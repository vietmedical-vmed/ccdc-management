// Màn Tổng quan ký gửi: tiến độ cập nhật kỳ, KPI, SL theo tháng trong FY, tình trạng từng nhóm SP,
// phân bổ miền → BV, theo KTV. Bộ lọc FY / Nhóm SP / Miền nằm trên header (CCDC_KG).
(function () {
  const { useState, useEffect } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const R = window.CCDC_ROUTER;
  const { useKgFilters, KgFilters } = window.CCDC_KG;
  const { fmtInt, fmtKy, fmtDate, fyLabel, useReload, StatCard, Panel, Badge, Legend, LoadingBlock, RefreshingBar, Empty, T } = window.CCDC_UI;

  const FISCAL_MONTHS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

  function niceTicks(max) {
    const rough = max / 4;
    const pow = 10 ** Math.floor(Math.log10(rough || 1));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) || rough || 1;
    const ticks = [];
    for (let t = 0; t <= max + step - 1; t += step) ticks.push(t);
    return ticks.length > 1 ? ticks : [0, step];
  }

  // Tiến độ cập nhật kỳ hiện hành (cùng bố cục WinRateCard bên trang thầu)
  function UpdateCard({ data }) {
    const list = data.nhom_san_pham;
    const done = list.filter((n) => !n.chua_cap_nhat_thang).length;
    const pct = list.length ? Math.round((done / list.length) * 1000) / 10 : 0;
    const last = list.map((n) => n.created_at).filter(Boolean).sort().pop();
    return h("div", { className: "rounded-xl border border-slate-200 bg-white p-3.5" },
      h("div", { className: "mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] tracking-wide text-slate-400" },
        h("span", null, "Tiến độ cập nhật kỳ " + fmtKy((data.ref_month || "") + "-01")),
        last && h("span", null, "Lần upload gần nhất ", h("b", { className: "font-bold text-slate-700" }, fmtDate(last)))),
      h("div", { className: "mb-1.5 flex items-center justify-between" },
        h("span", { className: "text-[13px] font-semibold text-slate-800" }, fmtInt(done) + " / " + fmtInt(list.length) + " nhóm SP đã cập nhật"),
        h("span", { className: "text-[22px] font-bold tabular-nums text-blue-600" }, pct + "%")),
      h("div", { className: "mb-1.5 h-3.5 overflow-hidden rounded bg-slate-100" },
        h("div", { className: "h-full rounded bg-blue-500", style: { width: pct + "%" } })),
      h("div", { className: "text-[11px] text-slate-400" },
        list.length - done > 0
          ? "Chưa cập nhật: " + list.filter((n) => n.chua_cap_nhat_thang).map((n) => n.nhom_san_pham).join(", ")
          : list.length ? "Tất cả nhóm SP đã có snapshot kỳ này" : "Chưa có snapshot trong năm tài chính này"));
  }

  // Cột SL theo tháng (T4 → T3). Tháng có nhóm SP chưa upload: giữ số kỳ trước, tô nhạt.
  function MonthColumns({ trend }) {
    const byMonth = new Map(trend.map((t) => [Number(t.ky.slice(5)), t]));
    const ticks = niceTicks(Math.max(1, ...trend.map((t) => t.sl || 0)));
    const top = ticks[ticks.length - 1];
    return h("div", { className: "px-4 pb-3 pt-8" },
      h("div", { className: "flex gap-2" },
        h("div", { className: "relative h-44 w-8 text-right text-[11px] tabular-nums text-slate-400" },
          ticks.map((t) => h("span", { key: t, className: "absolute right-0 -translate-y-1/2", style: { bottom: (t / top) * 100 + "%" } }, fmtInt(t)))),
        h("div", { className: "flex-1" },
          h("div", { className: "relative h-44 border-b border-slate-300" },
            ticks.slice(1).map((t) => h("div", { key: t, className: "absolute inset-x-0 border-t border-slate-100", style: { bottom: (t / top) * 100 + "%" } })),
            h("div", { className: "absolute inset-0 grid grid-cols-12 items-end" },
              FISCAL_MONTHS.map((m) => {
                const t = byMonth.get(m);
                if (!t || t.sl == null) return h("div", { key: m });
                const partial = t.chi_tiet.some((c) => !c.cap_nhat_trong_thang);
                return h("div", { key: m, className: "group relative flex h-full items-end justify-center" },
                  h("div", { className: "relative w-6", style: { height: Math.max(1, (t.sl / top) * 100) + "%" } },
                    h("span", { className: "absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 text-[11px] font-semibold tabular-nums text-slate-700" }, fmtInt(t.sl)),
                    h("div", { className: "h-full w-full rounded-t-sm " + (partial ? "bg-blue-200" : "bg-blue-500") })),
                  h("div", { className: "pointer-events-none absolute bottom-1/2 left-1/2 z-20 hidden w-56 -translate-x-1/2 rounded-md border border-slate-200 bg-white p-2.5 text-[12px] shadow-lg group-hover:block" },
                    h("div", { className: "mb-1 font-semibold text-slate-800" }, fmtKy(t.ky + "-01")),
                    t.chi_tiet.map((c) => h("div", { key: c.nhom_san_pham, className: "flex justify-between gap-2 text-slate-500" },
                      h("span", { className: "truncate" }, c.nhom_san_pham,
                        !c.cap_nhat_trong_thang && h("span", { className: "text-slate-400" }, " (số " + fmtKy(c.ky_snapshot) + ")")),
                      h("span", { className: "tabular-nums text-slate-800" }, fmtInt(c.sl)))),
                    h("div", { className: "mt-1 flex justify-between border-t border-slate-100 pt-1 text-slate-500" },
                      h("span", null, "Tổng SL"), h("span", { className: "font-semibold tabular-nums text-slate-800" }, fmtInt(t.sl)))));
              }))),
          h("div", { className: "grid grid-cols-12 pt-1 text-[11px] text-slate-400" },
            FISCAL_MONTHS.map((m) => h("span", { key: m, className: "text-center" }, "T" + m))))));
  }

  // Miền → BV (bấm miền để mở)
  function TheoMien({ rows }) {
    const [open, setOpen] = useState(() => new Set(rows.length === 1 ? [rows[0].mien] : []));
    const toggle = (k) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
    return h("div", { className: "scroll-shadow overflow-x-auto" },
      h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow },
          h("th", { className: "px-4 py-2 text-left font-semibold" }, "Miền → Bệnh viện"),
          h("th", { className: T.th() }, "Nhóm SP"),
          h("th", { className: "px-4 py-2 text-right font-semibold" }, "SL"))),
        h("tbody", null,
          rows.length === 0
            ? h("tr", null, h("td", { colSpan: 3, className: "px-4 py-6 text-center text-slate-400" }, "Không có dữ liệu"))
            : rows.flatMap((m) => {
                const isOpen = open.has(m.mien);
                const out = [h("tr", { key: m.mien, onClick: () => toggle(m.mien), className: "cursor-pointer select-none border-t border-slate-100 bg-white hover:bg-blue-50/40" },
                  h("td", { className: "px-4 py-1.5 font-semibold text-slate-800" },
                    h("span", { className: "mr-1 inline-block w-3 text-slate-400", style: { transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 120ms" } }, "▸"),
                    m.mien, h("span", { className: "ml-1.5 text-[11px] font-normal text-slate-400" }, m.children.length + " BV")),
                  h("td", null),
                  h("td", { className: "px-4 py-1.5 text-right font-semibold tabular-nums text-slate-800" }, fmtInt(m.sl)))];
                if (isOpen) m.children.forEach((b, i) => out.push(h("tr", { key: m.mien + "|" + (b.ma_bv || b.ten_bv), className: i % 2 ? "bg-slate-50/50" : "bg-slate-50/20" },
                  h("td", { className: "max-w-[320px] truncate py-1.5 pl-9 pr-3 text-slate-700", title: b.ten_bv },
                    b.ma_bv && h("span", { className: "mr-1.5 font-mono text-[11px] text-slate-400" }, b.ma_bv), b.ten_bv),
                  h("td", { className: "px-3 py-1.5 text-[12px] text-slate-500" }, b.nhom.join(", ")),
                  h("td", { className: "px-4 py-1.5 text-right tabular-nums text-slate-700" }, fmtInt(b.sl)))));
                return out;
              }))));
  }

  function TheoKtv({ rows }) {
    const [all, setAll] = useState(false);
    const max = Math.max(1, ...rows.map((r) => r.sl));
    const shown = all ? rows : rows.slice(0, 12);
    return h("div", null,
      h("table", { className: T.table },
        h("thead", null, h("tr", { className: T.headRow },
          h("th", { className: "px-4 py-2 text-left font-semibold" }, "KTV phụ trách"),
          h("th", { className: T.th() }, "SL"),
          h("th", { className: "px-4 py-2 text-right font-semibold" }, "Số BV"))),
        h("tbody", null,
          rows.length === 0
            ? h("tr", null, h("td", { colSpan: 3, className: "px-4 py-6 text-center text-slate-400" }, "Không có dữ liệu"))
            : shown.map((k, i) => h("tr", { key: k.ktv, className: T.row(i) },
                h("td", { className: "px-4 py-1.5 " + (k.ktv.startsWith("(") ? "italic text-slate-400" : "text-slate-800") }, k.ktv),
                h("td", { className: "px-3 py-1.5" },
                  h("div", { className: "flex items-center gap-2" },
                    h("div", { className: "h-2.5 rounded-sm bg-blue-500", style: { width: Math.max(4, (k.sl / max) * 120) + "px" } }),
                    h("span", { className: "tabular-nums text-slate-600" }, fmtInt(k.sl)))),
                h("td", { className: "px-4 py-1.5 text-right tabular-nums text-slate-600" }, fmtInt(k.so_bv)))))),
      rows.length > 12 && h("button", { type: "button", onClick: () => setAll(!all),
        className: "w-full border-t border-slate-100 py-2 text-[12px] text-blue-600 hover:bg-slate-50" },
        all ? "Thu gọn" : "Xem tất cả " + rows.length + " KTV"));
  }

  function DashboardScreen({ user }) {
    const f = useKgFilters(user);
    const reload = useReload();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
      let alive = true;
      setLoading(true); setError("");
      api("ky_gui_dashboard", { fiscal_year: f.fy, nhom_san_pham: f.nhom || null, mien: f.mien })
        .then((res) => { if (alive) { setData(res); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e.message || String(e)); setLoading(false); } });
      return () => { alive = false; };
    }, [f.fy, f.nhom, f.mien.join("|"), reload]);

    const filters = h(KgFilters, { f });
    if (!data) return h(React.Fragment, null, filters, h(LoadingBlock, { error }));

    const k = data.kpi;
    const hasChange = k.sl_them != null;
    const detailHref = (nhom) => {
      const q = new URLSearchParams({ fy: String(f.fy), nhom });
      f.mien.forEach((m) => q.append("mien", m));
      return R.href("/ky-gui", q);
    };

    return h("div", { className: "space-y-4" },
      filters,
      loading && h(RefreshingBar),
      error && h(LoadingBlock, { error }),

      data.nhom_san_pham.length === 0
        ? h(Empty, null, "Chưa có snapshot ký gửi cho bộ lọc này — vào tab Chi tiết theo kỳ để upload.")
        : h("div", { className: "grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)]" },
            h(UpdateCard, { data }),
            h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-3" },
              h(StatCard, { label: "Tổng SL ký gửi", value: fmtInt(k.tong_sl), sub: fmtInt(k.so_nhom) + " nhóm SP", accent: true }),
              h(StatCard, { label: "Bệnh viện", value: fmtInt(k.so_bv) }),
              h(StatCard, { label: "KTV phụ trách", value: fmtInt(k.so_ktv) }),
              h(StatCard, { label: "Thêm mới so kỳ trước", value: hasChange ? fmtInt(k.sl_them) : "—", swatch: "bg-blue-500", sub: "SL" }),
              h(StatCard, { label: "Thu hồi so kỳ trước", value: hasChange ? fmtInt(k.sl_thu_hoi) : "—", swatch: "bg-red-500", sub: "SL" }),
              h(StatCard, { label: "Chuyển BV", value: hasChange ? fmtInt(k.so_chuyen) : "—", swatch: "bg-amber-500", sub: hasChange ? "chiếc" : "Chưa có kỳ trước để so" }))),

      h(Panel, {
        title: "SL ký gửi theo tháng – " + fyLabel(data.fy) + " (T4/" + data.fy + " → T3/" + (data.fy + 1) + ")",
        subtitle: "Mỗi tháng lấy snapshot mới nhất tính đến tháng đó của từng nhóm SP",
        right: h(Legend, { items: [{ label: "Đã cập nhật đủ", cls: "bg-blue-500" }, { label: "Có nhóm SP giữ số kỳ trước", cls: "bg-blue-200" }] }),
      },
        data.trend.every((t) => t.sl == null)
          ? h("div", { className: "px-4 py-10 text-center text-[13px] text-slate-400" }, "Chưa có snapshot trong " + fyLabel(data.fy))
          : h(MonthColumns, { trend: data.trend })),

      h(Panel, { title: "Tình trạng cập nhật theo nhóm SP", subtitle: "Bấm tên nhóm để xem chi tiết kỳ" },
        h("div", { className: "scroll-shadow overflow-x-auto" },
          h("table", { className: T.table + " min-w-[760px]" },
            h("thead", null, h("tr", { className: T.headRow },
              h("th", { className: "px-4 py-2 text-left font-semibold" }, "Nhóm SP"),
              h("th", { className: T.th() }, "Kỳ mới nhất"),
              h("th", { className: T.th(true) }, "SL"),
              h("th", { className: T.th(true) }, "Số BV"),
              h("th", { className: T.th(true) }, "Thêm"),
              h("th", { className: T.th(true) }, "Thu hồi"),
              h("th", { className: T.th(true) }, "Chuyển"),
              h("th", { className: "px-4 py-2 text-left font-semibold" }, "Cập nhật bởi"))),
            h("tbody", null,
              data.nhom_san_pham.length === 0
                ? h("tr", null, h("td", { colSpan: 8, className: "px-4 py-6 text-center text-slate-400" }, "Không có dữ liệu"))
                : data.nhom_san_pham.map((n, i) => h("tr", { key: n.nhom_san_pham, className: T.row(i) },
                    h("td", { className: "px-4 py-1.5" },
                      h("a", { href: detailHref(n.nhom_san_pham), className: "text-slate-800 hover:text-blue-600 hover:underline" }, n.nhom_san_pham)),
                    h("td", { className: "whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-700" }, fmtKy(n.ky_cap_nhat), " ",
                      n.chua_cap_nhat_thang && h(Badge, { tone: "amber" }, "chưa cập nhật")),
                    h("td", { className: "px-3 py-1.5 text-right font-semibold tabular-nums text-slate-800" }, fmtInt(n.sl)),
                    h("td", { className: "px-3 py-1.5 text-right tabular-nums text-slate-600" }, fmtInt(n.so_bv)),
                    n.ky_truoc == null
                      ? h("td", { colSpan: 3, className: "px-3 py-1.5 text-right text-[12px] italic text-slate-400" }, "kỳ đầu, chưa có kỳ trước")
                      : [h("td", { key: "a", className: "px-3 py-1.5 text-right tabular-nums text-blue-700" }, "+" + fmtInt(n.sl_them)),
                         h("td", { key: "b", className: "px-3 py-1.5 text-right tabular-nums text-red-600" }, "−" + fmtInt(n.sl_thu_hoi)),
                         h("td", { key: "c", className: "px-3 py-1.5 text-right tabular-nums text-amber-700" }, fmtInt(n.so_chuyen))],
                    h("td", { className: "whitespace-nowrap px-4 py-1.5 text-[12px] text-slate-500" }, (n.created_by || "—") + " · " + fmtDate(n.created_at)))))))),

      h("div", { className: "grid gap-4 xl:grid-cols-2" },
        h(Panel, { title: "Theo miền", subtitle: "Bấm miền để xem bệnh viện" }, h(TheoMien, { key: data.fy + f.nhom + f.mien.join(), rows: data.ton_by_mien })),
        h(Panel, { title: "Theo KTV phụ trách" }, h(TheoKtv, { key: data.fy + f.nhom + f.mien.join(), rows: data.theo_ktv }))),
    );
  }

  window.CCDC_ROUTER.register("/dashboard", DashboardScreen);
})();
