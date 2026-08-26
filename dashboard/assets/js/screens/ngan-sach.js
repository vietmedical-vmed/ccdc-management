// Màn Ngân sách — đăng ký đầu năm theo mã Bravo + SL.
// Wizard: chọn BU → Miền → Nhóm SP → tích chọn mã → nhập SL → xác nhận → lưu.
(function () {
  const { useState, useEffect, useCallback, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const FY_CURRENT = (() => {
    const d = new Date();
    return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
  })();

  const fmtMoney = (n) => (n == null || Number(n) === 0) ? "0" : Math.round(Number(n)).toLocaleString("vi-VN");
  const cellCls = "px-3 py-2 text-sm";
  const selectCls = "w-full px-2 py-1.5 text-sm border border-slate-300 rounded outline-none focus:border-blue-400 bg-white";
  const btnPrimary = "px-4 py-2 text-sm font-semibold rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40";
  const btnSecondary = "px-4 py-2 text-sm font-semibold rounded border border-slate-300 text-slate-700 hover:bg-slate-50";

  // ── Wizard thêm đăng ký ──────────────────────────────────
  function AddWizard({ fy, onDone, onCancel }) {
    const [opts, setOpts] = useState({ bu: [], nhom_san_pham: [], mien: [] });
    const [bu, setBU] = useState("");
    const [mien, setMien] = useState("");
    const [nhomSP, setNhomSP] = useState("");
    const [items, setItems] = useState([]);
    const [loadingOpts, setLoadingOpts] = useState(true);
    const [loadingItems, setLoadingItems] = useState(false);
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState({});
    const [step, setStep] = useState("filter");
    const [saving, setSaving] = useState(false);

    // Load BU + miền options on mount
    useEffect(() => {
      setLoadingOpts(true);
      api("ngan_sach_options", {}).then(r => {
        setOpts({ bu: r.bu || [], nhom_san_pham: r.nhom_san_pham || [], mien: r.mien || [] });
      }).catch(() => {}).finally(() => setLoadingOpts(false));
    }, []);

    // Reload nhóm SP when BU changes
    useEffect(() => {
      if (!bu) return;
      api("ngan_sach_options", { bu }).then(r => {
        setOpts(prev => ({ ...prev, nhom_san_pham: r.nhom_san_pham || [] }));
        setNhomSP("");
        setItems([]);
      }).catch(() => {});
    }, [bu]);

    // Load items when nhóm SP is selected
    useEffect(() => {
      if (!nhomSP) { setItems([]); return; }
      setLoadingItems(true);
      api("ngan_sach_items", {
        bu: bu || null, nhom_san_pham: nhomSP,
        nam_tai_chinh: fy, mien: mien || null,
      }).then(r => {
        setItems(r.rows || []);
        const pre = {};
        for (const row of (r.rows || [])) {
          if (row.existing_sl != null)
            pre[row.ma_bravo] = { checked: true, sl: row.existing_sl, id: row.existing_id };
        }
        setSelected(prev => ({ ...pre, ...prev }));
      }).catch(() => {}).finally(() => setLoadingItems(false));
    }, [nhomSP, bu, fy, mien]);

    const toggle = (ma) => {
      setSelected(prev => {
        const cur = prev[ma];
        if (cur?.checked) {
          const next = { ...prev };
          delete next[ma];
          return next;
        }
        return { ...prev, [ma]: { checked: true, sl: cur?.sl || 1, id: cur?.id || null } };
      });
    };

    const setSL = (ma, val) => {
      setSelected(prev => ({
        ...prev,
        [ma]: { ...prev[ma], sl: Math.max(1, Number(val) || 0) },
      }));
    };

    const toggleAll = () => {
      const visible = filteredItems.map(r => r.ma_bravo);
      const allChecked = visible.every(m => selected[m]?.checked);
      if (allChecked) {
        setSelected(prev => {
          const next = { ...prev };
          for (const m of visible) delete next[m];
          return next;
        });
      } else {
        setSelected(prev => {
          const next = { ...prev };
          for (const m of visible)
            if (!next[m]?.checked) next[m] = { checked: true, sl: 1, id: null };
          return next;
        });
      }
    };

    const filteredItems = useMemo(() => {
      if (!search) return items;
      const s = search.toLowerCase();
      return items.filter(r =>
        (r.ma_bravo || "").toLowerCase().includes(s) ||
        (r.ten_vat_tu || "").toLowerCase().includes(s) ||
        (r.ma_ncc || "").toLowerCase().includes(s)
      );
    }, [items, search]);

    const checkedItems = useMemo(() =>
      Object.entries(selected)
        .filter(([, v]) => v.checked)
        .map(([ma, v]) => {
          const item = items.find(r => r.ma_bravo === ma) || {};
          const don_gia = item.don_gia_mua != null ? Number(item.don_gia_mua) : null;
          return { ...item, ma_bravo: ma, so_luong: v.sl, id: v.id, don_gia, tong: don_gia != null ? don_gia * v.sl : null };
        }),
    [selected, items]);

    const doSave = async () => {
      if (!checkedItems.length) return;
      setSaving(true);
      try {
        const res = await api("batch_upsert_ngan_sach", {
          nam_tai_chinh: fy,
          mien: mien || null,
          items: checkedItems.map(r => ({ ma_bravo: r.ma_bravo, so_luong: r.so_luong, id: r.id })),
        });
        const errors = (res.results || []).filter(r => r.error);
        if (errors.length) alert("Lỗi: " + errors.map(r => r.ma_bravo + ": " + r.error).join("\n"));
        else onDone();
      } catch (e) { alert("Lỗi lưu: " + e.message); }
      setSaving(false);
    };

    // ── Step: confirm ──
    if (step === "confirm") {
      return h("div", { className: "space-y-4" },
        h("div", { className: "flex items-center justify-between" },
          h("h2", { className: "text-base font-bold text-slate-900" }, "Xác nhận đăng ký"),
          h("div", { className: "text-sm text-slate-500" },
            "FY" + String(fy).slice(-2) + " · " + (mien || "Tất cả miền") + " · " + (bu || "Tất cả BU")),
        ),
        h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50 border-b border-slate-200" },
              h("tr", null, ["Mã NCC", "Mã Bravo", "Tên hàng hóa", "Đơn giá", "SL", "Tổng giá trị"].map((c, i) =>
                h("th", { key: i, className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase" +
                  (["Đơn giá", "SL", "Tổng giá trị"].includes(c) ? " text-right" : "") }, c)))),
            h("tbody", null,
              checkedItems.map(r =>
                h("tr", { key: r.ma_bravo, className: "border-b border-slate-100" },
                  h("td", { className: cellCls + " font-mono text-xs text-slate-500" }, r.ma_ncc || "—"),
                  h("td", { className: cellCls + " font-mono text-xs font-semibold" }, r.ma_bravo),
                  h("td", { className: cellCls + " text-slate-700 max-w-xs truncate" }, r.ten_vat_tu || "—"),
                  h("td", { className: cellCls + " text-right tabular-nums" }, r.don_gia != null ? fmtMoney(r.don_gia) : "—"),
                  h("td", { className: cellCls + " text-right tabular-nums font-bold" }, r.so_luong),
                  h("td", { className: cellCls + " text-right tabular-nums font-semibold" }, r.tong != null ? fmtMoney(r.tong) : "—"),
                )),
            ),
          ),
        ),
        h("div", { className: "text-sm text-slate-600" },
          h("b", null, checkedItems.length), " mã · tổng ",
          h("b", null, checkedItems.reduce((s, r) => s + r.so_luong, 0)), " bộ",
          (() => { const t = checkedItems.reduce((s, r) => s + (r.tong || 0), 0); return t > 0 ? [" · ", h("b", null, fmtMoney(t)), " ₫"] : null; })()),
        h("div", { className: "flex gap-3 justify-end" },
          h("button", { onClick: () => setStep("filter"), className: btnSecondary, disabled: saving }, "← Quay lại"),
          h("button", { onClick: doSave, className: btnPrimary, disabled: saving },
            saving ? "Đang lưu…" : "Lưu ngân sách"),
        ),
      );
    }

    // ── Step: filter + select items ──
    const allVisible = filteredItems.length > 0 && filteredItems.every(r => selected[r.ma_bravo]?.checked);

    return h("div", { className: "space-y-4" },
      // Header
      h("div", { className: "flex items-center justify-between" },
        h("h2", { className: "text-base font-bold text-slate-900" },
          "Thêm đăng ký ngân sách — FY" + String(fy).slice(-2)),
        h("button", { onClick: onCancel, className: "text-sm text-slate-500 hover:text-slate-700" }, "✕ Đóng"),
      ),

      // Filter row
      h("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-3" },
        // BU
        h("div", null,
          h("label", { className: "block text-xs font-semibold text-slate-600 mb-1 uppercase" }, "1. Chọn BU"),
          h("select", {
            className: selectCls, value: bu,
            onChange: e => { setBU(e.target.value); setNhomSP(""); setItems([]); setSelected({}); },
          },
            h("option", { value: "" }, "— Chọn BU —"),
            opts.bu.map(b => h("option", { key: b, value: b }, b)),
          ),
        ),
        // Miền
        h("div", null,
          h("label", { className: "block text-xs font-semibold text-slate-600 mb-1 uppercase" }, "2. Chọn Miền"),
          h("select", {
            className: selectCls, value: mien,
            onChange: e => { setMien(e.target.value); },
          },
            h("option", { value: "" }, "(Tất cả miền)"),
            opts.mien.map(m => h("option", { key: m, value: m }, m)),
          ),
        ),
        // Nhóm SP
        h("div", null,
          h("label", { className: "block text-xs font-semibold text-slate-600 mb-1 uppercase" }, "3. Chọn nhóm SP"),
          h("select", {
            className: selectCls, value: nhomSP, disabled: !bu,
            onChange: e => { setNhomSP(e.target.value); setSearch(""); },
          },
            h("option", { value: "" }, bu ? "— Chọn nhóm —" : "Chọn BU trước"),
            opts.nhom_san_pham.map(n => h("option", { key: n, value: n }, n)),
          ),
        ),
      ),

      // Items table
      nhomSP && h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
        // Search + count bar
        h("div", { className: "px-3 py-2 border-b border-slate-200 flex items-center gap-3 bg-slate-50" },
          h("input", {
            type: "text", placeholder: "Tìm mã, tên, NCC…",
            className: "flex-1 px-2 py-1 text-sm border border-slate-300 rounded outline-none focus:border-blue-400",
            value: search, onChange: e => setSearch(e.target.value),
          }),
          h("span", { className: "text-xs text-slate-500 whitespace-nowrap" },
            loadingItems ? "Đang tải…"
              : filteredItems.length + " mã · " + checkedItems.length + " đã chọn"),
        ),
        h("div", { className: "overflow-x-auto max-h-[420px] overflow-y-auto" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50 border-b border-slate-200 sticky top-0 z-10" },
              h("tr", null,
                h("th", { className: "px-3 py-2 w-10" },
                  h("input", {
                    type: "checkbox", checked: allVisible,
                    onChange: toggleAll,
                    className: "accent-blue-500",
                  }),
                ),
                ["Mã NCC", "Mã Bravo", "Tên hàng hóa", "Đơn giá", "SL", "Tổng giá trị"].map((c, i) =>
                  h("th", { key: i, className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase" +
                    (["Đơn giá", "SL", "Tổng giá trị"].includes(c) ? " text-right" : "") +
                    (c === "SL" ? " w-24" : "") }, c)),
              ),
            ),
            h("tbody", null,
              filteredItems.length === 0 && !loadingItems
                ? h("tr", null, h("td", { colSpan: 7, className: "px-3 py-6 text-center text-sm text-slate-400" },
                    "Không có mã nào"))
                : filteredItems.map(r => {
                    const sel = selected[r.ma_bravo];
                    const checked = !!sel?.checked;
                    const isExisting = r.existing_sl != null;
                    const donGia = r.don_gia_mua != null ? Number(r.don_gia_mua) : null;
                    const sl = checked ? (sel.sl || 0) : (isExisting ? r.existing_sl : 0);
                    return h("tr", {
                      key: r.ma_bravo,
                      className: "border-b border-slate-100 " +
                        (checked ? "bg-blue-50/60" : "hover:bg-slate-50") +
                        (isExisting ? " ring-1 ring-inset ring-blue-200" : ""),
                    },
                      h("td", { className: "px-3 py-2 text-center" },
                        h("input", {
                          type: "checkbox", checked,
                          onChange: () => toggle(r.ma_bravo),
                          className: "accent-blue-500",
                        }),
                      ),
                      h("td", { className: cellCls + " font-mono text-xs text-slate-500" }, r.ma_ncc || "—"),
                      h("td", { className: cellCls + " font-mono text-xs font-semibold text-slate-800" }, r.ma_bravo),
                      h("td", { className: cellCls + " text-slate-700 max-w-xs truncate", title: r.ten_vat_tu },
                        r.ten_vat_tu || "—"),
                      h("td", { className: cellCls + " text-right tabular-nums text-slate-600" }, donGia != null ? fmtMoney(donGia) : "—"),
                      h("td", { className: cellCls + " text-right" },
                        checked
                          ? h("input", {
                              type: "number", min: 1,
                              className: "w-20 px-2 py-1 text-sm text-right tabular-nums border border-slate-300 rounded outline-none focus:border-blue-400",
                              value: sel.sl,
                              onChange: e => setSL(r.ma_bravo, e.target.value),
                            })
                          : isExisting
                            ? h("span", { className: "text-xs text-blue-500 tabular-nums" }, r.existing_sl)
                            : h("span", { className: "text-slate-300" }, "—"),
                      ),
                      h("td", { className: cellCls + " text-right tabular-nums font-semibold" },
                        (checked || isExisting) && donGia != null ? fmtMoney(donGia * sl) : "—",
                      ),
                    );
                  }),
            ),
          ),
        ),
      ),

      // Bottom bar
      checkedItems.length > 0 && h("div", {
        className: "flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3",
      },
        h("span", { className: "text-sm text-blue-800" },
          h("b", null, checkedItems.length), " mã đã chọn · tổng ",
          h("b", null, checkedItems.reduce((s, r) => s + r.so_luong, 0)), " bộ",
          (() => { const t = checkedItems.reduce((s, r) => s + (r.tong || 0), 0); return t > 0 ? [" · ", h("b", null, fmtMoney(t)), " ₫"] : null; })(),
        ),
        h("button", {
          onClick: () => setStep("confirm"),
          className: btnPrimary,
        }, "Xác nhận →"),
      ),
    );
  }

  // ── Upload Excel ──────────────────────────────────────────
  function UploadExcel({ fy, onDone, onCancel }) {
    const [parsed, setParsed] = useState(null);
    const [error, setError]   = useState("");
    const [saving, setSaving] = useState(false);
    const fileRef = React.useRef(null);

    const HEADER_MAP = {
      "nhóm sản phẩm": "nhom_san_pham", "nhom san pham": "nhom_san_pham", "nhóm sp": "nhom_san_pham",
      "miền": "mien", "mien": "mien",
      "mã ncc": "ma_ncc", "ma ncc": "ma_ncc",
      "mã bravo": "ma_bravo", "ma bravo": "ma_bravo",
      "tên tscđ/ccdc": "ten", "ten tscd/ccdc": "ten", "tên hàng hóa": "ten", "ten hang hoa": "ten", "tên": "ten", "ten vat tu": "ten",
      "sl": "so_luong", "số lượng": "so_luong", "so luong": "so_luong",
    };

    const parseFile = (file) => {
      setError("");
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
          if (raw.length < 2) { setError("File rỗng hoặc thiếu dòng dữ liệu"); return; }

          const headerRow = raw[0].map(c => String(c).trim().toLowerCase());
          const colMap = {};
          headerRow.forEach((h, i) => {
            const key = HEADER_MAP[h];
            if (key) colMap[key] = i;
          });
          if (colMap.ma_bravo == null) { setError("Không tìm thấy cột 'Mã Bravo'"); return; }
          if (colMap.so_luong == null) { setError("Không tìm thấy cột 'SL' hoặc 'Số lượng'"); return; }

          const rows = [];
          for (let i = 1; i < raw.length; i++) {
            const r = raw[i];
            const ma = String(r[colMap.ma_bravo] || "").trim();
            const sl = Number(r[colMap.so_luong]) || 0;
            if (!ma || sl <= 0) continue;
            rows.push({
              nhom_san_pham: colMap.nhom_san_pham != null ? String(r[colMap.nhom_san_pham] || "").trim() : "",
              mien: colMap.mien != null ? String(r[colMap.mien] || "").trim() : "",
              ma_ncc: colMap.ma_ncc != null ? String(r[colMap.ma_ncc] || "").trim() : "",
              ma_bravo: ma,
              ten: colMap.ten != null ? String(r[colMap.ten] || "").trim() : "",
              so_luong: sl,
            });
          }
          if (!rows.length) { setError("Không tìm thấy dòng nào hợp lệ (cần Mã Bravo + SL > 0)"); return; }
          setParsed(rows);
        } catch (ex) { setError("Lỗi đọc file: " + ex.message); }
      };
      reader.readAsArrayBuffer(file);
    };

    const onFileChange = (e) => {
      const f = e.target.files?.[0];
      if (f) parseFile(f);
    };

    const mienGroups = useMemo(() => {
      if (!parsed) return [];
      const set = [...new Set(parsed.map(r => r.mien || "(tất cả miền)"))].sort();
      return set;
    }, [parsed]);

    const doSave = async () => {
      if (!parsed?.length) return;
      setSaving(true);
      try {
        const byMien = {};
        for (const r of parsed) {
          const m = r.mien || "";
          (byMien[m] ??= []).push(r);
        }
        const allResults = [];
        for (const [mien, items] of Object.entries(byMien)) {
          const res = await api("batch_upsert_ngan_sach", {
            nam_tai_chinh: fy,
            mien: mien || null,
            items: items.map(r => ({ ma_bravo: r.ma_bravo, so_luong: r.so_luong })),
          });
          allResults.push(...(res.results || []));
        }
        const errors = allResults.filter(r => r.error);
        if (errors.length)
          alert("Có " + errors.length + " lỗi:\n" + errors.slice(0, 5).map(r => r.ma_bravo + ": " + r.error).join("\n"));
        onDone();
      } catch (e) { alert("Lỗi lưu: " + e.message); }
      setSaving(false);
    };

    return h("div", { className: "space-y-4" },
      h("div", { className: "flex items-center justify-between" },
        h("h2", { className: "text-base font-bold text-slate-900" },
          "Upload ngân sách — FY" + String(fy).slice(-2)),
        h("button", { onClick: onCancel, className: "text-sm text-slate-500 hover:text-slate-700" }, "✕ Đóng"),
      ),

      // File input
      !parsed && h("div", { className: "space-y-3" },
        h("div", { className: "bg-slate-50 border-2 border-dashed border-slate-300 rounded-lg p-8 text-center" },
          h("div", { className: "text-sm text-slate-600 mb-3" },
            "Chọn file Excel (.xlsx / .xls) theo format:"),
          h("div", { className: "inline-block bg-white border border-slate-200 rounded px-4 py-2 text-xs font-mono text-slate-700 mb-4" },
            "Nhóm sản phẩm | Miền | Mã NCC | Mã Bravo | Tên TSCĐ/CCDC | SL"),
          h("div", null,
            h("input", {
              ref: fileRef, type: "file", accept: ".xlsx,.xls",
              className: "hidden", onChange: onFileChange,
            }),
            h("button", {
              onClick: () => fileRef.current?.click(),
              className: btnPrimary,
            }, "Chọn file Excel"),
          ),
        ),
        error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, error),
      ),

      // Preview
      parsed && h("div", { className: "space-y-3" },
        h("div", { className: "text-sm text-slate-600" },
          h("b", null, parsed.length), " dòng hợp lệ",
          mienGroups.length > 1 && [" · miền: ", mienGroups.join(", ")],
        ),
        h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
          h("div", { className: "overflow-x-auto max-h-[420px] overflow-y-auto" },
            h("table", { className: "w-full text-sm" },
              h("thead", { className: "bg-slate-50 border-b border-slate-200 sticky top-0 z-10" },
                h("tr", null,
                  ["#", "Nhóm SP", "Miền", "Mã NCC", "Mã Bravo", "Tên hàng hóa", "SL"].map((c, i) =>
                    h("th", { key: i, className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase" +
                      (c === "SL" ? " text-right" : "") }, c)),
                ),
              ),
              h("tbody", null,
                parsed.map((r, i) =>
                  h("tr", { key: i, className: "border-b border-slate-100" },
                    h("td", { className: cellCls + " text-slate-400 text-xs" }, i + 1),
                    h("td", { className: cellCls + " text-xs" }, r.nhom_san_pham || "—"),
                    h("td", { className: cellCls + " text-xs" }, r.mien || "(tất cả)"),
                    h("td", { className: cellCls + " font-mono text-xs text-slate-500" }, r.ma_ncc || "—"),
                    h("td", { className: cellCls + " font-mono text-xs font-semibold" }, r.ma_bravo),
                    h("td", { className: cellCls + " text-slate-700 max-w-xs truncate" }, r.ten || "—"),
                    h("td", { className: cellCls + " text-right tabular-nums font-bold" }, r.so_luong),
                  ),
                ),
              ),
            ),
          ),
        ),
        h("div", { className: "flex gap-3 justify-end" },
          h("button", {
            onClick: () => { setParsed(null); setError(""); if (fileRef.current) fileRef.current.value = ""; },
            className: btnSecondary, disabled: saving,
          }, "← Chọn file khác"),
          h("button", { onClick: doSave, className: btnPrimary, disabled: saving },
            saving ? "Đang lưu…" : "Lưu " + parsed.length + " dòng"),
        ),
      ),
    );
  }

  // ── Main screen ──────────────────────────────────────────
  function NganSachScreen({ user }) {
    const canWrite = user?.permission?.canWrite;
    const [rows, setRows]       = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState("");
    const [editing, setEditing] = useState(null);
    const [filterFy, setFilterFy] = useState(FY_CURRENT);
    const [showWizard, setShowWizard] = useState(false);
    const [showUpload, setShowUpload] = useState(false);
    const [checkedIds, setCheckedIds] = useState(new Set());
    const [deleting, setDeleting]     = useState(false);

    const fetchData = useCallback(async () => {
      setLoading(true); setError("");
      try {
        const res = await api("list_ngan_sach", {});
        setRows(res.rows || []);
        setCheckedIds(new Set());
      } catch (e) { setError(e.message || String(e)); }
      setLoading(false);
    }, []);
    useEffect(() => { fetchData(); }, [fetchData]);

    const filtered = useMemo(() =>
      filterFy ? rows.filter(r => r.fy === filterFy) : rows,
    [rows, filterFy]);

    const grouped = useMemo(() => {
      const map = {};
      for (const r of filtered) {
        const k = r.nhom_san_pham || "(chưa phân loại)";
        (map[k] ??= []).push(r);
      }
      for (const items of Object.values(map)) {
        items.sort((a, b) =>
          (a.mien || "").localeCompare(b.mien || "")
          || (a.ma_ncc || "").localeCompare(b.ma_ncc || "")
          || (a.ma_bravo || "").localeCompare(b.ma_bravo || ""));
      }
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
    }, [filtered]);

    const totalDK = useMemo(() => filtered.reduce((s, r) => s + Number(r.sl_dang_ky || 0), 0), [filtered]);
    const totalDD = useMemo(() => filtered.reduce((s, r) => s + Number(r.sl_da_dung || 0), 0), [filtered]);

    const startEdit = (r) => setEditing({
      id: r.id, nam_tai_chinh: r.fy,
      ma_bravo: r.ma_bravo, mien: r.mien || "", so_luong: Number(r.sl_dang_ky || 0),
    });
    const cancelEdit = () => setEditing(null);
    const saveEdit = async () => {
      try {
        await api("upsert_ngan_sach", {
          id:            editing.id,
          nam_tai_chinh: Number(editing.nam_tai_chinh),
          ma_bravo:      editing.ma_bravo,
          mien:          editing.mien || null,
          so_luong:      Number(editing.so_luong),
        });
        setEditing(null); fetchData();
      } catch (e) { alert("Lỗi lưu: " + e.message); }
    };
    const del = async (r) => {
      if (!confirm("Xoá đăng ký " + r.ma_bravo + " (SL " + r.sl_dang_ky + ")?")) return;
      try { await api("delete_ngan_sach", { id: r.id }); fetchData(); setCheckedIds(new Set()); }
      catch (e) { alert("Lỗi xoá: " + e.message); }
    };

    const toggleCheck = (id) => setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    const allFilteredIds = useMemo(() => filtered.map(r => r.id), [filtered]);
    const allChecked = allFilteredIds.length > 0 && allFilteredIds.every(id => checkedIds.has(id));
    const toggleCheckAll = () => {
      if (allChecked) setCheckedIds(new Set());
      else setCheckedIds(new Set(allFilteredIds));
    };
    const bulkDel = async () => {
      const ids = [...checkedIds];
      if (!ids.length) return;
      if (!confirm("Xoá " + ids.length + " dòng đăng ký đã chọn?")) return;
      setDeleting(true);
      try {
        await api("delete_ngan_sach", { ids });
        setCheckedIds(new Set());
        fetchData();
      } catch (e) { alert("Lỗi xoá: " + e.message); }
      setDeleting(false);
    };

    const fyOptions = [...new Set(rows.map(r => r.fy))].sort((a, b) => b - a);
    if (!fyOptions.includes(FY_CURRENT)) fyOptions.unshift(FY_CURRENT);

    const statusBadge = (r) => {
      const st = r.trang_thai || "OK";
      const cls = st === "VUOT" ? "bg-red-50 text-red-700"
        : st === "CANH_BAO" ? "bg-amber-50 text-amber-700"
        : "bg-emerald-50 text-emerald-700";
      const label = st === "VUOT" ? "Vượt" : st === "CANH_BAO" ? "Cảnh báo" : "OK";
      return h("span", { className: "inline-flex items-center gap-1" },
        h("span", { className: "px-1.5 py-0.5 rounded text-[10px] font-semibold " + cls }, label),
        h("span", { className: "text-xs tabular-nums text-slate-500" }, (r.pct || 0) + "%"),
      );
    };

    // ── Wizard mode ──
    if (showWizard) {
      return h("div", { className: "p-4 md:p-6" },
        h(AddWizard, {
          fy: filterFy || FY_CURRENT,
          onDone: () => { setShowWizard(false); fetchData(); },
          onCancel: () => setShowWizard(false),
        }),
      );
    }

    // ── Upload mode ──
    if (showUpload) {
      return h("div", { className: "p-4 md:p-6" },
        h(UploadExcel, {
          fy: filterFy || FY_CURRENT,
          onDone: () => { setShowUpload(false); fetchData(); },
          onCancel: () => setShowUpload(false),
        }),
      );
    }

    // ── Main table mode ──
    const cellInput = "w-20 px-2 py-1 text-sm text-right tabular-nums border border-slate-300 rounded outline-none focus:border-blue-400";

    return h("div", { className: "p-4 md:p-6 space-y-4" },
      // Header
      h("div", { className: "flex flex-wrap items-baseline gap-3" },
        h("h1", { className: "text-lg font-bold text-slate-900" }, "Ngân sách đăng ký"),
        h("select", {
          className: "text-sm border border-slate-300 rounded px-2 py-1",
          value: filterFy || "",
          onChange: (e) => setFilterFy(Number(e.target.value) || null),
        },
          h("option", { value: "" }, "Tất cả FY"),
          fyOptions.map(f => h("option", { key: f, value: f }, "FY" + String(f).slice(-2))),
        ),
        h("span", { className: "text-xs text-slate-500" },
          loading ? "đang tải…" : filtered.length + " mã · đăng ký " + totalDK + " bộ · đã dùng " + totalDD + " bộ"),
        canWrite && h("div", { className: "ml-auto flex gap-2" },
          h("button", {
            onClick: () => setShowUpload(true),
            className: btnSecondary,
          }, "Upload Excel"),
          h("button", {
            onClick: () => setShowWizard(true),
            className: btnPrimary,
          }, "+ Thêm đăng ký"),
        ),
      ),

      error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

      // Bulk delete bar
      canWrite && checkedIds.size > 0 && h("div", {
        className: "flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2",
      },
        h("span", { className: "text-sm text-blue-800 font-medium" }, "Đã chọn " + checkedIds.size + " dòng"),
        h("button", {
          onClick: bulkDel, disabled: deleting,
          className: "px-3 py-1 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded disabled:opacity-50",
        }, deleting ? "Đang xoá…" : "Xoá " + checkedIds.size + " dòng"),
        h("button", {
          onClick: () => setCheckedIds(new Set()),
          className: "px-3 py-1 text-xs text-slate-600 hover:underline",
        }, "Bỏ chọn"),
      ),

      // Table
      h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
        h("div", { className: "overflow-x-auto" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50 border-b border-slate-200" },
              h("tr", null,
                canWrite && h("th", { className: "px-3 py-2 w-8" },
                  h("input", { type: "checkbox", checked: allChecked, onChange: toggleCheckAll }),
                ),
                ["Miền", "Mã NCC", "Mã Bravo", "Tên hàng hóa", "SL đăng ký", ""].map((c, i) =>
                  h("th", {
                    key: i,
                    className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide" +
                      (c === "SL đăng ký" ? " text-right" : ""),
                  }, c)),
              ),
            ),
            h("tbody", null,
              filtered.length === 0 && !loading
                ? h("tr", null, h("td", { colSpan: canWrite ? 7 : 6, className: "px-3 py-8 text-center text-sm text-slate-400" },
                    "Chưa có đăng ký ngân sách — bấm '+ Thêm đăng ký'"))
                : grouped.map(([nhom, items]) => [
                    h("tr", { key: "g-" + nhom, className: "bg-slate-50/70" },
                      h("td", { colSpan: canWrite ? 7 : 6, className: "px-3 py-2 text-xs font-bold text-slate-700 uppercase tracking-wide" },
                        nhom,
                        h("span", { className: "ml-3 font-normal normal-case text-slate-500" },
                          items.reduce((s, r) => s + Number(r.sl_dang_ky || 0), 0) + " bộ"),
                        h("span", { className: "ml-2 font-normal normal-case text-slate-400" }, "·"),
                        h("span", { className: "ml-2 font-normal normal-case text-slate-500" },
                          (() => {
                            const tv = items.reduce((s, r) => {
                              const p = r.don_gia_mua != null ? Number(r.don_gia_mua) : null;
                              return p != null ? s + p * Number(r.sl_dang_ky || 0) : s;
                            }, 0);
                            return tv ? tv.toLocaleString("vi-VN") + " ₫" : "—";
                          })()),
                      ),
                    ),
                    ...items.map(r =>
                      editing && editing.id === r.id
                        ? h("tr", { key: r.id, className: "bg-blue-50 border-b border-slate-100" },
                            canWrite && h("td", { className: cellCls }),
                            h("td", { className: cellCls + " text-xs" }, r.mien || "(tất cả)"),
                            h("td", { className: cellCls + " font-mono text-xs" }, r.ma_ncc || "—"),
                            h("td", { className: cellCls + " font-mono text-xs font-semibold" }, r.ma_bravo),
                            h("td", { className: cellCls + " text-slate-500 text-xs" }, r.ten_vat_tu || "—"),
                            h("td", { className: cellCls + " text-right" },
                              h("input", {
                                type: "number", min: 1, className: cellInput,
                                value: editing.so_luong,
                                onChange: e => setEditing({ ...editing, so_luong: Number(e.target.value) || 0 }),
                              }),
                            ),
                            h("td", { className: cellCls + " whitespace-nowrap" },
                              h("button", { onClick: saveEdit, className: "text-xs font-semibold text-blue-600 hover:underline mr-3" }, "Lưu"),
                              h("button", { onClick: cancelEdit, className: "text-xs text-slate-500 hover:underline" }, "Huỷ"),
                            ),
                          )
                        : h("tr", { key: r.id, className: "border-b border-slate-100 hover:bg-slate-50" + (checkedIds.has(r.id) ? " bg-blue-50/50" : "") },
                            canWrite && h("td", { className: cellCls },
                              h("input", { type: "checkbox", checked: checkedIds.has(r.id), onChange: () => toggleCheck(r.id) }),
                            ),
                            h("td", { className: cellCls + " text-slate-600" }, r.mien || h("span", { className: "italic text-slate-400" }, "(tất cả)")),
                            h("td", { className: cellCls + " font-mono text-xs text-slate-500" }, r.ma_ncc || "—"),
                            h("td", { className: cellCls + " font-mono text-xs font-semibold text-slate-800" }, r.ma_bravo),
                            h("td", { className: cellCls + " text-slate-700 max-w-xs truncate", title: r.ten_vat_tu }, r.ten_vat_tu || "—"),
                            h("td", { className: cellCls + " text-right tabular-nums font-semibold" }, r.sl_dang_ky),
                            canWrite
                              ? h("td", { className: cellCls + " whitespace-nowrap" },
                                  h("button", { onClick: () => startEdit(r), disabled: !!editing,
                                    className: "text-xs text-blue-600 hover:underline mr-3 disabled:opacity-40" }, "Sửa"),
                                  h("button", { onClick: () => del(r), disabled: !!editing,
                                    className: "text-xs text-red-600 hover:underline disabled:opacity-40" }, "Xoá"),
                                )
                              : h("td"),
                          )
                    ),
                  ].flat()),
            ),
          ),
        ),
      ),
    );
  }

  window.CCDC_ROUTER.register("/ngan-sach", NganSachScreen);
})();
