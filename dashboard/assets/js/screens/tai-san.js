// Màn Tài sản — miền tabs, thẻ nhóm SP, bảng chi tiết.
// Admin: Sửa/Xoá + modal.
(function () {
  const { useState, useEffect, useCallback, useRef, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const PL_OPTIONS = [
    { key: "all", label: "Tất cả", value: null },
    { key: "ccdc", label: "CCDC", value: "CCDC" },
    { key: "thietbi", label: "Thiết bị", value: "THIẾT BỊ" },
  ];
  const MIEN_TABS = ["Miền Bắc", "Miền Nam"];
  const PAGE_SIZE = 10;
  const LVT_OPTIONS = ["", "Kho", "Sale/KTV", "Bệnh viện"];
  const TT_OPTIONS = [
    { key: "dang_dung", label: "Đang dùng" }, { key: "dang_sua", label: "Đang sửa" },
    { key: "hong", label: "Hỏng" },           { key: "mat", label: "Mất" },
    { key: "cho_thanh_ly", label: "Chờ thanh lý" }, { key: "da_thanh_ly", label: "Đã thanh lý" },
  ];
  const TT_LABEL = Object.fromEntries(TT_OPTIONS.map(o => [o.key, o.label]));
  const TTHD_OPTIONS = ["Active", "Inactive"];
  const MIEN_OPTIONS = ["", "Miền Bắc", "Miền Trung", "Miền Nam"];
  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");
  const fmtMoney = (n) => (n == null || n === 0) ? "—" : Math.round(Number(n)).toLocaleString("vi-VN");
  const parseMoney = (s) => { if (!s) return 0; return Number(String(s).replace(/[.,\s₫đ]/g, "")) || 0; };

  // ────────────────────────────────────────────────────────────────
  // EDIT MODAL (admin only)
  // ────────────────────────────────────────────────────────────────
  function EditModal({ row, onClose, onSaved }) {
    const [f, setF] = useState(() => ({
      serial: row.serial || "",
      loai_vi_tri: row.loai_vi_tri || "",
      mien: row.mien || "",
      vi_tri: row.vi_tri || "",
      pic: row.pic || "",
      pic_id: row.pic_id || "",
      tinh_trang: row.tinh_trang || "dang_dung",
      trang_thai_hd: row.trang_thai_hd || "Active",
      so_luong: String(row.so_luong ?? 1),
      nguyen_gia: String(row.nguyen_gia ?? 0),
      ngay_mua: row.ngay_mua ? String(row.ngay_mua).slice(0, 10) : "",
      ghi_chu: row.ghi_chu || "",
    }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const save = async () => {
      setError(""); setBusy(true);
      try {
        const payload = {
          id: row.id,
          serial: f.serial.trim() || null,
          loai_vi_tri: f.loai_vi_tri || null,
          mien: f.mien || null,
          vi_tri: f.vi_tri || null,
          pic: f.pic || null,
          pic_id: f.pic_id.trim() || null,
          tinh_trang: f.tinh_trang,
          trang_thai_hd: f.trang_thai_hd,
          so_luong: Number(f.so_luong) || 0,
          nguyen_gia: parseMoney(f.nguyen_gia),
          ngay_mua: f.ngay_mua || null,
          ghi_chu: f.ghi_chu || null,
        };
        if (payload.so_luong <= 0) throw new Error("Số lượng phải > 0");
        const res = await api("update_tai_san", payload);
        if (!res.ok) throw new Error(res.error || "unknown_error");
        onSaved && onSaved(); onClose();
      } catch (e) { setError(e.message || String(e)); }
      setBusy(false);
    };

    const inputCls = "w-full px-2 py-1.5 text-sm border border-slate-300 rounded outline-none focus:border-blue-400";
    const labelCls = "text-xs font-semibold text-slate-600 uppercase tracking-wide";

    return h("div", {
      className: "fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto",
      onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
      h("div", { className: "bg-white rounded-lg shadow-xl w-full max-w-2xl my-8" },
        h("div", { className: "px-5 py-3 border-b border-slate-200 flex items-center justify-between" },
          h("h2", { className: "text-base font-bold text-slate-900" }, "Sửa tài sản #" + row.id),
          h("button", { onClick: onClose, className: "text-slate-400 hover:text-slate-700 text-xl leading-none" }, "×"),
        ),
        h("div", { className: "px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto" },
          h("div", { className: "text-xs text-slate-500 bg-slate-50 p-2 rounded" },
            h("span", { className: "font-mono text-slate-700 font-semibold" }, row.ma_bravo),
            " · ", row.ten_vat_tu || "—",
            " · ", h("span", { className: "text-blue-700 font-semibold" }, row.phan_loai || "—"),
          ),
          error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

          h("div", null,
            h("div", { className: labelCls + " mb-1" }, "Serial (TB: bắt buộc unique)"),
            h("input", { className: inputCls, value: f.serial, onChange: e => setF({ ...f, serial: e.target.value }) })),

          h("div", { className: "grid grid-cols-2 gap-3" },
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Loại vị trí"),
              h("select", { className: inputCls, value: f.loai_vi_tri, onChange: e => setF({ ...f, loai_vi_tri: e.target.value }) },
                LVT_OPTIONS.map(x => h("option", { key: x, value: x }, x || "-- (rỗng) --")))),
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Miền"),
              h("select", { className: inputCls, value: f.mien, onChange: e => setF({ ...f, mien: e.target.value }) },
                MIEN_OPTIONS.map(x => h("option", { key: x, value: x }, x || "-- (rỗng) --")))),
          ),

          h("div", { className: "grid grid-cols-2 gap-3" },
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "PIC (tên người)"),
              h("input", { className: inputCls, value: f.pic, onChange: e => setF({ ...f, pic: e.target.value }) })),
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "PIC ID (mã điểm)"),
              h("input", { className: inputCls + " font-mono text-xs", value: f.pic_id,
                onChange: e => setF({ ...f, pic_id: e.target.value }),
                placeholder: "VD: HN.CTCH.180211" })),
          ),

          h("div", { className: "grid grid-cols-2 gap-3" },
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Tình trạng"),
              h("select", { className: inputCls, value: f.tinh_trang, onChange: e => setF({ ...f, tinh_trang: e.target.value }) },
                TT_OPTIONS.map(o => h("option", { key: o.key, value: o.key }, o.label)))),
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Trạng thái HĐ"),
              h("select", { className: inputCls, value: f.trang_thai_hd, onChange: e => setF({ ...f, trang_thai_hd: e.target.value }) },
                TTHD_OPTIONS.map(x => h("option", { key: x, value: x }, x)))),
          ),

          h("div", { className: "grid grid-cols-2 gap-3" },
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Số lượng"),
              h("input", { type: "number", className: inputCls, value: f.so_luong, onChange: e => setF({ ...f, so_luong: e.target.value }) })),
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Nguyên giá (VNĐ)"),
              h("input", { className: inputCls + " text-right tabular-nums",
                value: parseMoney(f.nguyen_gia).toLocaleString("vi-VN"),
                onChange: e => setF({ ...f, nguyen_gia: e.target.value }) })),
          ),

          h("div", { className: "grid grid-cols-2 gap-3" },
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Ngày mua"),
              h("input", { type: "date", className: inputCls, value: f.ngay_mua, onChange: e => setF({ ...f, ngay_mua: e.target.value }) })),
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Ghi chú"),
              h("input", { className: inputCls, value: f.ghi_chu, onChange: e => setF({ ...f, ghi_chu: e.target.value }) })),
          ),
        ),
        h("div", { className: "px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50" },
          h("button", { onClick: onClose, disabled: busy,
            className: "px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded" }, "Huỷ"),
          h("button", { onClick: save, disabled: busy,
            className: "px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50" },
            busy ? "Đang lưu…" : "Lưu"),
        ),
      ),
    );
  }

  // ────────────────────────────────────────────────────────────────
  // MÀN TÀI SẢN
  // ────────────────────────────────────────────────────────────────
  function TaiSanScreen({ user }) {
    const canWrite = user?.permission?.canWrite;
    const isAdmin = canWrite;
    const permMien = user?.permission?.filterMien || null;
    const permNhomSP = user?.permission?.filterNhomSP || null;

    const [rows, setRows]       = useState([]);
    const [total, setTotal]     = useState(0);
    const [plKey, setPlKey]     = useState("all");
    const [mienTab, setMienTab] = useState(permMien || MIEN_TABS[0]);
    const [lvt, setLvt]         = useState("");
    const [nhomSp, setNhomSp]   = useState("");
    const [search, setSearch]   = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState("");
    const [editRow, setEditRow] = useState(null);

    const [kpi, setKpi]         = useState({ sl: 0, gia_tri: 0, gia_tri_dang_dung: 0, sl_dang_dung: 0 });
    const [lvtStats, setLvtStats] = useState({});
    const [nhomSpOptions, setNhomSpOptions] = useState([]);
    const [mienCounts, setMienCounts] = useState({});
    const [collapsed, setCollapsed] = useState({});
    const [cardPages, setCardPages] = useState({});

    const debounceRef = useRef(null);
    const [searchApplied, setSearchApplied] = useState("");
    useEffect(() => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchApplied(search.trim()), 300);
      return () => clearTimeout(debounceRef.current);
    }, [search]);

    const plValue = PL_OPTIONS.find(x => x.key === plKey)?.value;

    const fetchKpi = useCallback(async () => {
      try {
        const res = await api("tai_san_kpi", {
          phan_loai: plValue, nhom_san_pham: nhomSp || null,
          mien: mienTab, loai_vi_tri: lvt || null,
          search: searchApplied,
        });
        setKpi({ sl: res.sl || 0, gia_tri: res.gia_tri || 0, gia_tri_dang_dung: res.gia_tri_dang_dung || 0, sl_dang_dung: res.sl_dang_dung || 0 });
        setLvtStats(res.lvt_stats || {});
        setNhomSpOptions(res.nhom_sp_options || []);
        setMienCounts(res.mien_counts || {});
      } catch (_) {}
    }, [plValue, nhomSp, mienTab, lvt, searchApplied]);

    const fetchData = useCallback(async () => {
      setLoading(true); setError("");
      try {
        const res = await api("list_tai_san", {
          search: searchApplied, phan_loai: plValue,
          nhom_san_pham: nhomSp || null,
          mien: mienTab, loai_vi_tri: lvt || null,
          page: 1, pageSize: 1000,
        });
        setRows(res.rows || []); setTotal(res.total || 0);
      } catch (e) { setError(e.message || String(e)); setRows([]); setTotal(0); }
      setLoading(false);
    }, [plValue, nhomSp, mienTab, lvt, searchApplied]);

    useEffect(() => { fetchData(); fetchKpi(); setCardPages({}); }, [fetchData, fetchKpi]);

    const reload = () => { fetchData(); fetchKpi(); };

    const del = async (r) => {
      if (!confirm(`Xoá tài sản #${r.id} (${r.ma_bravo}${r.serial ? " · " + r.serial : ""})?\n(Sẽ bị chặn nếu có giao dịch trỏ tới.)`)) return;
      try {
        const res = await api("delete_tai_san", { id: r.id });
        if (!res.ok) throw new Error(res.error + (res.details ? ": " + res.details : ""));
        reload();
      } catch (e) { alert("Lỗi xoá: " + e.message); }
    };

    const sel = "px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400";

    // Nhóm rows theo nhom_san_pham
    const grouped = useMemo(() => {
      const map = {};
      for (const r of rows) {
        const nsp = r.nhom_san_pham || "Khác";
        (map[nsp] || (map[nsp] = [])).push(r);
      }
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "vi"));
    }, [rows]);

    const toggleGroup = (nsp) => setCollapsed(c => ({ ...c, [nsp]: !c[nsp] }));
    const setCardPage = (nsp, p) => setCardPages(cp => ({ ...cp, [nsp]: p }));

    const tyLeSuDung = kpi.gia_tri > 0
      ? Math.round(kpi.gia_tri_dang_dung / kpi.gia_tri * 1000) / 10
      : 0;

    const cols = ["Mã NCC", "Mã Bravo", "Tên", "Loại", "Serial", "Vị trí", "PIC ID", "PIC", "Tình trạng", "SL", "Nguyên giá"];
    if (isAdmin) cols.push("");

    return h("div", { className: "p-4 md:p-6 space-y-4" },
      // Header
      h("div", { className: "flex items-baseline gap-3 flex-wrap" },
        h("h1", { className: "text-lg font-bold text-slate-900" }, "Tài sản"),
        h("span", { className: "text-xs text-slate-500" },
          loading ? "đang tải…" : `${fmtInt(total)} dòng`),
        isAdmin && h("span", { className: "ml-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200" }, "ADMIN"),
      ),

      // KPI Cards
      h("div", { className: "grid grid-cols-2 sm:grid-cols-5 gap-3" },
        // Tổng tài sản
        h("div", { className: "bg-white border border-slate-200 rounded-lg px-4 py-3" },
          h("div", { className: "text-xs font-semibold text-slate-500 uppercase tracking-wide" }, "Tổng tài sản"),
          h("div", { className: "text-2xl font-bold text-slate-900 mt-1 tabular-nums" }, fmtInt(kpi.sl)),
          h("div", { className: "text-xs text-slate-400 mt-0.5 tabular-nums" },
            kpi.gia_tri > 0 ? fmtMoney(kpi.gia_tri) + "₫" : "—"),
        ),
        // Kho
        h("div", { className: "bg-white border border-slate-200 rounded-lg px-4 py-3" },
          h("div", { className: "text-xs font-semibold text-slate-500 uppercase tracking-wide" }, "Kho"),
          h("div", { className: "text-2xl font-bold text-slate-900 mt-1 tabular-nums" }, fmtInt((lvtStats["Kho"] || {}).sl || 0)),
          h("div", { className: "text-xs text-slate-400 mt-0.5 tabular-nums" },
            (lvtStats["Kho"] || {}).gia_tri > 0 ? fmtMoney(lvtStats["Kho"].gia_tri) + "₫" : "—"),
        ),
        // Sale/KTV
        h("div", { className: "bg-white border border-slate-200 rounded-lg px-4 py-3" },
          h("div", { className: "text-xs font-semibold text-slate-500 uppercase tracking-wide" }, "Sale/KTV"),
          h("div", { className: "text-2xl font-bold text-slate-900 mt-1 tabular-nums" }, fmtInt((lvtStats["Sale/KTV"] || {}).sl || 0)),
          h("div", { className: "text-xs text-slate-400 mt-0.5 tabular-nums" },
            (lvtStats["Sale/KTV"] || {}).gia_tri > 0 ? fmtMoney(lvtStats["Sale/KTV"].gia_tri) + "₫" : "—"),
        ),
        // Bệnh viện
        h("div", { className: "bg-white border border-slate-200 rounded-lg px-4 py-3" },
          h("div", { className: "text-xs font-semibold text-slate-500 uppercase tracking-wide" }, "Bệnh viện"),
          h("div", { className: "text-2xl font-bold text-slate-900 mt-1 tabular-nums" }, fmtInt((lvtStats["Bệnh viện"] || {}).sl || 0)),
          h("div", { className: "text-xs text-slate-400 mt-0.5 tabular-nums" },
            (lvtStats["Bệnh viện"] || {}).gia_tri > 0 ? fmtMoney(lvtStats["Bệnh viện"].gia_tri) + "₫" : "—"),
        ),
        // Tỷ lệ sử dụng
        h("div", { className: "bg-white border border-slate-200 rounded-lg px-4 py-3" },
          h("div", { className: "text-xs font-semibold text-slate-500 uppercase tracking-wide" }, "Tỷ lệ sử dụng"),
          h("div", { className: "flex items-end gap-2 mt-1" },
            h("span", { className: "text-2xl font-bold tabular-nums " +
              (tyLeSuDung >= 80 ? "text-green-600" : tyLeSuDung >= 50 ? "text-amber-600" : "text-red-600") },
              tyLeSuDung + "%"),
          ),
          h("div", { className: "text-xs text-slate-400 mt-0.5 tabular-nums" },
            fmtInt(kpi.sl_dang_dung) + " / " + fmtInt(kpi.sl)),
          h("div", { className: "mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden" },
            h("div", { className: "h-full rounded-full transition-all " +
              (tyLeSuDung >= 80 ? "bg-green-500" : tyLeSuDung >= 50 ? "bg-amber-500" : "bg-red-500"),
              style: { width: Math.min(100, tyLeSuDung) + "%" } }),
          ),
        ),
      ),

      // Filter toolbar
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h("div", { className: "flex items-center gap-1 bg-white border border-slate-200 rounded-md p-0.5" },
          PL_OPTIONS.map(opt => h("button", {
            key: opt.key, onClick: () => setPlKey(opt.key),
            className: "px-3 py-1 text-xs font-semibold rounded " +
              (plKey === opt.key ? "bg-blue-500 text-white" : "text-slate-600 hover:bg-slate-100"),
          }, opt.label))),
        h("select", { className: sel + (permNhomSP ? " opacity-60" : ""), value: nhomSp,
          disabled: !!permNhomSP && permNhomSP.length === 1,
          onChange: e => setNhomSp(e.target.value) },
          h("option", { value: "" }, "-- Nhóm SP --"),
          nhomSpOptions.map(n => h("option", { key: n, value: n }, n))),
        h("select", { className: sel, value: lvt, onChange: e => setLvt(e.target.value) },
          LVT_OPTIONS.map(m => h("option", { key: m, value: m }, m || "-- Loại vị trí --"))),
        h("div", { className: "relative flex-1 min-w-[200px] max-w-sm" },
          h("input", {
            type: "search", value: search, onChange: e => setSearch(e.target.value),
            placeholder: "Tìm mã / serial / PIC / vị trí…",
            className: "w-full pl-3 pr-8 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400",
          }),
          search && h("button", { onClick: () => setSearch(""),
            className: "absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" }, "×"),
        ),
      ),

      // Miền Tabs
      h("div", { className: "flex items-center gap-1 border-b border-slate-200" },
        MIEN_TABS.map(m => {
          const cnt = mienCounts[m] || 0;
          const active = mienTab === m;
          return h("button", {
            key: m,
            onClick: () => { if (!permMien) setMienTab(m); },
            disabled: !!permMien && permMien !== m,
            className: "px-4 py-2 text-sm font-semibold border-b-2 transition-colors " +
              (active
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300") +
              (permMien && permMien !== m ? " opacity-40 cursor-not-allowed" : ""),
          }, m + " (" + fmtInt(cnt) + ")");
        }),
      ),

      error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

      // Cards per nhom_san_pham
      rows.length === 0 && !loading
        ? h("div", { className: "bg-white border border-slate-200 rounded-lg px-6 py-12 text-center text-sm text-slate-400" },
            "Chưa có tài sản nào")
        : h("div", { className: "space-y-4" },
            grouped.map(([nsp, items]) => {
              const isCollapsed = collapsed[nsp];
              const grpSl = items.reduce((s, r) => s + Number(r.so_luong || 0), 0);
              const grpGt = items.reduce((s, r) => s + Number(r.so_luong || 0) * Number(r.nguyen_gia || 0), 0);
              const pg = cardPages[nsp] || 1;
              const lastPg = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
              const pgItems = items.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);

              return h("div", { key: nsp, className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
                // Card header
                h("div", {
                  className: "px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between cursor-pointer hover:bg-slate-100",
                  onClick: () => toggleGroup(nsp),
                },
                  h("div", { className: "flex items-center gap-3" },
                    h("span", { className: "text-slate-400 text-xs w-4 text-center" }, isCollapsed ? "▶" : "▼"),
                    h("span", { className: "font-bold text-slate-800" }, nsp),
                    h("span", { className: "text-xs text-slate-500 bg-slate-200 px-2 py-0.5 rounded-full" },
                      items.length + " mã"),
                  ),
                  h("div", { className: "flex items-center gap-4 text-xs text-slate-600" },
                    h("span", null, "SL: ", h("span", { className: "font-semibold tabular-nums" }, fmtInt(grpSl))),
                    h("span", null, "Giá trị: ", h("span", { className: "font-semibold tabular-nums" }, fmtMoney(grpGt) + "₫")),
                  ),
                ),
                // Card body — table
                !isCollapsed && h("div", { className: "overflow-x-auto" },
                  h("table", { className: "w-full text-sm" },
                    h("thead", { className: "bg-slate-50/50 border-b border-slate-100" },
                      h("tr", null, cols.map((c, i) =>
                        h("th", { key: i, className: "px-3 py-1.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide " +
                          ((c === "SL" || c === "Nguyên giá") ? "text-right" : "") }, c)))),
                    h("tbody", null,
                      pgItems.map(r =>
                        h("tr", { key: r.id, className: "border-b border-slate-100 hover:bg-blue-50/30" },
                          h("td", { className: "px-3 py-2 font-mono text-xs text-slate-600 whitespace-nowrap" }, r.ma_ncc || "—"),
                          h("td", { className: "px-3 py-2 font-mono text-xs text-slate-900 whitespace-nowrap" }, r.ma_bravo),
                          h("td", { className: "px-3 py-2 text-slate-800" }, r.ten_vat_tu || "—"),
                          h("td", { className: "px-3 py-2 whitespace-nowrap" },
                            h("span", { className: "inline-block px-2 py-0.5 rounded text-[11px] font-semibold " +
                              (r.phan_loai === "THIẾT BỊ" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-700"),
                            }, r.phan_loai || "—")),
                          h("td", { className: "px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap" }, r.serial || "—"),
                          h("td", { className: "px-3 py-2 text-slate-700 whitespace-nowrap" },
                            r.vi_tri || r.loai_vi_tri || "—"),
                          h("td", { className: "px-3 py-2 font-mono text-xs text-slate-600 whitespace-nowrap" }, r.pic_id || "—"),
                          h("td", { className: "px-3 py-2 text-slate-700 whitespace-nowrap" }, r.pic || "—"),
                          h("td", { className: "px-3 py-2 text-slate-600 whitespace-nowrap" }, TT_LABEL[r.tinh_trang] || r.tinh_trang),
                          h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap" }, fmtInt(r.so_luong)),
                          h("td", { className: "px-3 py-2 text-right tabular-nums whitespace-nowrap" }, fmtMoney(Number(r.so_luong || 0) * Number(r.nguyen_gia || 0))),
                          isAdmin && h("td", { className: "px-3 py-2 whitespace-nowrap" },
                            h("button", { onClick: () => setEditRow(r),
                              className: "text-xs text-blue-600 hover:underline mr-2" }, "Sửa"),
                            h("button", { onClick: () => del(r),
                              className: "text-xs text-red-600 hover:underline" }, "Xoá")),
                        )),
                    ),
                  ),
                ),
                // Pagination footer
                !isCollapsed && lastPg > 1 && h("div", {
                  className: "flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-600",
                },
                  h("span", null,
                    `${(pg - 1) * PAGE_SIZE + 1}–${Math.min(pg * PAGE_SIZE, items.length)} / ${items.length}`),
                  h("div", { className: "flex items-center gap-1" },
                    h("button", {
                      onClick: () => setCardPage(nsp, 1), disabled: pg <= 1,
                      className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
                    }, "««"),
                    h("button", {
                      onClick: () => setCardPage(nsp, pg - 1), disabled: pg <= 1,
                      className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
                    }, "‹"),
                    h("span", { className: "px-2 font-semibold text-slate-800" }, `${pg} / ${lastPg}`),
                    h("button", {
                      onClick: () => setCardPage(nsp, pg + 1), disabled: pg >= lastPg,
                      className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
                    }, "›"),
                    h("button", {
                      onClick: () => setCardPage(nsp, lastPg), disabled: pg >= lastPg,
                      className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
                    }, "»»"),
                  ),
                ),
              );
            }),
          ),

      editRow && h(EditModal, { row: editRow, onClose: () => setEditRow(null), onSaved: reload }),
    );
  }

  window.CCDC_ROUTER.register("/tai-san", TaiSanScreen);
})();
