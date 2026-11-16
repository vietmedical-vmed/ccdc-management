-- =====================================================================
-- Migration: khấu hao thiết bị trong snapshot ký gửi + giá trị còn lại (GTCL)
-- File ký gửi bổ sung 3 cột cho thiết bị (CCDC thường để trống chi phí):
--   "Ngày đặt"                 → ngay_dat         (ngày đặt máy tại BV, mốc bắt đầu khấu hao)
--   "Chi phí (tính khấu hao)"  → chi_phi_khau_hao (VNĐ / 1 đơn vị)
--   "Số năm khấu hao"          → so_nam_khau_hao
-- GTCL tính theo đường thẳng, theo tháng, chốt tại hết tháng kỳ snapshot:
--   thang_da_kh = số tháng từ tháng đặt tới tháng kỳ (tính cả 2 đầu), kẹp trong [0, số năm × 12]
--   gtcl        = chi_phi_khau_hao × so_luong × (1 − thang_da_kh / (số năm × 12))
-- Thiếu ngày đặt → dùng ngày ký gửi; thiếu cả 2 → chưa khấu hao (GTCL = nguyên giá).
-- Chạy 1 lần trên SQL Editor, sau migrate_mien_dia_ban.sql.
-- =====================================================================

begin;

-- 1. Cột mới
alter table app_ccdc.snapshot_items
  add column if not exists ngay_dat          date,
  add column if not exists chi_phi_khau_hao  numeric(18, 0),
  add column if not exists so_nam_khau_hao   numeric(5, 2);

-- 2. Upload snapshot: nhận thêm 3 cột (giữ nguyên phần còn lại của migrate_mien_dia_ban.sql)
create or replace function app_ccdc.fn_snapshot_replace(
  p_nhom        text,
  p_ky          date,
  p_nguon_file  text,
  p_ghi_chu     text,
  p_created_by  text,
  p_items       jsonb
) returns bigint language plpgsql as $$
declare
  v_ky date := date_trunc('month', p_ky)::date;
  v_thang text := to_char(date_trunc('month', p_ky), 'YYYY-MM');
  v_id bigint;
begin
  delete from app_ccdc.snapshots
   where nhom_san_pham = p_nhom and ky_cap_nhat = v_ky;

  insert into app_ccdc.snapshots
    (nhom_san_pham, ky_cap_nhat, fiscal_year, nguon_file, ghi_chu, created_by)
  values
    (p_nhom, v_ky, app_ccdc.fn_fy(v_ky), p_nguon_file, p_ghi_chu, p_created_by)
  returning id into v_id;

  insert into app_ccdc.snapshot_items
    (snapshot_id, ma_bv, ten_bv, ma_bravo, ma_ncc, ten_ccdc, serial, dvt,
     so_luong, ngay_ky_gui, ktv_phu_trach, note, mien, loai_vi_tri,
     ngay_dat, chi_phi_khau_hao, so_nam_khau_hao)
  select v_id,
         nullif(trim(x->>'ma_bv'), ''),
         nullif(trim(x->>'ten_bv'), ''),
         nullif(trim(x->>'ma_bravo'), ''),
         nullif(trim(x->>'ma_ncc'), ''),
         trim(x->>'ten_ccdc'),
         nullif(trim(x->>'serial'), ''),
         nullif(trim(x->>'dvt'), ''),
         coalesce(round(nullif(x->>'so_luong', '')::numeric)::int, 1),
         nullif(x->>'ngay_ky_gui', '')::date,
         nullif(trim(x->>'ktv_phu_trach'), ''),
         nullif(trim(x->>'note'), ''),
         app_ccdc.fn_mien_bv(nullif(trim(x->>'ma_bv'), ''), p_nhom, v_thang),
         'Bệnh viện',
         nullif(x->>'ngay_dat', '')::date,
         round(nullif(x->>'chi_phi_khau_hao', '')::numeric),
         nullif(x->>'so_nam_khau_hao', '')::numeric
    from jsonb_array_elements(p_items) x
   where nullif(trim(x->>'ten_ccdc'), '') is not null;

  update app_ccdc.snapshots s
     set tong_dong = c.n, tong_sl = c.sl
    from (select count(*) as n, coalesce(sum(so_luong), 0) as sl
            from app_ccdc.snapshot_items where snapshot_id = v_id) c
   where s.id = v_id;

  return v_id;
end $$;

revoke all on function app_ccdc.fn_snapshot_replace(text, date, text, text, text, jsonb) from public;
grant execute on function app_ccdc.fn_snapshot_replace(text, date, text, text, text, jsonb) to service_role;

-- 3. View items kèm nguyên giá, số tháng đã khấu hao, GTCL tại kỳ snapshot.
--    Edge function đọc view này thay cho bảng snapshot_items.
create or replace view app_ccdc.v_snapshot_items
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

commit;
