# Triển khai — CCDC Management

## Kiến trúc
- **Frontend**: SPA React CDN + Tailwind CDN, static host (GitHub Pages) từ `dashboard/`.
- **Backend**: 2 edge function Supabase (`ccdc-login`, `ccdc-api`) + schema `shared` (users, dm_vat_tu) và các bảng riêng (`ccdc_thuoc_tinh`, `tai_san`, `giao_dich`, `ngan_sach`, `cau_hinh_khau_hao`).
- **Auth**: dùng chung `shared.users` với sale-target / order / kpi. Token HMAC ký bằng `TOKEN_SECRET` (secret chung 1 lần cho project).

## Cấu trúc source
```
ccdc-management/
├── dashboard/                 (deploy tới GitHub Pages)
│   ├── index.html             ← shell SPA
│   ├── assets/js/
│   │   ├── config.js          ← SUPABASE_URL, anon key, tên edge function
│   │   ├── api.js             ← fetch helper + token storage
│   │   ├── auth.js            ← <LoginGate>
│   │   ├── router.js          ← hash router
│   │   ├── app.js             ← bootstrap, shell, nav
│   │   ├── components/        ← (chưa dùng) UI dùng chung: table, gauge, badge
│   │   └── screens/
│   │       ├── dashboard.js
│   │       ├── dm-vat-tu.js       (sắp thêm)
│   │       ├── giao-dich.js       (sắp thêm)
│   │       ├── tai-san.js         (sắp thêm)
│   │       └── ngan-sach.js       (sắp thêm)
│   └── report-legacy.html     ← dashboard tĩnh cũ, giữ tham chiếu
├── supabase/functions/
│   ├── ccdc-login/index.ts
│   └── ccdc-api/index.ts
├── sql/schema.sql
└── scripts/import_ton_ccdc.py
```

## Deploy edge functions

Chỉ chạy 1 lần đầu (cần Supabase CLI đã login):

```bash
supabase functions deploy ccdc-login --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
supabase functions deploy ccdc-api   --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
```

## Snapshot ký gửi

Mô hình báo cáo theo kỳ: mỗi tháng upload file Excel ký gửi của 1 nhóm SP ở màn **Ký gửi**. Upload thay thế toàn bộ snapshot cùng nhóm SP × tháng (chạy trong 1 transaction qua `app_ccdc.fn_snapshot_replace`).

Triển khai lần đầu:

1. Chạy `sql/migrate_snapshot_ky_gui.sql` trên SQL Editor.
2. Redeploy `ccdc-api` (thêm action `snapshot_upload`, `snapshot_list`, `snapshot_items`, `snapshot_diff`, `ky_gui_dashboard`).

Miền của mỗi dòng lấy từ `shared.dm_dia_ban` (cấu hình địa bàn bên Kế hoạch kinh doanh) theo mã BV ("Code KH") × nhóm SP, còn hiệu lực ở tháng của snapshot (`app_ccdc.fn_mien_bv`; chạy `sql/migrate_mien_dia_ban.sql`). Chưa khai báo đúng nhóm SP thì lấy theo khai báo khác của cùng KH. Mã BV thiếu hoặc chưa có địa bàn → miền rỗng; màn upload liệt kê các BV này sau khi lưu.

## Phân bổ CCDC theo quota thầu

Màn **Phân bổ** so số CCDC ký gửi (snapshot mới nhất của nhóm SP) với quota thầu còn lại tại từng BV, cùng nhóm SP. Quota còn lại = quota chính thức đã có (thầu cũ + đợt đã tới tháng thầu, theo `shared.app_config.current_month`) − doanh thu thực hiện FY, lấy từ `shared.quota_thau`, `shared.dot_thau`, `shared.sale_target`. Ghép theo mã BV = `ma_khach_hang`.

Triển khai: chạy `sql/migrate_phan_bo_quota.sql` (view `app_ccdc.v_quota_kh_nhom`, chỉ service_role đọc), rồi redeploy `ccdc-api` (action `phan_bo_ccdc`).

## Secret

`TOKEN_SECRET` là secret chung cho cả Supabase project (đã set từ khi triển khai sale-target/order/kpi). Nếu deploy sang project khác, chạy:

```bash
supabase secrets set TOKEN_SECRET=<chuỗi_bí_mật_dài>
```

## Đăng nhập

- Dùng chung tài khoản với các app khác (bảng `shared.users`, cột `username`, `password_hash`, `salt`).
- Đăng nhập lần đầu: nhập `username` + `password` hiện tại.
- Đổi mật khẩu: bấm "Đổi mật khẩu" ở form login, nhập mật khẩu hiện tại + mật khẩu mới ≥ 6 ký tự.

## Phát triển local

Chạy static server bất kỳ trong `dashboard/`:

```bash
cd dashboard && python -m http.server 5173
# hoặc: npx serve dashboard
```

Sau đó mở http://localhost:5173.

## Thêm 1 màn mới

1. Tạo `dashboard/assets/js/screens/<ten>.js`:
   ```js
   (function () {
     const h = React.createElement;
     function MyScreen({ user }) { return h("div", null, "..."); }
     window.CCDC_ROUTER.register("/my-path", MyScreen);
   })();
   ```
2. Thêm 1 dòng `<script src="assets/js/screens/<ten>.js"></script>` vào `dashboard/index.html`.
3. Thêm mục vào mảng `NAV` trong `assets/js/app.js` nếu muốn hiện ở thanh nav.

## Thêm 1 action API mới

1. Trong `supabase/functions/ccdc-api/index.ts`, thêm case vào `handleAction()`.
2. Redeploy: `supabase functions deploy ccdc-api --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb`.
3. Ở frontend: `const res = await window.CCDC_API.api("ten_action", { ...payload });`
