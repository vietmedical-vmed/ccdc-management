-- =====================================================================
-- Platform quản lý CCDC & Thiết bị  —  SCHEMA (Supabase / Postgres)
-- Mô hình 3 lớp trên master DÙNG CHUNG shared.dm_vat_tu
--
--   Lớp 1  shared.dm_vat_tu    : master vật tư datamart (đã có cột phan_loai
--                                với 6 taxonomy sales: DISPOSABLE, CCDC,
--                                IMPLANT, THIẾT BỊ, TRAINING, DỊCH VỤ KHÁC —
--                                do team khác quản, project này CHỈ ĐỌC)
--   Lớp 2  app_ccdc.ccdc_thuoc_tinh : mở rộng 1-1 cho mã CCDC/THIẾT BỊ
--          app_ccdc.cau_hinh_khau_hao : mặc định số tháng khấu hao theo loại
--   Lớp 3  app_ccdc.tai_san         : tồn/đăng ký tài sản nội bộ
--          app_ccdc.giao_dich       : ledger giá trị (nguồn sự thật)
--          app_ccdc.ngan_sach       : budget mua mới
--   Views  app_ccdc.v_dm_ccdc · v_gia_tri_con_lai · v_ton_hien_tai
--          v_gia_tri_theo_ky · v_budget_canh_bao
--
-- NGUYÊN TẮC:
--   * project chỉ đọc dm_vat_tu, KHÔNG ghi (kể cả phan_loai).
--   * ccdc_thuoc_tinh cho biết mã nào là TB (quan_ly_serial=true) vs CCDC.
--   * giao_dich là nguồn sự thật của GIÁ TRỊ; tồn/giá trị đều suy ra từ đây.
--
-- LƯU Ý DEPLOY:
--   1. Schema `app_ccdc` phải được EXPOSE trong Supabase Dashboard:
--        Settings → API → Exposed schemas → thêm 'app_ccdc' → Save
--   2. shared.dm_vat_tu.phan_loai đã tồn tại — KHÔNG ALTER lại.
--   3. Chạy file này 1 lần trên SQL Editor. Idempotent (dùng if not exists).
--
-- FK MỀM (soft reference) tới shared.dm_vat_tu.ma_bravo:
--   * dm_vat_tu.ma_bravo KHÔNG có UNIQUE constraint (89 dòng 'Chưa có',
--     3 dòng TH.AR.A03.0021, 2 dòng NULL) → Postgres không cho tạo FK.
--   * app_ccdc.* CHỦ Ý bỏ FK, dựa vào script import (validate existing_ma
--     trước insert) + JOIN ở view. Nếu team master dedup + add PK sau này,
--     có thể thêm FK bằng ALTER TABLE ADD CONSTRAINT.
-- =====================================================================


-- --------------------------------------------------------------------
-- 0. SCHEMA app_ccdc
-- --------------------------------------------------------------------
create schema if not exists app_ccdc;


-- --------------------------------------------------------------------
-- 1. CẤU HÌNH KHẤU HAO (mặc định theo phân loại)
--    Key = giá trị phan_loai trong shared.dm_vat_tu (CCDC, THIẾT BỊ)
-- --------------------------------------------------------------------
create table if not exists app_ccdc.cau_hinh_khau_hao (
  phan_loai text primary key,
  so_thang  int  not null check (so_thang > 0)
);

insert into app_ccdc.cau_hinh_khau_hao (phan_loai, so_thang)
values ('CCDC', 24), ('THIẾT BỊ', 48)
on conflict (phan_loai) do nothing;


-- --------------------------------------------------------------------
-- 2. MỞ RỘNG 1-1: thuộc tính riêng của CCDC/THIẾT BỊ
-- --------------------------------------------------------------------
create table if not exists app_ccdc.ccdc_thuoc_tinh (
  ma_bravo         text primary key,  -- FK mềm → shared.dm_vat_tu(ma_bravo)
  quan_ly_serial   boolean not null default false,  -- THIẾT BỊ=true, CCDC=false
  so_thang_su_dung int,                              -- override; null = lấy theo cau_hinh
  ghi_chu          text,
  updated_at       timestamptz not null default now()
);


