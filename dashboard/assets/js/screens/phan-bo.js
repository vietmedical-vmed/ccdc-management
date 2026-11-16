// Màn Phân bổ CCDC — CCDC / thiết bị ký gửi (snapshot mới nhất) cạnh quota thầu theo BV, cùng nhóm SP.
// Quota khả dụng = Quota Onhand − TH YTD.
// Dthu TH 12T = doanh thu thực hiện 12 tháng tới tháng hiện tại − 1; tô xanh khi > Dthu sàn (mặc định 20 tỷ, lưu theo trình duyệt).
// Hệ số đầu tư         = Dthu TH 12T / khấu hao thiết bị 12T (lần).
// Hệ số đầu tư dự kiến = (Quota khả dụng + Quota upcoming trong thời gian khấu hao còn lại) / GTCL (lần).
//   Thời gian khấu hao còn lại của BV = tới tháng hết khấu hao muộn nhất trong các thiết bị còn GTCL.
//   GTCL khấu hao đường thẳng theo tháng từ ngày ký gửi tới kỳ snapshot (view v_snapshot_items).
(function () {
  const { useState, useEffect } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const { useKgFilters, KgFilters } = window.CCDC_KG;
  const { fmtInt, fmtTien, fmtKy, useReload, StatCard, Panel, Segmented, FilterSelect,
    LoadingBlock, RefreshingBar, Empty, T } = window.CCDC_UI;

  const fmtLan = (x) => x == null ? "—" : x.toFixed(2) + " lần";
  const SAN_KEY = "ccdc.phanBo.dthuSanTy";
  const SAN_MAC_DINH = 20; // tỷ đồng
  const readSan = () => {
    try { const v = Number(localStorage.getItem(SAN_KEY)); return v > 0 ? v : SAN_MAC_DINH; } catch { return SAN_MAC_DINH; }
  };
  const saveSan = (v) => { try { localStorage.setItem(SAN_KEY, String(v)); } catch { /* bỏ qua */ } };

  // Hệ số càng thấp càng kém: < 1 lần đỏ, < 2 lần vàng
  const hsTone = (x) => x == null ? "text-slate-400" : x < 1 ? "text-red-600" : x < 2 ? "text-amber-600" : "text-slate-800";

  function PhanBoScreen({ user }) {
    const f = useKgFilters(user, { requireNhom: true });
    const reload = useReload();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loai, setLoai] = useState("");
    const [tab, setTab] = useState("co_ccdc");
    const [sanInput, setSanInput] = useState(() => String(readSan()));
    const sanTy = Number(sanInput) > 0 ? Number(sanInput) : SAN_MAC_DINH;
    useEffect(() => { saveSan(sanTy); }, [sanTy]);

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
    // Hệ số dự kiến chung: chỉ các BV đang đặt thiết bị còn GTCL
    const coGtcl = rows.filter((r) => r.gtcl > 0);
    const hsDuKienChung = coGtcl.length ? coGtcl.reduce((s, r) => s + r.quota_du_kien, 0) / sum("gtcl") : null;

    return h("div", { className: "space-y-4" },
      filters,
      loading && h(RefreshingBar),
      error && h(LoadingBlock, { error }),

      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(FilterSelect, { label: "Loại CCDC", searchable: true, options: data.loai_options, selected: loai ? [loai] : [], onChange: (v) => setLoai(v[0] || "") }),
        h("label", { className: "flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px]" },
          h("span", { className: "text-slate-400" }, "Dthu sàn:"),
          h("input", {
            type: "number", min: 0, step: 1, value: sanInput, onChange: (e) => setSanInput(e.target.value),
            className: "w-14 border-0 bg-transparent p-0 text-right text-[13px] font-medium tabular-nums text-blue-700 outline-none",
          }),
          h("span", { className: "text-slate-400" }, "tỷ ₫")),
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
          sub: "Nguyên giá " + fmtTien(sum("nguyen_gia")) + " · HS ĐT dự kiến " + fmtLan(hsDuKienChung) }),
        h(StatCard, { label: "Ký gửi nhưng không có quota", swatch: "bg-amber-500", value: fmtInt(khongQuota.length), sub: khongQuota.length ? "Kiểm tra mã BV ↔ mã KH" : "Mọi BV ký gửi đều có quota" })),

      h(Panel, {
        title: "Quota và CCDC theo bệnh viện",
        subtitle: "Quota Onhand = thầu cũ + đợt đã tới tháng thầu · Quota Upcoming = đợt chưa tới tháng · Quota khả dụng = Onhand − TH YTD" +
          (data.dt_12t_tu ? " · Dthu TH 12T = " + fmtKy(data.dt_12t_tu + "-01") + "–" + fmtKy(data.dt_12t_den + "-01") : " · Dthu TH 12T") +
          ", xanh khi > " + sanTy + " tỷ" +
          " · Hệ số đầu tư = Dthu TH 12T / khấu hao TB 12T" +
          " · Hệ số đầu tư dự kiến = (Quota khả dụng + Upcoming trong thời gian khấu hao còn lại) / GTCL",
        right: h(Segmented, { options: tabs.map((t) => ({ key: t.key, label: t.label, count: t.list.length })), value: tab, onChange: setTab }),
      },
        h("div", { className: "scroll-shadow overflow-x-auto" }, h("table", { className: T.table + " min-w-[1380px]" },
          h("thead", null, h("tr", { className: T.headRow },
            h("th", { className: "px-4 py-2 text-left font-semibold" }, "Miền"), h("th", { className: T.th() }, "Bệnh viện"),
            h("th", { className: T.th(true) }, "SL CCDC"), h("th", { className: T.th(true) }, "SL TB"), h("th", { className: T.th(true) }, "Quota Onhand"), h("th", { className: T.th(true) }, "Quota Upcoming"),
            h("th", { className: T.th(true) }, "TH YTD"), h("th", { className: T.th(true) }, "Quota khả dụng"),
            h("th", { className: T.th(true) }, "Dthu TH 12T"), h("th", { className: T.th(true) }, "Hệ số đầu tư"),
            h("th", { className: T.th(true) }, "GTCL thiết bị"), h("th", { className: "px-4 py-2 text-right font-semibold" }, "Hệ số đầu tư dự kiến"))),
          h("tbody", null,
            shown.length === 0
              ? h("tr", null, h("td", { colSpan: 12, className: "px-4 py-8 text-center text-slate-400" }, "Không có bệnh viện nào"))
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
                  h("td", { className: T.num + (r.dt_12t > sanTy * 1e9 ? " bg-emerald-50 font-semibold text-emerald-700" : " text-slate-600") },
                    r.dt_12t > 0 ? fmtTien(r.dt_12t) : "—"),
                  h("td", { className: T.num + " font-semibold " + hsTone(r.he_so_dau_tu),
                    title: r.khau_hao_12t > 0 ? "Khấu hao 12T " + fmtInt(r.khau_hao_12t) : undefined },
                    fmtLan(r.he_so_dau_tu)),
                  h("td", { className: T.num + " text-slate-700",
                    title: r.gtcl > 0 ? "Nguyên giá " + fmtInt(r.nguyen_gia) + " · " + fmtInt(r.sl_co_gia) + " thiết bị có giá" : undefined },
                    r.gtcl > 0 ? fmtTien(r.gtcl) : "—"),
                  h("td", { className: "whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums " + hsTone(r.he_so_dau_tu_du_kien),
                    title: r.gtcl > 0 ? "Quota khả dụng " + fmtInt(r.quota_tien_con_lai) + " + upcoming tới " +
                      (r.thang_het_kh ? fmtKy(r.thang_het_kh + "-01") : "—") + " " + fmtInt(r.quota_sap_toi_trong_kh) : undefined },
                    fmtLan(r.he_so_dau_tu_du_kien)))))))),
    );
  }

  window.CCDC_ROUTER.register("/phan-bo", PhanBoScreen);
})();
