// Màn Tài sản — bảng tai_san theo nhóm SP, lọc phân loại / nhóm SP / loại vị trí / miền. Admin: Sửa/Xoá.
(function () {
  const { useState, useEffect, useCallback, useRef, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const { fmtInt, fmtDate, useReload, I, FilterBar, FilterSelect, StatCard, Panel, Badge, SearchInput,
    LoadingBlock, RefreshingBar, ErrorBox, Empty, Modal, Pager, T, btn, input, fieldLabel } = window.CCDC_UI;

  const PL_OPTIONS = [{ value: "CCDC", label: "CCDC" }, { value: "THIẾT BỊ", label: "Thiết bị" }];
  const ALL_MIEN = ["Miền Bắc", "Miền Trung", "Miền Nam"];
  const PAGE_SIZE = 10;
  const LVT = ["Kho", "Sale/KTV", "Bệnh viện"];
  const TT_OPTIONS = [
    { key: "dang_dung", label: "Đang dùng" }, { key: "dang_sua", label: "Đang sửa" },
    { key: "hong", label: "Hỏng" },           { key: "mat", label: "Mất" },
    { key: "cho_thanh_ly", label: "Chờ thanh lý" }, { key: "da_thanh_ly", label: "Đã thanh lý" },
  ];
  const TT_LABEL = Object.fromEntries(TT_OPTIONS.map((o) => [o.key, o.label]));
  const TT_TONE = { dang_dung: "blue", dang_sua: "amber", hong: "red", mat: "red", cho_thanh_ly: "amber", da_thanh_ly: "grey" };
  const fmtMoney = (n) => (n == null || n === 0) ? "—" : Math.round(Number(n)).toLocaleString("vi-VN");
  const parseMoney = (s) => { if (!s) return 0; return Number(String(s).replace(/[.,\s₫đ]/g, "")) || 0; };

  // ─── Sửa tài sản (admin) ─────────────────────────────────
  function EditModal({ row, onClose, onSaved }) {
    const [f, setF] = useState(() => ({
      serial: row.serial || "", loai_vi_tri: row.loai_vi_tri || "", mien: row.mien || "",
      pic: row.pic || "", pic_id: row.pic_id || "", tinh_trang: row.tinh_trang || "dang_dung",
      trang_thai_hd: row.trang_thai_hd || "Active", so_luong: String(row.so_luong ?? 1),
      nguyen_gia: String(row.nguyen_gia ?? 0), ngay_mua: row.ngay_mua ? String(row.ngay_mua).slice(0, 10) : "",
      ghi_chu: row.ghi_chu || "",
    }));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

    const save = async () => {
      setError(""); setBusy(true);
      try {
        const payload = {
          id: row.id, serial: f.serial.trim() || null, loai_vi_tri: f.loai_vi_tri || null, mien: f.mien || null,
          pic: f.pic || null, pic_id: f.pic_id.trim() || null,
          tinh_trang: f.tinh_trang, trang_thai_hd: f.trang_thai_hd, so_luong: Number(f.so_luong) || 0,
          nguyen_gia: parseMoney(f.nguyen_gia), ngay_mua: f.ngay_mua || null, ghi_chu: f.ghi_chu || null,
        };
        if (payload.so_luong <= 0) throw new Error("Số lượng phải > 0");
        const res = await api("update_tai_san", payload);
        if (!res.ok) throw new Error(res.error || "unknown_error");
        onSaved && onSaved(); onClose();
      } catch (e) { setError(e.message || String(e)); }
      setBusy(false);
    };

    const field = (label, el) => h("label", { className: "block" }, h("span", { className: fieldLabel }, label), el);
    const select = (k, opts) => h("select", { className: input, value: f[k], onChange: set(k) },
      opts.map((o) => typeof o === "object" ? h("option", { key: o.key, value: o.key }, o.label) : h("option", { key: o, value: o }, o || "— (rỗng) —")));

    return h(Modal, { open: true, onClose, busy, width: 640, title: "Sửa tài sản #" + row.id },
      h("div", { className: "max-h-[65vh] space-y-3 overflow-y-auto px-4 py-4" },
        h("div", { className: "rounded-md bg-slate-50 px-3 py-2 text-[12px] text-slate-500" },
          h("span", { className: "font-mono font-semibold text-slate-700" }, row.ma_bravo), " · ", row.ten_vat_tu || "—", " · ",
          h("span", { className: "font-semibold text-blue-700" }, row.phan_loai || "—")),
        error && h(ErrorBox, null, error),
        field("Serial (thiết bị: bắt buộc, không trùng)", h("input", { className: input, value: f.serial, onChange: set("serial") })),
        h("div", { className: "grid grid-cols-2 gap-3" },
          field("Loại vị trí", select("loai_vi_tri", ["", ...LVT])),
          field("Miền", select("mien", ["", ...ALL_MIEN]))),
        h("div", { className: "grid grid-cols-2 gap-3" },
          field("PIC (tên người)", h("input", { className: input, value: f.pic, onChange: set("pic") })),
          field("PIC ID (mã điểm)", h("input", { className: input + " font-mono", value: f.pic_id, onChange: set("pic_id"), placeholder: "VD: HN.CTCH.180211" }))),
        h("div", { className: "grid grid-cols-2 gap-3" },
          field("Tình trạng", select("tinh_trang", TT_OPTIONS)),
          field("Trạng thái HĐ", select("trang_thai_hd", ["Active", "Inactive"]))),
        h("div", { className: "grid grid-cols-2 gap-3" },
          field("Số lượng", h("input", { type: "number", className: input, value: f.so_luong, onChange: set("so_luong") })),
          field("Nguyên giá (VNĐ)", h("input", { className: input + " text-right tabular-nums", value: parseMoney(f.nguyen_gia).toLocaleString("vi-VN"), onChange: set("nguyen_gia") }))),
        h("div", { className: "grid grid-cols-2 gap-3" },
          field("Ngày mua", h("input", { type: "date", className: input, value: f.ngay_mua, onChange: set("ngay_mua") })),
          field("Ghi chú", h("input", { className: input, value: f.ghi_chu, onChange: set("ghi_chu") })))),
      h("div", { className: "flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3" },
        h("button", { type: "button", onClick: onClose, disabled: busy, className: btn.secondary }, "Huỷ"),
        h("button", { type: "button", onClick: save, disabled: busy, className: btn.primary }, busy ? "Đang lưu…" : "Lưu")));
  }

  // ─── Màn Tài sản ─────────────────────────────────────────
  function TaiSanScreen({ user }) {
    const isAdmin = user?.permission?.canWrite;
    const pm0 = user?.permission?.filterMien;
    const permMien = pm0 ? [].concat(pm0) : null;
    const mienOptions = permMien ? ALL_MIEN.filter((m) => permMien.includes(m)) : ALL_MIEN;
    const reload = useReload();

    const [rows, setRows] = useState(null);
    const [total, setTotal] = useState(0);
    const [pl, setPl] = useState("");
    const [mien, setMien] = useState("");
    const [lvt, setLvt] = useState("");
    const [nhomSp, setNhomSp] = useState("");
    const [search, setSearch] = useState("");
    const [searchApplied, setSearchApplied] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [editRow, setEditRow] = useState(null);
    const [kpi, setKpi] = useState({ sl: 0, gia_tri: 0, gia_tri_dang_dung: 0, sl_dang_dung: 0 });
    const [lvtStats, setLvtStats] = useState({});
    const [nhomSpOptions, setNhomSpOptions] = useState([]);
    const [mienCounts, setMienCounts] = useState({});
    const [collapsed, setCollapsed] = useState({});
    const [cardPages, setCardPages] = useState({});
    const [nonce, setNonce] = useState(0);

    const debounceRef = useRef(null);
    useEffect(() => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchApplied(search.trim()), 300);
      return () => clearTimeout(debounceRef.current);
    }, [search]);

    const params = { phan_loai: pl || null, nhom_san_pham: nhomSp || null, mien: mien || null, loai_vi_tri: lvt || null, search: searchApplied };
    const fetchAll = useCallback(async () => {
      setLoading(true); setError("");
      try {
        const [list, k] = await Promise.all([
          api("list_tai_san", { ...params, page: 1, pageSize: 1000 }),
          api("tai_san_kpi", params),
        ]);
        setRows(list.rows || []); setTotal(list.total || 0);
        setKpi({ sl: k.sl || 0, gia_tri: k.gia_tri || 0, gia_tri_dang_dung: k.gia_tri_dang_dung || 0, sl_dang_dung: k.sl_dang_dung || 0 });
        setLvtStats(k.lvt_stats || {}); setNhomSpOptions(k.nhom_sp_options || []); setMienCounts(k.mien_counts || {});
      } catch (e) { setError(e.message || String(e)); setRows((r) => r || []); }
      setLoading(false);
    }, [pl, nhomSp, mien, lvt, searchApplied]);

    useEffect(() => { fetchAll(); setCardPages({}); }, [fetchAll, reload, nonce]);
    const refresh = () => setNonce((n) => n + 1);

    const del = async (r) => {
      if (!confirm(`Xoá tài sản #${r.id} (${r.ma_bravo}${r.serial ? " · " + r.serial : ""})?\n(Sẽ bị chặn nếu có giao dịch trỏ tới.)`)) return;
      try {
        const res = await api("delete_tai_san", { id: r.id });
        if (!res.ok) throw new Error(res.error + (res.details ? ": " + res.details : ""));
        refresh();
      } catch (e) { alert("Lỗi xoá: " + e.message); }
    };

    const grouped = useMemo(() => {
      const map = {};
      for (const r of rows || []) (map[r.nhom_san_pham || "Khác"] ??= []).push(r);
      return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], "vi"));
    }, [rows]);

    const tyLe = kpi.gia_tri > 0 ? Math.round(kpi.gia_tri_dang_dung / kpi.gia_tri * 1000) / 10 : 0;
    const hasFilter = pl || mien || lvt || nhomSp;
    const filters = h(FilterBar, null,
      h(FilterSelect, { label: "Phân loại", options: PL_OPTIONS, selected: pl ? [pl] : [], onChange: (v) => setPl(v[0] || "") }),
      h(FilterSelect, { label: "Nhóm SP", searchable: true, options: nhomSpOptions, selected: nhomSp ? [nhomSp] : [], onChange: (v) => setNhomSp(v[0] || "") }),
      h(FilterSelect, { label: "Loại vị trí", options: LVT, selected: lvt ? [lvt] : [], onChange: (v) => setLvt(v[0] || "") }),
      mienOptions.length > 1 && h(FilterSelect, {
        label: "Miền", options: mienOptions.map((m) => ({ value: m, label: m + " (" + fmtInt(mienCounts[m] || 0) + ")" })),
        selected: mien ? [mien] : [], onChange: (v) => setMien(v[0] || ""),
      }),
      hasFilter && h("button", { type: "button", onClick: () => { setPl(""); setMien(""); setLvt(""); setNhomSp(""); }, className: "px-1 " + btn.link }, "Bỏ lọc"));

    if (rows === null) return h(React.Fragment, null, filters, h(LoadingBlock, { error }));

    const cols = ["Mã NCC", "Mã Bravo", "Tên", "Loại", "Serial", "Vị trí", "PIC ID", "PIC", "Tình trạng", "SL", "Nguyên giá"];
    if (isAdmin) cols.push("");
    const lv = (k) => lvtStats[k] || {};

    return h("div", { className: "space-y-4" },
      filters,
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(SearchInput, { value: search, onChange: setSearch, placeholder: "Tìm mã, serial, PIC, vị trí…" }),
        h("span", { className: "ml-auto text-[13px] text-slate-500" }, fmtInt(total) + " dòng"),
        isAdmin && h(Badge, { tone: "amber" }, "ADMIN")),
      loading && h(RefreshingBar),
      error && h(LoadingBlock, { error }),

      h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-5" },
        h(StatCard, { label: "Tổng tài sản", value: fmtInt(kpi.sl), sub: kpi.gia_tri > 0 ? fmtMoney(kpi.gia_tri) + " ₫" : "—", accent: true }),
        LVT.map((k) => h(StatCard, { key: k, label: k, value: fmtInt(lv(k).sl || 0), sub: lv(k).gia_tri > 0 ? fmtMoney(lv(k).gia_tri) + " ₫" : "—" })),
        h("div", { className: "rounded-xl border border-slate-200 bg-white p-3.5" },
          h("div", { className: "mb-2 text-[11px] tracking-wide text-slate-400" }, "Tỷ lệ sử dụng (theo giá trị)"),
          h("div", { className: "text-[20px] font-bold tabular-nums text-slate-800" }, tyLe + "%"),
          h("div", { className: "mt-1.5 h-2 overflow-hidden rounded bg-slate-100" },
            h("div", { className: "h-full rounded " + (tyLe >= 80 ? "bg-blue-500" : tyLe >= 50 ? "bg-amber-500" : "bg-red-500"), style: { width: Math.min(100, tyLe) + "%" } })),
          h("div", { className: "mt-1 text-[11px] text-slate-400" }, fmtInt(kpi.sl_dang_dung) + " / " + fmtInt(kpi.sl) + " đang dùng"))),

      grouped.length === 0
        ? h(Empty, null, "Không có tài sản nào khớp bộ lọc")
        : grouped.map(([nsp, items]) => {
            const isCol = collapsed[nsp];
            const sl = items.reduce((s, r) => s + Number(r.so_luong || 0), 0);
            const gt = items.reduce((s, r) => s + Number(r.so_luong || 0) * Number(r.nguyen_gia || 0), 0);
            const pg = cardPages[nsp] || 1;
            const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
            const pgItems = items.slice((pg - 1) * PAGE_SIZE, pg * PAGE_SIZE);
            return h(Panel, {
              key: nsp,
              title: h("button", { type: "button", onClick: () => setCollapsed((c) => ({ ...c, [nsp]: !c[nsp] })), className: "flex items-center gap-2 text-left" },
                h("span", { className: "inline-block w-3 text-slate-400", style: { transform: isCol ? "none" : "rotate(90deg)", transition: "transform 120ms" } }, "▸"),
                nsp, h("span", { className: "rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-500" }, items.length + " mã")),
              right: h("span", { className: "text-[12px] text-slate-500" }, "SL ", h("b", { className: "font-semibold tabular-nums text-slate-800" }, fmtInt(sl)),
                " · Giá trị ", h("b", { className: "font-semibold tabular-nums text-slate-800" }, fmtMoney(gt) + " ₫")),
            },
              !isCol && h(React.Fragment, null,
                h("div", { className: "scroll-shadow overflow-x-auto" },
                  h("table", { className: T.table + " min-w-[1100px]" },
                    h("thead", null, h("tr", { className: T.headRow }, cols.map((c, i) => h("th", { key: i, className: T.th(c === "SL" || c === "Nguyên giá") }, c)))),
                    h("tbody", null, pgItems.map((r, i) => h("tr", { key: r.id, className: T.row(i) },
                      h("td", { className: "whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-slate-500" }, r.ma_ncc || "—"),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-slate-800" }, r.ma_bravo),
                      h("td", { className: "px-3 py-1.5 text-slate-800" }, r.ten_vat_tu || "—"),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5" }, h(Badge, { tone: r.phan_loai === "THIẾT BỊ" ? "blue" : "grey" }, r.phan_loai || "—")),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-slate-600" }, r.serial || "—"),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5 text-slate-700" }, r.vi_tri || r.loai_vi_tri || "—"),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-slate-500" }, r.pic_id || "—"),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5 text-slate-700" }, r.pic || "—"),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5" }, h(Badge, { tone: TT_TONE[r.tinh_trang] || "grey" }, TT_LABEL[r.tinh_trang] || r.tinh_trang)),
                      h("td", { className: "px-3 py-1.5 text-right font-semibold tabular-nums" }, fmtInt(r.so_luong)),
                      h("td", { className: "whitespace-nowrap px-3 py-1.5 text-right tabular-nums" }, fmtMoney(Number(r.so_luong || 0) * Number(r.nguyen_gia || 0))),
                      isAdmin && h("td", { className: "whitespace-nowrap px-3 py-1.5" },
                        h("button", { type: "button", onClick: () => setEditRow(r), className: "mr-2 text-[12px] text-blue-600 hover:underline" }, "Sửa"),
                        h("button", { type: "button", onClick: () => del(r), className: "text-[12px] text-red-600 hover:underline" }, "Xoá"))))))),
                pages > 1 && h(Pager, { page: pg, pages, total: items.length, pageSize: PAGE_SIZE, onPage: (p) => setCardPages((cp) => ({ ...cp, [nsp]: p })) })));
          }),

      editRow && h(EditModal, { row: editRow, onClose: () => setEditRow(null), onSaved: refresh }),
    );
  }

  window.CCDC_ROUTER.register("/tai-san", TaiSanScreen);
})();
