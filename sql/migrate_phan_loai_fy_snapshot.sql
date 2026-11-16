-- =====================================================================
-- Migration: phân loại TB / CCDC cho dòng snapshot + sửa năm tài chính của snapshot
--   * phan_loai: lấy cột "Nhóm" trong file (TB / CCDC). File không có → theo
--     shared.dm_vat_tu.phan_loai ('THIẾT BỊ' → TB); không mã Bravo → CCDC.
--   * fiscal_year: quy ước org T4–T3, đặt tên theo năm bắt đầu (T11/2026 → 2026 = FY26),
--     giống fyOf() ở app và nam_tai_chinh của quota. Không dùng app_ccdc.fn_fy vì bản
--     trên DB đang tính từ tháng 7 theo năm kết thúc (T11/2026 → 2027), và module
--     ngân sách còn dùng hàm đó.
--   * Ngày đặt = ngày ký gửi: chép ngay_dat sang ngay_ky_gui cho snapshot đã upload.
-- Chạy 1 lần trên SQL Editor, sau migrate_chuan_hoa_nhom_bv.sql.
-- =====================================================================

begin;

-- 1. Cột phân loại
alter table app_ccdc.snapshot_items
  add column if not exists phan_loai text;

alter table app_ccdc.snapshot_items
  drop constraint if exists ck_snapshot_items_phan_loai;
alter table app_ccdc.snapshot_items
  add constraint ck_snapshot_items_phan_loai check (phan_loai in ('TB', 'CCDC'));

-- 2. Hàm phân loại 1 dòng
create or replace function app_ccdc.fn_phan_loai_snapshot(p_file text, p_ma_bravo text)
returns text language sql stable as $$
  select case
    when upper(btrim(p_file)) in ('TB', 'THIẾT BỊ', 'THIET BI') then 'TB'
    when upper(btrim(p_file)) = 'CCDC' then 'CCDC'
    when exists (select 1 from shared.dm_vat_tu vt
                  where vt.ma_bravo = btrim(p_ma_bravo) and vt.phan_loai = 'THIẾT BỊ') then 'TB'
    else 'CCDC'
  end
$$;

-- 3. Năm tài chính của kỳ snapshot (T4–T3, tên theo năm bắt đầu)
create or replace function app_ccdc.fn_fy_snapshot(p_ky date)
returns int language sql immutable as $$
  select case when extract(month from p_ky) >= 4
              then extract(year from p_ky)::int
              else extract(year from p_ky)::int - 1 end
$$;

-- 4. Sửa dữ liệu đã có
update app_ccdc.snapshots
   set fiscal_year = app_ccdc.fn_fy_snapshot(ky_cap_nhat)
 where fiscal_year is distinct from app_ccdc.fn_fy_snapshot(ky_cap_nhat);

update app_ccdc.snapshot_items
   set phan_loai = app_ccdc.fn_phan_loai_snapshot(null, ma_bravo)
 where phan_loai is null;

-- "Ngày đặt" và "Ngày ký gửi" là một: app chỉ hiển thị ngay_ky_gui, upload mới map "Ngày đặt" vào ngay_ky_gui.
-- Cột ngay_dat giữ lại cho tương thích (view vẫn dùng coalesce(ngay_dat, ngay_ky_gui)).
update app_ccdc.snapshot_items
   set ngay_ky_gui = ngay_dat
 where ngay_ky_gui is null and ngay_dat is not null;

-- 5. Upload snapshot (bản đầy đủ, thay bản ở migrate_chuan_hoa_nhom_bv.sql)
create or replace function app_ccdc.fn_snapshot_replace(
  p_nhom        text,
  p_ky          date,
  p_nguon_file  text,
  p_ghi_chu     text,
  p_created_by  text,
  p_items       jsonb
) returns bigint language plpgsql as $$
declare
  v_nhom text := app_ccdc.fn_nhom_chuan(p_nhom);
  v_ky date := date_trunc('month', p_ky)::date;
  v_thang text := to_char(date_trunc('month', p_ky), 'YYYY-MM');
  v_id bigint;
