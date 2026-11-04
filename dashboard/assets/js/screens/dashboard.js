// Màn Tổng quan — dashboard ký gửi theo snapshot: KPI kỳ hiện hành, trend SL theo tháng trong FY,
// tình trạng cập nhật từng nhóm SP, phân bổ miền → BV, theo KTV.
(function () {
  const { useState, useEffect, useRef } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");
  const fmtKy = (d) => { if (!d) return "—"; const [y, m] = String(d).split("-"); return "T" + Number(m) + "/" + y; };
  const fmtDateTime = (d) => !d ? "—" : new Date(d).toLocaleDateString("vi-VN");
  const card = "bg-white border border-slate-200 rounded-lg";
  const cardHead = "px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700 flex items-center justify-between gap-2";

  function Kpi({ label, value, sub, accent }) {
    return h("div", { className: card + " p-4" },
      h("div", { className: "text-xs text-slate-500 uppercase tracking-wide font-semibold" }, label),
      h("div", { className: "mt-1 text-xl md:text-2xl font-bold tabular-nums " + (accent ? "text-blue-600" : "text-slate-900") }, value),
      sub && h("div", { className: "text-xs text-slate-500 mt-0.5" }, sub),
    );
  }

  // ─── Trend SL theo tháng (bar, 1 chuỗi) ──────────────────
  function TrendChart({ trend }) {
    const [hover, setHover] = useState(null);
    const max = Math.max(1, ...trend.map((t) => t.sl || 0));
    const H = 160;
    const ref = useRef(null);

    return h("div", { className: "relative", ref },
      h("div", { className: "flex items-end gap-[2px] border-b border-slate-200", style: { height: H + 24 } },
        trend.map((t, i) => {
          const hasData = t.sl != null;
          const partial = hasData && t.chi_tiet.some((c) => !c.cap_nhat_trong_thang);
          const barH = hasData ? Math.max(2, Math.round((t.sl / max) * H)) : 0;
          return h("div", {
            key: t.ky,
            className: "flex-1 h-full flex flex-col justify-end items-center cursor-default",
            onMouseEnter: () => hasData && setHover(i),
            onMouseLeave: () => setHover(null),
          },
            hasData && h("div", { className: "text-[11px] tabular-nums text-slate-600 mb-1" }, fmtInt(t.sl)),
            h("div", {
              className: "w-full max-w-[44px] rounded-t " + (partial ? "bg-blue-200" : "bg-blue-500") +
                (hover === i ? " opacity-80" : ""),
              style: { height: barH },
            }),
          );
        }),
      ),
      h("div", { className: "flex gap-[2px] mt-1" },
        trend.map((t) => h("div", { key: t.ky, className: "flex-1 text-center text-[11px] text-slate-500" },
          "T" + Number(t.ky.slice(5))))),

      hover != null && (() => {
        const t = trend[hover];
        const left = ((hover + 0.5) / trend.length) * 100;
        return h("div", {
          className: "absolute top-0 z-10 bg-white border border-slate-200 rounded-md shadow-lg px-3 py-2 text-xs pointer-events-none w-56",
          style: { left: "clamp(0px, calc(" + left + "% - 112px), calc(100% - 224px))" },
        },
          h("div", { className: "font-semibold text-slate-800 mb-1" }, fmtKy(t.ky + "-01") + " · SL " + fmtInt(t.sl)),
          t.chi_tiet.map((c) => h("div", { key: c.nhom_san_pham, className: "flex justify-between gap-2 text-slate-600" },
            h("span", { className: "truncate" }, c.nhom_san_pham,
              !c.cap_nhat_trong_thang && h("span", { className: "text-slate-400" }, " (số " + fmtKy(c.ky_snapshot) + ")")),
            h("span", { className: "tabular-nums text-slate-800" }, fmtInt(c.sl)))),
        );
      })(),
    );
  }

  // ─── Tồn theo miền → BV ──────────────────────────────────
  function TonTheoMien({ rows }) {
    const [open, setOpen] = useState(() => new Set(rows.length === 1 ? [rows[0].mien] : []));
    const toggle = (k) => setOpen((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
    const th = (label, cls) => h("th", { className: "px-3 py-2 text-xs font-semibold text-slate-600 uppercase " + (cls || "text-right") }, label);

    return h("table", { className: "w-full text-sm" },
      h("thead", { className: "bg-slate-50" }, h("tr", null, th("Miền → Bệnh viện", "text-left"), th("Nhóm SP", "text-left"), th("SL"))),
      h("tbody", null,
        rows.length === 0
          ? h("tr", null, h("td", { colSpan: 3, className: "px-3 py-6 text-center text-sm text-slate-400" }, "Chưa có dữ liệu ký gửi"))
          : rows.flatMap((m) => {
              const isOpen = open.has(m.mien);
              const out = [h("tr", {
                key: m.mien, onClick: () => toggle(m.mien),
                className: "border-t border-slate-100 hover:bg-slate-50 font-semibold text-slate-800 cursor-pointer select-none",
              },
                h("td", { className: "px-3 py-2" },
                  h("span", { className: "inline-block w-4 text-slate-400", style: { transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 120ms" } }, "▸"),
                  m.mien, h("span", { className: "ml-1.5 text-xs font-normal text-slate-400" }, "(" + m.children.length + " BV)")),
                h("td", null),
                h("td", { className: "px-3 py-2 text-right tabular-nums" }, fmtInt(m.sl)))];
              if (isOpen) for (const b of m.children) out.push(h("tr", { key: m.mien + "|" + (b.ma_bv || b.ten_bv), className: "border-t border-slate-50 bg-slate-50/40 text-slate-700" },
                h("td", { className: "pl-9 pr-3 py-1.5" },
                  b.ma_bv && h("span", { className: "font-mono text-[11px] text-slate-400 mr-1.5" }, b.ma_bv), b.ten_bv),
                h("td", { className: "px-3 py-1.5 text-xs text-slate-500" }, b.nhom.join(", ")),
                h("td", { className: "px-3 py-1.5 text-right tabular-nums" }, fmtInt(b.sl))));
              return out;
            })),
    );
  }

  // ─── Theo KTV ────────────────────────────────────────────
  function TheoKtv({ rows }) {
    const [all, setAll] = useState(false);
    const shown = all ? rows : rows.slice(0, 12);
    return h("div", null,
      h("table", { className: "w-full text-sm" },
        h("thead", { className: "bg-slate-50" }, h("tr", null,
          h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase" }, "KTV phụ trách"),
          h("th", { className: "px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase" }, "Số BV"),
          h("th", { className: "px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase" }, "SL"))),
        h("tbody", null,
          rows.length === 0
            ? h("tr", null, h("td", { colSpan: 3, className: "px-3 py-6 text-center text-sm text-slate-400" }, "Chưa có dữ liệu"))
            : shown.map((k) => h("tr", { key: k.ktv, className: "border-t border-slate-100" },
                h("td", { className: "px-3 py-1.5 " + (k.ktv.startsWith("(") ? "italic text-slate-400" : "text-slate-800") }, k.ktv),
                h("td", { className: "px-3 py-1.5 text-right tabular-nums text-slate-600" }, fmtInt(k.so_bv)),
                h("td", { className: "px-3 py-1.5 text-right tabular-nums font-semibold" }, fmtInt(k.sl)))))),
      rows.length > 12 && h("button", {
        onClick: () => setAll(!all), className: "w-full py-2 text-xs text-blue-600 hover:bg-slate-50 border-t border-slate-100",
      }, all ? "Thu gọn" : "Xem tất cả " + rows.length + " KTV"),
    );
  }

  const changeCell = (n) => n.ky_truoc == null
    ? h("span", { className: "text-slate-400" }, "kỳ đầu")
    : h("span", { className: "tabular-nums whitespace-nowrap" },
        h("span", { className: "text-emerald-700" }, "+" + fmtInt(n.sl_them)), " / ",
        h("span", { className: "text-red-600" }, "−" + fmtInt(n.sl_thu_hoi)), " / ",
        h("span", { className: "text-amber-700" }, fmtInt(n.so_chuyen) + " chuyển"),
        h("span", { className: "text-slate-400" }, " so " + fmtKy(n.ky_truoc)));

  // ────────────────────────────────────────────────────────────────
  // MÀN TỔNG QUAN
  // ────────────────────────────────────────────────────────────────
  function DashboardScreen() {
    const [fy, setFy] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
      let alive = true;
      setLoading(true); setError("");
      api("ky_gui_dashboard", fy ? { fiscal_year: fy } : {})
        .then((res) => { if (alive) { setData(res); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e.message || String(e)); setLoading(false); } });
      return () => { alive = false; };
    }, [fy]);

    if (loading && !data) return h("div", { className: "p-6 text-sm text-slate-500" }, "Đang tải…");
    if (error) return h("div", { className: "p-6" },
      h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error));

    const k = data.kpi;
    const fyLabel = (y) => "FY" + String(y).slice(-2);
    const hasChange = k.sl_them != null;
    const stale = data.nhom_san_pham.filter((n) => n.chua_cap_nhat_thang);

    return h("div", { className: "p-4 md:p-6 space-y-6" + (loading ? " opacity-60" : "") },
      h("div", { className: "flex items-center gap-3 flex-wrap" },
        h("h1", { className: "text-lg font-bold text-slate-900" }, "Tổng quan ký gửi"),
        h("select", {
          className: "px-2 py-1 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400",
          value: data.fy, onChange: (e) => setFy(Number(e.target.value)),
        }, data.fy_options.map((y) => h("option", { key: y, value: y }, fyLabel(y) + " (T4/" + y + "–T3/" + (y + 1) + ")"))),
        data.ref_month && h("span", { className: "text-xs text-slate-500" }, "Số liệu tính đến " + fmtKy(data.ref_month + "-01")),
      ),

      h("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3" },
        h(Kpi, { label: "Tổng SL ký gửi", value: fmtInt(k.tong_sl), sub: k.so_nhom + " nhóm SP", accent: true }),
        h(Kpi, { label: "Bệnh viện", value: fmtInt(k.so_bv) }),
        h(Kpi, { label: "KTV phụ trách", value: fmtInt(k.so_ktv) }),
        h(Kpi, {
          label: "So với kỳ trước",
          value: hasChange ? h("span", null,
            h("span", { className: "text-emerald-700" }, "+" + fmtInt(k.sl_them)), " ",
            h("span", { className: "text-red-600" }, "−" + fmtInt(k.sl_thu_hoi))) : "—",
          sub: hasChange ? fmtInt(k.so_chuyen) + " chiếc chuyển BV" : "Chưa có kỳ trước để so",
        }),
      ),

      h("div", { className: card },
        h("div", { className: cardHead },
          h("span", null, "SL ký gửi theo tháng — " + fyLabel(data.fy)),
          h("span", { className: "flex items-center gap-3 text-xs font-normal text-slate-500" },
            h("span", { className: "flex items-center gap-1" }, h("span", { className: "inline-block w-3 h-3 rounded-sm bg-blue-500" }), "Đã cập nhật đủ"),
            h("span", { className: "flex items-center gap-1" }, h("span", { className: "inline-block w-3 h-3 rounded-sm bg-blue-200" }), "Có nhóm SP giữ số kỳ trước")),
        ),
        h("div", { className: "px-4 pt-4 pb-3" },
          data.trend.every((t) => t.sl == null)
            ? h("div", { className: "text-center text-sm text-slate-400 py-10" },
                "Chưa có snapshot trong ", fyLabel(data.fy), " — vào ", h("a", { href: "#/ky-gui", className: "text-blue-600 hover:underline" }, "Ký gửi"), " để upload.")
            : h(TrendChart, { trend: data.trend })),
      ),

      h("div", { className: card + " overflow-hidden" },
        h("div", { className: cardHead },
          h("span", null, "Tình trạng cập nhật theo nhóm SP"),
          h("a", { href: "#/ky-gui", className: "text-xs text-blue-600 hover:underline font-normal" }, "Upload / xem chi tiết →")),
        stale.length > 0 && h("div", { className: "px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-800" },
          stale.length + " nhóm SP chưa cập nhật " + fmtKy(data.ref_month + "-01") + ": " + stale.map((n) => n.nhom_san_pham).join(", ")),
        h("div", { className: "overflow-x-auto" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50" }, h("tr", null,
              ["Nhóm SP", "Kỳ mới nhất", "SL", "Số BV", "Thêm / Thu hồi / Chuyển", "Cập nhật bởi"].map((c, i) =>
                h("th", { key: i, className: "px-3 py-2 text-xs font-semibold text-slate-600 uppercase whitespace-nowrap " + (i === 2 || i === 3 ? "text-right" : "text-left") }, c)))),
            h("tbody", null,
              data.nhom_san_pham.length === 0
                ? h("tr", null, h("td", { colSpan: 6, className: "px-3 py-6 text-center text-sm text-slate-400" }, "Chưa có snapshot"))
                : data.nhom_san_pham.map((n) => h("tr", { key: n.nhom_san_pham, className: "border-t border-slate-100" },
                    h("td", { className: "px-3 py-2 font-semibold text-slate-800" }, n.nhom_san_pham),
                    h("td", { className: "px-3 py-2 whitespace-nowrap" }, fmtKy(n.ky_cap_nhat),
                      n.chua_cap_nhat_thang && h("span", { className: "ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700" }, "chưa cập nhật")),
                    h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold" }, fmtInt(n.sl)),
                    h("td", { className: "px-3 py-2 text-right tabular-nums" }, fmtInt(n.so_bv)),
                    h("td", { className: "px-3 py-2 text-xs" }, changeCell(n)),
                    h("td", { className: "px-3 py-2 text-xs text-slate-500 whitespace-nowrap" }, (n.created_by || "—") + " · " + fmtDateTime(n.created_at)),
                  ))),
          )),
      ),

      h("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-4" },
        h("div", { className: card + " overflow-hidden" },
          h("div", { className: cardHead }, h("span", null, "Phân bổ theo miền"),
            h("span", { className: "text-xs font-normal text-slate-400" }, "Ấn miền để xem BV")),
          h(TonTheoMien, { key: data.fy, rows: data.ton_by_mien })),
        h("div", { className: card + " overflow-hidden" },
          h("div", { className: cardHead }, h("span", null, "Theo KTV phụ trách")),
          h(TheoKtv, { key: data.fy, rows: data.theo_ktv })),
      ),
    );
  }

  window.CCDC_ROUTER.register("/dashboard", DashboardScreen);
})();
