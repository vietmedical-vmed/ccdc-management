-- =====================================================================
-- Migration: ngan_sach v2 — từ ngân sách tiền → đăng ký theo mã Bravo + SL
-- Chạy 1 lần trên SQL Editor. Dữ liệu cũ sẽ bị xoá (model khác hoàn toàn).
-- =====================================================================

begin;

-- 1. Xoá view phụ thuộc trước
drop view if exists app_ccdc.v_budget_canh_bao;

-- 2. Xoá bảng cũ, tạo lại
drop table if exists app_ccdc.ngan_sach;

create table app_ccdc.ngan_sach (
  id             bigint generated always as identity primary key,
  nam_tai_chinh  int  not null,                       -- vd 2026 = FY26
  ma_bravo       text not null,                       -- FK mềm → shared.dm_vat_tu
  mien           text,                                -- Miền Bắc/Trung/Nam, null = tất cả
  so_luong       int  not null check (so_luong > 0),
  unique (nam_tai_chinh, ma_bravo, mien)
);

-- 3. RLS + policy (giống cũ)
alter table app_ccdc.ngan_sach enable row level security;

drop policy if exists p_read_auth  on app_ccdc.ngan_sach;
drop policy if exists p_write_auth on app_ccdc.ngan_sach;
create policy p_read_auth  on app_ccdc.ngan_sach for select to authenticated using (true);
create policy p_write_auth on app_ccdc.ngan_sach for all    to authenticated using (true) with check (true);

grant select, insert, update, delete on app_ccdc.ngan_sach to authenticated;
grant all on app_ccdc.ngan_sach to service_role;
grant usage, select on all sequences in schema app_ccdc to authenticated;

-- 4. View cảnh báo mới — so sánh SL đăng ký vs SL nhập mới, kèm giá trị tiền
create or replace view app_ccdc.v_budget_canh_bao as
  with dung as (
    select g.ma_bravo, ts.mien, app_ccdc.fn_fy(g.ky) as fy,
           sum(g.so_luong)   as sl_da_dung,
           sum(g.thanh_tien) as da_chi
    from app_ccdc.giao_dich g
    left join app_ccdc.tai_san ts on ts.id = g.tai_san_id
    where g.loai = 'nhap_moi'
    group by g.ma_bravo, ts.mien, app_ccdc.fn_fy(g.ky)
  ),
  dm as (
    select distinct on (ma_bravo)
           ma_bravo, nhom_san_pham, ma_ncc, ten_vat_tu
    from shared.dm_vat_tu
    where ma_bravo is not null and ma_bravo <> 'Chưa có'
    order by ma_bravo
  )
  select ns.id, ns.nam_tai_chinh as fy, ns.ma_bravo, ns.mien,
         dm.nhom_san_pham, dm.ma_ncc, dm.ten_vat_tu,
         ns.so_luong                              as sl_dang_ky,
         coalesce(sum(d.sl_da_dung), 0)::int      as sl_da_dung,
         coalesce(sum(d.da_chi), 0)               as da_chi,
         round(coalesce(sum(d.sl_da_dung),0)::numeric
               / nullif(ns.so_luong,0) * 100, 1)  as pct,
         case
           when coalesce(sum(d.sl_da_dung),0) >  ns.so_luong       then 'VUOT'
           when coalesce(sum(d.sl_da_dung),0) >= ns.so_luong * 0.8 then 'CANH_BAO'
           else 'OK'
         end as trang_thai
  from app_ccdc.ngan_sach ns
  left join dm   on dm.ma_bravo = ns.ma_bravo
  left join dung d on d.ma_bravo = ns.ma_bravo
                   and d.fy = ns.nam_tai_chinh
                   and (ns.mien is null or d.mien = ns.mien)
  group by ns.id, ns.nam_tai_chinh, ns.ma_bravo, ns.mien,
           dm.nhom_san_pham, dm.ma_ncc, dm.ten_vat_tu, ns.so_luong;

commit;
