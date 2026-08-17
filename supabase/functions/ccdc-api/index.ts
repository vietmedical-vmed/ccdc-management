// Supabase Edge Function: ccdc-api
// Verify HMAC token (do ccdc-login phát) rồi dispatch theo `action`.
// Payload chuẩn: { action, token, payload }
//
// Deploy:
//   supabase functions deploy ccdc-api --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const enc = new TextEncoder();

function b64urlDecode(s: string) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64url(bytes: Uint8Array) {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return new Uint8Array(sig);
}

type Session = {
  username: string;
  ho_ten: string;
  role: string;
  mien: string;
  bu: string;
  scope: string;
  exp: number;
};

async function verifyToken(token: string, secret: string): Promise<Session | null> {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [p, sig] = token.split(".");
  const expected = b64url(await hmac(secret, p));
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as Session;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ─── Utils ───────────────────────────────────────────────────────────────
// Escape ký tự phá vỡ cú pháp .or() của PostgREST khi ghép chuỗi search.
function sanitizeSearch(s: string): string {
  return String(s ?? "").replace(/[,()\\%]/g, " ").trim();
}

// ─── Action dispatch ─────────────────────────────────────────────────────
async function handleAction(
  action: string,
  payload: any,
  session: Session,
  admin: SupabaseClient,
) {
  switch (action) {
    case "whoami":
      return { ok: true, user: session };

    // ── Danh mục CCDC/THIẾT BỊ ──────────────────────────────────────────
    // params: { search?, phan_loai?: string[], page?=1, pageSize?=50 }
    // returns: { ok, rows[], total, page, pageSize }
    case "list_dm_ccdc": {
      const page = Math.max(1, Number(payload.page ?? 1));
      const pageSize = Math.min(200, Math.max(10, Number(payload.pageSize ?? 50)));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const filterPL: string[] = Array.isArray(payload.phan_loai) && payload.phan_loai.length
        ? payload.phan_loai
        : ["CCDC", "THIẾT BỊ"];
      const search = sanitizeSearch(payload.search ?? "");

      let q = admin.schema("shared").from("dm_vat_tu")
        .select("ma_bravo, ten_vat_tu, ma_ncc, bu, nhom_san_pham, san_pham, phan_loai",
                { count: "exact" })
        .in("phan_loai", filterPL);

      if (search) {
        const s = search.replace(/"/g, "");
        q = q.or(
          `ma_bravo.ilike.*${s}*,ten_vat_tu.ilike.*${s}*,ma_ncc.ilike.*${s}*`
        );
      }

      q = q.order("ma_bravo", { ascending: true }).range(from, to);
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);

      const rows = data ?? [];
      const maList = rows.map((r: any) => r.ma_bravo).filter(Boolean);

      // Enrich: quan_ly_serial + tồn hiện tại (nếu app_ccdc đã có data)
      let ttMap = new Map<string, boolean>();
      let tonMap = new Map<string, number>();
      if (maList.length) {
        try {
          const [ttRes, tsRes] = await Promise.all([
            admin.schema("app_ccdc").from("ccdc_thuoc_tinh")
              .select("ma_bravo, quan_ly_serial").in("ma_bravo", maList),
            admin.schema("app_ccdc").from("tai_san")
              .select("ma_bravo, so_luong")
              .in("ma_bravo", maList).eq("trang_thai_hd", "Active"),
          ]);
          for (const r of (ttRes.data ?? [])) ttMap.set(r.ma_bravo, r.quan_ly_serial);
          for (const r of (tsRes.data ?? [])) {
            tonMap.set(r.ma_bravo, (tonMap.get(r.ma_bravo) ?? 0) + Number(r.so_luong ?? 0));
          }
        } catch (_) { /* app_ccdc chưa deploy hoặc rỗng → skip enrich */ }
      }

      const enriched = rows.map((r: any) => ({
        ...r,
        quan_ly_serial: ttMap.get(r.ma_bravo) ?? null,
        so_luong_ton:   tonMap.get(r.ma_bravo) ?? 0,
      }));

      return { ok: true, rows: enriched, total: count ?? enriched.length, page, pageSize };
    }

    // ── Tài sản ─────────────────────────────────────────────────────────
    // params: { search?, phan_loai?, mien?, loai_vi_tri?, page?, pageSize? }
    case "list_tai_san": {
      const page = Math.max(1, Number(payload.page ?? 1));
      const pageSize = Math.min(200, Math.max(10, Number(payload.pageSize ?? 50)));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = admin.schema("app_ccdc").from("tai_san")
        .select("id, ma_bravo, serial, vi_tri, loai_vi_tri, mien, pic, " +
                "tinh_trang, trang_thai_hd, so_luong, nguyen_gia, ngay_mua",
                { count: "exact" })
        .eq("trang_thai_hd", "Active");

      if (payload.mien)        q = q.eq("mien", payload.mien);
      if (payload.loai_vi_tri) q = q.eq("loai_vi_tri", payload.loai_vi_tri);
      const search = sanitizeSearch(payload.search ?? "");
      if (search) {
        const s = search.replace(/"/g, "");
        q = q.or(`ma_bravo.ilike.*${s}*,serial.ilike.*${s}*,pic.ilike.*${s}*,vi_tri.ilike.*${s}*`);
      }

      q = q.order("ma_bravo").order("id").range(from, to);
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data ?? [];

      // Enrich với tên + phan_loai từ dm_vat_tu
      const maList = [...new Set(rows.map((r: any) => r.ma_bravo).filter(Boolean))];
      let nameMap = new Map<string, { ten: string; phan_loai: string }>();
      if (maList.length) {
        const dmRes = await admin.schema("shared").from("dm_vat_tu")
          .select("ma_bravo, ten_vat_tu, phan_loai").in("ma_bravo", maList);
        for (const d of (dmRes.data ?? [])) {
          nameMap.set(d.ma_bravo, { ten: d.ten_vat_tu, phan_loai: d.phan_loai });
        }
      }
      const enriched = rows.map((r: any) => ({
        ...r,
        ten_vat_tu: nameMap.get(r.ma_bravo)?.ten ?? null,
        phan_loai:  nameMap.get(r.ma_bravo)?.phan_loai ?? null,
      }));
      // Filter phan_loai sau enrich (vì phan_loai không có trong tai_san)
      const filtered = payload.phan_loai
        ? enriched.filter((r: any) => r.phan_loai === payload.phan_loai)
        : enriched;

      return { ok: true, rows: filtered, total: count ?? filtered.length, page, pageSize };
    }

    // ── Giao dịch (ledger) ──────────────────────────────────────────────
    // params: { loai?, from_date?, to_date?, search?, page?, pageSize? }
    case "list_giao_dich": {
      const page = Math.max(1, Number(payload.page ?? 1));
      const pageSize = Math.min(200, Math.max(10, Number(payload.pageSize ?? 50)));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = admin.schema("app_ccdc").from("giao_dich")
        .select("id, ngay, loai, ma_bravo, tai_san_id, so_luong, don_gia, thanh_tien, " +
                "vi_tri_tu, vi_tri_den, pic_tu, pic_den, ghi_chu, created_at",
                { count: "exact" });

      if (payload.loai)      q = q.eq("loai", payload.loai);
      if (payload.from_date) q = q.gte("ngay", payload.from_date);
      if (payload.to_date)   q = q.lte("ngay", payload.to_date);
      const search = sanitizeSearch(payload.search ?? "");
      if (search) {
        const s = search.replace(/"/g, "");
        q = q.or(`ma_bravo.ilike.*${s}*,ghi_chu.ilike.*${s}*`);
      }

      q = q.order("ngay", { ascending: false }).order("id", { ascending: false }).range(from, to);
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data ?? [];

      const maList = [...new Set(rows.map((r: any) => r.ma_bravo).filter(Boolean))];
      let nameMap = new Map<string, string>();
      if (maList.length) {
        const dmRes = await admin.schema("shared").from("dm_vat_tu")
          .select("ma_bravo, ten_vat_tu").in("ma_bravo", maList);
        for (const d of (dmRes.data ?? [])) nameMap.set(d.ma_bravo, d.ten_vat_tu);
      }
      const enriched = rows.map((r: any) => ({ ...r, ten_vat_tu: nameMap.get(r.ma_bravo) ?? null }));
      return { ok: true, rows: enriched, total: count ?? enriched.length, page, pageSize };
    }

    // ── Ngân sách (CRUD) ────────────────────────────────────────────────
    // Options cho dropdown khi nhập ngân sách
    case "ngan_sach_options": {
      const all: any[] = [];
      let start = 0;
      while (true) {
        const { data, error } = await admin.schema("shared").from("dm_vat_tu")
          .select("nhom_san_pham, bu").range(start, start + 999);
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        if (!rows.length) break;
        all.push(...rows);
        if (rows.length < 1000) break;
        start += 1000;
      }
      const nsp = [...new Set(all.map((r: any) => r.nhom_san_pham).filter(Boolean))].sort();
      const bu  = [...new Set(all.map((r: any) => r.bu).filter(Boolean))].sort();
      return { ok: true, nhom_san_pham: nsp, bu };
    }

    case "list_ngan_sach": {
      const { data, error } = await admin.schema("app_ccdc").from("ngan_sach")
        .select("*").order("nam_tai_chinh", { ascending: false })
        .order("nhom_san_pham", { nullsFirst: true }).order("bo_phan", { nullsFirst: true });
      if (error) throw new Error(error.message);
      return { ok: true, rows: data ?? [] };
    }

    case "upsert_ngan_sach": {
      const { id, nam_tai_chinh, nhom_san_pham, bo_phan, gia_tri_budget } = payload;
      if (!nam_tai_chinh) return { ok: false, error: "missing_nam_tai_chinh" };
      if (gia_tri_budget == null || Number(gia_tri_budget) < 0) return { ok: false, error: "invalid_budget" };
      const row = {
        nam_tai_chinh: Number(nam_tai_chinh),
        nhom_san_pham: nhom_san_pham || null,
        bo_phan:       bo_phan       || null,
        gia_tri_budget: Number(gia_tri_budget),
      };
      const q = id
        ? admin.schema("app_ccdc").from("ngan_sach").update(row).eq("id", id).select().single()
        : admin.schema("app_ccdc").from("ngan_sach").insert(row).select().single();
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { ok: true, row: data };
    }

    case "delete_ngan_sach": {
      const { id } = payload;
      if (!id) return { ok: false, error: "missing_id" };
      const { error } = await admin.schema("app_ccdc").from("ngan_sach").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    // ── Dashboard summary ───────────────────────────────────────────────
    // KPI + gauge budget + chart mua_moi/huy theo tháng (FY hiện tại T4-T3)
    case "dashboard_summary": {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = now.getUTCMonth() + 1;
      const fy = m >= 4 ? y : y - 1;              // FY name = starting year
      const fyStart = `${fy}-04-01`;
      const fyEnd   = `${fy + 1}-04-01`;          // exclusive

      const [dmCnt, tsRes, gdFyRes, recentRes, budgetRes, conLaiRes] = await Promise.all([
        admin.schema("shared").from("dm_vat_tu")
          .select("phan_loai", { count: "exact", head: false })
          .in("phan_loai", ["CCDC", "THIẾT BỊ"]),
        admin.schema("app_ccdc").from("tai_san")
          .select("id, so_luong, nguyen_gia, mien, loai_vi_tri, pic, trang_thai_hd")
          .eq("trang_thai_hd", "Active"),
        admin.schema("app_ccdc").from("giao_dich")
          .select("ngay, loai, thanh_tien, so_luong")
          .in("loai", ["nhap_moi", "huy"])
          .gte("ngay", fyStart).lt("ngay", fyEnd),
        admin.schema("app_ccdc").from("giao_dich")
          .select("id, ngay, loai, ma_bravo, so_luong, thanh_tien, ghi_chu")
          .order("id", { ascending: false }).limit(10),
        admin.schema("app_ccdc").from("v_budget_canh_bao").select("*").eq("fy", fy),
        admin.schema("app_ccdc").from("v_gia_tri_con_lai").select("gia_tri_con_lai"),
      ]);

      // KPI mã
      const cntByPl: Record<string, number> = { CCDC: 0, "THIẾT BỊ": 0 };
      for (const d of (dmCnt.data ?? [])) if (d.phan_loai in cntByPl) cntByPl[d.phan_loai]++;

      // KPI tai_san
      const ts = tsRes.data ?? [];
      const tong_nguyen_gia = ts.reduce((s: number, r: any) =>
        s + Number(r.so_luong ?? 0) * Number(r.nguyen_gia ?? 0), 0);
      const so_tai_san = ts.length;
      const so_luong_tong = ts.reduce((s: number, r: any) => s + Number(r.so_luong ?? 0), 0);

      // KPI YTD
      const gdFy = gdFyRes.data ?? [];
      const mua_moi_ytd = gdFy.filter((r: any) => r.loai === "nhap_moi")
        .reduce((s: number, r: any) => s + Number(r.thanh_tien ?? 0), 0);
      const huy_ytd = gdFy.filter((r: any) => r.loai === "huy")
        .reduce((s: number, r: any) => s + Number(r.thanh_tien ?? 0), 0);

      // KPI giá trị còn lại (view)
      const tong_gia_tri_con_lai = (conLaiRes.data ?? [])
        .reduce((s: number, r: any) => s + Number(r.gia_tri_con_lai ?? 0), 0);

      // Budget cả năm FY hiện tại
      const budget = budgetRes.data ?? [];
      const ngan_sach_ca_nam = budget.reduce((s: number, r: any) =>
        s + Number(r.gia_tri_budget ?? 0), 0);

      // Chart 12 tháng FY: fill 0 nếu tháng chưa có data
      const chartMap: Record<string, { nhap_moi: number; huy: number }> = {};
      for (const r of gdFy) {
        const k = String(r.ngay).slice(0, 7);
        (chartMap[k] ??= { nhap_moi: 0, huy: 0 });
        if (r.loai === "nhap_moi") chartMap[k].nhap_moi += Number(r.thanh_tien ?? 0);
        if (r.loai === "huy")      chartMap[k].huy      += Number(r.thanh_tien ?? 0);
      }
      const chart_theo_ky: Array<{ ky: string; nhap_moi: number; huy: number }> = [];
      for (let i = 0; i < 12; i++) {
        const mm = ((3 + i) % 12) + 1;
        const yy = mm >= 4 ? fy : fy + 1;
        const k = `${yy}-${String(mm).padStart(2, "0")}`;
        chart_theo_ky.push({ ky: k, ...(chartMap[k] ?? { nhap_moi: 0, huy: 0 }) });
      }

      // Tồn theo miền → loại vị trí → PIC (cây 3 cấp)
      type TonPic  = { sl: number; nguyen_gia: number };
      type TonViTri = { sl: number; nguyen_gia: number; pics: Record<string, TonPic> };
      type TonMien = { sl: number; nguyen_gia: number; vitris: Record<string, TonViTri> };
      const tonByMien: Record<string, TonMien> = {};
      for (const r of ts) {
        const sl  = Number(r.so_luong ?? 0);
        const val = sl * Number(r.nguyen_gia ?? 0);
        const mk = r.mien || "—", vt = r.loai_vi_tri || "—", pic = r.pic || "—";
        const M = (tonByMien[mk] ??= { sl: 0, nguyen_gia: 0, vitris: {} });
        M.sl += sl; M.nguyen_gia += val;
        const V = (M.vitris[vt] ??= { sl: 0, nguyen_gia: 0, pics: {} });
        V.sl += sl; V.nguyen_gia += val;
        const P = (V.pics[pic] ??= { sl: 0, nguyen_gia: 0 });
        P.sl += sl; P.nguyen_gia += val;
      }
      const byNguyenGia = (a: any, b: any) => b.nguyen_gia - a.nguyen_gia;

      // 10 GD gần nhất + enrich tên
      const recent = recentRes.data ?? [];
      const maList = [...new Set(recent.map((r: any) => r.ma_bravo).filter(Boolean))];
      let nameMap = new Map<string, string>();
      if (maList.length) {
        const dmRes = await admin.schema("shared").from("dm_vat_tu")
          .select("ma_bravo, ten_vat_tu").in("ma_bravo", maList);
        for (const d of (dmRes.data ?? [])) nameMap.set(d.ma_bravo, d.ten_vat_tu);
      }
      const recent_enriched = recent.map((r: any) => ({ ...r, ten_vat_tu: nameMap.get(r.ma_bravo) ?? null }));

      return {
        ok: true, fy,
        kpi: {
          so_ma_ccdc: cntByPl["CCDC"],
          so_ma_tb:   cntByPl["THIẾT BỊ"],
          so_tai_san, so_luong_tong,
          tong_nguyen_gia, tong_gia_tri_con_lai,
          mua_moi_ytd, huy_ytd, ngan_sach_ca_nam,
        },
        ton_by_mien: Object.entries(tonByMien).map(([mien, M]) => ({
          mien, sl: M.sl, nguyen_gia: M.nguyen_gia,
          children: Object.entries(M.vitris).map(([vi_tri, V]) => ({
            vi_tri, sl: V.sl, nguyen_gia: V.nguyen_gia,
            children: Object.entries(V.pics).map(([pic, P]) => ({
              pic, sl: P.sl, nguyen_gia: P.nguyen_gia,
            })).sort(byNguyenGia),
          })).sort(byNguyenGia),
        })).sort(byNguyenGia),
        budget,
        chart_theo_ky,
        recent_giao_dich: recent_enriched,
      };
    }

    // ── Admin: sửa tài sản ─────────────────────────────────────────────
    case "update_tai_san": {
      if (session.role !== "admin")
        return { ok: false, error: "forbidden_not_admin" };
      const { id, ...fields } = payload ?? {};
      if (!id) return { ok: false, error: "missing_id" };
      const allow = ["serial", "vi_tri", "loai_vi_tri", "mien", "pic",
        "tinh_trang", "trang_thai_hd", "so_luong", "nguyen_gia",
        "ngay_mua", "ghi_chu"];
      const update: Record<string, unknown> = {};
      for (const k of allow) if (k in fields) update[k] = fields[k];
      if (!Object.keys(update).length)
        return { ok: false, error: "no_fields_to_update" };
      update.updated_at = new Date().toISOString();
      const { data, error } = await admin.schema("app_ccdc").from("tai_san")
        .update(update).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return { ok: true, row: data };
    }

    // ── Admin: xoá tài sản (hard delete, cẩn thận!) ────────────────────
    case "delete_tai_san": {
      if (session.role !== "admin")
        return { ok: false, error: "forbidden_not_admin" };
      const { id } = payload ?? {};
      if (!id) return { ok: false, error: "missing_id" };
      // Kiểm tra: có giao_dich nào trỏ tới không? Nếu có, block.
      const { count } = await admin.schema("app_ccdc").from("giao_dich")
        .select("id", { count: "exact", head: true }).eq("tai_san_id", id);
      if ((count || 0) > 0) return {
        ok: false, error: "has_giao_dich", details: `${count} giao dịch trỏ tới. Xoá giao dịch trước.`
      };
      const { error } = await admin.schema("app_ccdc").from("tai_san").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }

    // ── Tạo giao dịch (nhap_moi / huy / mat / dieu_chuyen) ─────────────
    // Logic split cho CCDC (so_luong > 1, thao tác 1 phần) → tách row.
    // TB (serial) luôn full operation (so_luong=1).
    case "create_giao_dich": {
      const p = payload ?? {};
      const loai = p.loai;
      if (!["nhap_moi", "huy", "mat", "dieu_chuyen"].includes(loai))
        return { ok: false, error: "invalid_loai" };
      const app = admin.schema("app_ccdc");
      const nowDate = p.ngay || new Date().toISOString().slice(0, 10);

      // ─── Nhập mới: tạo tai_san + giao_dich ────────────────────────
      if (loai === "nhap_moi") {
        if (!p.ma_bravo) return { ok: false, error: "missing_ma_bravo" };
        const sl = Number(p.so_luong || 1);
        const dg = Number(p.don_gia || 0);
        if (sl <= 0) return { ok: false, error: "invalid_so_luong" };

        const { data: ts, error: e1 } = await app.from("tai_san").insert({
          ma_bravo:      p.ma_bravo,
          serial:        p.serial      || null,
          vi_tri:        p.vi_tri      || null,
          loai_vi_tri:   p.loai_vi_tri || null,
          mien:          p.mien        || null,
          pic:           p.pic         || null,
          tinh_trang:   "dang_dung",
          trang_thai_hd: "Active",
          so_luong:     sl,
          nguyen_gia:   dg,
          ngay_mua:     p.ngay_mua || nowDate,
          ghi_chu:      p.ghi_chu || null,
        }).select().single();
        if (e1) throw new Error(e1.message);

        const { error: e2 } = await app.from("giao_dich").insert({
          ngay: nowDate, loai: "nhap_moi", ma_bravo: p.ma_bravo,
          tai_san_id: ts.id, so_luong: sl, don_gia: dg,
          ghi_chu: p.ghi_chu || null,
        });
        if (e2) throw new Error(e2.message);
        return { ok: true, tai_san_id: ts.id };
      }

      // ─── Huỷ / Mất / Điều chuyển: cần tai_san_id nguồn ────────────
      if (!p.tai_san_id) return { ok: false, error: "missing_tai_san_id" };
      const qty = Number(p.so_luong || 0);
      if (qty <= 0) return { ok: false, error: "invalid_so_luong" };

      const { data: source, error: eSrc } = await app.from("tai_san")
        .select("*").eq("id", p.tai_san_id).single();
      if (eSrc || !source) return { ok: false, error: "tai_san_not_found" };
      if (qty > Number(source.so_luong)) return { ok: false, error: "so_luong_exceeds_ton" };

      const isFull = qty === Number(source.so_luong);
      const isSerial = !!source.serial;
      if (isSerial && !isFull) return { ok: false, error: "tb_serial_khong_the_split" };

      let target_id: number;

      if (loai === "huy" || loai === "mat") {
        const tt_new = loai === "mat" ? "mat" : (p.tinh_trang_dich || "hong");
        if (isFull) {
          const { error: eU } = await app.from("tai_san").update({
            tinh_trang: tt_new, trang_thai_hd: "Inactive",
            updated_at: new Date().toISOString(),
          }).eq("id", source.id);
          if (eU) throw new Error(eU.message);
          target_id = source.id;
        } else {
          // Split: giảm SL nguồn + tạo row mới (Inactive, tinh_trang mới)
          const { error: eD } = await app.from("tai_san").update({
            so_luong: Number(source.so_luong) - qty,
            updated_at: new Date().toISOString(),
          }).eq("id", source.id);
          if (eD) throw new Error(eD.message);
          const { data: nr, error: eN } = await app.from("tai_san").insert({
            ma_bravo: source.ma_bravo, serial: null,
            vi_tri: source.vi_tri, loai_vi_tri: source.loai_vi_tri,
            mien: source.mien, pic: source.pic,
            tinh_trang: tt_new, trang_thai_hd: "Inactive",
            so_luong: qty, nguyen_gia: source.nguyen_gia,
            ngay_mua: source.ngay_mua, ghi_chu: p.ghi_chu || null,
          }).select().single();
          if (eN) throw new Error(eN.message);
          target_id = nr.id;
        }
        const { error: eG } = await app.from("giao_dich").insert({
          ngay: nowDate, loai, ma_bravo: source.ma_bravo,
          tai_san_id: target_id, so_luong: qty,
          don_gia: Number(source.nguyen_gia),
          ghi_chu: p.ghi_chu || null,
        });
        if (eG) throw new Error(eG.message);
        return { ok: true, tai_san_id: target_id };
      }

      // ─── Điều chuyển ──────────────────────────────────────────────
      if (loai === "dieu_chuyen") {
        const dest = {
          vi_tri:      p.vi_tri_den      ?? null,
          loai_vi_tri: p.loai_vi_tri_den ?? source.loai_vi_tri,
          mien:        p.mien_den        ?? source.mien,
          pic:         p.pic_den         ?? null,
        };
        if (isFull) {
          const { error: eU } = await app.from("tai_san").update({
            ...dest, updated_at: new Date().toISOString(),
          }).eq("id", source.id);
          if (eU) throw new Error(eU.message);
          target_id = source.id;
        } else {
          const { error: eD } = await app.from("tai_san").update({
            so_luong: Number(source.so_luong) - qty,
            updated_at: new Date().toISOString(),
          }).eq("id", source.id);
          if (eD) throw new Error(eD.message);
          const { data: nr, error: eN } = await app.from("tai_san").insert({
            ma_bravo: source.ma_bravo, serial: null,
            ...dest,
            tinh_trang: source.tinh_trang, trang_thai_hd: "Active",
            so_luong: qty, nguyen_gia: source.nguyen_gia,
            ngay_mua: source.ngay_mua, ghi_chu: p.ghi_chu || null,
          }).select().single();
          if (eN) throw new Error(eN.message);
          target_id = nr.id;
        }
        const { error: eG } = await app.from("giao_dich").insert({
          ngay: nowDate, loai: "dieu_chuyen", ma_bravo: source.ma_bravo,
          tai_san_id: target_id, so_luong: qty,
          don_gia: Number(source.nguyen_gia),
          vi_tri_tu:  source.vi_tri, pic_tu:  source.pic,
          vi_tri_den: dest.vi_tri,   pic_den: dest.pic,
          ghi_chu: p.ghi_chu || null,
        });
        if (eG) throw new Error(eG.message);
        return { ok: true, tai_san_id: target_id };
      }

      return { ok: false, error: "unsupported_loai" };
    }

    default:
      return { ok: false, error: "unknown_action" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const secret = Deno.env.get("TOKEN_SECRET");
  if (!secret) return json({ ok: false, error: "TOKEN_SECRET chua duoc set" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_body" }, 400); }

  const { action, token, payload } = body ?? {};
  if (!action) return json({ ok: false, error: "missing_action" }, 400);

  const session = await verifyToken(token, secret);
  if (!session) return json({ ok: false, error: "unauthorized" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const result = await handleAction(action, payload ?? {}, session, admin);
    const status = result && (result as any).ok === false ? 400 : 200;
    return json(result, status);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message || "server_error" }, 500);
  }
});
