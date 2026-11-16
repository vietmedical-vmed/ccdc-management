// Màn Phân bổ CCDC — CCDC / thiết bị ký gửi (snapshot mới nhất) cạnh quota thầu theo BV, cùng nhóm SP.
// Quota khả dụng = Quota Onhand − TH YTD.
// Tỷ suất đầu tư = GTCL thiết bị đang đặt tại BV / (Quota khả dụng + Quota Upcoming).
//   GTCL khấu hao đường thẳng theo tháng từ ngày ký gửi tới kỳ snapshot (view v_snapshot_items).
(function () {
  const { useState, useEffect } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const { useKgFilters, KgFilters } = window.CCDC_KG;
  const { fmtInt, fmtTien, fmtKy, useReload, StatCard, Panel, Badge, Segmented, FilterSelect,
    LoadingBlock, RefreshingBar, Empty, T } = window.CCDC_UI;

  const fmtPct = (x) => x == null ? "—" : (x * 100).toFixed(x >= 0.1 ? 0 : 1) + "%";
  const tyTone = (x) => x == null ? "text-slate-400" : x >= 1 ? "text-red-600" : x >= 0.5 ? "text-amber-600" : "text-slate-800";

  function PhanBoScreen({ user }) {
    const f = useKgFilters(user, { requireNhom: true });
    const reload = useReload();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loai, setLoai] = useState("");
    const [tab, setTab] = useState("co_ccdc");

    useEffect(() => {
      if (f.loading) return;
      let alive = true;
      setLoading(true); setError("");
      api("phan_bo_ccdc", { nhom_san_pham: f.nhom || null, fiscal_year: f.fy, mien: f.mien })
        .then((res) => { if (alive) { setData(res); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e.message || String(e)); setLoading(false); } });
      return () => { alive = false; };
    }, [f.loading, f.nhom, f.fy, f.mien.join("|"), reload]);
    useEffect(() => { setLoai(""); }, [data && data.nhom_san_pham, data && data.fy]);

    // Lọc 1 loại CCDC → SL CCDC chỉ đếm loại đó
    const rows = ((data && data.rows) || []).map((r) => ({ ...r, sl: loai ? (r.loai[loai] || 0) : r.sl_ccdc }));

    const filters = h(KgFilters, { f });
    if (!data) return h(React.Fragment, null, filters, h(LoadingBlock, { error: error || f.error }));
    if (!data.nhom_san_pham) return h(React.Fragment, null, filters,
      h(Empty, null, "Chưa có snapshot ký gửi — vào tab Chi tiết theo kỳ để upload."));

    const coCcdc = rows.filter((r) => r.sl > 0 || r.sl_tb > 0);
    const khongQuota = coCcdc.filter((r) => !r.co_quota);
    const tabs = [
      { key: "co_ccdc", label: "Đang ký gửi", list: coCcdc },
      { key: "tat_ca", label: "Tất cả BV", list: rows },
    ];
    const mienOrder = (m) => m === "Miền Bắc" ? 0 : m === "Miền Nam" ? 1 : 2;
    const shown = (tabs.find((t) => t.key === tab) || tabs[0]).list.slice()
      .sort((a, b) => (mienOrder(a.mien) - mienOrder(b.mien))
        || ((b.quota_tien_on_hand + b.quota_tien_sap_toi) - (a.quota_tien_on_hand + a.quota_tien_sap_toi)));
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    const coGtcl = rows.filter((r) => r.gtcl > 0);
    // Tỷ suất chung: chỉ các BV đang đặt thiết bị có giá
    const quotaCoGtcl = coGtcl.reduce((s, r) => s + r.quota_con_ban, 0);
    const tySuatChung = quotaCoGtcl > 0 ? sum("gtcl") / quotaCoGtcl : null;

    return h("div", { className: "space-y-4" },
      filters,
      loading && h(RefreshingBar),
      error && h(LoadingBlock, { error }),

      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(FilterSelect, { label: "Loại CCDC", searchable: true, options: data.loai_options, selected: loai ? [loai] : [], onChange: (v) => setLoai(v[0] || "") }),
        h("div", { className: "flex-1" }),
        h("span", { className: "text-[12px] text-slate-500" },
          "CCDC: snapshot ", h("b", { className: "font-semibold text-slate-700" }, fmtKy(data.snapshot.ky_cap_nhat)),
          " · Quota: ", h("b", { className: "font-semibold text-slate-700" }, data.nam_tai_chinh),
          data.current_month ? h(React.Fragment, null, " · TH đến ", h("b", { className: "font-semibold text-slate-700" }, fmtKy(data.current_month + "-01"))) : null)),

      h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4" },
        h(StatCard, { label: "Quota khả dụng", value: fmtTien(sum("quota_tien_con_lai")), accent: true,
          sub: "Onhand " + fmtTien(sum("quota_tien_on_hand")) + " · Upcoming " + fmtTien(sum("quota_tien_sap_toi")) }),
        h(StatCard, { label: "BV đang ký gửi", value: fmtInt(coCcdc.length), sub: "SL CCDC " + fmtInt(coCcdc.reduce((s, r) => s + r.sl, 0)) + " · SL TB " + fmtInt(sum("sl_tb")) }),
        h(StatCard, { label: "GTCL thiết bị", value: fmtTien(sum("gtcl")),
          sub: "Nguyên giá " + fmtTien(sum("nguyen_gia")) + " · Tỷ suất ĐT " + fmtPct(tySuatChung) }),
        h(StatCard, { label: "Ký gửi nhưng không có quota", swatch: "bg-amber-500", value: fmtInt(khongQuota.length), sub: khongQuota.length ? "Kiểm tra mã BV ↔ mã KH" : "Mọi BV ký gửi đều có quota" })),

      h(Panel, {
        title: "Quota và CCDC theo bệnh viện",
        subtitle: "Quota Onhand = thầu cũ + đợt đã tới tháng thầu · Quota Upcoming = đợt chưa tới tháng · Quota khả dụng = Onhand − TH YTD" +
          " · Tỷ suất ĐT = GTCL thiết bị / (Quota khả dụng + Upcoming)",
        right: h(Segmented, { options: tabs.map((t) => ({ key: t.key, label: t.label, count: t.list.length })), value: tab, onChange: setTab }),
      },
        h("div", { className: "scroll-shadow overflow-x-auto" }, h("table", { className: T.table + " min-w-[1180px]" },
          h("thead", null, h("tr", { className: T.headRow },
            h("th", { className: "px-4 py-2 text-left font-semibold" }, "Miền"), h("th", { className: T.th() }, "Bệnh viện"),
            h("th", { className: T.th(true) }, "SL CCDC"), h("th", { className: T.th(true) }, "SL TB"), h("th", { className: T.th(true) }, "Quota Onhand"), h("th", { className: T.th(true) }, "Quota Upcoming"),
            h("th", { className: T.th(true) }, "TH YTD"), h("th", { className: T.th(true) }, "Quota khả dụng"),
            h("th", { className: T.th(true) }, "GTCL thiết bị"), h("th", { className: "px-4 py-2 text-right font-semibold" }, "Tỷ suất ĐT"))),
          h("tbody", null,
            shown.length === 0
              ? h("tr", null, h("td", { colSpan: 10, className: "px-4 py-8 text-center text-slate-400" }, "Không có bệnh viện nào"))
              : shown.map((r, i) => h("tr", { key: r.ma_bv || r.ten_bv, className: T.row(i) + " align-top" },
                  h("td", { className: "whitespace-nowrap px-4 py-2 " + (r.mien ? "text-slate-700" : "italic text-slate-400") }, r.mien || "chưa xác định"),
                  h("td", { className: T.td + " min-w-[14rem] text-slate-800" },
                    r.ma_bv && h("span", { className: "mr-1.5 font-mono text-[11px] text-slate-400" }, r.ma_bv), r.ten_bv || "—"),
                  h("td", { className: T.num + " text-slate-700", title: Object.entries(r.loai).map(([l, n]) => l + ": " + n).join("\n") || undefined },
                    r.sl > 0 ? fmtInt(r.sl) : "—"),
                  h("td", { className: T.num + " text-slate-700" }, r.sl_tb > 0 ? fmtInt(r.sl_tb) : "—"),
                  h("td", { className: T.num + " text-slate-600" }, r.co_quota ? fmtTien(r.quota_tien_on_hand) : "—"),
                  h("td", { className: T.num + " text-slate-600" },
                    r.quota_tien_sap_toi > 0 ? h("span", null, fmtTien(r.quota_tien_sap_toi),
                      r.thang_thau_sap_toi && h("div", { className: "text-[11px] text-slate-400" }, fmtKy(r.thang_thau_sap_toi + "-01"))) : "—"),
                  h("td", { className: T.num + " text-slate-600" }, r.co_quota ? fmtTien(r.dt_thuc_hien) : "—"),
                  h("td", { className: T.num + " font-semibold text-slate-800" }, r.co_quota ? fmtTien(r.quota_tien_con_lai) : "—"),
                  h("td", { className: T.num + " text-slate-700",
                    title: r.gtcl > 0 ? "Nguyên giá " + fmtInt(r.nguyen_gia) + " · " + fmtInt(r.sl_co_gia) + " thiết bị có giá" : undefined },
                    r.gtcl > 0 ? fmtTien(r.gtcl) : "—"),
                  h("td", { className: "whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums " + tyTone(r.ty_suat_dau_tu) },
                    r.gtcl > 0 && !(r.quota_con_ban > 0) ? h(Badge, { tone: "red" }, "không quota") : fmtPct(r.ty_suat_dau_tu)))))))),
    );
  }

  window.CCDC_ROUTER.register("/phan-bo", PhanBoScreen);
})();
