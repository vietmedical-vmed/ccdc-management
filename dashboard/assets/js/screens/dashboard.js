// Màn Tổng quan — KPI YTD + Gauge budget + Bar chart mua mới/huỷ theo tháng.
(function () {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const vnd    = (n) => (n == null || Number(n) === 0) ? "0" : Math.round(Number(n)).toLocaleString("vi-VN");
  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");
  const fmtShort = (n) => {
    if (n == null || Number(n) === 0) return "0";
    const v = Number(n);
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 1 : 2) + " tỷ";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + " tr";
    return Math.round(v).toLocaleString("vi-VN");
  };
  const fmtDate = (d) => !d ? "—" : String(d).slice(0, 10);
  const LOAI_LABEL = { ton_dau: "Tồn đầu", nhap_moi: "Mua mới", huy: "Huỷ", mat: "Mất", dieu_chuyen: "Điều chuyển" };
  const LOAI_BADGE = {
    ton_dau: "bg-slate-100 text-slate-700", nhap_moi: "bg-emerald-50 text-emerald-700",
    huy: "bg-red-50 text-red-700", mat: "bg-red-50 text-red-700",
    dieu_chuyen: "bg-amber-50 text-amber-700",
  };
  const budgetStatus = (r) => {
    if (!r.gia_tri_budget) return "OK";
    const pct = Number(r.da_chi || 0) / Number(r.gia_tri_budget);
    return pct > 1 ? "VUOT" : pct >= 0.8 ? "CANH_BAO" : "OK";
  };
  const STATUS_COLOR = { OK: "#10b981", CANH_BAO: "#f59e0b", VUOT: "#ef4444" };
  const STATUS_TEXT = {
    OK:      { label: "OK",      cls: "bg-emerald-50 text-emerald-700" },
    CANH_BAO:{ label: "Cảnh báo", cls: "bg-amber-50 text-amber-700" },
    VUOT:    { label: "Vượt",     cls: "bg-red-50 text-red-700" },
  };

  // ─── KPI card ─────────────────────────────────────────────
  function Kpi({ label, value, sub, accent }) {
    return h("div", { className: "bg-white border border-slate-200 rounded-lg p-4" },
      h("div", { className: "text-xs text-slate-500 uppercase tracking-wide font-semibold" }, label),
      h("div", {
        className: "mt-1 text-xl md:text-2xl font-bold tabular-nums " +
          (accent ? "text-blue-600" : "text-slate-900"),
      }, value),
      sub && h("div", { className: "text-xs text-slate-500 mt-0.5" }, sub),
    );
  }

  // ─── Gauge (thanh tiến độ budget) ────────────────────────
  function Gauge({ r }) {
    const budget = Number(r.gia_tri_budget || 0);
    const chi = Number(r.da_chi || 0);
    const pct = budget ? (chi / budget) * 100 : 0;
    const s = budgetStatus(r);
    const color = STATUS_COLOR[s];
    const stat = STATUS_TEXT[s];
    return h("div", { className: "mb-3 last:mb-0" },
      h("div", { className: "flex items-baseline justify-between mb-1.5" },
        h("div", { className: "text-sm font-semibold text-slate-800" },
          r.nhom_san_pham || h("span", { className: "italic text-slate-500" }, "(tất cả nhóm)"),
          r.bo_phan && h("span", { className: "ml-2 text-xs font-normal text-slate-500" }, "· " + r.bo_phan),
        ),
        h("div", { className: "flex items-center gap-2" },
          h("span", { className: "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold " + stat.cls }, stat.label),
          h("span", { className: "text-sm font-bold tabular-nums" }, Math.round(pct) + "%"),
        ),
      ),
      h("div", {
        className: "relative h-3 rounded bg-slate-100 overflow-visible",
      },
        h("div", {
          className: "absolute inset-y-0 left-0 rounded transition-all",
          style: { width: Math.min(pct, 100) + "%", background: color },
        }),
        // Tick 80%
        h("div", {
          className: "absolute top-[-3px] bottom-[-3px] w-px bg-slate-400",
          style: { left: "80%" },
        }),
      ),
      h("div", { className: "text-xs text-slate-600 mt-1" },
        "Đã chi ", h("b", { className: "text-slate-900 tabular-nums" }, vnd(chi)),
        " / ngân sách ", h("b", { className: "text-slate-900 tabular-nums" }, vnd(budget)), " ₫",
      ),
    );
  }

  // ─── ChartTheoKy: SVG grouped bar chart 2 series ────────
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * p;
  }
  function ChartTheoKy({ months }) {
    const [hover, setHover] = useState(null);
    const series = [
      { key: "nhap_moi", label: "Mua mới", color: "#1877f2" },
      { key: "huy",      label: "Huỷ",     color: "#ef4444" },
    ];
    const rawMax = Math.max(1, ...months.flatMap(d => series.map(s => Number(d[s.key] || 0))));
    const yMax = niceMax(rawMax);
    const W = 720, H = 300, padL = 60, padR = 14, padT = 16, padB = 34;
    const pw = W - padL - padR, ph = H - padT - padB;
    const gw = pw / months.length;
    const barW = 20, gap = 4;
    const inner = series.length * barW + (series.length - 1) * gap;
    const off = (gw - inner) / 2;
    const y = v => padT + ph - (v / yMax) * ph;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * yMax);
    const fmtTick = v => v >= 1e9 ? (v / 1e9).toFixed(1) + "tỷ" :
                        v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "tr" :
                        v >= 1e3 ? Math.round(v / 1e3) + "k" : String(v);
    const barPath = (x, yy, w, hh, r) => {
      r = Math.min(r, hh);
      return `M${x},${yy+hh} L${x},${yy+r} Q${x},${yy} ${x+r},${yy} ` +
             `L${x+w-r},${yy} Q${x+w},${yy} ${x+w},${yy+r} L${x+w},${yy+hh} Z`;
    };
    const monthShort = (k) => "T" + parseInt(k.slice(5), 10);
    const hasData = months.some(d => Number(d.nhap_moi || 0) + Number(d.huy || 0) > 0);

    if (!hasData) return h("div", {
      className: "text-center text-sm text-slate-400 py-12",
    }, "Chưa có giao dịch mua mới / huỷ trong FY này");

    return h("div", null,
      h("div", { className: "flex gap-4 mb-2 text-xs text-slate-600" },
        series.map(s => h("span", { key: s.key, className: "flex items-center gap-1.5" },
          h("span", { className: "inline-block w-3 h-3 rounded", style: { background: s.color } }),
          s.label))),
      h("div", { className: "overflow-x-auto" },
        h("svg", {
          viewBox: `0 0 ${W} ${H}`, width: "100%",
          style: { maxWidth: W, height: "auto", display: "block" },
          role: "img", "aria-label": "Giá trị mua mới / huỷ theo tháng",
        },
          // Grid + Y labels
          ticks.map((t, i) => h("g", { key: i },
            h("line", { x1: padL, x2: W - padR, y1: y(t), y2: y(t), stroke: "#e2e8f0", strokeWidth: 1 }),
            h("text", { x: padL - 8, y: y(t) + 4, textAnchor: "end", fill: "#64748b", fontSize: 11 }, fmtTick(t)),
          )),
          // X axis
          h("line", { x1: padL, x2: W - padR, y1: padT + ph, y2: padT + ph, stroke: "#94a3b8", strokeWidth: 1 }),
          // Bars + month labels
          months.map((d, gi) => {
            const gx = padL + gi * gw;
            return h("g", { key: d.ky },
              h("text", { x: gx + gw / 2, y: padT + ph + 18, textAnchor: "middle", fill: "#64748b", fontSize: 11 },
                monthShort(d.ky)),
              series.map((s, si) => {
                const v = Number(d[s.key] || 0);
                if (!v) return null;
                const x = gx + off + si * (barW + gap);
                const hh = (v / yMax) * ph;
                const yy = y(v);
                const on = hover && hover.gi === gi && hover.si === si;
                return h("path", {
                  key: s.key,
                  d: barPath(x, yy, barW, hh, 3),
                  fill: s.color,
                  opacity: hover && !on ? 0.5 : 1,
                  style: { cursor: "pointer", transition: "opacity 120ms" },
                  onMouseEnter: () => setHover({ gi, si, x: x + barW / 2, yy, v, label: s.label, ky: d.ky }),
                  onMouseLeave: () => setHover(null),
                });
              }),
            );
          }),
          // Hover tooltip
          hover && h("g", { pointerEvents: "none" },
            h("line", {
              x1: hover.x, x2: hover.x, y1: padT, y2: padT + ph,
              stroke: "#94a3b8", strokeDasharray: "3 3",
            }),
            h("rect", {
              x: Math.min(hover.x - 60, W - 130), y: Math.max(hover.yy - 44, padT),
              width: 120, height: 38, rx: 6, fill: "#fff", stroke: "#cbd5e1",
            }),
            h("text", {
              x: Math.min(hover.x - 52, W - 122), y: Math.max(hover.yy - 28, padT + 14),
              fill: "#475569", fontSize: 11,
            }, `${hover.label} · ${monthShort(hover.ky)}`),
            h("text", {
              x: Math.min(hover.x - 52, W - 122), y: Math.max(hover.yy - 12, padT + 30),
              fill: "#0f172a", fontSize: 12, fontWeight: 700,
            }, vnd(hover.v) + " ₫"),
          ),
        ),
      ),
    );
  }

  // ─── Tồn theo miền → vị trí → PIC (cây 3 cấp expand) ──────
  function TonTheoMien({ rows }) {
    // Mặc định chỉ mở cấp miền → hiện vị trí, PIC vẫn ẩn tới khi bấm vị trí
    const [open, setOpen] = useState(() => {
      const s = new Set();
      for (const m of rows) s.add("m:" + m.mien);
      return s;
    });
    const toggle = (key) => setOpen((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

    const numCells = (r, py, bold) => [
      h("td", { key: "c", className: "px-3 " + py + " text-right tabular-nums text-slate-500" }, r.sl_ccdc ? fmtInt(r.sl_ccdc) : "—"),
      h("td", { key: "t", className: "px-3 " + py + " text-right tabular-nums text-slate-500" }, r.sl_tb ? fmtInt(r.sl_tb) : "—"),
      h("td", { key: "s", className: "px-3 " + py + " text-right tabular-nums" + (bold ? " font-semibold" : "") }, fmtInt(r.sl)),
      h("td", { key: "g", className: "px-3 " + py + " text-right tabular-nums" }, fmtShort(r.nguyen_gia)),
    ];

    // level: 0=miền, 1=vị trí, 2=PIC. Cột 1 thụt lề & style theo cấp.
    const branchRow = (key, label, kids, level, r) => {
      const isOpen = open.has(key);
      const hasKids = kids && kids.length;
      const pad = { 0: "px-3", 1: "pl-8 pr-3", 2: "pl-14 pr-3" }[level];
      const rowCls = {
        0: "border-t border-slate-100 hover:bg-slate-50 font-semibold text-slate-800",
        1: "border-t border-slate-50 bg-slate-50/30 hover:bg-slate-100/60 text-slate-700",
        2: "border-t border-slate-50 bg-slate-50/50 text-slate-600",
      }[level];
      const py = level === 0 ? "py-2" : "py-1.5";
      return h("tr", {
        key,
        className: rowCls + (hasKids ? " cursor-pointer select-none" : ""),
        onClick: hasKids ? () => toggle(key) : undefined,
      },
        h("td", { className: pad + " " + py },
          hasKids
            ? h("span", {
                className: "inline-block w-4 text-slate-400",
                style: { transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 120ms" },
              }, "▸")
            : h("span", { className: "inline-block w-4" }),
          label,
          hasKids ? h("span", { className: "ml-1.5 text-xs font-normal text-slate-400" }, "(" + kids.length + ")") : null,
        ),
        ...numCells(r, py, level === 0),
      );
    };

    const render = (rowsArr) => rowsArr.flatMap((m) => {
      const out = [branchRow("m:" + m.mien, m.mien, m.children, 0, m)];
      if (!open.has("m:" + m.mien)) return out;
      for (const v of (m.children || [])) {
        const vk = "m:" + m.mien + "|v:" + v.vi_tri;
        out.push(branchRow(vk, v.vi_tri, v.children, 1, v));
        if (!open.has(vk)) continue;
        for (const p of (v.children || [])) {
          out.push(h("tr", { key: vk + "|p:" + p.pic, className: "border-t border-slate-50 bg-slate-50/50 text-slate-600" },
            h("td", { className: "pl-14 pr-3 py-1.5" },
              h("span", { className: "inline-block w-4" }), p.pic),
            ...numCells(p, "py-1.5", false),
          ));
        }
      }
      return out;
    });

    const th = (label, extra) => h("th", { className: "px-3 py-2 text-xs font-semibold text-slate-600 uppercase " + (extra || "text-right") }, label);
    return h("table", { className: "w-full text-sm" },
      h("thead", { className: "bg-slate-50" },
        h("tr", null,
          th("Miền → Vị trí → PIC", "text-left"),
          th("SL CCDC"), th("SL TB"), th("Tổng SL"), th("Nguyên giá"),
        )),
      h("tbody", null,
        rows.length === 0
          ? h("tr", null, h("td", { colSpan: 5, className: "px-3 py-6 text-center text-sm text-slate-400" }, "Chưa có tài sản"))
          : render(rows)),
    );
  }

  // ────────────────────────────────────────────────────────────────
  // MÀN TỔNG QUAN
  // ────────────────────────────────────────────────────────────────
  function DashboardScreen({ user }) {
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState("");

    useEffect(() => {
      let alive = true;
      api("dashboard_summary").then((res) => {
        if (!alive) return; setData(res); setLoading(false);
      }).catch((e) => {
        if (!alive) return; setError(e.message || String(e)); setLoading(false);
      });
      return () => { alive = false; };
    }, []);

    if (loading) return h("div", { className: "p-6 text-sm text-slate-500" }, "Đang tải…");
    if (error)   return h("div", { className: "p-6" },
      h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error));

    const k       = data.kpi || {};
    const ton     = data.ton_by_mien || [];
    const budget  = data.budget || [];
    const chart   = data.chart_theo_ky || [];
    const recent  = data.recent_giao_dich || [];
    const fy      = data.fy;
    const fyLabel = "FY" + String(fy).slice(-2);

    return h("div", { className: "p-4 md:p-6 space-y-6" },
      // Greeting
      h("div", { className: "flex items-baseline justify-between flex-wrap gap-2" },
        h("div", { className: "text-sm text-slate-600" },
          "Chào ", h("span", { className: "font-semibold text-slate-900" }, user.ho_ten || user.username),
          " — ", user.role || "—",
        ),
        h("div", { className: "text-xs text-slate-500" },
          "Năm tài chính: ", h("span", { className: "font-semibold text-slate-900" }, fyLabel),
          " (", fy, "-04 → ", fy + 1, "-03)",
        ),
      ),

      // KPI row
      h("div", { className: "grid grid-cols-2 md:grid-cols-5 gap-3" },
        h(Kpi, { label: "Ngân sách " + fyLabel, value: fmtShort(k.ngan_sach_ca_nam), sub: "tất cả nhóm", accent: true }),
        h(Kpi, { label: "Mua mới YTD",  value: fmtShort(k.mua_moi_ytd), sub: "trừ vào ngân sách" }),
        h(Kpi, { label: "Giá trị còn lại", value: fmtShort(k.tong_gia_tri_con_lai), sub: "sau khấu hao" }),
        h(Kpi, { label: "Huỷ YTD", value: fmtShort(k.huy_ytd), sub: "gồm cả mất" }),
        h(Kpi, { label: "Số tài sản", value: fmtInt(k.so_tai_san), sub: fmtInt(k.so_luong_tong) + " đơn vị" }),
      ),

      // Budget gauges
      h("div", { className: "bg-white border border-slate-200 rounded-lg" },
        h("div", { className: "px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700 flex items-center justify-between" },
          h("span", null, "Ngân sách mua mới theo nhóm sản phẩm — " + fyLabel),
          h("a", { href: "#/ngan-sach", className: "text-xs text-blue-600 hover:underline font-normal" }, "Cập nhật →"),
        ),
        h("div", { className: "px-4 py-3" },
          budget.length === 0
            ? h("div", { className: "text-center text-sm text-slate-400 py-8" },
                "Chưa thiết lập ngân sách cho ", fyLabel,
                " — vào ", h("a", { href: "#/ngan-sach", className: "text-blue-600 hover:underline" }, "Ngân sách"))
            : budget.map((r, i) => h(Gauge, { key: i, r })),
        ),
      ),

      // Chart theo tháng
      h("div", { className: "bg-white border border-slate-200 rounded-lg" },
        h("div", { className: "px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700" },
          "Giá trị mua mới / huỷ theo tháng — " + fyLabel,
        ),
        h("div", { className: "px-4 py-3" }, h(ChartTheoKy, { months: chart })),
      ),

      // 2 cột: Tồn theo miền + Recent GD
      h("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4" },
        // Tồn theo miền (expand → vị trí/PIC)
        h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
          h("div", { className: "px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700 flex items-center justify-between" },
            h("span", null, "Tồn theo miền"),
            h("span", { className: "text-xs font-normal text-slate-400" }, "Ấn miền để xem vị trí / PIC"),
          ),
          h(TonTheoMien, { rows: ton }),
        ),

        // Recent GD
        h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
          h("div", { className: "px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700 flex items-center justify-between" },
            h("span", null, "10 giao dịch gần nhất"),
            h("a", { href: "#/giao-dich", className: "text-xs text-blue-600 hover:underline font-normal" }, "Xem tất cả →"),
          ),
          h("div", { className: "overflow-x-auto" },
            h("table", { className: "w-full text-sm" },
              h("thead", { className: "bg-slate-50" },
                h("tr", null,
                  h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase" }, "Ngày"),
                  h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase" }, "Loại"),
                  h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase" }, "Mã"),
                  h("th", { className: "px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase" }, "Thành tiền"),
                )),
              h("tbody", null,
                recent.length === 0
                  ? h("tr", null, h("td", { colSpan: 4, className: "px-3 py-6 text-center text-sm text-slate-400" }, "Chưa có giao dịch"))
                  : recent.map(r => h("tr", { key: r.id, className: "border-t border-slate-100" },
                      h("td", { className: "px-3 py-2 whitespace-nowrap text-slate-700 text-xs" }, fmtDate(r.ngay)),
                      h("td", { className: "px-3 py-2" },
                        h("span", { className: "inline-block px-2 py-0.5 rounded text-[11px] font-semibold " + (LOAI_BADGE[r.loai] || "bg-slate-100 text-slate-700") },
                          LOAI_LABEL[r.loai] || r.loai)),
                      h("td", { className: "px-3 py-2 font-mono text-xs text-slate-900" }, r.ma_bravo),
                      h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold" }, fmtShort(r.thanh_tien)),
                    ))),
            ),
          ),
        ),
      ),
    );
  }

  window.CCDC_ROUTER.register("/dashboard", DashboardScreen);
})();