-- --------------------------------------------------------------------
-- 3. TỒN / ĐĂNG KÝ TÀI SẢN
--    THIẾT BỊ: 1 dòng = 1 máy (serial, so_luong=1).
--    CCDC: 1 dòng = 1 tổ hợp (mã × vị trí × PIC × tình trạng) với so_luong.
-- --------------------------------------------------------------------
create table if not exists app_ccdc.tai_san (
  id            bigint generated always as identity primary key,
  ma_bravo      text not null,                 -- FK mềm → shared.dm_vat_tu(ma_bravo)
  serial        text,                          -- THIẾT BỊ: bắt buộc & unique; CCDC: null
  vi_tri        text,                          -- tên vị trí cụ thể (BV cho TB)
  loai_vi_tri   text check (loai_vi_tri in ('Kho','Sale/KTV','Bệnh viện')),
  mien          text,                          -- Miền Bắc / Miền Trung / Miền Nam
  pic           text,                          -- lưu bằng TÊN
  pic_id        text,                          -- mã điểm nội bộ (từ Excel PIC ID)
  tinh_trang    text not null default 'dang_dung'
                  check (tinh_trang in
                    ('dang_dung','dang_sua','hong','mat','cho_thanh_ly','da_thanh_ly')),
  trang_thai_hd text not null default 'Active'
                  check (trang_thai_hd in ('Active','Inactive')),
  so_luong      numeric not null default 1 check (so_luong > 0),
  nguyen_gia    numeric not null default 0,    -- đơn giá gốc 1 đơn vị (cho khấu hao)
  ngay_mua      date,
  ghi_chu       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists ux_tai_san_serial
  on app_ccdc.tai_san(serial) where serial is not null;
create index if not exists ix_tai_san_ma on app_ccdc.tai_san(ma_bravo);

-- Idempotent add cho DB đã có bảng từ trước
alter table app_ccdc.tai_san add column if not exists pic_id text;


-- --------------------------------------------------------------------
-- 4. GIAO DỊCH (ledger giá trị — nguồn sự thật)
--    loai: ton_dau | nhap_moi | huy | mat | dieu_chuyen
-- --------------------------------------------------------------------
create table if not exists app_ccdc.giao_dich (
  id          bigint generated always as identity primary key,
  ngay        date not null default current_date,
  loai        text not null
                check (loai in ('ton_dau','nhap_moi','huy','mat','dieu_chuyen')),
  ma_bravo    text not null,                          -- FK mềm → shared.dm_vat_tu(ma_bravo)
  tai_san_id  bigint references app_ccdc.tai_san(id), -- huy/mat/dieu_chuyen: trỏ tài sản cụ thể (FK nội bộ)
  so_luong    numeric not null default 1 check (so_luong > 0),
  don_gia     numeric not null default 0,
  thanh_tien  numeric,                               -- TRIGGER tính
  ky          date generated always as
                (make_date(extract(year from ngay)::int,
                           extract(month from ngay)::int, 1)) stored,
  vi_tri_tu   text, vi_tri_den text, pic_tu text, pic_den text,
  ghi_chu     text,
  created_at  timestamptz not null default now()
);

create index if not exists ix_gd_ma_loai_ky on app_ccdc.giao_dich(ma_bravo, loai, ky);


-- --------------------------------------------------------------------
-- 5. NGÂN SÁCH đăng ký đầu năm (theo mã Bravo × miền × FY)
-- --------------------------------------------------------------------
create table if not exists app_ccdc.ngan_sach (
  id             bigint generated always as identity primary key,
  nam_tai_chinh  int  not null,                       -- vd 2026 = FY26
  ma_bravo       text not null,                       -- FK mềm → shared.dm_vat_tu
  mien           text,                                -- Miền Bắc/Trung/Nam, null = tất cả
  so_luong       int  not null check (so_luong > 0),
  unique (nam_tai_chinh, ma_bravo, mien)
);


-- ====================================================================
-- 6. HÀM
-- ====================================================================

-- FY convention org: T4-T3, FY name = starting year.
--   VD: 2026-04-01 → 2027-03-31 = FY26.  Đầu FY26 = 2026-04-01.
create or replace function app_ccdc.fn_fy(d date, thang_bat_dau int default 4)
returns int language sql immutable as $$
  select case when extract(month from d) >= thang_bat_dau
              then extract(year from d)::int
              else extract(year from d)::int - 1 end;
$$;

create or replace function app_ccdc.fn_gia_tri_con_lai(
  nguyen_gia numeric, ngay_mua date, so_thang int, ngay_tinh date default current_date
) returns numeric language sql immutable as $$
  select case
    when nguyen_gia is null then 0
    when so_thang is null or so_thang <= 0 or ngay_mua is null then nguyen_gia
    else greatest(0,
      nguyen_gia
      * (so_thang - (extract(year  from age(ngay_tinh, ngay_mua)) * 12
                   + extract(month from age(ngay_tinh, ngay_mua)))::int)::numeric
      / so_thang)
  end;
$$;

-- Số tháng khấu hao 1 mã: override ở ccdc_thuoc_tinh, else theo cau_hinh
create or replace function app_ccdc.fn_so_thang_kh(p_ma text)
returns int language sql stable as $$
  select coalesce(
    (select ct.so_thang_su_dung from app_ccdc.ccdc_thuoc_tinh ct
      where ct.ma_bravo = p_ma),
    (select ck.so_thang from app_ccdc.cau_hinh_khau_hao ck
       join shared.dm_vat_tu vt on vt.phan_loai = ck.phan_loai
      where vt.ma_bravo = p_ma)
  );
$$;

-- Trigger: tính thanh_tien theo loai giao dịch
create or replace function app_ccdc.trg_set_thanh_tien()
returns trigger language plpgsql as $$
declare
  v_nguyen_gia numeric;
  v_ngay_mua   date;
  v_so_thang   int;
begin
  if new.loai in ('ton_dau','nhap_moi') then
    new.thanh_tien := new.so_luong * new.don_gia;
  elsif new.loai = 'dieu_chuyen' then
    new.thanh_tien := 0;
  elsif new.loai in ('huy','mat') then
    select ts.nguyen_gia, ts.ngay_mua
      into v_nguyen_gia, v_ngay_mua
      from app_ccdc.tai_san ts where ts.id = new.tai_san_id;
    v_nguyen_gia := coalesce(v_nguyen_gia, new.don_gia);
    v_so_thang   := app_ccdc.fn_so_thang_kh(new.ma_bravo);
    new.thanh_tien := new.so_luong
      * app_ccdc.fn_gia_tri_con_lai(v_nguyen_gia, v_ngay_mua, v_so_thang, new.ngay);
  end if;
  return new;
end $$;

drop trigger if exists trg_giao_dich_tt on app_ccdc.giao_dich;
create trigger trg_giao_dich_tt
  before insert or update on app_ccdc.giao_dich
  for each row execute function app_ccdc.trg_set_thanh_tien();


-- ====================================================================
-- 7. VIEWS
-- ====================================================================

create or replace view app_ccdc.v_dm_ccdc as
  select * from shared.dm_vat_tu where phan_loai in ('CCDC','THIẾT BỊ');

create or replace view app_ccdc.v_gia_tri_con_lai as
  select ts.id, ts.ma_bravo, vt.phan_loai, ts.serial, ts.vi_tri, ts.pic,
         ts.tinh_trang, ts.so_luong, ts.nguyen_gia,
         ts.so_luong * app_ccdc.fn_gia_tri_con_lai(
           ts.nguyen_gia, ts.ngay_mua, app_ccdc.fn_so_thang_kh(ts.ma_bravo)
         ) as gia_tri_con_lai
  from app_ccdc.tai_san ts
  join shared.dm_vat_tu vt on vt.ma_bravo = ts.ma_bravo
  where ts.trang_thai_hd = 'Active'
    and ts.tinh_trang not in ('mat','da_thanh_ly');

create or replace view app_ccdc.v_ton_hien_tai as
  select ts.ma_bravo, vt.ten_vat_tu, vt.nhom_san_pham, vt.phan_loai,
         ts.mien, ts.loai_vi_tri, ts.vi_tri, ts.pic, ts.tinh_trang,
         sum(ts.so_luong) as so_luong
  from app_ccdc.tai_san ts
  join shared.dm_vat_tu vt on vt.ma_bravo = ts.ma_bravo
  where ts.trang_thai_hd = 'Active'
  group by ts.ma_bravo, vt.ten_vat_tu, vt.nhom_san_pham, vt.phan_loai,
           ts.mien, ts.loai_vi_tri, ts.vi_tri, ts.pic, ts.tinh_trang;

create or replace view app_ccdc.v_gia_tri_theo_ky as
  select ma_bravo, ky, app_ccdc.fn_fy(ky) as fy, loai,
         sum(so_luong)   as sl,
         sum(thanh_tien) as gia_tri
  from app_ccdc.giao_dich
  group by ma_bravo, ky, loai;

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
           ma_bravo, nhom_san_pham, ma_ncc, ten_vat_tu, don_gia_mua
    from shared.dm_vat_tu
    where ma_bravo is not null and ma_bravo <> 'Chưa có'
    order by ma_bravo
  )
  select ns.id, ns.nam_tai_chinh as fy, ns.ma_bravo, ns.mien,
         dm.nhom_san_pham, dm.ma_ncc, dm.ten_vat_tu, dm.don_gia_mua,
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
           dm.nhom_san_pham, dm.ma_ncc, dm.ten_vat_tu, dm.don_gia_mua, ns.so_luong;


