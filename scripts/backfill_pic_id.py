#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
backfill_pic_id.py — backfill app_ccdc.tai_san.pic_id từ Excel PIC ID cho các dòng
đã import trước đây (lúc script chưa map cột PIC ID).

Chạy sau khi:
  1) Đã ALTER app_ccdc.tai_san ADD COLUMN pic_id text;
  2) Đã push dữ liệu import trước đó.

Match rule:
  - TB (Excel Nhóm=THIẾT BỊ, có Serial): match DB theo serial (unique).
  - CCDC (Nhóm=CCDC, không serial): match DB theo (ma_bravo, pic, mien, loai_vi_tri)
    WHERE pic_id IS NULL, order by id — lấy dòng đầu tiên chưa gán.
    Lặp qua từng Excel row theo thứ tự → mỗi row Excel bind vào 1 DB row riêng.

Cách dùng:
  python scripts/backfill_pic_id.py "Quản lý CCDC&TB_V1_202608 - ARTHREX (08.11).xlsx"
"""
import sys, argparse, re
import pandas as pd

# Reuse config từ import script chính
sys.path.insert(0, "scripts")
from import_ton_ccdc import (
    SUPABASE_URL, SUPABASE_KEY, APP_SCHEMA,
    SHEET_CCDC, SHEET_TB, NHOM_TB, NHOM_CCDC,
    COLMAP_CCDC, COLMAP_TB,
    _rename, _clean,
)


def _blank(v):
    if v is None: return True
    s = str(v).strip().lower()
    return s in ("", "nan", "none")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--dry-run", action="store_true", help="Chỉ báo cáo, không update DB")
    args = ap.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("❌ Điền SUPABASE_URL / SUPABASE_KEY ở scripts/import_ton_ccdc.py trước")

    from supabase import create_client
    sb = create_client(SUPABASE_URL, SUPABASE_KEY)
    app = lambda t: sb.schema(APP_SCHEMA).table(t)

    # ── Load Excel + lọc giống import script ────────────────
    xls = pd.ExcelFile(args.file)
    raw_ccdc = pd.read_excel(xls, SHEET_CCDC, dtype=str)
    raw_tb   = pd.read_excel(xls, SHEET_TB,   dtype=str)
    raw_ccdc = raw_ccdc[raw_ccdc["Nhóm"] != NHOM_TB].copy()
    overlap = set(raw_ccdc["Mã Bravo"].dropna()) & set(raw_tb["Mã Bravo"].dropna())
    raw_ccdc = raw_ccdc[~raw_ccdc["Mã Bravo"].isin(overlap)].copy()
    raw_tb   = raw_tb[~raw_tb["Mã Bravo"].isin(overlap)].copy()
    df_ccdc = _clean(_rename(raw_ccdc, COLMAP_CCDC))
    df_tb   = _clean(_rename(raw_tb,   COLMAP_TB))
    # TB bỏ dòng thiếu serial/đơn giá
    mask_skip = df_tb["ma_bravo"].apply(_blank) | df_tb["serial"].apply(_blank) | \
                (~df_tb["don_gia"].apply(lambda x: bool(re.match(r"^-?[\d.,]+$", str(x)))) if "don_gia" in df_tb.columns else False)
    df_tb = df_tb[~mask_skip].copy()

    print(f"Excel: {len(df_ccdc)} CCDC + {len(df_tb)} TB")

    # ── TB backfill (theo serial) ───────────────────────────
    tb_updates = []
    tb_missing_pic_id = 0
    for _, r in df_tb.iterrows():
        pid = r.get("pic_id")
        if _blank(pid):
            tb_missing_pic_id += 1
            continue
        tb_updates.append({"serial": str(r["serial"]).strip(), "pic_id": str(pid).strip()})
    print(f"\nTB: {len(tb_updates)} rows có PIC ID, {tb_missing_pic_id} rows thiếu PIC ID")

    tb_matched = tb_not_found = 0
    if not args.dry_run:
        for u in tb_updates:
            res = app("tai_san").update({"pic_id": u["pic_id"]}) \
                .eq("serial", u["serial"]).is_("pic_id", "null").execute()
            if res.data:
                tb_matched += len(res.data)
            else:
                # Check nếu row tồn tại mà pic_id đã có
                q = app("tai_san").select("id, pic_id").eq("serial", u["serial"]).execute()
                if not q.data: tb_not_found += 1
        print(f"  → matched & updated: {tb_matched}, không tìm thấy serial: {tb_not_found}")

    # ── CCDC backfill (match theo tuple, lấy DB row đầu chưa có pic_id) ─
    ccdc_updates = []
    ccdc_missing_pic_id = 0
    for _, r in df_ccdc.iterrows():
        pid = r.get("pic_id")
        if _blank(pid):
            ccdc_missing_pic_id += 1
            continue
        ccdc_updates.append({
            "ma_bravo":    str(r["ma_bravo"]).strip(),
            "pic":         str(r["pic_raw"]).strip() if not _blank(r.get("pic_raw")) else None,
            "mien":        str(r.get("mien", "")).strip() or None,
            "loai_vi_tri": str(r.get("loai_vi_tri", "")).strip() or None,
            "pic_id":      str(pid).strip(),
        })
    print(f"\nCCDC: {len(ccdc_updates)} rows có PIC ID, {ccdc_missing_pic_id} rows thiếu PIC ID")

    ccdc_matched = ccdc_ambiguous = ccdc_not_found = 0
    if not args.dry_run:
        # Preload tất cả CCDC rows (loai_vi_tri in Kho/Sale-KTV, hoặc serial null) chưa có pic_id
        rows = []
        start = 0
        while True:
            q = app("tai_san").select("id, ma_bravo, pic, mien, loai_vi_tri, pic_id, serial") \
                .is_("serial", "null").is_("pic_id", "null").range(start, start + 999).execute()
            r = q.data or []
            if not r: break
            rows.extend(r);
            if len(r) < 1000: break
            start += 1000
        # Index theo (ma_bravo, pic, mien, loai_vi_tri) → list of ids (order by id asc)
        from collections import defaultdict
        pool = defaultdict(list)
        for row in sorted(rows, key=lambda x: x["id"]):
            key = (row["ma_bravo"], row.get("pic"), row.get("mien"), row.get("loai_vi_tri"))
            pool[key].append(row["id"])
        print(f"  DB pool: {len(rows)} CCDC rows chưa có pic_id, {len(pool)} unique tuples")

        for u in ccdc_updates:
            key = (u["ma_bravo"], u["pic"], u["mien"], u["loai_vi_tri"])
            if key not in pool or not pool[key]:
                ccdc_not_found += 1
                continue
            # Lấy DB id đầu tiên trong pool
            db_id = pool[key].pop(0)
            res = app("tai_san").update({"pic_id": u["pic_id"]}).eq("id", db_id).execute()
            if res.data: ccdc_matched += 1
        print(f"  → matched & updated: {ccdc_matched}, không match tuple: {ccdc_not_found}")

    print("\n✅ Backfill xong." if not args.dry_run else "\nℹ Dry-run — chưa update DB.")


if __name__ == "__main__":
    main()
