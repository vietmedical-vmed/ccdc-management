// Màn Ngân sách — CRUD app_ccdc.ngan_sach.
// Table + inline add row + edit/delete từng dòng. FY7 (T7 bắt đầu).
(function () {
  const { useState, useEffect, useCallback } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const fmtMoney = (n) => (n == null || Number(n) === 0) ? "0" : Math.round(Number(n)).toLocaleString("vi-VN");
  const parseMoney = (s) => {
    if (!s) return 0;
    const clean = String(s).replace(/[.,\s₫đ]/g, "");
    return Number(clean) || 0;
  };
  // FY convention org: T4-T3, FY name = starting year (VD: 2026-04 → 2027-03 = FY26)
  const FY_CURRENT = (() => {
    const d = new Date();
    return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  })();

  function NganSachScreen({ user }) {
    const canWrite = user?.permission?.canWrite;
    const [rows, setRows]       = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState("");
    const [editing, setEditing] = useState(null); // row đang edit (id null = tạo mới)
    const [opts, setOpts]       = useState({ nhom_san_pham: [], bu: [] });

    const fetchData = useCallback(async () => {
      setLoading(true); setError("");
      try {
        const res = await api("list_ngan_sach", {});
        setRows(res.rows || []);
      } catch (e) { setError(e.message || String(e)); }
      setLoading(false);
    }, []);
    useEffect(() => { fetchData(); }, [fetchData]);

    // Fetch dropdown options 1 lần khi mount
    useEffect(() => {
      let alive = true;
      api("ngan_sach_options", {})
        .then(r => { if (alive) setOpts({ nhom_san_pham: r.nhom_san_pham || [], bu: r.bu || [] }); })
        .catch(() => {});
      return () => { alive = false; };
    }, []);

    const startAdd = () => setEditing({
      id: null, nam_tai_chinh: FY_CURRENT,
      nhom_san_pham: "", bo_phan: "", gia_tri_budget: 0,
    });
    const startEdit = (r) => setEditing({ ...r, gia_tri_budget: Number(r.gia_tri_budget || 0) });
    const cancel = () => setEditing(null);

    const save = async () => {
      try {
        await api("upsert_ngan_sach", {
          id:             editing.id,
          nam_tai_chinh:  Number(editing.nam_tai_chinh),
          nhom_san_pham:  editing.nhom_san_pham || null,
          bo_phan:        editing.bo_phan       || null,
          gia_tri_budget: Number(editing.gia_tri_budget),
        });
        setEditing(null); fetchData();
      } catch (e) { alert("Lỗi lưu: " + e.message); }
    };

    const del = async (r) => {
      if (!confirm(`Xoá ngân sách FY${r.nam_tai_chinh} · ${r.nhom_san_pham || "(all)"} · ${r.bo_phan || "(all)"}?`)) return;
      try { await api("delete_ngan_sach", { id: r.id }); fetchData(); }
      catch (e) { alert("Lỗi xoá: " + e.message); }
    };

    const cellInput = "w-full px-2 py-1 text-sm border border-slate-300 rounded outline-none focus:border-blue-400";

    return h("div", { className: "p-4 md:p-6 space-y-4" },
      h("div", { className: "flex items-baseline gap-3" },
        h("h1", { className: "text-lg font-bold text-slate-900" }, "Ngân sách"),
        h("span", { className: "text-xs text-slate-500" },
          loading ? "đang tải…" : `${rows.length} dòng · FY hiện tại: FY${String(FY_CURRENT).slice(-2)}`),
        canWrite && h("button", {
          onClick: startAdd, disabled: !!editing,
          className: "ml-auto px-3 py-1.5 text-xs font-semibold rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40",
        }, "+ Thêm ngân sách"),
      ),

      error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

      h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
        h("div", { className: "overflow-x-auto" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50 border-b border-slate-200" },
              h("tr", null, ["Năm tài chính", "Nhóm sản phẩm", "BU", "Giá trị budget (₫)"].concat(canWrite ? [""] : []).map((c, i) =>
                h("th", { key: i, className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide " +
                  (c === "Giá trị budget (₫)" ? "text-right" : "") }, c)))),
            h("tbody", null,
              // Row mới (nếu đang add)
              editing && editing.id === null && h("tr", { className: "bg-blue-50 border-b border-slate-100" },
                h("td", { className: "px-3 py-2" }, h("input", {
                  type: "number", className: cellInput, value: editing.nam_tai_chinh,
                  onChange: e => setEditing({ ...editing, nam_tai_chinh: e.target.value })
                })),
                h("td", { className: "px-3 py-2" }, h("select", {
                  className: cellInput, value: editing.nhom_san_pham || "",
                  onChange: e => setEditing({ ...editing, nhom_san_pham: e.target.value })
                },
                  h("option", { value: "" }, "(tất cả nhóm)"),
                  opts.nhom_san_pham.map(x => h("option", { key: x, value: x }, x)))),
                h("td", { className: "px-3 py-2" }, h("select", {
                  className: cellInput, value: editing.bo_phan || "",
                  onChange: e => setEditing({ ...editing, bo_phan: e.target.value })
                },
                  h("option", { value: "" }, "(tất cả BU)"),
                  opts.bu.map(x => h("option", { key: x, value: x }, x)))),
                h("td", { className: "px-3 py-2 text-right" }, h("input", {
                  className: cellInput + " text-right tabular-nums",
                  value: fmtMoney(editing.gia_tri_budget),
                  onChange: e => setEditing({ ...editing, gia_tri_budget: parseMoney(e.target.value) })
                })),
                h("td", { className: "px-3 py-2 whitespace-nowrap" },
                  h("button", { onClick: save, className: "text-xs font-semibold text-blue-600 hover:underline mr-3" }, "Lưu"),
                  h("button", { onClick: cancel, className: "text-xs text-slate-500 hover:underline" }, "Huỷ")),
              ),

              rows.length === 0 && !loading && !editing
                ? h("tr", null, h("td", { colSpan: 5, className: "px-3 py-8 text-center text-sm text-slate-400" },
                    "Chưa có ngân sách nào — bấm '+ Thêm ngân sách'"))
                : rows.map(r =>
                    editing && editing.id === r.id
                      ? h("tr", { key: r.id, className: "bg-blue-50 border-b border-slate-100" },
                          h("td", { className: "px-3 py-2" }, h("input", {
                            type: "number", className: cellInput, value: editing.nam_tai_chinh,
                            onChange: e => setEditing({ ...editing, nam_tai_chinh: e.target.value })
                          })),
                          h("td", { className: "px-3 py-2" }, h("select", {
                            className: cellInput, value: editing.nhom_san_pham || "",
                            onChange: e => setEditing({ ...editing, nhom_san_pham: e.target.value })
                          },
                            h("option", { value: "" }, "(tất cả nhóm)"),
                            opts.nhom_san_pham.map(x => h("option", { key: x, value: x }, x)))),
                          h("td", { className: "px-3 py-2" }, h("select", {
                            className: cellInput, value: editing.bo_phan || "",
                            onChange: e => setEditing({ ...editing, bo_phan: e.target.value })
                          },
                            h("option", { value: "" }, "(tất cả BU)"),
                            opts.bu.map(x => h("option", { key: x, value: x }, x)))),
                          h("td", { className: "px-3 py-2 text-right" }, h("input", {
                            className: cellInput + " text-right tabular-nums",
                            value: fmtMoney(editing.gia_tri_budget),
                            onChange: e => setEditing({ ...editing, gia_tri_budget: parseMoney(e.target.value) })
                          })),
                          h("td", { className: "px-3 py-2 whitespace-nowrap" },
                            h("button", { onClick: save, className: "text-xs font-semibold text-blue-600 hover:underline mr-3" }, "Lưu"),
                            h("button", { onClick: cancel, className: "text-xs text-slate-500 hover:underline" }, "Huỷ")),
                        )
                      : h("tr", { key: r.id, className: "border-b border-slate-100 hover:bg-slate-50" },
                          h("td", { className: "px-3 py-2 font-semibold text-slate-900" }, "FY" + r.nam_tai_chinh),
                          h("td", { className: "px-3 py-2 text-slate-700" }, r.nhom_san_pham || h("span", { className: "italic text-slate-400" }, "(tất cả)")),
                          h("td", { className: "px-3 py-2 text-slate-700" }, r.bo_phan || h("span", { className: "italic text-slate-400" }, "(tất cả BU)")),
                          h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold" }, fmtMoney(r.gia_tri_budget) + " ₫"),
                          canWrite && h("td", { className: "px-3 py-2 whitespace-nowrap" },
                            h("button", { onClick: () => startEdit(r), disabled: !!editing,
                              className: "text-xs text-blue-600 hover:underline mr-3 disabled:opacity-40" }, "Sửa"),
                            h("button", { onClick: () => del(r), disabled: !!editing,
                              className: "text-xs text-red-600 hover:underline disabled:opacity-40" }, "Xoá")),
                        )
                  ),
            ),
          ),
        ),
      ),
    );
  }

  window.CCDC_ROUTER.register("/ngan-sach", NganSachScreen);
})();