-- ====================================================================
-- 8. RLS  (đọc mở cho user đăng nhập; ghi tạm mở — siết theo role sau)
-- ====================================================================
alter table app_ccdc.ccdc_thuoc_tinh   enable row level security;
alter table app_ccdc.cau_hinh_khau_hao enable row level security;
alter table app_ccdc.tai_san           enable row level security;
alter table app_ccdc.giao_dich         enable row level security;
alter table app_ccdc.ngan_sach         enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'ccdc_thuoc_tinh','cau_hinh_khau_hao','tai_san','giao_dich','ngan_sach'
  ] loop
    execute format('drop policy if exists p_read_auth  on app_ccdc.%I', t);
    execute format('drop policy if exists p_write_auth on app_ccdc.%I', t);
    execute format(
      'create policy p_read_auth  on app_ccdc.%I for select to authenticated using (true)', t);
    -- TODO: siết theo role trong JWT, vd: with check (upper(auth.jwt()->>''role'') = ''ADMIN'')
    execute format(
      'create policy p_write_auth on app_ccdc.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Cấp quyền cho service_role & authenticated đọc/ghi
grant usage on schema app_ccdc to service_role, authenticated, anon;
grant all on all tables    in schema app_ccdc to service_role;
grant all on all sequences in schema app_ccdc to service_role;
grant select, insert, update, delete on all tables in schema app_ccdc to authenticated;
grant usage, select on all sequences in schema app_ccdc to authenticated;

alter default privileges in schema app_ccdc
  grant all on tables to service_role;
alter default privileges in schema app_ccdc
  grant select, insert, update, delete on tables to authenticated;

-- =====================================================================
-- HẾT. Thứ tự dùng:
--   (1) Expose 'app_ccdc' ở Dashboard → Settings → API → Exposed schemas
--   (2) Chạy file này trên SQL Editor
--   (3) Nhập ngan_sach thủ công (nếu cần)
--   (4) Import tồn đầu kỳ:  python scripts/import_ton_ccdc.py <file.xlsx> --push
-- =====================================================================
