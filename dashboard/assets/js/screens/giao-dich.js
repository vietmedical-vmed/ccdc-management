// Màn Giao dịch — ledger read + form nhập giao dịch (multi-select).
// Nhập mới: add nhiều mã Bravo, mỗi mã có SL/đơn giá/serial riêng, shared vị trí/PIC.
// Huỷ/Mất/Điều chuyển: tick nhiều tài sản, full operation mỗi row, shared config.
(function () {
  const { useState, useEffect, useCallback, useRef } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;

  const LOAI_OPTIONS = [
    { key: "", label: "Tất cả loại" },
    { key: "ton_dau",     label: "Tồn đầu kỳ" },
    { key: "nhap_moi",    label: "Nhập mới" },
    { key: "huy",         label: "Huỷ" },
    { key: "mat",         label: "Mất" },
    { key: "dieu_chuyen", label: "Điều chuyển" },
  ];
  const LOAI_BADGE = {
    ton_dau:     "bg-slate-100 text-slate-700",
    nhap_moi:    "bg-emerald-50 text-emerald-700",
    huy:         "bg-red-50 text-red-700",
    mat:         "bg-red-50 text-red-700",
    dieu_chuyen: "bg-amber-50 text-amber-700",
  };
  const LOAI_LABEL = Object.fromEntries(LOAI_OPTIONS.slice(1).map(o => [o.key, o.label]));

  const MIEN_OPTIONS = ["Miền Bắc", "Miền Trung", "Miền Nam"];
  const LVT_OPTIONS  = ["Kho", "Sale/KTV", "Bệnh viện"];
  const TT_HUY_OPTIONS = [
    { key: "hong",         label: "Hỏng" },
    { key: "cho_thanh_ly", label: "Chờ thanh lý" },
    { key: "da_thanh_ly",  label: "Đã thanh lý" },
  ];

  const PAGE_SIZE = 30;
  const today = () => new Date().toISOString().slice(0, 10);
  const fmtInt = (n) => (n == null || n === "") ? "—" : Number(n).toLocaleString("vi-VN");
  const fmtMoney = (n) => (n == null || Number(n) === 0) ? "—" : Math.round(Number(n)).toLocaleString("vi-VN");
  const fmtDate = (d) => !d ? "—" : String(d).slice(0, 10);
  const parseMoney = (s) => { if (!s) return 0; return Number(String(s).replace(/[.,\s₫đ]/g, "")) || 0; };

  // ────────────────────────────────────────────────────────────────
  // FORM MODAL — MULTI-SELECT
  // ────────────────────────────────────────────────────────────────
  function FormGiaoDich({ open, onClose, onSaved }) {
    const [mode, setMode] = useState("nhap_moi");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [progress, setProgress] = useState(null); // {done, total}

    // Nhập mới
    const [dmList, setDmList]     = useState([]);
    const [dmSearch, setDmSearch] = useState("");
    const [nhapItems, setNhapItems] = useState([]);   // [{ma_bravo, ten, phan_loai, serial, so_luong, don_gia}]
    const [nhapShared, setNhapShared] = useState({
      loai_vi_tri: "", mien: "", pic: "", pic_id: "", ngay_mua: today(), ghi_chu: "",
    });

    // Huỷ/Mất/Điều chuyển
    const [tsList, setTsList]     = useState([]);
    const [tsSearch, setTsSearch] = useState("");
    const [tsPicks, setTsPicks]   = useState([]);     // [tai_san row]
    const [thaoShared, setThaoShared] = useState({
      ngay: today(), ghi_chu: "", tinh_trang_dich: "hong",
      pic_id_den: "", loai_vi_tri_den: "", mien_den: "", pic_den: "",
    });

    // Reset khi đóng/mở
    useEffect(() => {
      if (!open) return;
      setMode("nhap_moi"); setError(""); setBusy(false); setProgress(null);
      setDmSearch(""); setNhapItems([]);
      setNhapShared({ loai_vi_tri: "", mien: "", pic: "", pic_id: "", ngay_mua: today(), ghi_chu: "" });
      setTsSearch(""); setTsPicks([]);
      setThaoShared({ ngay: today(), ghi_chu: "", tinh_trang_dich: "hong",
        pic_id_den: "", loai_vi_tri_den: "", mien_den: "", pic_den: "" });
    }, [open]);

    // Fetch dm_vat_tu
    useEffect(() => {
      if (!open || mode !== "nhap_moi") return;
      let alive = true;
      api("list_dm_ccdc", { search: dmSearch, page: 1, pageSize: 50 })
        .then(r => { if (alive) setDmList(r.rows || []); }).catch(() => {});
      return () => { alive = false; };
    }, [open, mode, dmSearch]);

    // Fetch tai_san
    useEffect(() => {
      if (!open || mode === "nhap_moi") return;
      let alive = true;
      api("list_tai_san", { search: tsSearch, page: 1, pageSize: 50 })
        .then(r => { if (alive) setTsList(r.rows || []); }).catch(() => {});
      return () => { alive = false; };
    }, [open, mode, tsSearch]);

    // ─── Nhập mới: add / update / remove item ────────────
    const addNhapItem = (dm) => {
      const isTB = dm.phan_loai === "THIẾT BỊ";
      // CCDC: chặn trùng mã (không cần thêm 2 lần cho cùng shared vị trí)
      if (!isTB && nhapItems.some(x => x.ma_bravo === dm.ma_bravo)) return;
      setNhapItems([...nhapItems, {
        _key: Date.now() + Math.random(),
        ma_bravo: dm.ma_bravo, ten: dm.ten_vat_tu, phan_loai: dm.phan_loai,
        serial: "", so_luong: 1, don_gia: 0,
      }]);
    };
    const updateNhapItem = (key, patch) =>
      setNhapItems(nhapItems.map(x => x._key === key ? { ...x, ...patch } : x));
    const removeNhapItem = (key) => setNhapItems(nhapItems.filter(x => x._key !== key));

    // ─── Thao tác: toggle pick ────────────────────────────
    const toggleTsPick = (r) => {
      if (tsPicks.some(x => x.id === r.id)) setTsPicks(tsPicks.filter(x => x.id !== r.id));
      else setTsPicks([...tsPicks, r]);
    };
    const isPicked = (id) => tsPicks.some(x => x.id === id);
    const removeTsPick = (id) => setTsPicks(tsPicks.filter(x => x.id !== id));

    // ─── Submit ──────────────────────────────────────────
    const submit = async () => {
      setError(""); setBusy(true); setProgress(null);
      try {
        if (mode === "nhap_moi") {
          if (!nhapItems.length) throw new Error("Chưa chọn mã nào");
          // Validate all trước khi gọi API
          for (let i = 0; i < nhapItems.length; i++) {
            const it = nhapItems[i];
            const sl = Number(it.so_luong) || 0;
            const dg = Number(it.don_gia) || 0;
            if (sl <= 0) throw new Error(`Dòng ${i+1} (${it.ma_bravo}): SL phải > 0`);
            if (it.phan_loai === "THIẾT BỊ" && !String(it.serial).trim())
              throw new Error(`Dòng ${i+1} (${it.ma_bravo}): Thiết bị bắt buộc Serial`);
            if (it.phan_loai === "THIẾT BỊ" && sl !== 1)
              throw new Error(`Dòng ${i+1}: Thiết bị phải SL = 1`);
          }
          setProgress({ done: 0, total: nhapItems.length });
          for (let i = 0; i < nhapItems.length; i++) {
            const it = nhapItems[i];
            const res = await api("create_giao_dich", {
              loai: "nhap_moi",
              ma_bravo:    it.ma_bravo,
              serial:      it.phan_loai === "THIẾT BỊ" ? String(it.serial).trim() : null,
              so_luong:    Number(it.so_luong),
              don_gia:     Number(it.don_gia) || 0,
              loai_vi_tri: nhapShared.loai_vi_tri || null,
              mien:        nhapShared.mien || null,
              pic:         nhapShared.pic || null,
              pic_id:      nhapShared.pic_id || null,
              ngay:        nhapShared.ngay_mua,
              ngay_mua:    nhapShared.ngay_mua,
              ghi_chu:     nhapShared.ghi_chu || null,
            });
            if (!res.ok) throw new Error(`Dòng ${i+1} (${it.ma_bravo}): ${res.error}`);
            setProgress({ done: i + 1, total: nhapItems.length });
          }
        } else {
          if (!tsPicks.length) throw new Error("Chưa tick tài sản nào");
          if (mode === "dieu_chuyen" && !thaoShared.pic_den && !thaoShared.pic_id_den)
            throw new Error("Điều chuyển: cần nhập PIC đích hoặc PIC ID đích");
          setProgress({ done: 0, total: tsPicks.length });
          for (let i = 0; i < tsPicks.length; i++) {
            const t = tsPicks[i];
            const payload = {
              loai: mode,
              tai_san_id: t.id,
              so_luong:   Number(t.so_luong), // full
              ngay:       thaoShared.ngay,
              ghi_chu:    thaoShared.ghi_chu || null,
            };
            if (mode === "huy") payload.tinh_trang_dich = thaoShared.tinh_trang_dich;
            if (mode === "dieu_chuyen") {
              payload.pic_id_den      = thaoShared.pic_id_den      || null;
              payload.loai_vi_tri_den = thaoShared.loai_vi_tri_den || null;
              payload.mien_den        = thaoShared.mien_den        || null;
              payload.pic_den         = thaoShared.pic_den         || null;
            }
            const res = await api("create_giao_dich", payload);
            if (!res.ok) throw new Error(`Tài sản #${t.id} (${t.ma_bravo}): ${res.error}`);
            setProgress({ done: i + 1, total: tsPicks.length });
          }
        }
        onSaved && onSaved();
        onClose && onClose();
      } catch (e) { setError(e.message || String(e)); }
      setBusy(false); setProgress(null);
    };

    if (!open) return null;

    const modeBtnClass = (m) => "px-3 py-1.5 text-xs font-semibold rounded " +
      (mode === m ? "bg-blue-500 text-white" : "text-slate-600 hover:bg-slate-100");
    const inputCls = "w-full px-2 py-1.5 text-sm border border-slate-300 rounded outline-none focus:border-blue-400";
    const labelCls = "text-xs font-semibold text-slate-600 uppercase tracking-wide";
    const countPicked = mode === "nhap_moi" ? nhapItems.length : tsPicks.length;

    return h("div", {
      className: "fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto",
      onClick: (e) => { if (e.target === e.currentTarget && !busy) onClose(); },
    },
      h("div", { className: "bg-white rounded-lg shadow-xl w-full max-w-4xl my-8" },
        // Header
        h("div", { className: "px-5 py-3 border-b border-slate-200 flex items-center justify-between" },
          h("h2", { className: "text-base font-bold text-slate-900" },
            "Nhập giao dịch",
            countPicked > 0 && h("span", { className: "ml-2 text-xs font-normal text-blue-600" },
              `· ${countPicked} mục đã chọn`),
          ),
          h("button", { onClick: onClose, disabled: busy, className: "text-slate-400 hover:text-slate-700 text-xl leading-none disabled:opacity-40" }, "×"),
        ),

        // Mode tabs
        h("div", { className: "px-5 py-3 border-b border-slate-100 flex items-center gap-1 bg-slate-50" },
          h("button", { onClick: () => setMode("nhap_moi"), disabled: busy, className: modeBtnClass("nhap_moi") }, "Nhập mới"),
          h("button", { onClick: () => setMode("huy"), disabled: busy, className: modeBtnClass("huy") }, "Huỷ"),
          h("button", { onClick: () => setMode("mat"), disabled: busy, className: modeBtnClass("mat") }, "Mất"),
          h("button", { onClick: () => setMode("dieu_chuyen"), disabled: busy, className: modeBtnClass("dieu_chuyen") }, "Điều chuyển"),
        ),

        // Body
        h("div", { className: "px-5 py-4 space-y-4 max-h-[65vh] overflow-y-auto" },
          error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

          mode === "nhap_moi"
            ? h(NhapMoiMulti, {
                dmList, dmSearch, setDmSearch, addNhapItem,
                nhapItems, updateNhapItem, removeNhapItem,
                nhapShared, setNhapShared, inputCls, labelCls,
              })
            : h(ThaoTacMulti, {
                mode, tsList, tsSearch, setTsSearch, toggleTsPick, isPicked,
                tsPicks, removeTsPick, thaoShared, setThaoShared, inputCls, labelCls,
              }),
        ),

        // Footer
        h("div", { className: "px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2 bg-slate-50" },
          h("div", { className: "text-xs text-slate-600" },
            progress
              ? `Đang xử lý ${progress.done}/${progress.total}…`
              : countPicked > 0 ? `${countPicked} mục sẽ được tạo giao dịch` : "Chưa chọn mục nào",
          ),
          h("div", { className: "flex items-center gap-2" },
            h("button", { onClick: onClose, disabled: busy,
              className: "px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded" }, "Huỷ"),
            h("button", { onClick: submit, disabled: busy || countPicked === 0,
              className: "px-4 py-1.5 text-sm font-semibold bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50" },
              busy ? "Đang lưu…" : `Lưu ${countPicked} giao dịch`),
          ),
        ),
      ),
    );
  }

  // ─── NHẬP MỚI multi ─────────────────────────────────────────
  function NhapMoiMulti({
    dmList, dmSearch, setDmSearch, addNhapItem,
    nhapItems, updateNhapItem, removeNhapItem,
    nhapShared, setNhapShared, inputCls, labelCls,
  }) {
    return h(React.Fragment, null,
      // Search + list
      h("div", null,
        h("div", { className: labelCls + " mb-1" }, "Tìm mã Bravo (bấm để thêm vào danh sách)"),
        h("input", {
          className: inputCls, autoFocus: true, value: dmSearch, onChange: e => setDmSearch(e.target.value),
          placeholder: "Tìm mã / tên…",
        }),
        h("div", { className: "mt-1 max-h-32 overflow-y-auto border border-slate-200 rounded" },
          dmList.length === 0
            ? h("div", { className: "px-3 py-2 text-xs text-slate-400" }, "Nhập từ khoá để tìm")
            : dmList.map(r => {
                const inList = nhapItems.some(x => x.ma_bravo === r.ma_bravo);
                const isTB = r.phan_loai === "THIẾT BỊ";
                const disabled = inList && !isTB; // CCDC: 1 lần, TB: nhiều lần
                return h("button", {
                  key: r.ma_bravo, type: "button",
                  onClick: () => addNhapItem(r),
                  disabled,
                  className: "w-full text-left px-3 py-1.5 text-sm border-b border-slate-100 last:border-0 " +
                    (disabled ? "opacity-50 cursor-not-allowed bg-slate-50"
                              : "hover:bg-blue-50"),
                },
                  h("span", { className: "font-mono text-xs text-slate-900 mr-2" }, r.ma_bravo),
                  h("span", { className: "text-slate-700" }, r.ten_vat_tu),
                  h("span", { className: "ml-2 text-[10px] font-semibold text-blue-600" }, r.phan_loai),
                  inList && h("span", { className: "ml-2 text-[10px] text-slate-500" },
                    isTB ? "(đã thêm — vẫn có thể thêm serial khác)" : "(đã có trong danh sách)"),
                );
              })),
      ),

      // Selected items table
      nhapItems.length > 0 && h("div", null,
        h("div", { className: labelCls + " mb-1" }, `Danh sách nhập (${nhapItems.length})`),
        h("div", { className: "border border-slate-200 rounded overflow-hidden" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50" },
              h("tr", null,
                h("th", { className: "px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600" }, "Mã"),
                h("th", { className: "px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600" }, "Tên"),
                h("th", { className: "px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600 w-28" }, "Loại"),
                h("th", { className: "px-2 py-1.5 text-left text-[11px] font-semibold text-slate-600 w-40" }, "Serial (nếu TB)"),
                h("th", { className: "px-2 py-1.5 text-right text-[11px] font-semibold text-slate-600 w-20" }, "SL"),
                h("th", { className: "px-2 py-1.5 text-right text-[11px] font-semibold text-slate-600 w-32" }, "Đơn giá"),
                h("th", { className: "w-8" }),
              )),
            h("tbody", null,
              nhapItems.map(it => {
                const isTB = it.phan_loai === "THIẾT BỊ";
                return h("tr", { key: it._key, className: "border-t border-slate-100" },
                  h("td", { className: "px-2 py-1 font-mono text-xs text-slate-900" }, it.ma_bravo),
                  h("td", { className: "px-2 py-1 text-slate-700 text-xs" }, it.ten),
                  h("td", { className: "px-2 py-1" },
                    h("span", { className: "inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold " +
                      (isTB ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-700") }, it.phan_loai)),
                  h("td", { className: "px-2 py-1" },
                    isTB
                      ? h("input", { className: "w-full px-1.5 py-0.5 text-xs border border-slate-200 rounded",
                          value: it.serial, placeholder: "Bắt buộc",
                          onChange: e => updateNhapItem(it._key, { serial: e.target.value }) })
                      : h("span", { className: "text-slate-300 text-xs" }, "—")),
                  h("td", { className: "px-2 py-1" },
                    h("input", { type: "number", className: "w-full px-1.5 py-0.5 text-xs text-right border border-slate-200 rounded",
                      value: it.so_luong, disabled: isTB,
                      onChange: e => updateNhapItem(it._key, { so_luong: e.target.value }) })),
                  h("td", { className: "px-2 py-1" },
                    h("input", { className: "w-full px-1.5 py-0.5 text-xs text-right tabular-nums border border-slate-200 rounded",
                      value: parseMoney(it.don_gia).toLocaleString("vi-VN"),
                      onChange: e => updateNhapItem(it._key, { don_gia: parseMoney(e.target.value) }) })),
                  h("td", { className: "px-2 py-1 text-center" },
                    h("button", { type: "button", onClick: () => removeNhapItem(it._key),
                      className: "text-red-500 hover:text-red-700 text-sm", title: "Bỏ" }, "×")),
                );
              })),
          ),
        ),
      ),

      // Shared config
      h("div", { className: "pt-2 border-t border-slate-100" },
        h("div", { className: labelCls + " mb-2" }, "Thông tin dùng chung cho tất cả mã ở trên"),
        h("div", { className: "grid grid-cols-2 gap-3" },
          h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Loại vị trí"),
            h("select", { className: inputCls, value: nhapShared.loai_vi_tri,
              onChange: e => setNhapShared({ ...nhapShared, loai_vi_tri: e.target.value }) },
              h("option", { value: "" }, "-- Chọn --"),
              LVT_OPTIONS.map(x => h("option", { key: x, value: x }, x)))),
          h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Miền"),
            h("select", { className: inputCls, value: nhapShared.mien,
              onChange: e => setNhapShared({ ...nhapShared, mien: e.target.value }) },
              h("option", { value: "" }, "-- Chọn --"),
              MIEN_OPTIONS.map(x => h("option", { key: x, value: x }, x)))),
        ),
        h("div", { className: "grid grid-cols-2 gap-3 mt-2" },
          h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "PIC (tên người)"),
            h("input", { className: inputCls, value: nhapShared.pic,
              onChange: e => setNhapShared({ ...nhapShared, pic: e.target.value }) })),
          h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "PIC ID (mã điểm)"),
            h("input", { className: inputCls + " font-mono text-xs", value: nhapShared.pic_id,
              placeholder: "VD: HN.CTCH.180211",
              onChange: e => setNhapShared({ ...nhapShared, pic_id: e.target.value }) })),
        ),
        h("div", { className: "grid grid-cols-2 gap-3 mt-2" },
          h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Ngày mua"),
            h("input", { type: "date", className: inputCls, value: nhapShared.ngay_mua,
              onChange: e => setNhapShared({ ...nhapShared, ngay_mua: e.target.value }) })),
          h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Ghi chú"),
            h("input", { className: inputCls, value: nhapShared.ghi_chu,
              onChange: e => setNhapShared({ ...nhapShared, ghi_chu: e.target.value }) })),
        ),
      ),
    );
  }

  // ─── HUỶ/MẤT/ĐIỀU CHUYỂN multi ────────────────────────────
  function ThaoTacMulti({
    mode, tsList, tsSearch, setTsSearch, toggleTsPick, isPicked,
    tsPicks, removeTsPick, thaoShared, setThaoShared, inputCls, labelCls,
  }) {
    return h(React.Fragment, null,
      // Search + list with checkboxes
      h("div", null,
        h("div", { className: labelCls + " mb-1" }, "Tìm tài sản (tick để chọn nhiều)"),
        h("input", {
          className: inputCls, autoFocus: true, value: tsSearch, onChange: e => setTsSearch(e.target.value),
          placeholder: "Tìm mã / serial / PIC / vị trí…",
        }),
        h("div", { className: "mt-1 max-h-40 overflow-y-auto border border-slate-200 rounded" },
          tsList.length === 0
            ? h("div", { className: "px-3 py-2 text-xs text-slate-400" }, "Nhập từ khoá để tìm")
            : tsList.map(r => {
                const picked = isPicked(r.id);
                return h("label", {
                  key: r.id,
                  className: "flex items-center gap-2 px-3 py-1.5 text-sm border-b border-slate-100 last:border-0 cursor-pointer " +
                    (picked ? "bg-blue-50" : "hover:bg-slate-50"),
                },
                  h("input", {
                    type: "checkbox", checked: picked,
                    onChange: () => toggleTsPick(r),
                    className: "cursor-pointer",
                  }),
                  h("div", { className: "flex-1 min-w-0" },
                    h("div", null,
                      h("span", { className: "font-mono text-xs text-slate-900 mr-2" }, r.ma_bravo),
                      r.serial && h("span", { className: "font-mono text-xs text-blue-700 mr-2" }, "#" + r.serial),
                      h("span", { className: "text-slate-700" }, r.ten_vat_tu),
                    ),
                    h("div", { className: "text-[11px] text-slate-500 mt-0.5" },
                      `SL=${fmtInt(r.so_luong)} · ${r.pic || "—"} · ${r.pic_id || r.loai_vi_tri || "—"} · ${r.mien || "—"}`),
                  ),
                );
              })),
      ),

      // Picked list
      tsPicks.length > 0 && h("div", null,
        h("div", { className: labelCls + " mb-1" }, `Đã chọn (${tsPicks.length})`),
        h("div", { className: "border border-slate-200 rounded overflow-hidden max-h-40 overflow-y-auto" },
          tsPicks.map(t => h("div", {
            key: t.id, className: "flex items-center gap-2 px-3 py-1.5 text-sm border-b border-slate-100 last:border-0 bg-blue-50/50",
          },
            h("div", { className: "flex-1 min-w-0" },
              h("span", { className: "font-mono text-xs text-slate-900 mr-2" }, t.ma_bravo),
              t.serial && h("span", { className: "font-mono text-xs text-blue-700 mr-2" }, "#" + t.serial),
              h("span", { className: "text-slate-700" }, t.ten_vat_tu),
              h("span", { className: "ml-2 text-[11px] text-slate-500" },
                `SL=${fmtInt(t.so_luong)} · ${t.pic || "—"}`),
            ),
            h("button", { type: "button", onClick: () => removeTsPick(t.id),
              className: "text-red-500 hover:text-red-700 text-sm", title: "Bỏ" }, "×"),
          ))),
        h("div", { className: "text-[11px] text-slate-500 mt-1" },
          "Mỗi tài sản sẽ bị thao tác TOÀN BỘ số lượng (không tách row). CCDC muốn tách 1 phần → dùng form đơn lẻ."),
      ),

      // Shared config
      h("div", { className: "pt-2 border-t border-slate-100" },
        h("div", { className: labelCls + " mb-2" }, "Thông tin dùng chung"),
        h("div", { className: "grid grid-cols-2 gap-3" },
          h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Ngày giao dịch"),
            h("input", { type: "date", className: inputCls, value: thaoShared.ngay,
              onChange: e => setThaoShared({ ...thaoShared, ngay: e.target.value }) })),
          mode === "huy" && h("div", null,
            h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Tình trạng đích"),
            h("select", { className: inputCls, value: thaoShared.tinh_trang_dich,
              onChange: e => setThaoShared({ ...thaoShared, tinh_trang_dich: e.target.value }) },
              TT_HUY_OPTIONS.map(o => h("option", { key: o.key, value: o.key }, o.label)))),
        ),

        mode === "dieu_chuyen" && h(React.Fragment, null,
          h("div", { className: labelCls + " mt-3 mb-1 text-slate-500" }, "Điểm đến (áp cho tất cả)"),
          h("div", { className: "grid grid-cols-2 gap-3" },
            h("div", null,
              h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Loại vị trí đích"),
              h("select", { className: inputCls, value: thaoShared.loai_vi_tri_den,
                onChange: e => setThaoShared({ ...thaoShared, loai_vi_tri_den: e.target.value }) },
                h("option", { value: "" }, "(giữ nguyên)"),
                LVT_OPTIONS.map(x => h("option", { key: x, value: x }, x)))),
            h("div", null,
              h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Miền đích"),
              h("select", { className: inputCls, value: thaoShared.mien_den,
                onChange: e => setThaoShared({ ...thaoShared, mien_den: e.target.value }) },
                h("option", { value: "" }, "(giữ nguyên)"),
                MIEN_OPTIONS.map(x => h("option", { key: x, value: x }, x)))),
          ),
          h("div", { className: "grid grid-cols-2 gap-3 mt-2" },
            h("div", null,
              h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "PIC ID đích"),
              h("input", { className: inputCls + " font-mono text-xs", value: thaoShared.pic_id_den,
                placeholder: "VD: HN.CTCH.180211",
                onChange: e => setThaoShared({ ...thaoShared, pic_id_den: e.target.value }) })),
            h("div", null,
              h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "PIC đích"),
              h("input", { className: inputCls, value: thaoShared.pic_den,
                onChange: e => setThaoShared({ ...thaoShared, pic_den: e.target.value }) })),
          ),
        ),

        h("div", { className: "mt-3" },
          h("div", { className: "text-[11px] text-slate-500 mb-0.5" }, "Ghi chú"),
          h("input", { className: inputCls, value: thaoShared.ghi_chu,
            onChange: e => setThaoShared({ ...thaoShared, ghi_chu: e.target.value }) })),
      ),
    );
  }

  // ────────────────────────────────────────────────────────────────
  // MÀN GIAO DỊCH
  // ────────────────────────────────────────────────────────────────
  function GiaoDichScreen({ user }) {
    const canWrite = user?.permission?.canWrite;
    const [rows, setRows]       = useState([]);
    const [total, setTotal]     = useState(0);
    const [page, setPage]       = useState(1);
    const [loai, setLoai]       = useState("");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate]   = useState("");
    const [search, setSearch]   = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState("");
    const [modalOpen, setModalOpen] = useState(false);

    const debounceRef = useRef(null);
    const [searchApplied, setSearchApplied] = useState("");
    useEffect(() => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchApplied(search.trim()), 300);
      return () => clearTimeout(debounceRef.current);
    }, [search]);
    useEffect(() => { setPage(1); }, [loai, fromDate, toDate, searchApplied]);

    const fetchData = useCallback(async () => {
      setLoading(true); setError("");
      try {
        const res = await api("list_giao_dich", {
          loai: loai || null, from_date: fromDate || null, to_date: toDate || null,
          search: searchApplied, page, pageSize: PAGE_SIZE,
        });
        setRows(res.rows || []); setTotal(res.total || 0);
      } catch (e) { setError(e.message || String(e)); setRows([]); setTotal(0); }
      setLoading(false);
    }, [loai, fromDate, toDate, searchApplied, page]);
    useEffect(() => { fetchData(); }, [fetchData]);

    const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const tongTT = rows.reduce((s, r) => s + Number(r.thanh_tien || 0), 0);
    const sel = "px-2 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400";

    return h("div", { className: "p-4 md:p-6 space-y-4" },
      h("div", { className: "flex items-baseline gap-3 flex-wrap" },
        h("h1", { className: "text-lg font-bold text-slate-900" }, "Giao dịch"),
        h("span", { className: "text-xs text-slate-500" },
          loading ? "đang tải…" : `${fmtInt(total)} dòng · thành tiền trang này ${fmtMoney(tongTT)}₫`),
        canWrite && h("button", {
          onClick: () => setModalOpen(true),
          className: "ml-auto px-3 py-1.5 text-xs font-semibold rounded bg-blue-500 text-white hover:bg-blue-600",
        }, "+ Nhập giao dịch"),
      ),

      h("div", { className: "flex flex-wrap items-center gap-2" },
        h("select", { className: sel, value: loai, onChange: e => setLoai(e.target.value) },
          LOAI_OPTIONS.map(o => h("option", { key: o.key, value: o.key }, o.label))),
        h("label", { className: "text-xs text-slate-500" }, "Từ"),
        h("input", { type: "date", className: sel, value: fromDate, onChange: e => setFromDate(e.target.value) }),
        h("label", { className: "text-xs text-slate-500" }, "đến"),
        h("input", { type: "date", className: sel, value: toDate, onChange: e => setToDate(e.target.value) }),
        h("div", { className: "relative flex-1 min-w-[180px] max-w-sm" },
          h("input", {
            type: "search", value: search, onChange: e => setSearch(e.target.value),
            placeholder: "Tìm mã / ghi chú…",
            className: "w-full pl-3 pr-8 py-1.5 text-sm border border-slate-200 rounded-md bg-white outline-none focus:border-blue-400",
          }),
          search && h("button", { onClick: () => setSearch(""),
            className: "absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" }, "×")),
      ),

      error && h("div", { className: "bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded" }, "Lỗi: " + error),

      h("div", { className: "bg-white border border-slate-200 rounded-lg overflow-hidden" },
        h("div", { className: "overflow-x-auto" },
          h("table", { className: "w-full text-sm" },
            h("thead", { className: "bg-slate-50 border-b border-slate-200" },
              h("tr", null, ["Ngày", "Loại", "Mã", "Tên", "SL", "Đơn giá", "Thành tiền", "Ghi chú"].map((c, i) =>
                h("th", { key: i, className: "px-3 py-2 text-left text-xs font-semibold text-slate-600 uppercase tracking-wide " +
                  (["SL","Đơn giá","Thành tiền"].includes(c) ? "text-right" : "") }, c)))),
            h("tbody", null,
              rows.length === 0 && !loading
                ? h("tr", null, h("td", { colSpan: 8, className: "px-3 py-8 text-center text-sm text-slate-400" },
                    "Chưa có giao dịch nào"))
                : rows.map(r => h("tr", { key: r.id, className: "border-b border-slate-100 hover:bg-slate-50" },
                    h("td", { className: "px-3 py-2 whitespace-nowrap text-slate-700" }, fmtDate(r.ngay)),
                    h("td", { className: "px-3 py-2" },
                      h("span", { className: "inline-block px-2 py-0.5 rounded text-[11px] font-semibold " + (LOAI_BADGE[r.loai] || "bg-slate-100 text-slate-700") },
                        LOAI_LABEL[r.loai] || r.loai)),
                    h("td", { className: "px-3 py-2 font-mono text-xs text-slate-900" }, r.ma_bravo),
                    h("td", { className: "px-3 py-2 text-slate-800" }, r.ten_vat_tu || "—"),
                    h("td", { className: "px-3 py-2 text-right tabular-nums" }, fmtInt(r.so_luong)),
                    h("td", { className: "px-3 py-2 text-right tabular-nums" }, fmtMoney(r.don_gia)),
                    h("td", { className: "px-3 py-2 text-right tabular-nums font-semibold" }, fmtMoney(r.thanh_tien)),
                    h("td", { className: "px-3 py-2 text-slate-500 text-xs" }, r.ghi_chu || "—"),
                  ))),
          ),
        ),
        h("div", { className: "flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-600" },
          h("div", null, total > 0 ? `Hiển thị ${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE, total)} / ${fmtInt(total)}` : "—"),
          h("div", { className: "flex items-center gap-1" },
            h("button", { onClick: () => setPage(1), disabled: page <= 1 || loading, className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed" }, "««"),
            h("button", { onClick: () => setPage(p => Math.max(1, p-1)), disabled: page <= 1 || loading, className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed" }, "‹"),
            h("span", { className: "px-2 font-semibold text-slate-800" }, `${page} / ${lastPage}`),
            h("button", { onClick: () => setPage(p => Math.min(lastPage, p+1)), disabled: page >= lastPage || loading, className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed" }, "›"),
            h("button", { onClick: () => setPage(lastPage), disabled: page >= lastPage || loading, className: "px-2 py-1 rounded border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed" }, "»»"),
          ),
        ),
      ),

      h(FormGiaoDich, { open: modalOpen, onClose: () => setModalOpen(false), onSaved: fetchData }),
    );
  }

  window.CCDC_ROUTER.register("/giao-dich", GiaoDichScreen);
})();
