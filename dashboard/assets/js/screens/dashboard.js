// Màn Tổng quan — KPI tài sản + thẻ ngân sách + tồn theo miền + GD gần nhất.
(function () {
  const { useState, useEffect } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

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
    if (!r.sl_dang_ky) return "OK";
    const pct = Number(r.sl_da_dung || 0) / Number(r.sl_dang_ky);
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

  // ─── BudgetCard (thẻ ngân sách tổng hợp + progress bar) ──
  function BudgetCard({ label, used, total, fmt, unit }) {
    const pct = total ? Math.round((used / total) * 100) : 0;
    const s = pct > 100 ? "VUOT" : pct >= 80 ? "CANH_BAO" : "OK";
    const color = STATUS_COLOR[s];
    const stat = STATUS_TEXT[s];
    return h("div", { className: "bg-white border border-slate-200 rounded-lg p-4" },
      h("div", { className: "text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2" }, label),
      h("div", { className: "flex items-center justify-between mb-1" },
        h("span", { className: "text-xl md:text-2xl font-bold tabular-nums text-slate-900" }, pct + "%"),
        h("span", { className: "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold " + stat.cls }, stat.label),
      ),
      h("div", { className: "relative h-3 rounded bg-slate-100 overflow-hidden" },
        h("div", {
          className: "absolute inset-y-0 left-0 rounded transition-all",
          style: { width: Math.min(pct, 100) + "%", background: color },
        }),
      ),
      h("div", { className: "text-xs text-slate-500 mt-1.5" },
        "Đã dùng ", h("b", { className: "text-slate-900 tabular-nums" }, fmt(used)),
        " / đăng ký ", h("b", { className: "text-slate-900 tabular-nums" }, fmt(total)), " " + unit,
      ),
    );
  }

  // ─── Gauge (thanh tiến độ budget) ────────────────────────
  function Gauge({ r }) {
    const dk = Number(r.sl_dang_ky || 0);
    const dd = Number(r.sl_da_dung || 0);
    const chi = Number(r.da_chi || 0);
    const pct = dk ? (dd / dk) * 100 : 0;
    const s = budgetStatus(r);
    const color = STATUS_COLOR[s];
    const stat = STATUS_TEXT[s];
    return h("div", { className: "mb-3 last:mb-0" },
      h("div", { className: "flex items-baseline justify-between mb-1.5" },
        h("div", { className: "text-sm font-semibold text-slate-800" },
          r.nhom_san_pham || h("span", { className: "italic text-slate-500" }, "(tất cả nhóm)"),
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
        h("div", {
          className: "absolute top-[-3px] bottom-[-3px] w-px bg-slate-400",
          style: { left: "80%" },
        }),
      ),
      h("div", { className: "text-xs text-slate-600 mt-1" },
        "Đã dùng ", h("b", { className: "text-slate-900 tabular-nums" }, fmtInt(dd)),
        " / đăng ký ", h("b", { className: "text-slate-900 tabular-nums" }, fmtInt(dk)), " bộ",
        chi > 0 && h("span", { className: "ml-2 text-slate-400" }, "· " + fmtShort(chi) + " ₫"),
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
    const recent  = (data.recent_giao_dich || []).slice()
      .sort((a, b) => String(b.ngay).localeCompare(String(a.ngay)) || (b.id - a.id));
    const fy      = data.fy;
    const fyLabel = "FY" + String(fy).slice(-2);

    // Ngân sách SL: đăng ký vs đã dùng
    const slDK       = Number(k.tong_sl_dang_ky || 0);
    const slDD       = Number(k.tong_sl_da_dung || 0);
    const slConLai   = slDK - slDD;
    const slPct      = slDK ? Math.round((slConLai / slDK) * 100) : 0;

    // Giá trị tiền tương ứng cho từng thẻ
    const gtHienCo   = Number(k.tong_nguyen_gia || 0);
    const gtTonDau   = gtHienCo + Number(k.huy_ytd || 0) - Number(k.mua_moi_ytd || 0);

    return h("div", { className: "p-4 md:p-6 space-y-6" },
      // Row 1: 4 thẻ chỉ số tài sản — dưới SL là giá trị tiền tương ứng
      h("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3" },
        h(Kpi, { label: "Tài sản hiện có", value: fmtInt(k.so_luong_tong), sub: fmtShort(gtHienCo) + " ₫", accent: true }),
        h(Kpi, { label: "Tổng tài sản đầu năm", value: fmtInt(k.ton_dau_ky), sub: fmtShort(gtTonDau) + " ₫" }),
        h(Kpi, { label: "Mua mới trong năm", value: fmtInt(k.sl_mua_moi_ytd), sub: fmtShort(k.mua_moi_ytd) + " ₫" }),
        h(Kpi, { label: "Đã hủy/mất trong năm", value: fmtInt(k.sl_huy_mat_ytd), sub: fmtShort(k.huy_ytd) + " ₫" }),
      ),

      // Row 2: 2 thẻ ngân sách tổng hợp
      h("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3" },
        h(BudgetCard, { label: "Ngân sách theo số lượng", used: slDD, total: slDK, fmt: fmtInt, unit: "bộ" }),
        h(BudgetCard, { label: "Ngân sách theo giá trị", used: Number(k.ngan_sach_ca_nam || 0), total: Number(k.tong_tien_dang_ky || 0), fmt: fmtShort, unit: "₫" }),
      ),

      // Budget gauges
      h("div", { className: "bg-white border border-slate-200 rounded-lg" },
        h("div", { className: "px-4 py-3 border-b border-slate-200 font-semibold text-sm text-slate-700 flex items-center justify-between" },
          h("span", null, "Ngân sách đăng ký theo nhóm sản phẩm — " + fyLabel),
          h("a", { href: "#/ngan-sach", className: "text-xs text-blue-600 hover:underline font-normal" }, "Cập nhật →"),
        ),
        h("div", { className: "px-4 py-3" },
          budget.length === 0
            ? h("div", { className: "text-center text-sm text-slate-400 py-8" },
                "Chưa đăng ký ngân sách cho ", fyLabel,
                " — vào ", h("a", { href: "#/ngan-sach", className: "text-blue-600 hover:underline" }, "Ngân sách"))
            : budget.map((r, i) => h(Gauge, { key: i, r })),
        ),
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
