// Màn Phân bổ CCDC — so CCDC ký gửi (snapshot mới nhất) với quota khả dụng theo BV, cùng nhóm SP.
// Quota khả dụng = Quota Onhand − TH YTD. Chỉ số: quota khả dụng (VNĐ) / SL CCDC. Ngưỡng T chỉnh được (mặc định = trung vị):
//   Cân nhắc rút : có CCDC, quota/CCDC < T/2 (hoặc không có quota FY)
//   Theo dõi     : như trên nhưng có Quota Upcoming
//   Cần thêm     : có CCDC, quota/CCDC ≥ 2T
//   Thiếu CCDC   : chưa có CCDC, quota khả dụng ≥ T
(function () {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const { useKgFilters, KgFilters } = window.CCDC_KG;
  const { fmtInt, fmtTien, fmtKy, useReload, StatCard, Panel, Badge, Segmented, FilterSelect,
    LoadingBlock, RefreshingBar, Empty, T, btn } = window.CCDC_UI;

  const median = (arr) => {
    const s = arr.filter((x) => x != null && isFinite(x)).sort((a, b) => a - b);
    if (!s.length) return 0;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  const STATUS = {
    rut:      { label: "Cân nhắc rút", tone: "red",   order: 0 },
    theo_doi: { label: "Theo dõi",     tone: "amber", order: 1 },
    thieu:    { label: "Thiếu CCDC",   tone: "blue",  order: 2 },
    them:     { label: "Cần thêm",     tone: "blue",  order: 3 },
    giu:      { label: "Giữ",          tone: "grey",  order: 4 },
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
            : "Quota khả dụng/CCDC thấp" + (r.quota_tien_sap_toi > 0
              ? ", có Quota Upcoming" + (r.thang_thau_sap_toi ? " " + fmtKy(r.thang_thau_sap_toi + "-01") : "") : "");
        } else if (per >= 2 * T) { status = "them"; ly_do = "Quota khả dụng/CCDC cao"; }
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
      r.ma_bv && h("span", { className: "mr-1.5 font-mono text-[11px] text-slate-400" }, r.ma_bv), r.ten_bv || "—"),
    h("div", { className: "text-[11px] text-slate-400" }, r.mien || "chưa xác định miền"));

  function PhanBoScreen({ user }) {
    const f = useKgFilters(user, { requireNhom: true });
    const reload = useReload();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loai, setLoai] = useState("");
    const [tInput, setTInput] = useState("");
    const [tab, setTab] = useState("de_xuat");

    useEffect(() => {
      if (f.loading) return;
      let alive = true;
      setLoading(true); setError("");
      api("phan_bo_ccdc", { nhom_san_pham: f.nhom || null, fiscal_year: f.fy, mien: f.mien })
        .then((res) => { if (alive) { setData(res); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e.message || String(e)); setLoading(false); } });
      return () => { alive = false; };
    }, [f.loading, f.nhom, f.fy, f.mien.join("|"), reload]);
    useEffect(() => { setLoai(""); setTInput(""); }, [data && data.nhom_san_pham, data && data.fy]);

    const rowsAll = (data && data.rows) || [];
    const medianT = useMemo(() => median(rowsAll
      .map((r) => { const sl = loai ? (r.loai[loai] || 0) : r.sl_ccdc; return sl > 0 && r.co_quota ? r.quota_tien_con_lai / sl : null; })),
      [rowsAll, loai]);
    const T0 = tInput !== "" && Number(tInput) > 0 ? Number(tInput) * 1e6 : medianT;
    const rows = useMemo(() => classify(rowsAll, loai, T0), [rowsAll, loai, T0]);
    const moves = useMemo(() => suggestMoves(rows), [rows]);

    const filters = h(KgFilters, { f });
    if (!data) return h(React.Fragment, null, filters, h(LoadingBlock, { error: error || f.error }));
    if (!data.nhom_san_pham) return h(React.Fragment, null, filters,
      h(Empty, null, "Chưa có snapshot ký gửi — vào tab Chi tiết theo kỳ để upload."));

    const count = (s) => rows.filter((r) => r.status === s);
    const coCcdc = rows.filter((r) => r.sl > 0);
    const khongQuota = coCcdc.filter((r) => !r.co_quota);
    const tabs = [
      { key: "de_xuat", label: "Cần xử lý", list: rows.filter((r) => ["rut", "theo_doi", "thieu", "them"].includes(r.status)) },
      { key: "co_ccdc", label: "Đang ký gửi", list: coCcdc },
      { key: "tat_ca", label: "Tất cả BV", list: rows },
    ];
    const shown = (tabs.find((t) => t.key === tab) || tabs[0]).list.slice()
      .sort((a, b) => ((STATUS[a.status] || { order: 9 }).order - (STATUS[b.status] || { order: 9 }).order)
        || ((a.per ?? Infinity) - (b.per ?? Infinity)) || (b.quota_tien_con_lai - a.quota_tien_con_lai));
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);

    return h("div", { className: "space-y-4" },
      filters,
      loading && h(RefreshingBar),
      error && h(LoadingBlock, { error }),

      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(FilterSelect, { label: "Loại CCDC", searchable: true, options: data.loai_options, selected: loai ? [loai] : [], onChange: (v) => setLoai(v[0] || "") }),
        h("div", { className: "flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px]" },
          h("span", { className: "text-slate-400" }, "Ngưỡng khả dụng / CCDC:"),
          h("input", {
            type: "number", min: 0, step: 10, value: tInput, placeholder: (medianT / 1e6).toFixed(0),
            onChange: (e) => setTInput(e.target.value),
            className: "w-20 border-0 bg-transparent p-0 text-right text-[13px] font-medium tabular-nums text-blue-700 outline-none placeholder:text-slate-500",
          }),
          h("span", { className: "text-slate-400" }, "triệu ₫")),
        tInput !== ""
          ? h("button", { type: "button", onClick: () => setTInput(""), className: "px-1 " + btn.link }, "Về trung vị (" + fmtTien(medianT) + ")")
          : h("span", { className: "text-[11px] text-slate-400" }, "Mặc định = trung vị các BV đang ký gửi"),
        h("div", { className: "flex-1" }),
        h("span", { className: "text-[12px] text-slate-500" },
          "CCDC: snapshot ", h("b", { className: "font-semibold text-slate-700" }, fmtKy(data.snapshot.ky_cap_nhat)),
          " · Quota: ", h("b", { className: "font-semibold text-slate-700" }, data.nam_tai_chinh),
          data.current_month ? h(React.Fragment, null, " · TH đến ", h("b", { className: "font-semibold text-slate-700" }, fmtKy(data.current_month + "-01"))) : null)),

      h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-5" },
        h(StatCard, { label: "Quota khả dụng", value: fmtTien(sum("quota_tien_con_lai")), accent: true,
          sub: "Onhand " + fmtTien(sum("quota_tien_on_hand")) + " · Upcoming " + fmtTien(sum("quota_tien_sap_toi")) }),
        h(StatCard, { label: "BV đang ký gửi", value: fmtInt(coCcdc.length), sub: "SL CCDC " + fmtInt(coCcdc.reduce((s, r) => s + r.sl, 0)) }),
        h(StatCard, { label: "Cân nhắc rút", swatch: "bg-red-500", value: fmtInt(count("rut").length), sub: "SL dư ước tính " + fmtInt(count("rut").reduce((s, r) => s + r.du, 0)) }),
        h(StatCard, { label: "Thiếu / cần thêm", swatch: "bg-blue-500", value: fmtInt(count("thieu").length + count("them").length), sub: "SL cần ước tính " + fmtInt(sum("can")) }),
        h(StatCard, { label: "Ký gửi nhưng không có quota", swatch: "bg-amber-500", value: fmtInt(khongQuota.length), sub: khongQuota.length ? "Kiểm tra mã BV ↔ mã KH" : "Mọi BV ký gửi đều có quota" })),

      h(Panel, {
        title: "Gợi ý điều chuyển",
        subtitle: "Rút từ BV có quota khả dụng/CCDC < " + fmtTien(T0 / 2) + " sang BV ≥ " + fmtTien(2 * T0) + " hoặc chưa có CCDC; ưu tiên cùng miền" +
          (loai ? ". Đang lọc 1 loại CCDC: quota vẫn là của cả nhóm SP" : ""),
        right: h("span", { className: "text-[12px] text-slate-500" }, fmtInt(moves.length) + " cặp"),
      },
        moves.length === 0
          ? h("div", { className: "px-4 py-6 text-center text-[13px] text-slate-400" }, "Không có cặp BV dư → BV thiếu với ngưỡng hiện tại")
          : h("div", { className: "scroll-shadow overflow-x-auto" }, h("table", { className: T.table + " min-w-[720px]" },
              h("thead", null, h("tr", { className: T.headRow },
                h("th", { className: "px-4 py-2 text-left font-semibold" }, "Rút từ"), h("th", { className: T.th() }, "Chuyển tới"),
                h("th", { className: T.th(true) }, "SL"), h("th", { className: "px-4 py-2 text-right font-semibold" }, "Quota khả dụng nơi tới"))),
              h("tbody", null, moves.map((m, i) => h("tr", { key: i, className: T.row(i) + " align-top" },
                h("td", { className: "px-4 py-2" }, bvCell(m.from)),
                h("td", { className: T.td }, bvCell(m.to), m.from.mien !== m.to.mien && h("div", { className: "mt-0.5" }, h(Badge, { tone: "amber" }, "khác miền"))),
                h("td", { className: T.num + " font-semibold" }, fmtInt(m.sl)),
                h("td", { className: "px-4 py-2 text-right tabular-nums" }, fmtTien(m.to.quota_tien_con_lai)))))))),

      h(Panel, {
        title: "Quota và CCDC theo bệnh viện",
        subtitle: "Quota Onhand = thầu cũ + đợt đã tới tháng thầu · Quota Upcoming = đợt chưa tới tháng · Quota khả dụng = Onhand − TH YTD",
        right: h(Segmented, { options: tabs.map((t) => ({ key: t.key, label: t.label, count: t.list.length })), value: tab, onChange: setTab }),
      },
        h("div", { className: "scroll-shadow overflow-x-auto" }, h("table", { className: T.table + " min-w-[1200px]" },
          h("thead", null, h("tr", { className: T.headRow },
            h("th", { className: "px-4 py-2 text-left font-semibold" }, "Miền"), h("th", { className: T.th() }, "Bệnh viện"),
            h("th", { className: T.th(true) }, "SL CCDC"), h("th", { className: T.th(true) }, "Quota Onhand"), h("th", { className: T.th(true) }, "Quota Upcoming"),
            h("th", { className: T.th(true) }, "TH YTD"), h("th", { className: T.th(true) }, "Quota khả dụng"),
            h("th", { className: T.th(true) }, "Khả dụng / CCDC"), h("th", { className: T.th(true) }, "SL nên có"),
            h("th", { className: "px-4 py-2 text-left font-semibold" }, "Đề xuất"))),
          h("tbody", null,
            shown.length === 0
              ? h("tr", null, h("td", { colSpan: 10, className: "px-4 py-8 text-center text-slate-400" }, "Không có bệnh viện nào"))
              : shown.map((r, i) => h("tr", { key: r.ma_bv || r.ten_bv, className: T.row(i) + " align-top" },
                  h("td", { className: "whitespace-nowrap px-4 py-2 " + (r.mien ? "text-slate-700" : "italic text-slate-400") }, r.mien || "chưa xác định"),
                  h("td", { className: T.td + " min-w-[14rem] text-slate-800" },
                    r.ma_bv && h("span", { className: "mr-1.5 font-mono text-[11px] text-slate-400" }, r.ma_bv), r.ten_bv || "—"),
                  h("td", { className: T.num + " font-semibold", title: Object.entries(r.loai).map(([l, n]) => l + ": " + n).join("\n") }, fmtInt(r.sl)),
                  h("td", { className: T.num + " text-slate-600" }, r.co_quota ? fmtTien(r.quota_tien_on_hand) : "—"),
                  h("td", { className: T.num + " text-slate-600" },
                    r.quota_tien_sap_toi > 0 ? h("span", null, fmtTien(r.quota_tien_sap_toi),
                      r.thang_thau_sap_toi && h("div", { className: "text-[11px] text-slate-400" }, fmtKy(r.thang_thau_sap_toi + "-01"))) : "—"),
                  h("td", { className: T.num + " text-slate-600" }, r.co_quota ? fmtTien(r.dt_thuc_hien) : "—"),
                  h("td", { className: T.num + " font-semibold text-slate-800" }, r.co_quota ? fmtTien(r.quota_tien_con_lai) : "—"),
                  h("td", { className: T.num }, r.co_quota && r.per != null ? fmtTien(r.per) : "—"),
                  h("td", { className: T.num + " text-slate-600" }, r.co_quota ? fmtInt(r.dangGiu) : "—"),
                  h("td", { className: "px-4 py-2" },
                    r.status && h(Badge, { tone: STATUS[r.status].tone }, STATUS[r.status].label),
                    r.ly_do && h("div", { className: "mt-0.5 max-w-[14rem] text-[11px] text-slate-400" }, r.ly_do)))))))),
    );
  }

  window.CCDC_ROUTER.register("/phan-bo", PhanBoScreen);
})();
