-- =====================================================================
-- Migration: Snapshot ký gửi — chuyển từ giao dịch sang mô hình snapshot
-- Mỗi kỳ (tháng) upload file Excel → full replace cho nhóm SP đó.
-- Diff (tính ở edge function ccdc-api, action snapshot_diff), so 2 snapshot cùng nhom_san_pham:
--   * có serial              → định danh theo (ma_bravo, serial), khác BV = chuyển
--   * không mã Bravo (bộ CCDC) → định danh theo tên bộ, khác BV = chuyển
--   * có mã Bravo, không serial → so SL theo (ma_bravo × BV)
-- Chạy 1 lần trên SQL Editor.
-- =====================================================================

begin;

-- 1. Bảng snapshot header
create table if not exists app_ccdc.snapshots (
  id              bigint generated always as identity primary key,
  nhom_san_pham   text not null,
  ky_cap_nhat     date not null,
  fiscal_year     int  not null,
  nguon_file      text,
  ghi_chu         text,
  tong_sl         int  not null default 0,
  tong_dong       int  not null default 0,
  created_at      timestamptz not null default now(),
  created_by      text,
  unique (nhom_san_pham, ky_cap_nhat)
);

-- 2. Bảng snapshot items (raw data từ Excel)
create table if not exists app_ccdc.snapshot_items (
  id              bigint generated always as identity primary key,
  snapshot_id     bigint not null references app_ccdc.snapshots(id) on delete cascade,
  ma_bv           text,
  ten_bv          text,
  ma_bravo        text,
  ma_ncc          text,
  ten_ccdc        text not null,
  serial          text,
  dvt             text,
  so_luong        int not null default 1,
  ngay_ky_gui     date,
  ktv_phu_trach   text,
  note            text,
  mien            text,
  loai_vi_tri     text default 'Bệnh viện'
);

create index if not exists ix_snapshot_items_snap
  on app_ccdc.snapshot_items(snapshot_id);
create index if not exists ix_snapshot_items_bv
  on app_ccdc.snapshot_items(ma_bv);

-- 3. Miền của BV lấy từ master khách hàng (shared.dm_khach_hang.area: 'MB' | 'Miền Bắc' | ...).
--    Chuẩn hoá về tên đầy đủ như app_ccdc.tai_san.mien.
create or replace view app_ccdc.v_bv_mien as
  select kh.customer_id as ma_bv,
         case
           when btrim(kh.area) in ('MB', 'Miền Bắc')   then 'Miền Bắc'
           when btrim(kh.area) in ('MT', 'Miền Trung') then 'Miền Trung'
           when btrim(kh.area) in ('MN', 'Miền Nam')   then 'Miền Nam'
         end as mien
  from shared.dm_khach_hang kh;

-- 4. Full replace 1 snapshot (nhóm SP × tháng) trong 1 transaction.
--    p_items: jsonb array, mỗi phần tử có các key trùng tên cột snapshot_items.
--    Miền chụp lại tại thời điểm upload từ v_bv_mien; mã BV không có trong master → mien = null.
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
         m.mien,
         'Bệnh viện'
    from jsonb_array_elements(p_items) x
    left join app_ccdc.v_bv_mien m on m.ma_bv = nullif(trim(x->>'ma_bv'), '')
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

-- 5. View: snapshot mới nhất per nhóm SP
create or replace view app_ccdc.v_latest_snapshot as
  select distinct on (nhom_san_pham)
         id, nhom_san_pham, ky_cap_nhat, fiscal_year,
         nguon_file, tong_sl, tong_dong, created_at, created_by
  from app_ccdc.snapshots
  order by nhom_san_pham, ky_cap_nhat desc;

-- 6. View: items snapshot mới nhất (dùng cho dashboard)
create or replace view app_ccdc.v_ky_gui_hien_tai as
  select si.*, s.nhom_san_pham as snap_nhom, s.ky_cap_nhat, s.fiscal_year
  from app_ccdc.snapshot_items si
  join app_ccdc.v_latest_snapshot s on s.id = si.snapshot_id;

-- 7. View: SL theo snapshot × miền (trend dashboard, lọc được theo miền của user)
create or replace view app_ccdc.v_snapshot_mien_sl as
  select si.snapshot_id, si.mien,
         sum(si.so_luong)::int as sl,
         count(*)::int         as so_dong
  from app_ccdc.snapshot_items si
  group by si.snapshot_id, si.mien;

-- 8. RLS
alter table app_ccdc.snapshots      enable row level security;
alter table app_ccdc.snapshot_items  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['snapshots','snapshot_items'] loop
    execute format('drop policy if exists p_read_auth  on app_ccdc.%I', t);
    execute format('drop policy if exists p_write_auth on app_ccdc.%I', t);
    execute format(
      'create policy p_read_auth  on app_ccdc.%I for select to authenticated using (true)', t);
    execute format(
      'create policy p_write_auth on app_ccdc.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

grant select, insert, update, delete on app_ccdc.snapshots     to authenticated;
grant select, insert, update, delete on app_ccdc.snapshot_items to authenticated;
grant all on app_ccdc.snapshots      to service_role;
grant all on app_ccdc.snapshot_items to service_role;
grant select on app_ccdc.v_bv_mien, app_ccdc.v_latest_snapshot, app_ccdc.v_ky_gui_hien_tai,
                app_ccdc.v_snapshot_mien_sl to service_role;
grant usage, select on all sequences in schema app_ccdc to authenticated;

commit;
