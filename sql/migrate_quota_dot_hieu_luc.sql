-- =====================================================================
-- Migration: quota theo đợt thầu kèm thời gian hiệu lực (màn Phân bổ, Hệ số đầu tư dự kiến)
-- Thay v_quota_sap_toi_thang. Mỗi đợt (loai <> 'cu') hiệu lực
--   [thang_thau, thang_thau + thoi_gian − 1]  (thoi_gian = số tháng của shared.dot_thau).
-- Chỉ lấy đợt còn hiệu lực hoặc chưa tới (tháng kết thúc ≥ tháng hiện tại), mọi năm tài chính.
-- Quota thầu cũ (loai = 'cu', không có đợt) trả 1 dòng theo năm tài chính, thang_thau / thoi_gian null.
-- Edge function dùng để tính quota và khấu hao trên CÙNG một khoảng thời gian.
-- Chạy 1 lần trên SQL Editor, rồi deploy ccdc-api.
-- =====================================================================

begin;

create or replace view app_ccdc.v_quota_dot_hieu_luc as
with cur as (
  select coalesce(
    (select value #>> '{}' from shared.app_config where key = 'current_month'),
    to_char(now(), 'YYYY-MM')) as thang
),
x as (
  select q.nam_tai_chinh, q.ma_khach_hang, q.nhom_san_pham, q.loai,
         d.thang_thau, d.thoi_gian,
         case when d.thang_thau is not null and d.thoi_gian > 0
              then to_char((d.thang_thau || '-01')::date
                           + make_interval(months => d.thoi_gian::int - 1), 'YYYY-MM')
         end as thang_het,
         q.so_luong * q.don_gia as tien
  from shared.quota_thau q
  left join shared.dot_thau d
         on d.nam_tai_chinh = q.nam_tai_chinh and d.ps = q.ps
        and d.ma_khach_hang = q.ma_khach_hang and d.nhom_san_pham = q.nhom_san_pham
        and d.loai = q.loai and d.dot = q.dot and q.loai <> 'cu'
  where q.trang_thai = 'chinh_thuc'
    and coalesce(q.bu, '') <> 'test'
    and q.so_luong <> 0
)
select x.nam_tai_chinh, x.ma_khach_hang, x.nhom_san_pham, x.loai,
       x.thang_thau, x.thoi_gian, x.thang_het,
       sum(x.tien) as quota_tien
from x
cross join cur
where x.loai = 'cu' or x.thang_het is null or x.thang_het >= cur.thang
group by x.nam_tai_chinh, x.ma_khach_hang, x.nhom_san_pham, x.loai, x.thang_thau, x.thoi_gian, x.thang_het;

comment on view app_ccdc.v_quota_dot_hieu_luc is
  'Quota theo đợt thầu còn hiệu lực / chưa tới, kèm tháng hết hiệu lực; thầu cũ theo FY. Chỉ service_role.';

revoke all on app_ccdc.v_quota_dot_hieu_luc from public, anon, authenticated;
grant select on app_ccdc.v_quota_dot_hieu_luc to service_role;

drop view if exists app_ccdc.v_quota_sap_toi_thang;

commit;
