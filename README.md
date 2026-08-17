# Quản lý CCDC & Thiết bị

Ứng dụng web quản lý **Công cụ dụng cụ (CCDC)**, **Tài sản/Thiết bị (TB)** và **ngân sách khấu hao** — theo dõi tồn kho, giao dịch nhập/xuất/điều chuyển/thanh lý và cảnh báo ngân sách.

🔗 **Live:** https://vietmedical-vmed.github.io/ccdc-management/

---

## Kiến trúc

```
Frontend (GitHub Pages)          Backend (Supabase)
┌──────────────────────┐         ┌───────────────────────────┐
│ dashboard/ (SPA)     │  HTTPS  │ Edge Functions            │
│  React 18 + Tailwind │ ──────► │  • ccdc-login  (auth)     │
│  (CDN, hash router)  │         │  • ccdc-api    (nghiệp vụ)│
└──────────────────────┘         │ Postgres                  │
                                 │  • schema app_ccdc        │
                                 │  • schema shared (dùng chung)│
                                 └───────────────────────────┘
```

- **Frontend**: SPA React thuần (nạp qua CDN, không build step), Tailwind CDN, hash router. Deploy tĩnh từ thư mục `dashboard/`.
- **Backend**: 2 Supabase Edge Function (Deno/TypeScript) + Postgres.
- **Auth**: dùng chung bảng `shared.users` với các app sale-target / order / kpi (cùng một Supabase project). Token đăng nhập là HMAC ký bằng `TOKEN_SECRET`.

---

## Cấu trúc source

```
ccdc-management/
├── dashboard/                    # → deploy GitHub Pages
│   ├── index.html                # shell SPA, nạp module theo thứ tự
│   └── assets/js/
│       ├── config.js             # SUPABASE_URL, anon key, tên edge function
│       ├── api.js                # fetch helper + lưu token
│       ├── auth.js               # <LoginGate> đăng nhập / đổi mật khẩu
│       ├── router.js             # hash router
│       ├── app.js                # bootstrap, shell, nav
│       └── screens/              # dashboard, dm-vat-tu, tai-san, giao-dich, ngan-sach
├── supabase/functions/
│   ├── ccdc-login/index.ts       # xác thực → phát token HMAC
│   └── ccdc-api/index.ts         # các action nghiệp vụ (list/create/update/delete…)
├── sql/schema.sql                # schema app_ccdc + grants + view cảnh báo
├── scripts/import_ton_ccdc.py    # import tồn CCDC từ Excel lên Supabase (⚠️ chứa secret — KHÔNG commit)
└── docs/                         # deploy.md, er-diagram.html
```

## Mô hình dữ liệu (schema `app_ccdc`)

| Bảng | Vai trò |
|------|---------|
| `ccdc_thuoc_tinh`   | Thuộc tính riêng của CCDC (bổ sung cho `shared.dm_vat_tu`) |
| `tai_san`           | Danh mục tài sản/thiết bị |
| `giao_dich`         | Giao dịch nhập / xuất / điều chuyển / thanh lý |
| `ngan_sach`         | Ngân sách theo kỳ |
| `cau_hinh_khau_hao` | Cấu hình khấu hao |

Danh mục vật tư gốc dùng chung ở `shared.dm_vat_tu` (PK `ma_bravo`, cột `phan_loai` phân loại TH/CCDC/TB).

---

## Deploy

### Frontend — tự động (GitHub Pages)
Mỗi lần push thay đổi trong `dashboard/` lên nhánh `master`, GitHub Actions (`.github/workflows/deploy-pages.yml`) tự build & deploy (~15s). Không cần thao tác tay.

### Backend — Edge Functions (chạy 1 lần đầu / khi đổi code function)
Cần [Supabase CLI](https://supabase.com/docs/guides/cli) đã login:

```bash
supabase functions deploy ccdc-login --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
supabase functions deploy ccdc-api   --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
```

Secret dùng chung project (đã set từ trước):

```bash
supabase secrets set TOKEN_SECRET=<chuỗi_bí_mật_dài>
```

### Database
Áp schema từ `sql/schema.sql` (SQL Editor trên Supabase Dashboard hoặc `psql`).

---

## Đăng nhập

- Dùng chung tài khoản với các app khác: bảng `shared.users` (`username`, `password_hash`, `salt`).
- Đăng nhập lần đầu: `username` + `password`.
- Đổi mật khẩu: bấm **"Đổi mật khẩu"** ở form login, nhập mật khẩu hiện tại + mật khẩu mới (≥ 6 ký tự).

---

## Bảo mật

- ⚠️ **Không commit secret.** `scripts/import_ton_ccdc.py` chứa `service_role` key và đã được `.gitignore` loại trừ. Nên đọc key từ biến môi trường thay vì hardcode:
  ```python
  import os
  SUPABASE_KEY = os.environ["SUPABASE_KEY"]   # service_role, đặt trong .env (đã gitignore)
  ```
- `SUPABASE_ANON_KEY` trong `config.js` là **public key** (thiết kế để lộ ở frontend) — an toàn khi commit.
- `service_role` key và JWT secret cấp theo **project**, dùng chung với sale-target/order/kpi. Rotate JWT secret sẽ ảnh hưởng **toàn bộ** các app đó — cân nhắc kỹ trước khi đổi.

---

## Chạy local

Frontend là static thuần, chỉ cần một HTTP server tĩnh (backend trỏ thẳng Supabase production):

```bash
cd dashboard
python -m http.server 5173
# mở http://localhost:5173
```
