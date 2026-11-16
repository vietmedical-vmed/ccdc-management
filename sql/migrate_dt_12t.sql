-- =====================================================================
-- Migration: doanh thu thực hiện 12 tháng gần nhất theo KH × nhóm SP (màn Phân bổ)
--   Cửa sổ: 12 tháng kết thúc ở tháng hiện tại − 1 (tháng hiện tại = shared.app_config.current_month).
--   VD current_month = 2026-11 → 2025-11 … 2026-10.
--   Không theo năm tài chính: gộp mọi FY trong cửa sổ.
-- Chạy 1 lần trên SQL Editor.
-- =====================================================================

begin;

create or replace view app_ccdc.v_dt_12t_kh_nhom as
with cur as (
  select (coalesce(
            (select value #>> '{}' from shared.app_config where key = 'current_month'),
            to_char(now(), 'YYYY-MM')) || '-01')::date as thang
),
win as (
  select to_char(thang - interval '12 months', 'YYYY-MM') as tu_thang,
         to_char(thang - interval '1 month',  'YYYY-MM') as den_thang
  from cur
)
select s.ma_khach_hang,
       s.nhom_san_pham,
       sum(coalesce(s.doanh_thu_thuc_hien, 0)) as dt_12t,
       min(win.tu_thang)  as tu_thang,
       min(win.den_thang) as den_thang
from shared.sale_target s
cross join win
where s.ma_khach_hang is not null
  and coalesce(s.bu, '') <> 'test'
  and left(s.thang_ke_hoach, 7) between win.tu_thang and win.den_thang
group by s.ma_khach_hang, s.nhom_san_pham;

comment on view app_ccdc.v_dt_12t_kh_nhom is
  'Doanh thu thực hiện 12 tháng tới tháng hiện tại − 1, theo KH × nhóm SP. Chỉ service_role.';

revoke all on app_ccdc.v_dt_12t_kh_nhom from public, anon, authenticated;
grant select on app_ccdc.v_dt_12t_kh_nhom to service_role;

commit;