begin
  delete from app_ccdc.snapshots
   where nhom_san_pham = v_nhom and ky_cap_nhat = v_ky;

  insert into app_ccdc.snapshots
    (nhom_san_pham, ky_cap_nhat, fiscal_year, nguon_file, ghi_chu, created_by)
  values
    (v_nhom, v_ky, app_ccdc.fn_fy_snapshot(v_ky), p_nguon_file, p_ghi_chu, p_created_by)
  returning id into v_id;

  insert into app_ccdc.snapshot_items
    (snapshot_id, ma_bv, ten_bv, ma_bravo, ma_ncc, ten_ccdc, serial, dvt,
     so_luong, ngay_ky_gui, ktv_phu_trach, note, mien, loai_vi_tri,
     ngay_dat, chi_phi_khau_hao, so_nam_khau_hao, phan_loai)
  select v_id,
         x.ma_bv,
         coalesce(app_ccdc.fn_ten_bv(x.ma_bv), nullif(trim(x.j->>'ten_bv'), '')),
         x.ma_bravo,
         nullif(trim(x.j->>'ma_ncc'), ''),
         trim(x.j->>'ten_ccdc'),
         nullif(trim(x.j->>'serial'), ''),
         nullif(trim(x.j->>'dvt'), ''),
         coalesce(round(nullif(x.j->>'so_luong', '')::numeric)::int, 1),
         nullif(x.j->>'ngay_ky_gui', '')::date,
         nullif(trim(x.j->>'ktv_phu_trach'), ''),
         nullif(trim(x.j->>'note'), ''),
         app_ccdc.fn_mien_bv(x.ma_bv, v_nhom, v_thang),
         'Bệnh viện',
         nullif(x.j->>'ngay_dat', '')::date,
         round(nullif(x.j->>'chi_phi_khau_hao', '')::numeric),
         nullif(x.j->>'so_nam_khau_hao', '')::numeric,
         app_ccdc.fn_phan_loai_snapshot(x.j->>'phan_loai', x.ma_bravo)
    from (select j,
                 nullif(upper(trim(j->>'ma_bv')), '') as ma_bv,
                 nullif(trim(j->>'ma_bravo'), '')     as ma_bravo
            from jsonb_array_elements(p_items) j) x
   where nullif(trim(x.j->>'ten_ccdc'), '') is not null;

  update app_ccdc.snapshots s
     set tong_dong = c.n, tong_sl = c.sl
    from (select count(*) as n, coalesce(sum(so_luong), 0) as sl
            from app_ccdc.snapshot_items where snapshot_id = v_id) c
   where s.id = v_id;

  return v_id;
end $$;

-- 6. View items: tạo lại để có cột phan_loai (si.* cố định danh sách cột lúc tạo view)
drop view if exists app_ccdc.v_snapshot_items;
create view app_ccdc.v_snapshot_items
with (security_invoker = true) as
select si.*,
       s.ky_cap_nhat,
       si.chi_phi_khau_hao * si.so_luong as nguyen_gia,
       kh.thang_da_kh,
       case
         when si.chi_phi_khau_hao is null then null
         when coalesce(si.so_nam_khau_hao, 0) <= 0 then si.chi_phi_khau_hao * si.so_luong
         else round(si.chi_phi_khau_hao * si.so_luong
                    * (1 - kh.thang_da_kh / (si.so_nam_khau_hao * 12)))
       end as gtcl
from app_ccdc.snapshot_items si
join app_ccdc.snapshots s on s.id = si.snapshot_id
cross join lateral (
  select case
           when coalesce(si.ngay_dat, si.ngay_ky_gui) is null or coalesce(si.so_nam_khau_hao, 0) <= 0 then 0
           else least(greatest(
                  (extract(year from s.ky_cap_nhat) - extract(year from coalesce(si.ngay_dat, si.ngay_ky_gui))) * 12
                + (extract(month from s.ky_cap_nhat) - extract(month from coalesce(si.ngay_dat, si.ngay_ky_gui))) + 1,
                  0), si.so_nam_khau_hao * 12)
         end::numeric as thang_da_kh
) kh;

comment on view app_ccdc.v_snapshot_items is
  'snapshot_items + nguyên giá, số tháng đã khấu hao và giá trị còn lại (GTCL) tại hết tháng kỳ snapshot.';

revoke all on app_ccdc.v_snapshot_items from public, anon, authenticated;
grant select on app_ccdc.v_snapshot_items to service_role;

revoke all on function app_ccdc.fn_phan_loai_snapshot(text, text) from public;
revoke all on function app_ccdc.fn_fy_snapshot(date) from public;
revoke all on function app_ccdc.fn_snapshot_replace(text, date, text, text, text, jsonb) from public;
grant execute on function app_ccdc.fn_phan_loai_snapshot(text, text) to service_role;
grant execute on function app_ccdc.fn_fy_snapshot(date) to service_role;
grant execute on function app_ccdc.fn_snapshot_replace(text, date, text, text, text, jsonb) to service_role;

commit;
