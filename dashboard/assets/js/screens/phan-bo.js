// Màn Phân bổ CCDC — so CCDC ký gửi (snapshot mới nhất) với quota thầu còn lại theo BV, cùng nhóm SP.
// Chỉ số: quota còn lại (VNĐ) / SL CCDC. Ngưỡng T chỉnh được (mặc định = trung vị):
//   Cân nhắc rút : có CCDC, quota/CCDC < T/2 (hoặc không có quota FY)
//   Theo dõi     : như trên nhưng có quota upcoming
//   Cần thêm     : có CCDC, quota/CCDC ≥ 2T
//   Thiếu CCDC   : chưa có CCDC, quota còn lại ≥ T
(function () {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");
  const fmtTien = (n) => {
    if (n == null) return "—";
    const v = Number(n);
    if (v === 0) return "0";
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, "") + " tỷ";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + " tr";
    return Math.round(v).toLocaleString("vi-VN");
  };
  const fmtKy = (d) => { if (!d) return "—"; const [y, m] = String(d).split("-"); return "T" + Number(m) + "/" + y; };
  const median = (arr) => {
    const s = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!s.length) return 0;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const STATUS = {
    rut:      { label: "Cân nhắc rút", cls: "bg-red-50 text-red-700",     order: 0 },
    theo_doi: { label: "Theo dõi",     cls: "bg-amber-50 text-amber-700", order: 1 },
    thieu:    { label: "Thiếu CCDC",   cls: "bg-blue-50 text-blue-700",   order: 2 },
    them:     { label: "Cần thêm",     cls: "bg-blue-50 text-blue-700",   order: 3 },
    giu:      { label: "Giữ",          cls: "bg-slate-100 text-slate-700", order: 4 },
  };

  function classify(rows, loai, T) {
    return rows.map((r) => {
      const sl = loai ? (r.loai[loai] || 0) : r.sl_ccdc;
      const conLai = r.quota_tien_con_lai;
      const per = sl > 0 ? conLai / sl : null;
      const dangGiu = T > 0 ? Math.floor(conLai / T) : 0;
      let status = null, ly_do = "";
      if (sl > 0) {
        if (!r.co_quota || per < T / 2) {
          status = r.quota_tien_sap_toi > 0 ? "theo_doi" : "rut";
          ly_do = !r.co_quota ? "Không có quota FY trong kế hoạch"
            : "Quota còn lại/CCDC thấp" + (r.quota_tien_sap_toi > 0
              ? ", có quota upcoming" + (r.thang_thau_sap_toi ? " " + fmtKy(r.thang_thau_sap_toi + "-01") : "") : "");
        } else if (per >= 2 * T) { status = "them"; ly_do = "Quota còn lại/CCDC cao"; }
        else status = "giu";
      } else if (conLai >= T && T > 0) { status = "thieu"; ly_do = "Có quota, chưa ký gửi CCDC"; }
      const du = status === "rut" ? Math.max(0, sl - Math.max(dangGiu, 0)) : 0;
      const can = status === "thieu" || status === "them" ? Math.max(0, dangGiu - sl) : 0;
      return { ...r, sl, per, dangGiu, status, ly_do, du, can };
    });
  }

  // Ghép BV dư → BV thiếu, ưu tiên cùng miền, BV dư nặng nhất đi trước.
  function suggestMoves(rows) {
    const donors = rows.filter((r) => r.du > 0).map((r) => ({ r, left: r.du }))
      .sort((a, b) => (a.r.per ?? -1) - (b.r.per ?? -1));
    const recv = rows.filter((r) => r.can > 0).map((r) => ({ r, left: r.can }))
      .sort((a, b) => b.r.quota_tien_con_lai - a.r.quota_tien_con_lai);
    const moves = [];
    for (const sameMien of [true, false]) {
      for (const d of donors) {
        for (const t of recv) {
          if (!d.left) break;
          if (!t.left || (sameMien && d.r.mien !== t.r.mien)) continue;
          const n = Math.min(d.left, t.left);
          moves.push({ from: d.r, to: t.r, sl: n });
          d.left -= n; t.left -= n;
        }
      }
    }
    return moves;
  }

  const bvCell = (r) => h("div", { className: "min-w-[12rem]" },
    h("div", { className: "text-slate-800" },
      r.ma_bv && h("span", { className: "font-mono text-[11px] text-slate-400 mr-1.5" }, r.ma_bv), r.ten_bv || "—"),
    h("div", { className: "text-[11px] text-slate-400" }, r.mien || "chưa xác định miền"));

  function PhanBoScreen() {
    const [params, setParams] = useState({});
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loai, setLoai] = useState("");
    const [tInput, setTInput] = useState("");
    const [tab, setTab] = useState("de_xuat");

    useEffect(() => {
      let alive = true;
      setLoading(true); setError("");
      api("phan_bo_ccdc", params)
        .then((res) => { if (alive) { setData(res); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e.message || String(e)); setLoading(false); } });
      return () => { alive = false; };
    }, [params]);
    useEffect(() => { setLoai(""); setTInput(""); }, [data && data.nhom_san_pham, data && data.fy]);

    const rowsAll = (data && data.rows) || [];
    const medianT = useMemo(() => median(rowsAll
      .map((r) => { const sl = loai ? (r.loai[loai] || 0) : r.sl_ccdc; return sl > 0 && r.co_quota ? r.quota_tien_con_lai / sl : null; })),
      [rowsAll, loai]);
    const T = tInput !== "" && Number(tInput) > 0 ? Number(tInput) * 1e6 : medianT;
    const rows = useMemo(() => classify(rowsAll, loai, T), [rowsAll, loai, T]);
    const moves = useMemo(() => suggestMoves(rows), [rows]);

    if (loading && !data) return h("div", { className: "p-6 text-sm text-slate-500" }, "Đang tải…");
    if (error) return h("div", { className: "p-6" },
      h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error));
    if (!data.nhom_san_pham) return h("div", { className: "p-6" },
      h("div", { className: "bg-white border border-slate-200 rounded-lg px-6 py-12 text-center text-sm text-slate-400" },
        "Chưa có snapshot ký gửi — vào ", h("a", { href: "#/ky-gui", className: "text-blue-600 hover:underline" }, "Ký gửi"), " để upload."));

    const count = (s) => rows.filter((r) => r.status === s);
    const coCcdc = rows.filter((r) => r.sl > 0);
    const khongQuota = coCcdc.filter((r) => !r.co_quota);
    const tabs = [
      ["de_xuat", "Cần xử lý", rows.filter((r) => ["rut", "theo_doi", "thieu", "them"].includes(r.status))],
      ["co_ccdc", "Đang ký gửi", coCcdc],
      ["tat_ca", "Tất cả BV có quota / CCDC", rows],
    ];
    const shown = (tabs.find((t) => t[0] === tab) || tabs[0])[2].slice()
      .sort((a, b) => ((STATUS[a.status] || { order: 9 }).order - (STATUS[b.status] || { order: 9 }).order)
        || ((a.per ?? Infinity) - (b.per ?? Infinity)) || (b.quota_tien_con_lai - a.quota_tien_con_lai));

    const sel = "px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400";
    const card = "bg-white border border-slate-200 rounded-lg";
    const kpi = (label, value, sub) => h("div", { className: card + " p-4" },
      h("div", { className: "text-xs text-slate-500 uppercase tracking-wide font-semibold" }, label),
      h("div", { className: "mt-1 text-xl md:text-2xl font-bold tabular-nums text-slate-900" }, value),
      sub && h("div", { className: "text-xs text-slate-500 mt-0.5" }, sub));
    const th = (label, right) => h("th", { className: "px-3 py-2 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap " + (right ? "text-right" : "text-left") }, label);
    const fyLabel = (y) => "FY" + String(y).slice(-2);

    return h("div", { className: "p-4 md:p-6 space-y-5" + (loading ? " opacity-60" : "") },
      h("div", { className: "flex items-center gap-2 flex-wrap" },
        h("h1", { className: "text-lg font-bold text-slate-900 mr-1" }, "Phân bổ CCDC"),
        h("select", { className: sel, value: data.nhom_san_pham,
          onChange: (e) => setParams({ ...params, nhom_san_pham: e.target.value }) },
          data.nhom_options.map((n) => h("option", { key: n, value: n }, n))),
        h("select", { className: sel, value: data.fy, onChange: (e) => setParams({ ...params, fiscal_year: Number(e.target.value) }) },
          [data.fy - 1, data.fy, data.fy + 1].map((y) => h("option", { key: y, value: y }, fyLabel(y)))),
        h("select", { className: sel + " max-w-[16rem]", value: loai, onChange: (e) => setLoai(e.target.value) },
          h("option", { value: "" }, "Mọi loại CCDC"),
          data.loai_options.map((l) => h("option", { key: l, value: l }, l))),
      ),
      h("div", { className: "text-xs text-slate-500" },
        "CCDC: snapshot ", fmtKy(data.snapshot.ky_cap_nhat), " · Quota: ", data.nam_tai_chinh, " (chính thức)",
        data.current_month ? ", thực hiện tính đến " + fmtKy(data.current_month + "-01") : "",
        " · Quota on hand = thầu cũ + đợt đã tới tháng thầu; upcoming = đợt chưa tới tháng. Quota còn lại = on hand − doanh thu thực hiện FY.",
        loai && h("span", { className: "text-amber-700" }, " Đang lọc 1 loại CCDC: quota vẫn là của cả nhóm SP, chưa tách theo loại.")),

      h("div", { className: card + " p-4 flex flex-wrap items-center gap-3 text-sm" },
        h("span", { className: "text-slate-600" }, "Ngưỡng quota còn lại / 1 CCDC:"),
        h("input", {
          type: "number", min: 0, step: 10, value: tInput, placeholder: (medianT / 1e6).toFixed(0),
          onChange: (e) => setTInput(e.target.value),
          className: "w-28 px-2 py-1 text-sm border border-slate-300 rounded outline-none focus:border-blue-400 text-right tabular-nums",
        }),
        h("span", { className: "text-slate-600" }, "triệu ₫"),
        tInput !== ""
          ? h("button", { onClick: () => setTInput(""), className: "text-xs text-blue-600 hover:underline" }, "Về mặc định (trung vị " + fmtTien(medianT) + ")")
          : h("span", { className: "text-xs text-slate-400" }, "Mặc định = trung vị các BV đang ký gửi (" + fmtTien(medianT) + ")"),
        h("span", { className: "text-xs text-slate-400 basis-full" },
          "Cân nhắc rút khi < ", fmtTien(T / 2), " · Cần thêm khi ≥ ", fmtTien(2 * T), " · Thiếu CCDC khi chưa ký gửi mà quota còn lại ≥ ", fmtTien(T)),
      ),

      h("div", { className: "grid grid-cols-2 md:grid-cols-5 gap-3" },
        kpi("Quota on hand", fmtTien(rows.reduce((s, r) => s + r.quota_tien_on_hand, 0)),
          "Upcoming " + fmtTien(rows.reduce((s, r) => s + r.quota_tien_sap_toi, 0)) +
          " · còn lại " + fmtTien(rows.reduce((s, r) => s + r.quota_tien_con_lai, 0))),
        kpi("BV đang ký gửi", fmtInt(coCcdc.length), "SL CCDC " + fmtInt(coCcdc.reduce((s, r) => s + r.sl, 0))),
        kpi("Cân nhắc rút", fmtInt(count("rut").length), "SL dư ước tính " + fmtInt(count("rut").reduce((s, r) => s + r.du, 0))),
        kpi("Thiếu / cần thêm", fmtInt(count("thieu").length + count("them").length),
          "SL cần ước tính " + fmtInt(rows.reduce((s, r) => s + r.can, 0))),
        kpi("Ký gửi nhưng không có quota", fmtInt(khongQuota.length), khongQuota.length ? "Kiểm tra mã BV ↔ mã KH" : null),
      ),

      h("div", { className: card + " overflow-hidden" },
        h("div", { className: "px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700" },
          "Gợi ý điều chuyển (" + moves.length + ")"),
        moves.length === 0
          ? h("div", { className: "px-4 py-6 text-center text-sm text-slate-400" }, "Không có cặp BV dư → BV thiếu với ngưỡng hiện tại")
          : h("div", { className: "overflow-x-auto" }, h("table", { className: "w-full text-sm" },
              h("thead", { className: "bg-slate-50" }, h("tr", null, th("Rút từ"), th("Chuyển tới"), th("SL", true), th("Quota còn lại nơi tới", true))),
              h("tbody", null, moves.map((m, i) => h("tr", { key: i, className: "border-t border-slate-100 align-top" },
                h("td", { className: "px-3 py-2" }, bvCell(m.from)),
                h("td", { className: "px-3 py-2" }, bvCell(m.to),
                  m.from.mien !== m.to.mien && h("span", { className: "text-[10px] font-semibold text-amber-700" }, "khác miền")),
                h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold" }, fmtInt(m.sl)),
                h("td", { className: "px-3 py-2 text-right tabular-nums" }, fmtTien(m.to.quota_tien_con_lai)))))))),

      h("div", { className: card + " overflow-hidden" },
        h("div", { className: "flex items-center gap-1 px-2 pt-2 border-b border-slate-200 overflow-x-auto" },
          tabs.map(([k, label, list]) => h("button", {
            key: k, onClick: () => setTab(k),
            className: "px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap " +
              (tab === k ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-800"),
          }, label + " (" + list.length + ")"))),
        h("div", { className: "overflow-x-auto" }, h("table", { className: "w-full text-sm" },
          h("thead", { className: "bg-slate-50" }, h("tr", null,
            th("Bệnh viện"), th("Đề xuất"), th("SL CCDC", true), th("Quota on hand", true), th("Đã thực hiện", true),
            th("Quota còn lại", true), th("Quota upcoming", true), th("DT 3 tháng", true), th("Còn lại / CCDC", true), th("SL nên có", true))),
          h("tbody", null,
            shown.length === 0
              ? h("tr", null, h("td", { colSpan: 10, className: "px-3 py-8 text-center text-sm text-slate-400" }, "Không có BV nào"))
              : shown.map((r) => h("tr", { key: r.ma_bv || r.ten_bv, className: "border-t border-slate-100 align-top" },
                  h("td", { className: "px-3 py-2" }, bvCell(r)),
                  h("td", { className: "px-3 py-2" },
                    r.status && h("span", { className: "inline-block px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap " + STATUS[r.status].cls }, STATUS[r.status].label),
                    r.ly_do && h("div", { className: "text-[11px] text-slate-400 mt-0.5" }, r.ly_do)),
                  h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold",
                    title: Object.entries(r.loai).map(([l, n]) => l + ": " + n).join("\n") }, fmtInt(r.sl)),
                  h("td", { className: "px-3 py-2 text-right tabular-nums text-slate-600" }, r.co_quota ? fmtTien(r.quota_tien_on_hand) : h("span", { className: "text-slate-400" }, "—")),
                  h("td", { className: "px-3 py-2 text-right tabular-nums text-slate-600" }, r.co_quota ? fmtTien(r.dt_thuc_hien) : "—"),
                  h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold" }, r.co_quota ? fmtTien(r.quota_tien_con_lai) : h("span", { className: "text-slate-400" }, "—")),
                  h("td", { className: "px-3 py-2 text-right tabular-nums text-slate-600" },
                    r.quota_tien_sap_toi > 0 ? h("span", null, fmtTien(r.quota_tien_sap_toi),
                      r.thang_thau_sap_toi && h("div", { className: "text-[11px] text-slate-400" }, fmtKy(r.thang_thau_sap_toi + "-01"))) : "—"),
                  h("td", { className: "px-3 py-2 text-right tabular-nums text-slate-600" }, r.co_quota ? fmtTien(r.dt_3_thang) : "—"),
                  h("td", { className: "px-3 py-2 text-right tabular-nums" }, r.co_quota && r.per != null ? fmtTien(r.per) : "—"),
                  h("td", { className: "px-3 py-2 text-right tabular-nums text-slate-600" }, r.co_quota ? fmtInt(r.dangGiu) : "—"),
                ))))),
      ),
    );
  }

  window.CCDC_ROUTER.register("/phan-bo", PhanBoScreen);
})();
