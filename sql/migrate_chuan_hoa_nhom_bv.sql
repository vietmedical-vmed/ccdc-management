-- =====================================================================
-- Migration: chuẩn hoá nhóm SP và tên BV của snapshot ký gửi theo danh mục
--   * Nhóm SP: so khớp không phân biệt hoa/thường với shared.dm_vat_tu.nhom_san_pham
--     ("NSK ARTHREX" → "NSK Arthrex"). Không có trong danh mục → giữ nguyên tên nhập.
--   * Tên BV: lấy theo mã BV từ shared.dm_khach_hang (customer_alias, rỗng thì customer_name).
--     Mã không có trong danh mục → tạm dùng tên trong file.
-- Snapshot trùng (cùng nhóm sau chuẩn hoá × cùng kỳ): giữ bản upload sau cùng, XOÁ bản cũ hơn
-- (giống hành vi upload thay thế). Kiểm tra mục 2 trước khi chạy.
-- Chạy 1 lần trên SQL Editor, sau migrate_khau_hao_ky_gui.sql.
-- =====================================================================

begin;

-- 1. Hàm tra danh mục
create or replace function app_ccdc.fn_nhom_chuan(p_nhom text)
returns text language sql stable as $$
  select coalesce(
    (select vt.nhom_san_pham
       from shared.dm_vat_tu vt
      where lower(btrim(vt.nhom_san_pham)) = lower(btrim(p_nhom))
      group by vt.nhom_san_pham
      order by count(*) desc, vt.nhom_san_pham
      limit 1),
    btrim(p_nhom))
$$;

create or replace function app_ccdc.fn_ten_bv(p_ma_bv text)
returns text language sql stable as $$
  select coalesce(nullif(btrim(kh.customer_alias), ''), nullif(btrim(kh.customer_name), ''))
    from shared.dm_khach_hang kh
   where kh.customer_id = upper(btrim(p_ma_bv))
   limit 1
$$;

-- 2. Gộp snapshot trùng sau chuẩn hoá: giữ bản created_at mới nhất.
--    Xem trước:  select id, nhom_san_pham, ky_cap_nhat, tong_dong, created_at from app_ccdc.snapshots order by ky_cap_nhat, created_at;
delete from app_ccdc.snapshots s
 using (
   select id,
          row_number() over (partition by app_ccdc.fn_nhom_chuan(nhom_san_pham), ky_cap_nhat
                             order by created_at desc, id desc) as rn
     from app_ccdc.snapshots
 ) d
 where d.id = s.id and d.rn > 1;

update app_ccdc.snapshots
   set nhom_san_pham = app_ccdc.fn_nhom_chuan(nhom_san_pham)
 where nhom_san_pham is distinct from app_ccdc.fn_nhom_chuan(nhom_san_pham);

-- 3. Tên BV của snapshot đã upload lấy lại từ danh mục
update app_ccdc.snapshot_items si
   set ten_bv = app_ccdc.fn_ten_bv(si.ma_bv)
 where si.ma_bv is not null
   and app_ccdc.fn_ten_bv(si.ma_bv) is not null
   and si.ten_bv is distinct from app_ccdc.fn_ten_bv(si.ma_bv);

-- 4. Upload snapshot: chuẩn hoá nhóm SP, tên BV theo mã (bản đầy đủ, thay bản ở migrate_khau_hao_ky_gui.sql)
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
    (v_nhom, v_ky, app_ccdc.fn_fy(v_ky), p_nguon_file, p_ghi_chu, p_created_by)
  returning id into v_id;

  insert into app_ccdc.snapshot_items
    (snapshot_id, ma_bv, ten_bv, ma_bravo, ma_ncc, ten_ccdc, serial, dvt,
     so_luong, ngay_ky_gui, ktv_phu_trach, note, mien, loai_vi_tri,
     ngay_dat, chi_phi_khau_hao, so_nam_khau_hao)
  select v_id,
         x.ma_bv,
         coalesce(app_ccdc.fn_ten_bv(x.ma_bv), nullif(trim(x.j->>'ten_bv'), '')),
         nullif(trim(x.j->>'ma_bravo'), ''),
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
         nullif(x.j->>'so_nam_khau_hao', '')::numeric
    from (select j, nullif(upper(trim(j->>'ma_bv')), '') as ma_bv
            from jsonb_array_elements(p_items) j) x
   where nullif(trim(x.j->>'ten_ccdc'), '') is not null;

  update app_ccdc.snapshots s
     set tong_dong = c.n, tong_sl = c.sl
    from (select count(*) as n, coalesce(sum(so_luong), 0) as sl
            from app_ccdc.snapshot_items where snapshot_id = v_id) c
   where s.id = v_id;

  return v_id;
end $$;

revoke all on function app_ccdc.fn_nhom_chuan(text) from public;
revoke all on function app_ccdc.fn_ten_bv(text) from public;
revoke all on function app_ccdc.fn_snapshot_replace(text, date, text, text, text, jsonb) from public;
grant execute on function app_ccdc.fn_nhom_chuan(text) to service_role;
grant execute on function app_ccdc.fn_ten_bv(text) to service_role;
grant execute on function app_ccdc.fn_snapshot_replace(text, date, text, text, text, jsonb) to service_role;

commit;
