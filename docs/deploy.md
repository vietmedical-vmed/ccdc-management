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
