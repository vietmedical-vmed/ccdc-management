// Màn Ký gửi — snapshot theo kỳ: upload Excel (full replace nhóm SP × tháng), xem chi tiết, so sánh 2 kỳ.
(function () {
  const { useState, useEffect, useCallback, useRef, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");
  const fmtDate = (d) => !d ? "—" : String(d).slice(0, 10);
  const fmtKy = (d) => { if (!d) return "—"; const [y, m] = String(d).split("-"); return "T" + Number(m) + "/" + y; };
  const pad2 = (n) => String(n).padStart(2, "0");

  const normHeader = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const HEADER_ALIASES = {
    ma_bv:         ["code kh", "mã kh", "code_kh", "mã bv", "ma bv"],
    ten_bv:        ["tên bệnh viện", "tên bv", "bệnh viện"],
    ma_bravo:      ["mã bravo", "ma bravo"],
    ma_ncc:        ["mã ncc", "ma ncc"],
    ten_ccdc:      ["danh mục dụng cụ nsk ký gửi tại bv", "tên ccdc", "danh mục", "tên vật tư", "tên dụng cụ"],
    serial:        ["số lô/ số serial", "số lô/số serial", "serial", "số serial", "sn"],
    dvt:           ["đvt", "đơn vị tính"],
    so_luong:      ["sl", "số lượng"],
    ngay_ky_gui:   ["ngày ký gửi", "ngày kg"],
    ktv_phu_trach: ["ktv phụ trách", "ktv", "pic"],
    note:          ["note", "ghi chú"],
  };
  const ALIAS_TO_FIELD = {};
  for (const [field, list] of Object.entries(HEADER_ALIASES)) for (const a of list) ALIAS_TO_FIELD[a] = field;

  // Ô ngày trong Excel có thể là Date thật hoặc chuỗi "dd/mm/yyyy".
  const parseDate = (v) => {
    if (v == null || v === "") return null;
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + pad2(v.getMonth() + 1) + "-" + pad2(v.getDate());
    const m = String(v).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
    if (m) return m[3] + "-" + pad2(m[2]) + "-" + pad2(m[1]);
    const iso = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : null;
  };
  const cellStr = (v) => (v == null ? "" : String(v).trim());

  const guessNhomSP = (fileName) => {
    const m = fileName.normalize("NFC").match(/_([^_]+)_Ký gửi/i);
    return m ? m[1].trim() : "";
  };
  const guessKy = (fileName) => {
    const m = fileName.match(/(20\d{2})(\d{2})(\d{2})/);
    if (m) return m[1] + "-" + m[2] + "-01";
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-01";
  };

  function parseWorkbook(buf) {
    const XLSX = window.XLSX;
    if (!XLSX) throw new Error("Thư viện XLSX chưa tải xong, thử lại sau vài giây");
    const wb = XLSX.read(buf, { type: "array", cellDates: true });

    let best = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
      for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const colMap = {};
        rows[r].forEach((c, i) => { const f = ALIAS_TO_FIELD[normHeader(c)]; if (f && colMap[f] == null) colMap[f] = i; });
        if (colMap.ten_ccdc != null && (best == null || Object.keys(colMap).length > Object.keys(best.colMap).length))
          best = { name, rows, headerRow: r, colMap };
      }
    }
    if (!best) throw new Error("Không tìm thấy sheet có cột tên dụng cụ (VD: 'Danh mục dụng cụ…', 'Tên CCDC')");

    const { rows, headerRow, colMap } = best;
    const get = (row, f) => colMap[f] == null ? "" : row[colMap[f]];
    const items = [];
    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const ten = cellStr(get(row, "ten_ccdc"));
      if (!ten) continue;
      const slRaw = Number(get(row, "so_luong"));
      items.push({
        ma_bv: cellStr(get(row, "ma_bv")) || null,
        ten_bv: cellStr(get(row, "ten_bv")) || null,
        ma_bravo: cellStr(get(row, "ma_bravo")) || null,
        ma_ncc: cellStr(get(row, "ma_ncc")) || null,
        ten_ccdc: ten,
        serial: cellStr(get(row, "serial")) || null,
        dvt: cellStr(get(row, "dvt")) || null,
        so_luong: slRaw > 0 ? slRaw : 1,
        ngay_ky_gui: parseDate(get(row, "ngay_ky_gui")),
        ktv_phu_trach: cellStr(get(row, "ktv_phu_trach")) || null,
        note: cellStr(get(row, "note")) || null,
      });
    }
    if (!items.length) throw new Error("Sheet '" + best.name + "' không có dòng dữ liệu");

    const warnings = [];
    const noMaBv = items.filter((i) => !i.ma_bv).length;
    if (noMaBv) warnings.push(noMaBv + " dòng thiếu mã BV (không map được miền)");
    const names = {};
    for (const i of items) if (i.ma_bv && i.ten_bv) (names[i.ma_bv] ??= new Set()).add(i.ten_bv);
    const multi = Object.entries(names).filter(([, s]) => s.size > 1);
    if (multi.length) warnings.push(multi.length + " mã BV có nhiều tên khác nhau: " +
      multi.slice(0, 3).map(([k, s]) => k + " (" + [...s].slice(0, 2).join(" / ") + (s.size > 2 ? " / +" + (s.size - 2) + " tên khác" : "") + ")")
        .join("; ") + (multi.length > 3 ? "…" : ""));
    const serials = {};
    for (const i of items) if (i.serial) serials[i.serial] = (serials[i.serial] || 0) + 1;
    const dupSerial = Object.entries(serials).filter(([, n]) => n > 1).map(([s]) => s);
    if (dupSerial.length) warnings.push("Serial trùng: " + dupSerial.slice(0, 5).join(", ") + (dupSerial.length > 5 ? "…" : ""));

    return { sheetName: best.name, items, fields: Object.keys(colMap), warnings };
  }

  // ─── Upload Modal ─────────────────────────────────────────
  function UploadModal({ existing, onClose, onUploaded }) {
    const [file, setFile] = useState(null);
    const [nhomSP, setNhomSP] = useState("");
    const [kyCapNhat, setKyCapNhat] = useState(guessKy(""));
    const [ghiChu, setGhiChu] = useState("");
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState(null);
    const fileRef = useRef(null);

    const pick = async (f) => {
      setFile(f); setError(""); setPreview(null); setResult(null);
      setNhomSP((cur) => cur || guessNhomSP(f.name));
      setKyCapNhat(guessKy(f.name));
      try { setPreview(parseWorkbook(await f.arrayBuffer())); }
      catch (e) { setError(e.message || String(e)); }
    };

    const kyMonth = kyCapNhat.slice(0, 7);
    const willReplace = existing.find((s) => s.nhom_san_pham === nhomSP.trim() && String(s.ky_cap_nhat).slice(0, 7) === kyMonth);

    const submit = async () => {
      setError(""); setBusy(true);
      try {
        if (!nhomSP.trim()) throw new Error("Chưa nhập nhóm sản phẩm");
        const res = await api("snapshot_upload", {
          nhom_san_pham: nhomSP.trim(), ky_cap_nhat: kyCapNhat,
          nguon_file: file.name, ghi_chu: ghiChu || null, items: preview.items,
        });
        onUploaded(res.snapshot_id);
        if (res.bv_chua_map && res.bv_chua_map.length) setResult(res);
        else onClose();
      } catch (e) { setError(e.message || String(e)); }
      setBusy(false);
    };

    const inputCls = "w-full px-2 py-1.5 text-sm border border-slate-300 rounded outline-none focus:border-blue-400";
    const labelCls = "text-xs font-semibold text-slate-600 uppercase tracking-wide";

    return h("div", {
      className: "fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto",
      onClick: (e) => { if (e.target === e.currentTarget && !busy) onClose(); },
    },
      h("div", { className: "bg-white rounded-lg shadow-xl w-full max-w-3xl my-8" },
        h("div", { className: "px-5 py-3 border-b border-slate-200 flex items-center justify-between" },
          h("h2", { className: "text-base font-bold text-slate-900" }, "Upload snapshot ký gửi"),
          h("button", { onClick: onClose, disabled: busy, className: "text-slate-400 hover:text-slate-700 text-xl leading-none" }, "×"),
        ),

        result
          ? h("div", { className: "px-5 py-4 space-y-3" },
              h("div", { className: "bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-3 py-2 rounded" },
                "Đã lưu snapshot " + nhomSP + " " + fmtKy(kyCapNhat) + "."),
              h("div", { className: "bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 rounded" },
                h("div", { className: "font-semibold mb-1" }, result.bv_chua_map.length + " BV không xác định được miền (thiếu mã BV hoặc thiếu area trong danh mục khách hàng):"),
                h("ul", { className: "list-disc pl-5 text-xs space-y-0.5 max-h-48 overflow-y-auto" },
                  result.bv_chua_map.map((b) => h("li", { key: b.ma_bv }, b.ma_bv + (b.ten_bv ? " — " + b.ten_bv : "")))),
                h("div", { className: "text-xs mt-2" }, "Các dòng này không hiện cho tài khoản bị giới hạn miền. Bổ sung mã BV trong file (hoặc area trong danh mục khách hàng) rồi upload lại kỳ này."),
              ),
              h("div", { className: "flex justify-end" },
                h("button", { onClick: onClose, className: "px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded hover:bg-blue-600" }, "Đóng")),
            )
          : h(React.Fragment, null,
        h("div", { className: "px-5 py-4 space-y-4 max-h-[65vh] overflow-y-auto" },
          error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

          h("div", {
            className: "border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30",
            onClick: () => fileRef.current && fileRef.current.click(),
            onDragOver: (e) => e.preventDefault(),
            onDrop: (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); },
          },
            h("input", { ref: fileRef, type: "file", accept: ".xlsx,.xls,.xlsm", className: "hidden",
              onChange: (e) => { if (e.target.files[0]) pick(e.target.files[0]); e.target.value = ""; } }),
            file
              ? h("div", null,
                  h("div", { className: "text-sm font-semibold text-slate-800 break-all" }, file.name),
                  h("div", { className: "text-xs text-slate-500 mt-1" }, (file.size / 1024).toFixed(0) + " KB · bấm để đổi file"))
              : h("div", null,
                  h("div", { className: "text-sm text-slate-500" }, "Kéo thả file hoặc bấm để chọn"),
                  h("div", { className: "text-xs text-slate-400 mt-1" }, ".xlsx / .xls / .xlsm")),
          ),

          h("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-3" },
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Nhóm sản phẩm *"),
              h("input", { className: inputCls, value: nhomSP, placeholder: "VD: NSK Arthrex", list: "kg-nhom-sp",
                onChange: (e) => setNhomSP(e.target.value) }),
              h("datalist", { id: "kg-nhom-sp" },
                [...new Set(existing.map((s) => s.nhom_san_pham))].map((n) => h("option", { key: n, value: n }))),
            ),
            h("div", null,
              h("div", { className: labelCls + " mb-1" }, "Kỳ cập nhật (tháng)"),
              h("input", { type: "month", className: inputCls, value: kyMonth,
                onChange: (e) => e.target.value && setKyCapNhat(e.target.value + "-01") }),
            ),
          ),
          h("div", null,
            h("div", { className: labelCls + " mb-1" }, "Ghi chú"),
            h("input", { className: inputCls, value: ghiChu, placeholder: "Tuỳ chọn", onChange: (e) => setGhiChu(e.target.value) }),
          ),

          willReplace && h("div", { className: "bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2 rounded" },
            "Đã có snapshot " + willReplace.nhom_san_pham + " " + fmtKy(willReplace.ky_cap_nhat) +
            " (" + fmtInt(willReplace.tong_dong) + " dòng). Upload sẽ thay thế toàn bộ."),

          preview && preview.warnings.length > 0 && h("div", { className: "bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded space-y-0.5" },
            h("div", { className: "font-semibold" }, "Cảnh báo dữ liệu (vẫn upload được):"),
            preview.warnings.map((w, i) => h("div", { key: i }, "• " + w))),

          preview && h("div", null,
            h("div", { className: labelCls + " mb-1" },
              "Xem trước: " + fmtInt(preview.items.length) + " dòng · SL " +
              fmtInt(preview.items.reduce((s, i) => s + i.so_luong, 0)) + " · sheet " + preview.sheetName),
            h("div", { className: "border border-slate-200 rounded overflow-auto max-h-60" },
              h("table", { className: "w-full text-xs" },
                h("thead", { className: "bg-slate-50 sticky top-0" },
                  h("tr", null, ["Mã BV", "Tên BV", "Mã Bravo", "Tên CCDC", "Serial", "SL", "Ngày KG", "KTV"].map((c, i) =>
                    h("th", { key: i, className: "px-2 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap" }, c)))),
                h("tbody", null,
                  preview.items.slice(0, 30).map((it, i) => h("tr", { key: i, className: "border-t border-slate-100" },
                    h("td", { className: "px-2 py-1 font-mono text-slate-600 whitespace-nowrap" }, it.ma_bv || "—"),
                    h("td", { className: "px-2 py-1 text-slate-700 max-w-[180px] truncate" }, it.ten_bv || "—"),
                    h("td", { className: "px-2 py-1 font-mono text-slate-900 whitespace-nowrap" }, it.ma_bravo || "—"),
                    h("td", { className: "px-2 py-1 text-slate-800 max-w-[200px] truncate" }, it.ten_ccdc),
                    h("td", { className: "px-2 py-1 font-mono text-slate-600 whitespace-nowrap" }, it.serial || "—"),
                    h("td", { className: "px-2 py-1 text-right tabular-nums" }, it.so_luong),
                    h("td", { className: "px-2 py-1 whitespace-nowrap" }, fmtDate(it.ngay_ky_gui)),
                    h("td", { className: "px-2 py-1 text-slate-600 whitespace-nowrap" }, it.ktv_phu_trach || "—"))),
                  preview.items.length > 30 && h("tr", null, h("td", { colSpan: 8, className: "px-2 py-2 text-center text-slate-400" },
                    "… và " + (preview.items.length - 30) + " dòng nữa")),
                ),
              ),
            ),
          ),
        ),

        h("div", { className: "px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50" },
          h("button", { onClick: onClose, disabled: busy, className: "px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded" }, "Huỷ"),
          h("button", {
            onClick: submit, disabled: busy || !preview || !nhomSP.trim(),
            className: "px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50",
          }, busy ? "Đang lưu…" : willReplace ? "Thay thế snapshot" : "Lưu snapshot"),
        ),
          ),
      ),
    );
  }

  // ─── So sánh 2 kỳ ─────────────────────────────────────────
  const DIFF_META = {
    added:   { label: "Thêm mới", badge: "bg-emerald-50 text-emerald-700", card: "bg-emerald-50 border-emerald-200 text-emerald-700" },
    removed: { label: "Thu hồi",  badge: "bg-red-50 text-red-700",         card: "bg-red-50 border-red-200 text-red-700" },
    moved:   { label: "Chuyển BV", badge: "bg-amber-50 text-amber-700",    card: "bg-amber-50 border-amber-200 text-amber-700" },
  };

  function DiffView({ idOld, idNew }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [only, setOnly] = useState("");

    useEffect(() => {
      let alive = true;
      setData(null); setError("");
      api("snapshot_diff", { snapshot_id_old: idOld, snapshot_id_new: idNew })
        .then((r) => alive && setData(r))
        .catch((e) => alive && setError(e.message || String(e)));
      return () => { alive = false; };
    }, [idOld, idNew]);

    if (error) return h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error);
    if (!data) return h("div", { className: "p-4 text-sm text-slate-500" }, "Đang so sánh…");

    const rows = ["added", "removed", "moved"].flatMap((k) => (data[k] || []).map((r) => ({ ...r, _k: k })))
      .filter((r) => !only || r._k === only);
    const slOf = { added: data.summary.sl_added, removed: data.summary.sl_removed, moved: data.summary.sl_moved };
    const bvLabel = (ma, ten) => ma && ten ? ma + " · " + ten : ten || ma || "—";

    return h("div", { className: "space-y-3" },
      h("div", { className: "grid grid-cols-3 gap-3" },
        ["added", "removed", "moved"].map((k) => h("button", {
          key: k, onClick: () => setOnly(only === k ? "" : k),
          className: "border rounded-lg px-4 py-3 text-center " + DIFF_META[k].card + (only === k ? " ring-2 ring-offset-1 ring-blue-400" : ""),
        },
          h("div", { className: "text-2xl font-bold tabular-nums" }, fmtInt((data[k] || []).length)),
          h("div", { className: "text-xs font-semibold uppercase mt-1" }, DIFF_META[k].label + " · SL " + fmtInt(slOf[k])),
        ))),

      rows.length === 0
        ? h("div", { className: "bg-white border border-slate-200 rounded-lg text-center text-sm text-slate-400 py-8" }, "Không có thay đổi")
        : h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-x-auto" },
            h("table", { className: "w-full text-sm" },
              h("thead", { className: "bg-slate-50" },
                h("tr", null, ["Thay đổi", "Tên CCDC", "Mã Bravo", "Serial", "SL", "Bệnh viện", "KTV"].map((c, i) =>
                  h("th", { key: i, className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase whitespace-nowrap" }, c)))),
              h("tbody", null,
                rows.map((r, i) => h("tr", { key: i, className: "border-t border-slate-100 align-top" },
                  h("td", { className: "px-3 py-2" },
                    h("span", { className: "inline-block px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap " + DIFF_META[r._k].badge }, DIFF_META[r._k].label)),
                  h("td", { className: "px-3 py-2 text-slate-800" }, r.ten_ccdc || "—"),
                  h("td", { className: "px-3 py-2 font-mono text-xs whitespace-nowrap" }, r.ma_bravo || "—"),
                  h("td", { className: "px-3 py-2 font-mono text-xs whitespace-nowrap" }, r.serial || "—"),
                  h("td", { className: "px-3 py-2 text-right tabular-nums" }, fmtInt(r.so_luong)),
                  h("td", { className: "px-3 py-2 text-slate-700" },
                    r._k === "moved"
                      ? h("span", null, h("span", { className: "text-slate-400" }, bvLabel(r.tu_ma_bv, r.tu_ten_bv)), " → ", bvLabel(r.ma_bv, r.ten_bv))
                      : bvLabel(r.ma_bv, r.ten_bv)),
                  h("td", { className: "px-3 py-2 text-slate-600 whitespace-nowrap" },
                    r._k === "moved" && (r.tu_ktv || "") !== (r.ktv_phu_trach || "")
                      ? (r.tu_ktv || "—") + " → " + (r.ktv_phu_trach || "—")
                      : r.ktv_phu_trach || "—"),
                ))),
            )),
    );
  }

  // ─── Chi tiết 1 snapshot (nhóm theo BV) ───────────────────
  function SnapshotDetail({ snapId }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [searchApplied, setSearchApplied] = useState("");
    const [collapsed, setCollapsed] = useState({});
    const debounceRef = useRef(null);

    useEffect(() => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchApplied(search.trim()), 300);
      return () => clearTimeout(debounceRef.current);
    }, [search]);

    useEffect(() => {
      let alive = true;
      setLoading(true); setError("");
      api("snapshot_items", { snapshot_id: snapId, search: searchApplied })
        .then((r) => { if (alive) { setItems(r.rows || []); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e.message || String(e)); setLoading(false); } });
      return () => { alive = false; };
    }, [snapId, searchApplied]);

    const grouped = useMemo(() => {
      const map = {};
      for (const r of items) {
        const k = r.ten_bv || r.ma_bv || "Không rõ BV";
        (map[k] ??= { ma_bv: r.ma_bv, mien: r.mien, rows: [] }).rows.push(r);
      }
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "vi"));
    }, [items]);

    return h("div", { className: "space-y-3" },
      h("div", { className: "flex items-center gap-3 flex-wrap" },
        h("div", { className: "relative flex-1 min-w-[200px] max-w-sm" },
          h("input", {
            type: "search", value: search, onChange: (e) => setSearch(e.target.value),
            placeholder: "Tìm BV / mã / tên / serial / KTV…",
            className: "w-full pl-3 pr-8 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400",
          })),
        h("span", { className: "text-xs text-slate-500" },
          loading ? "đang tải…" : fmtInt(items.length) + " dòng · " + grouped.length + " BV"),
      ),
      error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

      grouped.map(([bv, g]) => {
        const isCol = collapsed[bv];
        const sl = g.rows.reduce((s, r) => s + Number(r.so_luong || 0), 0);
        return h("div", { key: bv, className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
          h("div", {
            className: "px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 cursor-pointer hover:bg-slate-100",
            onClick: () => setCollapsed((c) => ({ ...c, [bv]: !c[bv] })),
          },
            h("div", { className: "flex items-center gap-2 min-w-0" },
              h("span", { className: "text-slate-400 text-xs w-4 text-center shrink-0" }, isCol ? "▶" : "▼"),
              g.ma_bv && h("span", { className: "font-mono text-xs text-slate-500 shrink-0" }, g.ma_bv),
              h("span", { className: "font-semibold text-slate-800 text-sm truncate" }, bv),
              h("span", { className: "text-[11px] text-slate-500 shrink-0" }, g.mien || "chưa map miền"),
            ),
            h("span", { className: "text-xs text-slate-600 shrink-0" },
              g.rows.length + " dòng · SL ", h("span", { className: "font-semibold tabular-nums" }, fmtInt(sl))),
          ),
          !isCol && h("div", { className: "overflow-x-auto" },
            h("table", { className: "w-full text-sm" },
              h("thead", { className: "border-b border-slate-100" },
                h("tr", null, ["Mã Bravo", "Mã NCC", "Tên CCDC", "Serial", "ĐVT", "SL", "Ngày KG", "KTV", "Note"].map((c, i) =>
                  h("th", { key: i, className: "px-3 py-1.5 text-left text-[11px] font-semibold text-slate-500 uppercase whitespace-nowrap" }, c)))),
              h("tbody", null,
                g.rows.map((r) => h("tr", { key: r.id, className: "border-b border-slate-100 last:border-0 hover:bg-blue-50/30" },
                  h("td", { className: "px-3 py-1.5 font-mono text-xs text-slate-900 whitespace-nowrap" }, r.ma_bravo || "—"),
                  h("td", { className: "px-3 py-1.5 font-mono text-xs text-slate-600 whitespace-nowrap" }, r.ma_ncc || "—"),
                  h("td", { className: "px-3 py-1.5 text-slate-800" }, r.ten_ccdc),
                  h("td", { className: "px-3 py-1.5 font-mono text-xs text-slate-600 whitespace-nowrap" }, r.serial || "—"),
                  h("td", { className: "px-3 py-1.5 text-xs text-slate-600" }, r.dvt || "—"),
                  h("td", { className: "px-3 py-1.5 text-right tabular-nums font-semibold" }, fmtInt(r.so_luong)),
                  h("td", { className: "px-3 py-1.5 text-xs text-slate-600 whitespace-nowrap" }, fmtDate(r.ngay_ky_gui)),
                  h("td", { className: "px-3 py-1.5 text-slate-700 whitespace-nowrap" }, r.ktv_phu_trach || "—"),
                  h("td", { className: "px-3 py-1.5 text-xs text-slate-500" }, r.note || "—"),
                ))),
            )),
        );
      }),
    );
  }

  // ────────────────────────────────────────────────────────────────
  // MÀN KÝ GỬI
  // ────────────────────────────────────────────────────────────────
  function KyGuiScreen({ user }) {
    const canWrite = user?.permission?.canWrite;
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [nhom, setNhom] = useState("");
    const [selId, setSelId] = useState(null);
    const [mode, setMode] = useState("detail");
    const [oldId, setOldId] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);

    const load = useCallback(async (focusId) => {
      setLoading(true); setError("");
      try {
        const res = await api("snapshot_list");
        const rows = res.rows || [];
        setSnapshots(rows);
        const focus = rows.find((s) => s.id === focusId);
        if (focus) { setNhom(focus.nhom_san_pham); setSelId(focus.id); }
        else setNhom((cur) => cur || (rows[0] && rows[0].nhom_san_pham) || "");
      } catch (e) { setError(e.message || String(e)); }
      setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const nhomOptions = useMemo(() => [...new Set(snapshots.map((s) => s.nhom_san_pham))].sort(), [snapshots]);
    const ofNhom = useMemo(() => snapshots.filter((s) => s.nhom_san_pham === nhom), [snapshots, nhom]);

    // Giữ lựa chọn hợp lệ khi đổi nhóm SP: kỳ mới nhất, so với kỳ liền trước
    useEffect(() => {
      if (!ofNhom.length) { setSelId(null); setOldId(null); return; }
      const cur = ofNhom.findIndex((s) => s.id === selId);
      const idx = cur >= 0 ? cur : 0;
      if (cur < 0) setSelId(ofNhom[0].id);
      if (!ofNhom.some((s) => s.id === oldId && s.id !== ofNhom[idx].id))
        setOldId(ofNhom[idx + 1] ? ofNhom[idx + 1].id : null);
    }, [ofNhom, selId]);

    const sel = "px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400";
    const selSnap = ofNhom.find((s) => s.id === selId);

    return h("div", { className: "p-4 md:p-6 space-y-4" },
      h("div", { className: "flex items-baseline gap-3 flex-wrap" },
        h("h1", { className: "text-lg font-bold text-slate-900" }, "Ký gửi"),
        h("span", { className: "text-xs text-slate-500" }, loading ? "đang tải…" : fmtInt(snapshots.length) + " snapshot"),
        canWrite && h("button", {
          onClick: () => setModalOpen(true),
          className: "ml-auto px-3 py-1.5 text-xs font-semibold rounded bg-blue-500 text-white hover:bg-blue-600",
        }, "+ Upload snapshot"),
      ),
      error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

      !loading && snapshots.length === 0
        ? h("div", { className: "bg-white border border-slate-200 rounded-lg px-6 py-12 text-center text-sm text-slate-400" },
            "Chưa có snapshot nào", canWrite ? " — bấm \"Upload snapshot\" để tải file Excel ký gửi." : ".")
        : h(React.Fragment, null,
            h("div", { className: "flex flex-wrap items-center gap-2" },
              h("select", { className: sel, value: nhom, onChange: (e) => setNhom(e.target.value) },
                nhomOptions.map((n) => h("option", { key: n, value: n }, n))),
              h("div", { className: "flex items-center gap-1 bg-white border border-slate-200 rounded-md p-0.5 ml-auto" },
                [["detail", "Chi tiết"], ["diff", "So sánh kỳ"]].map(([k, label]) => h("button", {
                  key: k, onClick: () => setMode(k),
                  className: "px-3 py-1 text-xs font-semibold rounded " + (mode === k ? "bg-blue-500 text-white" : "text-slate-600 hover:bg-slate-100"),
                }, label))),
            ),

            h("div", { className: "flex gap-2 overflow-x-auto pb-1" },
              ofNhom.map((s) => h("button", {
                key: s.id, onClick: () => setSelId(s.id),
                className: "shrink-0 px-3 py-2 rounded-lg border text-left " +
                  (s.id === selId ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-300"),
              },
                h("div", { className: "text-sm font-semibold text-slate-800" }, fmtKy(s.ky_cap_nhat)),
                h("div", { className: "text-[11px] text-slate-500 mt-0.5 whitespace-nowrap" },
                  fmtInt(s.tong_dong) + " dòng · SL " + fmtInt(s.tong_sl)),
              ))),

            selSnap && mode === "detail" && h(SnapshotDetail, { key: selSnap.id, snapId: selSnap.id }),

            selSnap && mode === "diff" && h("div", { className: "space-y-3" },
              h("div", { className: "flex items-center gap-2 flex-wrap text-sm text-slate-600" },
                "So",
                h("select", { className: sel, value: oldId || "", onChange: (e) => setOldId(Number(e.target.value) || null) },
                  h("option", { value: "" }, "-- chọn kỳ cũ --"),
                  ofNhom.filter((s) => s.id !== selId).map((s) => h("option", { key: s.id, value: s.id }, fmtKy(s.ky_cap_nhat)))),
                "→", h("b", { className: "text-slate-900" }, fmtKy(selSnap.ky_cap_nhat)),
                h("span", { className: "text-xs text-slate-400" }, "(bấm thẻ kỳ ở trên để đổi kỳ mới)"),
              ),
              oldId
                ? h(DiffView, { key: oldId + "-" + selId, idOld: oldId, idNew: selId })
                : h("div", { className: "bg-white border border-slate-200 rounded-lg text-center text-sm text-slate-400 py-8" },
                    ofNhom.length < 2 ? "Cần ít nhất 2 kỳ của nhóm " + nhom + " để so sánh" : "Chọn kỳ cũ để so sánh"),
            ),
          ),

      modalOpen && h(UploadModal, {
        existing: snapshots,
        onClose: () => setModalOpen(false),
        onUploaded: (id) => load(id),
      }),
    );
  }

  window.CCDC_ROUTER.register("/ky-gui", KyGuiScreen);
})();
