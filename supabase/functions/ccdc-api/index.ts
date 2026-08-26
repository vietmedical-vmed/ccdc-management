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

// ─── Permission ──────────────────────────────────────────────────────────
const MIEN_NORM: Record<string, string> = {
  MB: "Miền Bắc", MN: "Miền Nam", MT: "Miền Trung",
  "Miền Bắc": "Miền Bắc", "Miền Nam": "Miền Nam", "Miền Trung": "Miền Trung",
};

type Permission = {
  canWrite: boolean;
  filterMien: string | null;
  filterNhomSP: string[] | null;
};

function getPermission(session: Session): Permission {
  const role = (session.role || "").toLowerCase();
  switch (role) {
    case "admin":   return { canWrite: true,  filterMien: null, filterNhomSP: null };
    case "manager": return { canWrite: false, filterMien: null, filterNhomSP: null };
    case "pm": {
      const scopes = (session.scope || "").split(",").map(s => s.trim()).filter(Boolean);
      return { canWrite: false, filterMien: null, filterNhomSP: scopes };
    }
    case "am": {
      const m = MIEN_NORM[session.mien] ?? session.mien ?? null;
      return { canWrite: false, filterMien: m, filterNhomSP: null };
    }
    default: {
      const m = MIEN_NORM[session.mien] ?? session.mien ?? null;
      return { canWrite: false, filterMien: m, filterNhomSP: null };
    }
  }
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
  const perm = getPermission(session);

  switch (action) {
    case "whoami":
      return { ok: true, user: session, permission: perm };

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

      if (perm.filterNhomSP?.length)
        q = q.in("nhom_san_pham", perm.filterNhomSP);

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
    // params: { search?, phan_loai?, nhom_san_pham?, mien?, loai_vi_tri?, page?, pageSize? }
    case "list_tai_san": {
      const page = Math.max(1, Number(payload.page ?? 1));
      const pageSize = Math.min(200, Math.max(10, Number(payload.pageSize ?? 50)));
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      let q = admin.schema("app_ccdc").from("tai_san")
        .select("id, ma_bravo, serial, vi_tri, loai_vi_tri, mien, pic, pic_id, " +
                "tinh_trang, trang_thai_hd, so_luong, nguyen_gia, ngay_mua",
                { count: "exact" })
        .eq("trang_thai_hd", "Active");

      if (perm.filterMien) payload.mien = perm.filterMien;
      if (payload.mien)        q = q.eq("mien", payload.mien);
      if (payload.loai_vi_tri) q = q.eq("loai_vi_tri", payload.loai_vi_tri);
      const search = sanitizeSearch(payload.search ?? "");
      if (search) {
        const s = search.replace(/"/g, "");
        q = q.or(`ma_bravo.ilike.*${s}*,serial.ilike.*${s}*,pic.ilike.*${s}*,pic_id.ilike.*${s}*,vi_tri.ilike.*${s}*`);
      }

      q = q.order("ma_bravo").order("id").range(from, to);
      const { data, count, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data ?? [];

      const maList = [...new Set(rows.map((r: any) => r.ma_bravo).filter(Boolean))];
      let nameMap = new Map<string, { ten: string; phan_loai: string; san_pham: string; nhom_san_pham: string }>();
      if (maList.length) {
        const dmRes = await admin.schema("shared").from("dm_vat_tu")
          .select("ma_bravo, ten_vat_tu, phan_loai, san_pham, nhom_san_pham").in("ma_bravo", maList);
        for (const d of (dmRes.data ?? [])) {
          nameMap.set(d.ma_bravo, { ten: d.ten_vat_tu, phan_loai: d.phan_loai, san_pham: d.san_pham, nhom_san_pham: d.nhom_san_pham });
        }
      }
      const enriched = rows.map((r: any) => ({
        ...r,
        ten_vat_tu:     nameMap.get(r.ma_bravo)?.ten ?? null,
        phan_loai:      nameMap.get(r.ma_bravo)?.phan_loai ?? null,
        san_pham:       nameMap.get(r.ma_bravo)?.san_pham ?? null,
        nhom_san_pham:  nameMap.get(r.ma_bravo)?.nhom_san_pham ?? null,
      }));
      let filtered = enriched;
      if (payload.phan_loai)
        filtered = filtered.filter((r: any) => r.phan_loai === payload.phan_loai);
      if (perm.filterNhomSP?.length)
        filtered = filtered.filter((r: any) => perm.filterNhomSP!.includes(r.nhom_san_pham));
      if (payload.nhom_san_pham)
        filtered = filtered.filter((r: any) => r.nhom_san_pham === payload.nhom_san_pham);

      return { ok: true, rows: filtered, total: count ?? filtered.length, page, pageSize };
    }

    // KPI + options cho màn tài sản (aggregate, không phân trang)
    case "tai_san_kpi": {
      let q = admin.schema("app_ccdc").from("tai_san")
        .select("ma_bravo, so_luong, nguyen_gia, tinh_trang")
        .eq("trang_thai_hd", "Active");

      if (perm.filterMien) payload.mien = perm.filterMien;
      if (payload.mien)        q = q.eq("mien", payload.mien);
      if (payload.loai_vi_tri) q = q.eq("loai_vi_tri", payload.loai_vi_tri);
      const search = sanitizeSearch(payload.search ?? "");
      if (search) {
        const s = search.replace(/"/g, "");
        q = q.or(`ma_bravo.ilike.*${s}*,serial.ilike.*${s}*,pic.ilike.*${s}*,vi_tri.ilike.*${s}*`);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = data ?? [];

      const allMa = [...new Set(rows.map((r: any) => r.ma_bravo).filter(Boolean))];
      let dmMap = new Map<string, { phan_loai: string; nhom_san_pham: string }>();
      if (allMa.length) {
        let start = 0;
        while (start < allMa.length) {
          const batch = allMa.slice(start, start + 200);
          const { data: chunk, error: e } = await admin.schema("shared").from("dm_vat_tu")
            .select("ma_bravo, phan_loai, nhom_san_pham").in("ma_bravo", batch);
          if (e) throw new Error(e.message);
          for (const d of (chunk ?? [])) {
            dmMap.set(d.ma_bravo, { phan_loai: d.phan_loai, nhom_san_pham: d.nhom_san_pham });
          }
          start += 200;
        }
      }

      const enriched = rows.map((r: any) => ({
        ...r,
        phan_loai:     dmMap.get(r.ma_bravo)?.phan_loai ?? null,
        nhom_san_pham: dmMap.get(r.ma_bravo)?.nhom_san_pham ?? null,
      }));

      let baseForOptions = enriched;
      if (payload.phan_loai)
        baseForOptions = baseForOptions.filter((r: any) => r.phan_loai === payload.phan_loai);
      if (perm.filterNhomSP?.length)
        baseForOptions = baseForOptions.filter((r: any) => perm.filterNhomSP!.includes(r.nhom_san_pham));
      const nhom_sp_options = [...new Set(
        baseForOptions.map((r: any) => r.nhom_san_pham).filter(Boolean)
      )].sort();

      let filtered = baseForOptions;
      if (payload.nhom_san_pham)
        filtered = filtered.filter((r: any) => r.nhom_san_pham === payload.nhom_san_pham);

      const sl = filtered.reduce((s: number, r: any) => s + Number(r.so_luong ?? 0), 0);
      const gia_tri = filtered.reduce((s: number, r: any) =>
        s + Number(r.so_luong ?? 0) * Number(r.nguyen_gia ?? 0), 0);
      const gia_tri_dang_dung = filtered
        .filter((r: any) => r.tinh_trang === "dang_dung")
        .reduce((s: number, r: any) =>
          s + Number(r.so_luong ?? 0) * Number(r.nguyen_gia ?? 0), 0);

      return { ok: true, sl, gia_tri, gia_tri_dang_dung, nhom_sp_options };
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
      let dmMap2 = new Map<string, { ten: string; nsp: string }>();
      if (maList.length) {
        const dmRes = await admin.schema("shared").from("dm_vat_tu")
          .select("ma_bravo, ten_vat_tu, nhom_san_pham").in("ma_bravo", maList);
        for (const d of (dmRes.data ?? []))
          dmMap2.set(d.ma_bravo, { ten: d.ten_vat_tu, nsp: d.nhom_san_pham });
      }
      let enriched = rows.map((r: any) => ({
        ...r,
        ten_vat_tu: dmMap2.get(r.ma_bravo)?.ten ?? null,
      }));

      if (perm.filterNhomSP?.length)
        enriched = enriched.filter((r: any) =>
          perm.filterNhomSP!.includes(dmMap2.get(r.ma_bravo)?.nsp || ""));

      if (perm.filterMien) {
        const tsIds = [...new Set(enriched.map((r: any) => r.tai_san_id).filter(Boolean))];
        if (tsIds.length) {
          const tsRes = await admin.schema("app_ccdc").from("tai_san")
            .select("id, mien").in("id", tsIds);
          const mienSet = new Set(
            (tsRes.data ?? []).filter((t: any) => t.mien === perm.filterMien).map((t: any) => t.id));
          enriched = enriched.filter((r: any) => mienSet.has(r.tai_san_id));
        }
      }

      return { ok: true, rows: enriched, total: count ?? enriched.length, page, pageSize };
    }

    // ── Ngân sách (CRUD) — đăng ký theo mã Bravo + SL ───────────────────

    // Dropdown options: BU, nhóm SP (filtered by BU), miền
    case "ngan_sach_options": {
      const filterBU: string | null = payload.bu || null;
      const all: any[] = [];
      let start = 0;
      while (true) {
        let q = admin.schema("shared").from("dm_vat_tu")
          .select("bu, nhom_san_pham")
          .in("phan_loai", ["CCDC", "THIẾT BỊ"]);
        if (perm.filterNhomSP?.length)
          q = q.in("nhom_san_pham", perm.filterNhomSP);
        const { data, error } = await q.range(start, start + 999);
        if (error) throw new Error(error.message);
        const rows = data ?? [];
        if (!rows.length) break;
        all.push(...rows);
        if (rows.length < 1000) break;
        start += 1000;
      }
      const bu = [...new Set(all.map((r: any) => r.bu).filter(Boolean))].sort();
      const pool = filterBU ? all.filter((r: any) => r.bu === filterBU) : all;
      const nhom_san_pham = [...new Set(pool.map((r: any) => r.nhom_san_pham).filter(Boolean))].sort();
      const mien = ["Miền Bắc", "Miền Trung", "Miền Nam"];
      return { ok: true, bu, nhom_san_pham, mien };
    }

    // Danh sách hàng hóa cho wizard thêm ngân sách (filtered by BU + nhóm SP)
    case "ngan_sach_items": {
      const { bu, nhom_san_pham, nam_tai_chinh, mien } = payload;
      if (!nhom_san_pham) return { ok: false, error: "missing_nhom_san_pham" };
      let q = admin.schema("shared").from("dm_vat_tu")
        .select("ma_bravo, ten_vat_tu, ma_ncc, nhom_san_pham, bu, don_gia_mua")
        .in("phan_loai", ["CCDC", "THIẾT BỊ"])
        .eq("nhom_san_pham", nhom_san_pham);
      if (bu) q = q.eq("bu", bu);
      if (perm.filterNhomSP?.length)
        q = q.in("nhom_san_pham", perm.filterNhomSP);
      q = q.order("ma_ncc").order("ma_bravo").limit(500);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const items = (data ?? []).filter((r: any) => r.ma_bravo && r.ma_bravo !== "Chưa có");

      const maList = items.map((r: any) => r.ma_bravo);
      const existingMap = new Map<string, { id: number; so_luong: number }>();
      if (maList.length && nam_tai_chinh) {
        let eq = admin.schema("app_ccdc").from("ngan_sach")
          .select("ma_bravo, so_luong, id")
          .eq("nam_tai_chinh", Number(nam_tai_chinh))
          .in("ma_bravo", maList);
        if (mien) eq = eq.eq("mien", mien);
        else eq = eq.is("mien", null);
        const { data: existing } = await eq;
        for (const r of (existing ?? []))
          existingMap.set(r.ma_bravo, { id: r.id, so_luong: r.so_luong });
      }
      const rows = items.map((r: any) => ({
        ...r,
        existing_id: existingMap.get(r.ma_bravo)?.id ?? null,
        existing_sl: existingMap.get(r.ma_bravo)?.so_luong ?? null,
      }));
      return { ok: true, rows };
    }

    case "list_ngan_sach": {
      let qNS = admin.schema("app_ccdc").from("v_budget_canh_bao")
        .select("*").order("fy", { ascending: false })
        .order("nhom_san_pham", { nullsFirst: true })
        .order("mien", { nullsFirst: true })
        .order("ma_ncc", { nullsFirst: true })
        .order("ma_bravo");
      if (perm.filterNhomSP?.length)
        qNS = qNS.in("nhom_san_pham", perm.filterNhomSP);
      const { data, error } = await qNS;
      if (error) throw new Error(error.message);
      return { ok: true, rows: data ?? [] };
    }

    // Lưu batch nhiều mã cùng lúc
    case "batch_upsert_ngan_sach": {
      if (!perm.canWrite) return { ok: false, error: "forbidden" };
      const { nam_tai_chinh, mien, items } = payload;
      if (!nam_tai_chinh) return { ok: false, error: "missing_nam_tai_chinh" };
      if (!Array.isArray(items) || !items.length) return { ok: false, error: "no_items" };
      const results: any[] = [];
      for (const item of items) {
        if (!item.ma_bravo || !item.so_luong || Number(item.so_luong) <= 0) continue;
        const row = {
          nam_tai_chinh: Number(nam_tai_chinh),
          ma_bravo: String(item.ma_bravo).trim(),
          mien: mien || null,
          so_luong: Number(item.so_luong),
        };
        const q = item.id
          ? admin.schema("app_ccdc").from("ngan_sach").update(row).eq("id", item.id).select().single()
          : admin.schema("app_ccdc").from("ngan_sach").insert(row).select().single();
        const { data, error } = await q;
        if (error) results.push({ ma_bravo: item.ma_bravo, error: error.message });
        else results.push({ ma_bravo: item.ma_bravo, ok: true, id: data.id });
      }
      return { ok: true, results };
    }

    // Sửa 1 dòng ngân sách (inline edit từ bảng chính)
    case "upsert_ngan_sach": {
      if (!perm.canWrite) return { ok: false, error: "forbidden" };
      const { id, nam_tai_chinh, ma_bravo, mien, so_luong } = payload;
      if (!nam_tai_chinh) return { ok: false, error: "missing_nam_tai_chinh" };
      if (!ma_bravo) return { ok: false, error: "missing_ma_bravo" };
      if (!so_luong || Number(so_luong) <= 0) return { ok: false, error: "invalid_so_luong" };
      const row = {
        nam_tai_chinh: Number(nam_tai_chinh),
        ma_bravo:      String(ma_bravo).trim(),
        mien:          mien || null,
        so_luong:      Number(so_luong),
      };
      const q = id
        ? admin.schema("app_ccdc").from("ngan_sach").update(row).eq("id", id).select().single()
        : admin.schema("app_ccdc").from("ngan_sach").insert(row).select().single();
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return { ok: true, row: data };
    }

    case "delete_ngan_sach": {
      if (!perm.canWrite) return { ok: false, error: "forbidden" };
      const { id, ids } = payload;
      const toDelete: number[] = Array.isArray(ids) ? ids.map(Number).filter(Boolean)
        : id ? [Number(id)] : [];
      if (!toDelete.length) return { ok: false, error: "missing_id" };
      const { error } = await admin.schema("app_ccdc").from("ngan_sach")
        .delete().in("id", toDelete);
      if (error) throw new Error(error.message);
      return { ok: true, deleted: toDelete.length };
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

      // ── Build queries with permission filters ──
      let dmQ = admin.schema("shared").from("dm_vat_tu")
        .select("phan_loai", { count: "exact", head: false })
        .in("phan_loai", ["CCDC", "THIẾT BỊ"]);
      if (perm.filterNhomSP?.length)
        dmQ = dmQ.in("nhom_san_pham", perm.filterNhomSP);

      let tsQ = admin.schema("app_ccdc").from("tai_san")
        .select("id, ma_bravo, so_luong, nguyen_gia, mien, loai_vi_tri, pic, trang_thai_hd")
        .eq("trang_thai_hd", "Active");
      if (perm.filterMien) tsQ = tsQ.eq("mien", perm.filterMien);

      let budgetQ = admin.schema("app_ccdc").from("v_budget_canh_bao")
        .select("*").eq("fy", fy);
      if (perm.filterNhomSP?.length)
        budgetQ = budgetQ.in("nhom_san_pham", perm.filterNhomSP);

      const [dmCnt, tsRes, gdFyRes, recentRes, budgetRes, conLaiRes] = await Promise.all([
        dmQ,
        tsQ,
        admin.schema("app_ccdc").from("giao_dich")
          .select("ngay, loai, thanh_tien, so_luong, ma_bravo, tai_san_id")
          .in("loai", ["nhap_moi", "huy"])
          .gte("ngay", fyStart).lt("ngay", fyEnd),
        admin.schema("app_ccdc").from("giao_dich")
          .select("id, ngay, loai, ma_bravo, tai_san_id, so_luong, thanh_tien, ghi_chu")
          .order("ngay", { ascending: false }).order("id", { ascending: false }).limit(30),
        budgetQ,
        admin.schema("app_ccdc").from("v_gia_tri_con_lai").select("gia_tri_con_lai"),
      ]);

      // KPI mã
      const cntByPl: Record<string, number> = { CCDC: 0, "THIẾT BỊ": 0 };
      for (const d of (dmCnt.data ?? [])) if (d.phan_loai in cntByPl) cntByPl[d.phan_loai]++;

      // KPI tai_san — enrich with dm_vat_tu early (needed for PM filter)
      let ts = tsRes.data ?? [];
      const tsMaList = [...new Set(ts.map((r: any) => r.ma_bravo).filter(Boolean))];
      const plMap = new Map<string, string>();
      const nspMap = new Map<string, string>();
      if (tsMaList.length) {
        const plRes = await admin.schema("shared").from("dm_vat_tu")
          .select("ma_bravo, phan_loai, nhom_san_pham").in("ma_bravo", tsMaList);
        for (const d of (plRes.data ?? [])) {
          plMap.set(d.ma_bravo, d.phan_loai);
          nspMap.set(d.ma_bravo, d.nhom_san_pham);
        }
      }
      if (perm.filterNhomSP?.length)
        ts = ts.filter((r: any) => perm.filterNhomSP!.includes(nspMap.get(r.ma_bravo) || ""));

      const tong_nguyen_gia = ts.reduce((s: number, r: any) =>
        s + Number(r.so_luong ?? 0) * Number(r.nguyen_gia ?? 0), 0);
      const so_tai_san = ts.length;
      const so_luong_tong = ts.reduce((s: number, r: any) => s + Number(r.so_luong ?? 0), 0);

      // KPI YTD — post-filter giao_dich for PM/AM
      let gdFy = gdFyRes.data ?? [];
      if (perm.filterNhomSP?.length)
        gdFy = gdFy.filter((r: any) => perm.filterNhomSP!.includes(nspMap.get(r.ma_bravo) || ""));
      if (perm.filterMien) {
        const tsIdSet = new Set(ts.map((r: any) => r.id));
        gdFy = gdFy.filter((r: any) => tsIdSet.has(r.tai_san_id));
      }

      const mua_moi_ytd = gdFy.filter((r: any) => r.loai === "nhap_moi")
        .reduce((s: number, r: any) => s + Number(r.thanh_tien ?? 0), 0);
      const huy_ytd = gdFy.filter((r: any) => r.loai === "huy")
        .reduce((s: number, r: any) => s + Number(r.thanh_tien ?? 0), 0);

      // KPI giá trị còn lại (view — cannot filter by scope, show global)
      const tong_gia_tri_con_lai = (conLaiRes.data ?? [])
        .reduce((s: number, r: any) => s + Number(r.gia_tri_con_lai ?? 0), 0);

      // Budget cả năm FY hiện tại — aggregate theo nhóm SP cho gauge
      const budgetRaw = budgetRes.data ?? [];
      const budgetByNhom: Record<string, { nhom_san_pham: string; sl_dang_ky: number; sl_da_dung: number; da_chi: number }> = {};
      for (const r of budgetRaw) {
        const k = r.nhom_san_pham || "(tất cả)";
        const agg = (budgetByNhom[k] ??= { nhom_san_pham: k, sl_dang_ky: 0, sl_da_dung: 0, da_chi: 0 });
        agg.sl_dang_ky += Number(r.sl_dang_ky ?? 0);
        agg.sl_da_dung += Number(r.sl_da_dung ?? 0);
        agg.da_chi     += Number(r.da_chi ?? 0);
      }
      const budget = Object.values(budgetByNhom).map(r => ({
        ...r,
        pct: r.sl_dang_ky ? Math.round(r.sl_da_dung / r.sl_dang_ky * 1000) / 10 : 0,
        trang_thai: !r.sl_dang_ky ? "OK"
          : r.sl_da_dung > r.sl_dang_ky ? "VUOT"
          : r.sl_da_dung >= r.sl_dang_ky * 0.8 ? "CANH_BAO" : "OK",
      }));
      const ngan_sach_ca_nam = budgetRaw.reduce((s: number, r: any) =>
        s + Number(r.da_chi ?? 0), 0);
      const tong_sl_dang_ky = budgetRaw.reduce((s: number, r: any) =>
        s + Number(r.sl_dang_ky ?? 0), 0);
      const tong_sl_da_dung = budgetRaw.reduce((s: number, r: any) =>
        s + Number(r.sl_da_dung ?? 0), 0);

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
      type TonAgg  = { sl: number; sl_ccdc: number; sl_tb: number; nguyen_gia: number };
      type TonPic  = TonAgg;
      type TonViTri = TonAgg & { pics: Record<string, TonPic> };
      type TonMien = TonAgg & { vitris: Record<string, TonViTri> };
      const newAgg = () => ({ sl: 0, sl_ccdc: 0, sl_tb: 0, nguyen_gia: 0 });
      const addAgg = (a: TonAgg, sl: number, val: number, pl: string) => {
        a.sl += sl; a.nguyen_gia += val;
        if (pl === "CCDC") a.sl_ccdc += sl;
        else if (pl === "THIẾT BỊ") a.sl_tb += sl;
      };
      const tonByMien: Record<string, TonMien> = {};
      for (const r of ts) {
        const sl  = Number(r.so_luong ?? 0);
        const val = sl * Number(r.nguyen_gia ?? 0);
        const pl  = plMap.get(r.ma_bravo) ?? "";
        const mk = r.mien || "—", vt = r.loai_vi_tri || "—", pic = r.pic || "—";
        const M = (tonByMien[mk] ??= { ...newAgg(), vitris: {} });
        addAgg(M, sl, val, pl);
        const V = (M.vitris[vt] ??= { ...newAgg(), pics: {} });
        addAgg(V, sl, val, pl);
        const P = (V.pics[pic] ??= newAgg());
        addAgg(P, sl, val, pl);
      }
      const bySl = (a: any, b: any) => b.sl - a.sl;
      const pickAgg = (x: TonAgg) => ({ sl: x.sl, sl_ccdc: x.sl_ccdc, sl_tb: x.sl_tb, nguyen_gia: x.nguyen_gia });

      // GD gần nhất + enrich tên + scope filter
      let recent = recentRes.data ?? [];
      if (perm.filterNhomSP?.length)
        recent = recent.filter((r: any) => perm.filterNhomSP!.includes(nspMap.get(r.ma_bravo) || ""));
      if (perm.filterMien) {
        const tsIdSet2 = new Set(ts.map((r: any) => r.id));
        recent = recent.filter((r: any) => tsIdSet2.has(r.tai_san_id));
      }
      recent = recent.slice(0, 10);

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
          tong_sl_dang_ky, tong_sl_da_dung,
        },
        ton_by_mien: Object.entries(tonByMien).map(([mien, M]) => ({
          mien, ...pickAgg(M),
          children: Object.entries(M.vitris).map(([vi_tri, V]) => ({
            vi_tri, ...pickAgg(V),
            children: Object.entries(V.pics).map(([pic, P]) => ({
              pic, ...pickAgg(P),
            })).sort(bySl),
          })).sort(bySl),
        })).sort(bySl),
        budget,
        chart_theo_ky,
        recent_giao_dich: recent_enriched,
      };
    }

    // ── Admin: sửa tài sản ─────────────────────────────────────────────
    case "update_tai_san": {
      if (!perm.canWrite) return { ok: false, error: "forbidden" };
      const { id, ...fields } = payload ?? {};
      if (!id) return { ok: false, error: "missing_id" };
      const allow = ["serial", "vi_tri", "loai_vi_tri", "mien", "pic", "pic_id",
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
      if (!perm.canWrite) return { ok: false, error: "forbidden" };
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
      if (!perm.canWrite) return { ok: false, error: "forbidden" };
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
          pic_id:        p.pic_id      || null,
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
          loai_vi_tri: p.loai_vi_tri_den ?? source.loai_vi_tri,
          mien:        p.mien_den        ?? source.mien,
          pic:         p.pic_den         ?? null,
          pic_id:      p.pic_id_den      ?? null,
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
            vi_tri: source.vi_tri, // giữ nguyên (chỉ dùng cho TB legacy)
            ...dest,
            tinh_trang: source.tinh_trang, trang_thai_hd: "Active",
            so_luong: qty, nguyen_gia: source.nguyen_gia,
            ngay_mua: source.ngay_mua, ghi_chu: p.ghi_chu || null,
          }).select().single();
          if (eN) throw new Error(eN.message);
          target_id = nr.id;
        }
        // Ledger: dùng pic_id_tu/pic_id_den (giữ cột vi_tri_tu/den để backward compat)
        const { error: eG } = await app.from("giao_dich").insert({
          ngay: nowDate, loai: "dieu_chuyen", ma_bravo: source.ma_bravo,
          tai_san_id: target_id, so_luong: qty,
          don_gia: Number(source.nguyen_gia),
          vi_tri_tu:  source.pic_id, pic_tu:  source.pic,
          vi_tri_den: dest.pic_id,   pic_den: dest.pic,
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
