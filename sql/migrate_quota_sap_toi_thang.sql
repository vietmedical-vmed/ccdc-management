-- =====================================================================
-- Migration: quota upcoming theo tháng thầu (màn Phân bổ, Hệ số đầu tư dự kiến)
--   Upcoming = đợt thầu (loai <> 'cu') chưa tới tháng thầu (> tháng hiện tại, hoặc chưa có tháng),
--   cùng điều kiện như quota_tien_sap_toi trong v_quota_kh_nhom, nhưng tách theo tháng thầu
--   và gộp mọi năm tài chính — để chỉ cộng các đợt rơi vào thời gian khấu hao còn lại.
-- Chạy 1 lần trên SQL Editor.
-- =====================================================================

begin;

create or replace view app_ccdc.v_quota_sap_toi_thang as
with cur as (
  select coalesce(
    (select value #>> '{}' from shared.app_config where key = 'current_month'),
    to_char(now(), 'YYYY-MM')) as thang
)
select q.ma_khach_hang,
       q.nhom_san_pham,
       d.thang_thau,
       sum(q.so_luong * q.don_gia) as quota_tien
from shared.quota_thau q
cross join cur
left join shared.dot_thau d
       on d.nam_tai_chinh = q.nam_tai_chinh and d.ps = q.ps
      and d.ma_khach_hang = q.ma_khach_hang and d.nhom_san_pham = q.nhom_san_pham
      and d.loai = q.loai and d.dot = q.dot
where q.trang_thai = 'chinh_thuc'
  and coalesce(q.bu, '') <> 'test'
  and q.so_luong <> 0
  and q.loai <> 'cu'
  and (d.thang_thau is null or d.thang_thau > cur.thang)
group by q.ma_khach_hang, q.nhom_san_pham, d.thang_thau;

comment on view app_ccdc.v_quota_sap_toi_thang is
  'Quota upcoming (đợt chưa tới tháng thầu) theo KH × nhóm SP × tháng thầu, mọi FY. Chỉ service_role.';

revoke all on app_ccdc.v_quota_sap_toi_thang from public, anon, authenticated;
grant select on app_ccdc.v_quota_sap_toi_thang to service_role;

commit;
