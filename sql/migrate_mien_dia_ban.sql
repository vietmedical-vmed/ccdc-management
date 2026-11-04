-- =====================================================================
-- Migration: miền của BV lấy từ shared.dm_dia_ban (thay shared.dm_khach_hang.area)
-- dm_dia_ban khai báo miền theo KH × nhóm SP, có hiệu lực [tu_thang, den_thang] (YYYY-MM).
-- Chạy 1 lần trên SQL Editor, sau migrate_snapshot_ky_gui.sql và migrate_phan_bo_quota.sql.
-- =====================================================================

begin;

-- 1. Miền của 1 BV tại 1 tháng. Ưu tiên khai báo đúng nhóm SP; không có thì lấy theo
--    khai báo khác của cùng KH. Nhiều PS cùng KH → lấy miền xuất hiện nhiều nhất.
create or replace function app_ccdc.fn_mien_bv(p_ma_bv text, p_nhom text, p_thang text)
returns text language sql stable as $$
  select mien from (
    select case
             when btrim(d.mien) in ('MB', 'Miền Bắc')   then 'Miền Bắc'
             when btrim(d.mien) in ('MT', 'Miền Trung') then 'Miền Trung'
             when btrim(d.mien) in ('MN', 'Miền Nam')   then 'Miền Nam'
           end as mien,
           d.nhom_san_pham = p_nhom as dung_nhom
    from shared.dm_dia_ban d
    where d.cust_key = btrim(p_ma_bv)
      and d.active
      and coalesce(d.bu, '') <> 'test'
      and d.tu_thang <= p_thang
      and (d.den_thang is null or d.den_thang >= p_thang)
  ) t
  where mien is not null
  group by mien, dung_nhom
  order by dung_nhom desc, count(*) desc, mien
  limit 1
$$;

-- Tra hàng loạt cho edge function (BV chỉ có quota, chưa có trong snapshot)
create or replace function app_ccdc.fn_mien_bv_list(p_ma_bv text[], p_nhom text, p_thang text)
returns table (ma_bv text, mien text) language sql stable as $$
  select x.ma_bv, app_ccdc.fn_mien_bv(x.ma_bv, p_nhom, p_thang)
  from unnest(p_ma_bv) as x(ma_bv)
$$;

-- 2. Upload snapshot chụp miền theo nhóm SP × tháng của snapshot
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
     so_luong, ngay_ky_gui, ktv_phu_trach, note, mien, loai_vi_tri)
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
         'Bệnh viện'
    from jsonb_array_elements(p_items) x
   where nullif(trim(x->>'ten_ccdc'), '') is not null;

  update app_ccdc.snapshots s
     set tong_dong = c.n, tong_sl = c.sl
    from (select count(*) as n, coalesce(sum(so_luong), 0) as sl
            from app_ccdc.snapshot_items where snapshot_id = v_id) c
   where s.id = v_id;

  return v_id;
end $$;

-- 3. Tính lại miền cho các snapshot đã upload theo cách cũ
update app_ccdc.snapshot_items si
   set mien = app_ccdc.fn_mien_bv(si.ma_bv, s.nhom_san_pham, to_char(s.ky_cap_nhat, 'YYYY-MM'))
  from app_ccdc.snapshots s
 where s.id = si.snapshot_id;

-- 4. Bỏ view map theo dm_khach_hang.area
drop view if exists app_ccdc.v_bv_mien;

revoke all on function app_ccdc.fn_mien_bv(text, text, text) from public;
revoke all on function app_ccdc.fn_mien_bv_list(text[], text, text) from public;
grant execute on function app_ccdc.fn_mien_bv(text, text, text) to service_role;
grant execute on function app_ccdc.fn_mien_bv_list(text[], text, text) to service_role;

commit;
