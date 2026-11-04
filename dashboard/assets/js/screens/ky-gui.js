// Màn Chi tiết theo kỳ — snapshot ký gửi: upload Excel (full replace nhóm SP × tháng), xem chi tiết, so sánh 2 kỳ.
(function () {
  const { useState, useEffect, useRef, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const R = window.CCDC_ROUTER;
  const { useKgFilters, KgFilters, invalidateSnapshots } = window.CCDC_KG;
  const UI = window.CCDC_UI;
  const { fmtInt, fmtKy, fmtDate, fyOf, fyLabel, useReload, I, StatCard, Panel, Badge, Segmented, SearchInput,
    LoadingBlock, RefreshingBar, ErrorBox, Empty, Modal, T, btn, input, fieldLabel } = UI;

  const pad2 = (n) => String(n).padStart(2, "0");

  // ─── Đọc file Excel ký gửi ───────────────────────────────
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

  // ─── Upload ──────────────────────────────────────────────
  function UploadModal({ existing, defaultNhom, onClose, onUploaded }) {
    const [file, setFile] = useState(null);
    const [nhomSP, setNhomSP] = useState(defaultNhom || "");
    const [kyCapNhat, setKyCapNhat] = useState(guessKy(""));
    const [ghiChu, setGhiChu] = useState("");
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState(null);
    const fileRef = useRef(null);

    const pick = async (f) => {
      setFile(f); setError(""); setPreview(null); setResult(null);
      const g = guessNhomSP(f.name);
      if (g) setNhomSP(g);
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
        onUploaded(nhomSP.trim(), kyCapNhat);
        if (res.bv_chua_map && res.bv_chua_map.length) setResult(res);
        else onClose();
      } catch (e) { setError(e.message || String(e)); }
      setBusy(false);
    };

    return h(Modal, { open: true, onClose, busy, width: 820, title: "Upload snapshot ký gửi", icon: h(I.Upload, { size: 16, className: "text-blue-600" }) },
      result
        ? h("div", { className: "space-y-3 px-4 py-4" },
            h("div", { className: "flex items-center gap-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] text-blue-700" },
              h(I.Check, { size: 14 }), "Đã lưu snapshot " + nhomSP + " " + fmtKy(kyCapNhat) + "."),
            h("div", { className: "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800" },
              h("div", { className: "mb-1 flex items-center gap-1.5 font-semibold" }, h(I.AlertTriangle, { size: 14 }),
                result.bv_chua_map.length + " BV không xác định được miền (thiếu mã BV, hoặc chưa khai báo địa bàn cho nhóm SP này):"),
              h("ul", { className: "max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-[12px]" },
                result.bv_chua_map.map((b) => h("li", { key: b.ma_bv }, b.ma_bv + (b.ten_bv ? " — " + b.ten_bv : "")))),
              h("div", { className: "mt-2 text-[12px]" }, "Các dòng này không hiện cho tài khoản bị giới hạn miền. Bổ sung mã BV trong file, hoặc khai báo địa bàn bên Kế hoạch kinh doanh, rồi upload lại kỳ này.")),
            h("div", { className: "flex justify-end" }, h("button", { type: "button", onClick: onClose, className: btn.primary }, "Đóng")))
        : h(React.Fragment, null,
            h("div", { className: "max-h-[65vh] space-y-4 overflow-y-auto px-4 py-4" },
              error && h(ErrorBox, null, error),
              h("div", {
                className: "cursor-pointer rounded-lg border-2 border-dashed border-slate-300 p-6 text-center hover:border-blue-400 hover:bg-blue-50/30",
                onClick: () => fileRef.current && fileRef.current.click(),
                onDragOver: (e) => e.preventDefault(),
                onDrop: (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); },
              },
                h("input", { ref: fileRef, type: "file", accept: ".xlsx,.xls,.xlsm", className: "hidden",
                  onChange: (e) => { if (e.target.files[0]) pick(e.target.files[0]); e.target.value = ""; } }),
                h(I.Upload, { size: 20, className: "mx-auto mb-1.5 text-slate-400" }),
                file
                  ? h("div", null,
                      h("div", { className: "break-all text-[13px] font-semibold text-slate-800" }, file.name),
                      h("div", { className: "mt-0.5 text-[11px] text-slate-400" }, (file.size / 1024).toFixed(0) + " KB · bấm để đổi file"))
                  : h("div", null,
                      h("div", { className: "text-[13px] text-slate-600" }, "Kéo thả file hoặc bấm để chọn"),
                      h("div", { className: "mt-0.5 text-[11px] text-slate-400" }, ".xlsx / .xls / .xlsm"))),

              h("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2" },
                h("label", null, h("span", { className: fieldLabel }, "Nhóm sản phẩm *"),
                  h("input", { className: input, value: nhomSP, placeholder: "VD: NSK Arthrex", list: "kg-nhom-sp", onChange: (e) => setNhomSP(e.target.value) }),
                  h("datalist", { id: "kg-nhom-sp" }, [...new Set(existing.map((s) => s.nhom_san_pham))].map((n) => h("option", { key: n, value: n })))),
                h("label", null, h("span", { className: fieldLabel }, "Kỳ cập nhật (tháng)"),
                  h("input", { type: "month", className: input, value: kyMonth, onChange: (e) => e.target.value && setKyCapNhat(e.target.value + "-01") }))),
              h("label", { className: "block" }, h("span", { className: fieldLabel }, "Ghi chú"),
                h("input", { className: input, value: ghiChu, placeholder: "Tuỳ chọn", onChange: (e) => setGhiChu(e.target.value) })),

              willReplace && h("div", { className: "flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800" },
                h(I.AlertTriangle, { size: 14 }),
                "Đã có snapshot " + willReplace.nhom_san_pham + " " + fmtKy(willReplace.ky_cap_nhat) + " (" + fmtInt(willReplace.tong_dong) + " dòng). Upload sẽ thay thế toàn bộ."),

              preview && preview.warnings.length > 0 && h("div", { className: "space-y-0.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800" },
                h("div", { className: "font-semibold" }, "Cảnh báo dữ liệu (vẫn upload được):"),
                preview.warnings.map((w, i) => h("div", { key: i }, "• " + w))),

              preview && h("div", null,
                h("div", { className: "mb-1 text-[12px] text-slate-500" },
                  h("b", { className: "font-semibold text-slate-800" }, fmtInt(preview.items.length) + " dòng"),
                  " · SL " + fmtInt(preview.items.reduce((s, i) => s + i.so_luong, 0)) + " · sheet " + preview.sheetName),
                h("div", { className: "scroll-shadow max-h-60 overflow-auto rounded-md border border-slate-200" },
                  h("table", { className: T.table + " text-[12px]" },
                    h("thead", { className: "sticky top-0" }, h("tr", { className: T.headRow },
                      ["Mã BV", "Tên BV", "Mã Bravo", "Tên CCDC", "Serial", "SL", "Ngày KG", "KTV"].map((c, i) =>
                        h("th", { key: c, className: T.th(i === 5) }, c)))),
                    h("tbody", null,
                      preview.items.slice(0, 30).map((it, i) => h("tr", { key: i, className: T.row(i) },
                        h("td", { className: "whitespace-nowrap px-3 py-1 font-mono text-slate-600" }, it.ma_bv || "—"),
                        h("td", { className: "max-w-[180px] truncate px-3 py-1 text-slate-700" }, it.ten_bv || "—"),
                        h("td", { className: "whitespace-nowrap px-3 py-1 font-mono text-slate-800" }, it.ma_bravo || "—"),
                        h("td", { className: "max-w-[220px] truncate px-3 py-1 text-slate-800" }, it.ten_ccdc),
                        h("td", { className: "whitespace-nowrap px-3 py-1 font-mono text-slate-600" }, it.serial || "—"),
                        h("td", { className: "px-3 py-1 text-right tabular-nums" }, it.so_luong),
                        h("td", { className: "whitespace-nowrap px-3 py-1 tabular-nums" }, fmtDate(it.ngay_ky_gui)),
                        h("td", { className: "whitespace-nowrap px-3 py-1 text-slate-600" }, it.ktv_phu_trach || "—"))),
                      preview.items.length > 30 && h("tr", null, h("td", { colSpan: 8, className: "px-3 py-2 text-center text-slate-400" },
                        "… và " + (preview.items.length - 30) + " dòng nữa"))))))),
            h("div", { className: "flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3" },
              h("button", { type: "button", onClick: onClose, disabled: busy, className: btn.secondary }, "Huỷ"),
              h("button", { type: "button", onClick: submit, disabled: busy || !preview || !nhomSP.trim(), className: btn.primary },
                busy ? h(I.Loader2, { size: 14, className: "animate-spin" }) : h(I.Upload, { size: 14 }),
                busy ? "Đang lưu…" : willReplace ? "Thay thế snapshot" : "Lưu snapshot"))));
  }

  // ─── So sánh 2 kỳ ─────────────────────────────────────────
  const DIFF_META = {
    added:   { label: "Thêm mới",  tone: "blue",  swatch: "bg-blue-500" },
    removed: { label: "Thu hồi",   tone: "red",   swatch: "bg-red-500" },
    moved:   { label: "Chuyển BV", tone: "amber", swatch: "bg-amber-500" },
  };
  const bvLabel = (ma, ten) => ma && ten ? ma + " · " + ten : ten || ma || "—";

  function DiffView({ idOld, idNew, mien, reload }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [only, setOnly] = useState("");

    useEffect(() => {
      let alive = true;
      setError("");
      api("snapshot_diff", { snapshot_id_old: idOld, snapshot_id_new: idNew, mien })
        .then((r) => alive && setData(r))
        .catch((e) => alive && setError(e.message || String(e)));
      return () => { alive = false; };
    }, [idOld, idNew, mien.join("|"), reload]);

    if (error) return h(LoadingBlock, { error });
    if (!data) return h(LoadingBlock);

    const rows = ["added", "removed", "moved"].flatMap((k) => (data[k] || []).map((r) => ({ ...r, _k: k })))
      .filter((r) => !only || r._k === only);
    const slOf = { added: data.summary.sl_added, removed: data.summary.sl_removed, moved: data.summary.sl_moved };

    return h("div", { className: "space-y-3" },
      h("div", { className: "grid grid-cols-3 gap-3" },
        ["added", "removed", "moved"].map((k) => h(StatCard, {
          key: k, label: DIFF_META[k].label, swatch: DIFF_META[k].swatch, value: fmtInt((data[k] || []).length) + " dòng",
          sub: "SL " + fmtInt(slOf[k]) + (only === k ? " · đang lọc" : " · bấm để lọc"),
          onClick: () => setOnly(only === k ? "" : k), active: only === k,
        }))),
      h(Panel, { title: "Thay đổi giữa 2 kỳ", subtitle: fmtInt(rows.length) + " dòng" },
        rows.length === 0
          ? h("div", { className: "px-4 py-8 text-center text-[13px] text-slate-400" }, "Không có thay đổi")
          : h("div", { className: "scroll-shadow overflow-x-auto" },
              h("table", { className: T.table + " min-w-[900px]" },
                h("thead", null, h("tr", { className: T.headRow },
                  ["Thay đổi", "Tên CCDC", "Mã Bravo", "Serial", "SL", "Bệnh viện", "KTV"].map((c, i) => h("th", { key: c, className: T.th(i === 4) }, c)))),
                h("tbody", null, rows.map((r, i) => h("tr", { key: i, className: T.row(i) + " align-top" },
                  h("td", { className: T.td }, h(Badge, { tone: DIFF_META[r._k].tone }, DIFF_META[r._k].label)),
                  h("td", { className: T.td + " text-slate-800" }, r.ten_ccdc || "—"),
                  h("td", { className: T.td + " whitespace-nowrap font-mono text-[12px]" }, r.ma_bravo || "—"),
                  h("td", { className: T.td + " whitespace-nowrap font-mono text-[12px]" }, r.serial || "—"),
                  h("td", { className: T.num }, fmtInt(r.so_luong)),
                  h("td", { className: T.td + " text-slate-700" },
                    r._k === "moved"
                      ? h("span", null, h("span", { className: "text-slate-400" }, bvLabel(r.tu_ma_bv, r.tu_ten_bv)), " → ", bvLabel(r.ma_bv, r.ten_bv))
                      : bvLabel(r.ma_bv, r.ten_bv)),
                  h("td", { className: T.td + " whitespace-nowrap text-slate-600" },
                    r._k === "moved" && (r.tu_ktv || "") !== (r.ktv_phu_trach || "")
                      ? (r.tu_ktv || "—") + " → " + (r.ktv_phu_trach || "—")
                      : r.ktv_phu_trach || "—"))))))),
    );
  }

  // ─── Chi tiết 1 snapshot (nhóm theo BV) ───────────────────
  function SnapshotDetail({ snapId, mien, reload }) {
    const [items, setItems] = useState(null);
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
      setError("");
      api("snapshot_items", { snapshot_id: snapId, search: searchApplied, mien })
        .then((r) => alive && setItems(r.rows || []))
        .catch((e) => alive && setError(e.message || String(e)));
      return () => { alive = false; };
    }, [snapId, searchApplied, mien.join("|"), reload]);

    const grouped = useMemo(() => {
      const map = {};
      for (const r of items || []) {
        const k = r.ten_bv || r.ma_bv || "Không rõ BV";
        (map[k] ??= { ma_bv: r.ma_bv, mien: r.mien, rows: [] }).rows.push(r);
      }
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "vi"));
    }, [items]);
    const allCollapsed = grouped.length > 0 && grouped.every(([k]) => collapsed[k]);

    return h(Panel, {
      title: "Danh sách CCDC ký gửi",
      subtitle: items ? fmtInt(items.length) + " dòng · " + grouped.length + " bệnh viện · SL " + fmtInt((items || []).reduce((s, r) => s + Number(r.so_luong || 0), 0)) : "",
      right: h("div", { className: "flex items-center gap-2" },
        h(SearchInput, { value: search, onChange: setSearch, placeholder: "Tìm BV, mã, tên, serial, KTV…", className: "w-64" }),
        grouped.length > 0 && h("button", { type: "button", className: btn.link,
          onClick: () => setCollapsed(allCollapsed ? {} : Object.fromEntries(grouped.map(([k]) => [k, true]))) },
          allCollapsed ? "Mở tất cả" : "Thu gọn tất cả")),
    },
      error ? h("div", { className: "p-4" }, h(LoadingBlock, { error }))
      : !items ? h(LoadingBlock)
      : h("div", { className: "scroll-shadow overflow-x-auto" },
          h("table", { className: T.table + " min-w-[1000px]" },
            h("thead", null, h("tr", { className: T.headRow },
              ["Mã Bravo", "Mã NCC", "Tên CCDC", "Serial", "ĐVT", "SL", "Ngày KG", "KTV", "Note"].map((c, i) => h("th", { key: c, className: T.th(i === 5) }, c)))),
            h("tbody", null,
              grouped.length === 0
                ? h("tr", null, h("td", { colSpan: 9, className: "px-3 py-8 text-center text-slate-400" }, "Không có dòng nào khớp"))
                : grouped.flatMap(([bv, g]) => {
                    const isCol = collapsed[bv];
                    const sl = g.rows.reduce((s, r) => s + Number(r.so_luong || 0), 0);
                    return [
                      h("tr", { key: "g|" + bv, onClick: () => setCollapsed((c) => ({ ...c, [bv]: !c[bv] })),
                        className: "cursor-pointer select-none border-t border-slate-200 bg-slate-50 hover:bg-blue-50/40" },
                        h("td", { colSpan: 9, className: "px-3 py-1.5" },
                          h("div", { className: "flex items-center gap-2" },
                            h("span", { className: "inline-block w-3 text-slate-400", style: { transform: isCol ? "none" : "rotate(90deg)", transition: "transform 120ms" } }, "▸"),
                            g.ma_bv && h("span", { className: "font-mono text-[11px] text-slate-400" }, g.ma_bv),
                            h("span", { className: "font-semibold text-slate-800" }, bv),
                            g.mien ? h("span", { className: "text-[11px] text-slate-400" }, g.mien) : h(Badge, { tone: "amber" }, "chưa xác định miền"),
                            h("span", { className: "text-[12px] text-slate-500" }, "· " + g.rows.length + " dòng · SL ", h("b", { className: "font-semibold tabular-nums text-slate-800" }, fmtInt(sl)))))),
                      ...(isCol ? [] : g.rows.map((r, i) => h("tr", { key: r.id, className: T.row(i) },
                        h("td", { className: "whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-slate-800" }, r.ma_bravo || "—"),
                        h("td", { className: "whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-slate-500" }, r.ma_ncc || "—"),
                        h("td", { className: "px-3 py-1.5 text-slate-800" }, r.ten_ccdc),
                        h("td", { className: "whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-slate-600" }, r.serial || "—"),
                        h("td", { className: "px-3 py-1.5 text-[12px] text-slate-500" }, r.dvt || "—"),
                        h("td", { className: "px-3 py-1.5 text-right font-semibold tabular-nums" }, fmtInt(r.so_luong)),
                        h("td", { className: "whitespace-nowrap px-3 py-1.5 tabular-nums text-slate-600" }, fmtDate(r.ngay_ky_gui)),
                        h("td", { className: "whitespace-nowrap px-3 py-1.5 text-slate-700" }, r.ktv_phu_trach || "—"),
                        h("td", { className: "px-3 py-1.5 text-[12px] text-slate-500" }, r.note || "—")))),
                    ];
                  })))));
  }

  // ────────────────────────────────────────────────────────────────
  function KyGuiScreen({ user }) {
    const canWrite = user?.permission?.canWrite;
    const f = useKgFilters(user, { requireNhom: true });
    const reload = useReload();
    const q = R.useQuery();
    const [modalOpen, setModalOpen] = useState(false);
    const mode = q.get("xem") === "so-sanh" ? "diff" : "detail";

    const ofNhom = f.snapshots.filter((s) => s.nhom_san_pham === f.nhom)
      .sort((a, b) => String(b.ky_cap_nhat).localeCompare(String(a.ky_cap_nhat)));
    const inFy = ofNhom.filter((s) => Number(s.fiscal_year) === f.fy);
    const kyParam = q.get("ky");
    const sel = inFy.find((s) => String(s.ky_cap_nhat).slice(0, 7) === kyParam) || inFy[0] || null;
    const selIdx = sel ? ofNhom.indexOf(sel) : -1;
    const cuParam = q.get("so-voi");
    const old = ofNhom.find((s) => String(s.ky_cap_nhat).slice(0, 7) === cuParam && s !== sel) || ofNhom[selIdx + 1] || null;

    const filters = h(KgFilters, { f });
    const toolbar = h("div", { className: "flex flex-wrap items-center gap-2" },
      h(Segmented, {
        options: [{ key: "detail", label: "Chi tiết kỳ" }, { key: "diff", label: "So sánh 2 kỳ" }],
        value: mode, onChange: (k) => R.setQuery({ xem: k === "diff" ? "so-sanh" : "" }),
      }),
      f.nhom && h("span", { className: "text-[13px] text-slate-500" }, f.nhom + " · " + fmtInt(inFy.length) + " kỳ trong " + fyLabel(f.fy)),
      h("div", { className: "flex-1" }),
      canWrite && h("button", { type: "button", onClick: () => setModalOpen(true), className: btn.primary }, h(I.Upload, { size: 14 }), "Upload snapshot"));

    const modal = modalOpen && h(UploadModal, {
      existing: f.snapshots, defaultNhom: f.nhom,
      onClose: () => setModalOpen(false),
      onUploaded: (nhom, ky) => {
        invalidateSnapshots();
        const d = new Date(ky + "T00:00:00");
        R.setQuery({ nhom, fy: String(fyOf(d)), ky: ky.slice(0, 7) });
      },
    });

    if (f.loading) return h(React.Fragment, null, filters, h(LoadingBlock));
    if (f.error) return h(React.Fragment, null, filters, h(LoadingBlock, { error: f.error }));

    return h("div", { className: "space-y-4" },
      filters,
      toolbar,
      f.snapshots.length === 0
        ? h(Empty, null, "Chưa có snapshot nào", canWrite ? " — bấm \"Upload snapshot\" để tải file Excel ký gửi." : ".")
        : inFy.length === 0
          ? h(Empty, null, "Nhóm " + f.nhom + " chưa có snapshot trong " + fyLabel(f.fy) + ". Đổi năm tài chính trên bộ lọc" + (canWrite ? " hoặc upload kỳ mới." : "."))
          : h(React.Fragment, null,
              h("div", { className: "scroll-shadow flex gap-2 overflow-x-auto pb-1" },
                inFy.map((s) => {
                  const on = s === sel;
                  return h("button", {
                    key: s.id, type: "button", onClick: () => R.setQuery({ ky: String(s.ky_cap_nhat).slice(0, 7) }),
                    className: "shrink-0 rounded-xl border bg-white px-3.5 py-2.5 text-left transition-colors " +
                      (on ? "border-blue-400 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-300 hover:bg-blue-50/30"),
                  },
                    h("div", { className: "text-[11px] tracking-wide text-slate-400" }, "Kỳ"),
                    h("div", { className: "text-[16px] font-bold tabular-nums " + (on ? "text-blue-600" : "text-slate-800") }, fmtKy(s.ky_cap_nhat)),
                    h("div", { className: "mt-0.5 whitespace-nowrap text-[11px] text-slate-400" }, fmtInt(s.tong_dong) + " dòng · SL " + fmtInt(s.tong_sl)));
                })),

              mode === "detail" && sel && h(SnapshotDetail, { key: sel.id, snapId: sel.id, mien: f.mien, reload }),

              mode === "diff" && sel && h("div", { className: "space-y-3" },
                h("div", { className: "flex flex-wrap items-center gap-2 text-[13px] text-slate-600" },
                  h(UI.FilterSelect, {
                    label: "Kỳ cũ", allowAll: false,
                    options: ofNhom.filter((s) => s !== sel).map((s) => ({ value: String(s.ky_cap_nhat).slice(0, 7), label: fmtKy(s.ky_cap_nhat) })),
                    selected: old ? [String(old.ky_cap_nhat).slice(0, 7)] : [], onChange: (v) => R.setQuery({ "so-voi": v[0] }),
                  }),
                  h(I.ArrowRight, { size: 14, className: "text-slate-400" }),
                  h("span", { className: "rounded-md border border-slate-200 bg-white px-2.5 py-1.5" },
                    h("span", { className: "text-slate-400" }, "Kỳ mới: "), h("b", { className: "font-medium text-blue-700" }, fmtKy(sel.ky_cap_nhat))),
                  h("span", { className: "text-[11px] text-slate-400" }, "Bấm thẻ kỳ ở trên để đổi kỳ mới")),
                old
                  ? h(DiffView, { key: old.id + "-" + sel.id, idOld: old.id, idNew: sel.id, mien: f.mien, reload })
                  : h(Empty, null, "Chưa có kỳ trước của nhóm " + f.nhom + " để so sánh"))),
      modal,
    );
  }

  window.CCDC_ROUTER.register("/ky-gui", KyGuiScreen);
})();
