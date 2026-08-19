#!/usr/bin/env python3
"""
push_tach_ton.py — Đẩy dữ liệu đã tách (tồn đầu + nhập mới + điều chuyển) lên Supabase.

Bước:
  1. Xóa tất cả giao_dich loai='ton_dau' hiện có
  2. Insert ton_dau mới (đã giảm) + nhap_moi + dieu_chuyen
  3. Insert 65 tai_san mới (mã chưa có)

Cách dùng:
    python scripts/push_tach_ton.py           # dry-run (chỉ đọc, không ghi)
    python scripts/push_tach_ton.py --push    # thực sự đẩy lên Supabase
"""

import pandas as pd
import argparse
import re

SUPABASE_URL = "https://nrfxymnfmjhbsgpipvkb.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZnh5bW5mbWpoYnNncGlwdmtiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Mjg4OTY5NCwiZXhwIjoyMDk4NDY1Njk0fQ.3LBRziBs5FprQDR-cH0sb_jfS7OoQkucQseMNRXG_G4"
APP_SCHEMA = "app_ccdc"
CHUNK = 500
BASE = r"D:\1. GIANG\Data\git\ccdc-management"


def _clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip()
        return None if s == "" or s.lower() in ("nan", "none") else s
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def serialize(rows):
    return [{k: _clean(v) for k, v in r.items()} for r in rows]


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def parse_dieu_chuyen_ghi_chu(ghi_chu):
    m = re.match(r"Điều chuyển từ (.+?) → (.+)", ghi_chu or "")
    if m:
        return m.group(1), m.group(2)
    if ghi_chu and "Giữ tại" in ghi_chu:
        m2 = re.match(r"Giữ tại (.+?) \(", ghi_chu)
        return m2.group(1) if m2 else None, None
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true", help="Thực sự đẩy lên Supabase")
    args = ap.parse_args()

    gd = pd.read_csv(f"{BASE}/out_giao_dich.csv")
    ts = pd.read_csv(f"{BASE}/out_tai_san.csv")

    ton = gd[gd["loai"] == "ton_dau"]
    nhap = gd[gd["loai"] == "nhap_moi"]
    dc = gd[gd["loai"] == "dieu_chuyen"]
    ts_new = ts[ts["ghi_chu"].fillna("").str.contains("Mua mới T4-T7")]

    print("=== DỮ LIỆU SẼ PUSH ===")
    print(f"  ton_dau (thay thế):  {len(ton)} dòng")
    print(f"  nhap_moi (thêm):     {len(nhap)} dòng")
    print(f"  dieu_chuyen (thêm):  {len(dc)} dòng")
    print(f"  tai_san mới (thêm):  {len(ts_new)} dòng")

    # Prepare giao_dich rows
    gd_rows = []

    for _, r in ton.iterrows():
        gd_rows.append({
            "ngay": r["ngay"], "loai": "ton_dau", "ma_bravo": r["ma_bravo"],
            "so_luong": r["so_luong"], "don_gia": r["don_gia"],
            "thanh_tien": r["thanh_tien"], "ghi_chu": r["ghi_chu"],
        })

    for _, r in nhap.iterrows():
        gd_rows.append({
            "ngay": r["ngay"], "loai": "nhap_moi", "ma_bravo": r["ma_bravo"],
            "so_luong": r["so_luong"], "don_gia": r["don_gia"],
            "thanh_tien": r["thanh_tien"], "ghi_chu": r["ghi_chu"],
        })

    for _, r in dc.iterrows():
        pic_tu, pic_den = parse_dieu_chuyen_ghi_chu(r["ghi_chu"])
        gd_rows.append({
            "ngay": r["ngay"], "loai": "dieu_chuyen", "ma_bravo": r["ma_bravo"],
            "so_luong": r["so_luong"], "don_gia": r["don_gia"],
            "thanh_tien": r["thanh_tien"],
            "pic_tu": pic_tu, "pic_den": pic_den,
            "ghi_chu": r["ghi_chu"],
        })

    # Prepare tai_san rows
    ts_rows = []
    for _, r in ts_new.iterrows():
        ts_rows.append({
            "ma_bravo": r["ma_bravo"], "serial": None,
            "vi_tri": None, "loai_vi_tri": r["loai_vi_tri"],
            "mien": r["mien"], "pic": r["pic"],
            "tinh_trang": r["tinh_trang"], "trang_thai_hd": r["trang_thai_hd"],
            "so_luong": r["so_luong"], "nguyen_gia": r["nguyen_gia"],
            "ngay_mua": r["ngay_mua"], "ghi_chu": r["ghi_chu"],
        })

    gd_rows = serialize(gd_rows)
    ts_rows = serialize(ts_rows)

    print(f"\n  Tổng giao dịch: {len(gd_rows)}")
    print(f"  Tổng tai_san mới: {len(ts_rows)}")

    if not args.push:
        print("\n⚠ DRY-RUN — chạy lại với --push để thực sự đẩy lên Supabase.")
        return

    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    app = lambda t: sb.schema(APP_SCHEMA).table(t)

    # Step 1: Delete old ton_dau
    print("\n>>> 1. Xóa ton_dau cũ...")
    res = app("giao_dich").select("id", count="exact").eq("loai", "ton_dau").limit(1).execute()
    n_old = res.count or 0
    print(f"   Có {n_old} dòng ton_dau hiện tại → xóa...")
    app("giao_dich").delete().eq("loai", "ton_dau").execute()
    print(f"   ✓ Đã xóa")

    # Step 2: Insert tai_san mới (trước giao_dich vì có thể cần tai_san_id)
    print(f"\n>>> 2. Insert {len(ts_rows)} tai_san mới...")
    for i, chunk in enumerate(chunks(ts_rows, CHUNK), 1):
        app("tai_san").insert(chunk).execute()
        print(f"   chunk {i}: +{len(chunk)}")

    # Step 3: Insert giao_dich (ton_dau + nhap_moi + dieu_chuyen)
    print(f"\n>>> 3. Insert {len(gd_rows)} giao dịch...")
    for i, chunk in enumerate(chunks(gd_rows, CHUNK), 1):
        app("giao_dich").insert(chunk).execute()
        print(f"   chunk {i}: +{len(chunk)}")

    # Verify
    print("\n>>> 4. Verify...")
    for loai in ["ton_dau", "nhap_moi", "dieu_chuyen"]:
        res = app("giao_dich").select("id", count="exact").eq("loai", loai).limit(1).execute()
        print(f"   {loai}: {res.count} dòng")

    res_ts = app("tai_san").select("id", count="exact").limit(1).execute()
    print(f"   tai_san tổng: {res_ts.count} dòng")

    print("\n✅ Push xong!")


if __name__ == "__main__":
    main()
