-- =====================================================================
-- Migration: dữ liệu quota thầu cho màn Phân bổ CCDC
-- So số CCDC ký gửi (snapshot) với quota thầu còn lại theo KH × nhóm SP.
-- Nguồn quota: shared.quota_thau + shared.dot_thau (app Kế hoạch kinh doanh / sale-target).
-- Nguồn thực hiện: shared.sale_target.doanh_thu_thuc_hien, sl_thuc_hien.
-- Chạy 1 lần trên SQL Editor, sau migrate_snapshot_ky_gui.sql.
-- =====================================================================

begin;

-- Quota & thực hiện theo FY × KH × nhóm SP. Tiền (VNĐ) để so được giữa các sản phẩm khác nhau
-- trong cùng nhóm; SL giữ để tham khảo.
--   quota_*_on_hand : thầu cũ còn lại + các đợt đã tới tháng thầu (<= current_month)
--   quota_*_sap_toi : các đợt chưa tới tháng thầu
--   dt_3_thang      : doanh thu thực hiện 3 tháng gần nhất tính tới current_month
create or replace view app_ccdc.v_quota_kh_nhom as
with cur as (
  select coalesce(
    (select value #>> '{}' from shared.app_config where key = 'current_month'),
    to_char(now(), 'YYYY-MM')) as thang
),
q as (
  select q.nam_tai_chinh, q.ma_khach_hang, q.nhom_san_pham,
         min(q.khach_hang) as khach_hang,
         sum(q.so_luong)                                                       as quota_sl,
         sum(q.so_luong * q.don_gia)                                           as quota_tien,
         sum(q.so_luong) filter (where q.loai = 'cu' or d.thang_thau <= cur.thang)            as quota_sl_on_hand,
         sum(q.so_luong * q.don_gia) filter (where q.loai = 'cu' or d.thang_thau <= cur.thang) as quota_tien_on_hand,
         sum(q.so_luong * q.don_gia) filter (where q.loai <> 'cu' and (d.thang_thau is null or d.thang_thau > cur.thang))
                                                                               as quota_tien_sap_toi,
         min(d.thang_thau) filter (where q.loai <> 'cu' and d.thang_thau > cur.thang) as thang_thau_sap_toi
  from shared.quota_thau q
  cross join cur
  left join shared.dot_thau d
         on d.nam_tai_chinh = q.nam_tai_chinh and d.ps = q.ps
        and d.ma_khach_hang = q.ma_khach_hang and d.nhom_san_pham = q.nhom_san_pham
        and d.loai = q.loai and d.dot = q.dot and q.loai <> 'cu'
  where q.trang_thai = 'chinh_thuc'
    and coalesce(q.bu, '') <> 'test'
    and q.so_luong <> 0
  group by q.nam_tai_chinh, q.ma_khach_hang, q.nhom_san_pham
),
th as (
  select s.nam_tai_chinh,
         coalesce(s.ma_khach_hang, '') as ma_khach_hang,
         coalesce(s.nhom_san_pham, '') as nhom_san_pham,
         min(s.khach_hang)                         as khach_hang,
         sum(coalesce(s.sl_thuc_hien, 0))          as sl_thuc_hien,
         sum(coalesce(s.doanh_thu_thuc_hien, 0))   as dt_thuc_hien,
         sum(coalesce(s.doanh_thu_thuc_hien, 0)) filter (
           where left(s.thang_ke_hoach, 7) <= cur.thang
             and left(s.thang_ke_hoach, 7) > to_char((cur.thang || '-01')::date - interval '3 months', 'YYYY-MM'))
                                                   as dt_3_thang
  from shared.sale_target s
  cross join cur
  where s.nam_tai_chinh is not null
    and coalesce(s.bu, '') <> 'test'
  group by s.nam_tai_chinh, coalesce(s.ma_khach_hang, ''), coalesce(s.nhom_san_pham, '')
)
select coalesce(q.nam_tai_chinh, th.nam_tai_chinh)   as nam_tai_chinh,
       coalesce(q.ma_khach_hang, th.ma_khach_hang)   as ma_khach_hang,
       coalesce(q.nhom_san_pham, th.nhom_san_pham)   as nhom_san_pham,
       coalesce(q.khach_hang, th.khach_hang)         as khach_hang,
       coalesce(q.quota_sl, 0)                       as quota_sl,
       coalesce(q.quota_tien, 0)                     as quota_tien,
       coalesce(q.quota_sl_on_hand, 0)               as quota_sl_on_hand,
       coalesce(q.quota_tien_on_hand, 0)             as quota_tien_on_hand,
       coalesce(q.quota_tien_sap_toi, 0)             as quota_tien_sap_toi,
       q.thang_thau_sap_toi,
       coalesce(th.sl_thuc_hien, 0)                  as sl_thuc_hien,
       coalesce(th.dt_thuc_hien, 0)                  as dt_thuc_hien,
       coalesce(th.dt_3_thang, 0)                    as dt_3_thang,
       greatest(coalesce(q.quota_tien_on_hand, 0) - coalesce(th.dt_thuc_hien, 0), 0) as quota_tien_con_lai,
       (select thang from cur)                       as current_month
from q
full join th
  on th.nam_tai_chinh = q.nam_tai_chinh
 and th.ma_khach_hang = q.ma_khach_hang
 and th.nhom_san_pham = q.nhom_san_pham;

comment on view app_ccdc.v_quota_kh_nhom is
  'Quota thầu (chính thức) và thực hiện theo FY × KH × nhóm SP, cho màn Phân bổ CCDC. Chỉ service_role.';

-- Quota là dữ liệu nội bộ của Kế hoạch kinh doanh: chỉ đọc qua edge function.
revoke all on app_ccdc.v_quota_kh_nhom from public, anon, authenticated;
grant select on app_ccdc.v_quota_kh_nhom to service_role;

commit;
