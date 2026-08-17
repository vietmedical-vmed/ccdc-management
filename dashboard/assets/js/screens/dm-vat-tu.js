// Màn Danh mục CCDC/Thiết bị — list shared.dm_vat_tu (filter phan_loai in CCDC/THIẾT BỊ)
// enrich quan_ly_serial (app_ccdc.ccdc_thuoc_tinh) + tồn hiện tại (app_ccdc.tai_san).
(function () {
  const { useState, useEffect, useCallback, useRef } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const PL_OPTIONS = [
    { key: "all",     label: "Tất cả",    value: null },
    { key: "ccdc",    label: "CCDC",      value: ["CCDC"] },
    { key: "thietbi", label: "Thiết bị",  value: ["THIẾT BỊ"] },
  ];
  const PAGE_SIZE = 50;

  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");

  function DmVatTuScreen() {
    const [rows, setRows]         = useState([]);
    const [total, setTotal]       = useState(0);
    const [page, setPage]         = useState(1);
    const [plKey, setPlKey]       = useState("all");
    const [search, setSearch]     = useState("");
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState("");

    // Debounce search
    const debounceRef = useRef(null);
    const [searchApplied, setSearchApplied] = useState("");
    useEffect(() => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchApplied(search.trim()), 300);
      return () => clearTimeout(debounceRef.current);
    }, [search]);

    // Reset page về 1 khi filter đổi
    useEffect(() => { setPage(1); }, [plKey, searchApplied]);

    const fetchData = useCallback(async () => {
      setLoading(true); setError("");
      try {
        const pl = PL_OPTIONS.find(x => x.key === plKey)?.value;
        const res = await api("list_dm_ccdc", {
          search: searchApplied, phan_loai: pl, page, pageSize: PAGE_SIZE,
        });
        setRows(res.rows || []);
        setTotal(res.total || 0);
      } catch (e) {
        setError(e.message || String(e));
        setRows([]); setTotal(0);
      }
      setLoading(false);
    }, [plKey, searchApplied, page]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return h("div", { className: "p-4 md:p-6 space-y-4" },
      // ─── Header ─────────────────────────────
      h("div", { className: "flex items-baseline gap-3" },
        h("h1", { className: "text-lg font-bold text-slate-900" }, "Danh mục CCDC & Thiết bị"),
        h("span", { className: "text-xs text-slate-500" },
          loading ? "đang tải…" : `${fmtInt(total)} mã`,
        ),
      ),

      // ─── Toolbar filter ─────────────────────
      h("div", { className: "flex flex-wrap items-center gap-3" },
        h("div", { className: "flex items-center gap-1 bg-white border border-slate-200 rounded-md p-0.5" },
          PL_OPTIONS.map(opt => h("button", {
            key: opt.key,
            onClick: () => setPlKey(opt.key),
            className: "px-3 py-1 text-xs font-semibold rounded " +
              (plKey === opt.key
                ? "bg-blue-500 text-white"
                : "text-slate-600 hover:bg-slate-100"),
          }, opt.label)),
        ),
        h("div", { className: "relative flex-1 max-w-sm" },
          h("input", {
            type: "search",
            value: search,
            onChange: (e) => setSearch(e.target.value),
            placeholder: "Tìm mã Bravo / tên / mã NCC…",
            className: "w-full pl-3 pr-8 py-1.5 text-sm border border-slate-200 rounded-md " +
                       "bg-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
          }),
          search && h("button", {
            onClick: () => setSearch(""),
            className: "absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xs",
            title: "Xoá",
          }, "×"),
        ),
      ),

      // ─── Error ──────────────────────────────
      error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

      // ─── Table ──────────────────────────────
      h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
        h("div", { className: "overflow-x-auto" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50 border-b border-slate-200" },
              h("tr", null,
                h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide" }, "Mã Bravo"),
                h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide" }, "Tên"),
                h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide" }, "Mã NCC"),
                h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide" }, "BU"),
                h("th", { className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide" }, "Loại"),
                h("th", { className: "px-3 py-2 text-center text-xs font-semibold text-slate-600 uppercase tracking-wide" }, "Serial"),
                h("th", { className: "px-3 py-2 text-right text-xs font-semibold text-slate-600 uppercase tracking-wide" }, "Tồn"),
              ),
            ),
            h("tbody", null,
              rows.length === 0 && !loading
                ? h("tr", null, h("td", { colSpan: 7, className: "px-3 py-8 text-center text-sm text-slate-400" },
                    "Không có mã nào khớp bộ lọc"))
                : rows.map((r) => h("tr", {
                    key: r.ma_bravo,
                    className: "border-b border-slate-100 hover:bg-slate-50",
                  },
                    h("td", { className: "px-3 py-2 font-mono text-xs text-slate-900" }, r.ma_bravo),
                    h("td", { className: "px-3 py-2 text-slate-800" }, r.ten_vat_tu || "—"),
                    h("td", { className: "px-3 py-2 font-mono text-xs text-slate-600" }, r.ma_ncc || "—"),
                    h("td", { className: "px-3 py-2 text-slate-600" }, r.bu || "—"),
                    h("td", { className: "px-3 py-2" },
                      h("span", {
                        className: "inline-block px-2 py-0.5 rounded text-[11px] font-semibold " +
                          (r.phan_loai === "THIẾT BỊ"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-slate-100 text-slate-700"),
                      }, r.phan_loai),
                    ),
                    h("td", { className: "px-3 py-2 text-center" },
                      r.quan_ly_serial === true
                        ? h("span", { className: "text-blue-600 font-semibold" }, "✓")
                        : r.quan_ly_serial === false
                          ? h("span", { className: "text-slate-300" }, "—")
                          : h("span", { className: "text-slate-300 text-xs italic" }, "chưa cấu hình"),
                    ),
                    h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold text-slate-900" },
                      r.so_luong_ton > 0 ? fmtInt(r.so_luong_ton) : h("span", { className: "text-slate-300 font-normal" }, "0")),
                  )),
            ),
          ),
        ),

        // ─── Pagination footer ─────────────────
        h("div", { className: "flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-600" },
          h("div", null,
            total > 0
              ? `Hiển thị ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} / ${fmtInt(total)}`
              : "—"),
          h("div", { className: "flex items-center gap-1" },
            h("button", {
              onClick: () => setPage(1),
              disabled: page <= 1 || loading,
              className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
            }, "««"),
            h("button", {
              onClick: () => setPage(p => Math.max(1, p - 1)),
              disabled: page <= 1 || loading,
              className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
            }, "‹"),
            h("span", { className: "px-2 font-semibold text-slate-800" }, `${page} / ${lastPage}`),
            h("button", {
              onClick: () => setPage(p => Math.min(lastPage, p + 1)),
              disabled: page >= lastPage || loading,
              className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
            }, "›"),
            h("button", {
              onClick: () => setPage(lastPage),
              disabled: page >= lastPage || loading,
              className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed",
            }, "»»"),
          ),
        ),
      ),
    );
  }

  window.CCDC_ROUTER.register("/dm-vat-tu", DmVatTuScreen);
})();
