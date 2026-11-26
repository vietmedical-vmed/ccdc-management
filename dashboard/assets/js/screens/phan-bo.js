// Màn Phân bổ CCDC — CCDC / thiết bị ký gửi (snapshot mới nhất) cạnh quota thầu theo BV, cùng nhóm SP.
// Quota khả dụng = Quota Onhand − TH YTD.
// Dthu TH 12T = doanh thu thực hiện 12 tháng tới tháng hiện tại − 1; tô xanh khi > Dthu sàn (mặc định 20 tỷ, lưu theo trình duyệt).
// Hệ số đầu tư         = Dthu TH 12T / khấu hao thiết bị 12T (lần).
// Hệ số đầu tư dự kiến = quota / khấu hao thiết bị trên CÙNG kỳ dự kiến (lần), tính ở ccdc-api:
//   kỳ = tháng hiện tại → min(hết hiệu lực quota muộn nhất, hết khấu hao muộn nhất);
//   quota mỗi đợt thầu chia đều theo thời gian hiệu lực, chỉ lấy phần rơi vào kỳ.
//   GTCL khấu hao đường thẳng theo tháng từ ngày ký gửi tới kỳ snapshot (view v_snapshot_items).
(function () {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const { useKgFilters, KgFilters } = window.CCDC_KG;
  const { fmtInt, fmtKy, fmtDate, deaccent, useReload, StatCard, Panel, Segmented, FilterSelect, SearchInput,
    LoadingBlock, RefreshingBar, Empty, Modal, I, T } = window.CCDC_UI;

  // Tiền và hệ số: 1 chữ số thập phân
  const fmtTien = (n) => {
    if (n == null) return "—";
    const v = Number(n);
    if (v === 0) return "0";
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + " tỷ";
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + " tr";
    return Math.round(v).toLocaleString("vi-VN");
  };
  const fmtLan = (x) => x == null ? "—" : x.toFixed(1) + " lần";
  const SAN_KEY = "ccdc.phanBo.dthuSanTy";
  const SAN_MAC_DINH = 20; // tỷ đồng
  const readSan = () => {
    try { const v = Number(localStorage.getItem(SAN_KEY)); return v > 0 ? v : SAN_MAC_DINH; } catch { return SAN_MAC_DINH; }
  };
  const saveSan = (v) => { try { localStorage.setItem(SAN_KEY, String(v)); } catch { /* bỏ qua */ } };

  // Hệ số càng thấp càng kém: < 1 lần đỏ, < 2 lần vàng
  const hsTone = (x) => x == null ? "text-slate-400" : x < 1 ? "text-red-600" : x < 2 ? "text-amber-600" : "text-slate-800";

  // Cùng quy tắc với ccdc-api: định danh BV và loại CCDC (bỏ số thứ tự bộ ở cuối tên)
  const norm = (x) => String(x ?? "").trim().toUpperCase();
  const bvKey = (r) => r.ma_bv ? norm(r.ma_bv) : "TEN|" + norm(r.ten_bv);
  const loaiOf = (ten) => String(ten ?? "").trim()
    .replace(/\s+-\s+(?:(?:nam|bắc|bac|trung|mb|mn|mt)\s+-\s+)?\d+$/iu, "").trim();

  // Dòng snapshot đầy đủ: tải 1 lần mỗi snapshot rồi lọc theo BV ở client
  const itemCache = new Map();
  const loadItems = (id) => {
    if (!itemCache.has(id)) {
      itemCache.set(id, api("snapshot_items", { snapshot_id: id })
        .then((r) => r.rows || [])
        .catch((e) => { itemCache.delete(id); throw e; }));
    }
    return itemCache.get(id);
  };

  // Popup danh sách CCDC / thiết bị của 1 BV hoặc cả miền.
  // target: { kind: "CCDC" | "TB", title, keys: Set<bvKey>, loai, multiBv }
  function ItemsPopup({ snapshotId, target, onClose }) {
    const [state, setState] = useState({ rows: null, error: "" });
    const [search, setSearch] = useState("");
    useEffect(() => {
      if (!target) return;
      let alive = true;
      setState({ rows: null, error: "" }); setSearch("");
      loadItems(snapshotId)
        .then((rows) => alive && setState({ rows, error: "" }))
        .catch((e) => alive && setState({ rows: [], error: e.message || String(e) }));
      return () => { alive = false; };
    }, [snapshotId, target]);

    const isTb = !!target && target.kind === "TB";
    const list = useMemo(() => {
      if (!target || !state.rows) return [];
      const q = deaccent(search.trim());
      return state.rows.filter((r) => target.keys.has(bvKey(r))
          && ((r.phan_loai === "TB") === isTb)
          && (isTb || !target.loai || loaiOf(r.ten_ccdc) === target.loai)
          && (!q || deaccent([r.ma_bravo, r.ten_ccdc, r.serial, r.ten_bv, r.ktv_phu_trach].join(" ")).includes(q)))
        .sort((a, b) => String(a.ten_bv ?? "").localeCompare(String(b.ten_bv ?? ""), "vi")
          || String(a.ten_ccdc ?? "").localeCompare(String(b.ten_ccdc ?? ""), "vi")
          || String(a.serial ?? "").localeCompare(String(b.serial ?? ""), "vi"));
    }, [target, state.rows, search, isTb]);
    if (!target) return null;

    const tongSl = list.reduce((s, r) => s + Number(r.so_luong ?? 0), 0);
    const cols = [
      "#", target.multiBv && "Bệnh viện", "Mã Bravo", isTb ? "Tên thiết bị" : "Tên CCDC", "Serial", "SL",
      "Ngày ký gửi", "KTV phụ trách", isTb && "Nguyên giá", isTb && "GTCL",
    ].filter(Boolean);
    const right = new Set(["#", "SL", "Nguyên giá", "GTCL"]);

    return h(Modal, { open: true, onClose, width: 1100, title: target.title },
      h("div", { className: "flex flex-wrap items-center gap-3 px-4 py-2.5" },
        h(SearchInput, { value: search, onChange: setSearch, placeholder: "Tìm mã, tên, serial, KTV…" }),
        h("div", { className: "flex-1" }),
        state.rows && !state.error && h("span", { className: "text-[12px] text-slate-500" },
          fmtInt(list.length), " dòng · SL ", h("b", { className: "font-semibold text-slate-700" }, fmtInt(tongSl)))),
      !state.rows || state.error
        ? h("div", { className: "px-4 pb-4" }, h(LoadingBlock, { error: state.error }))
        : h("div", { className: "scroll-shadow max-h-[65vh] overflow-auto border-t border-slate-100" },
          h("table", { className: T.table },
            h("thead", { className: "sticky top-0 z-10" }, h("tr", { className: T.headRow },
              cols.map((c) => h("th", { key: c, className: T.th(right.has(c)) }, c)))),
            h("tbody", null,
              list.length === 0
                ? h("tr", null, h("td", { colSpan: cols.length, className: "px-4 py-8 text-center text-slate-400" }, "Không có dòng nào"))
                : list.map((r, i) => h("tr", { key: r.id, className: T.row(i) },
                    h("td", { className: T.num + " text-slate-400" }, i + 1),
                    target.multiBv && h("td", { className: T.td + " min-w-[12rem] text-slate-700" },
                      r.ma_bv && h("span", { className: "mr-1.5 font-mono text-[11px] text-slate-400" }, r.ma_bv), r.ten_bv || "—"),
                    h("td", { className: T.td + " whitespace-nowrap font-mono text-[12px] text-slate-600" }, r.ma_bravo || "—"),
                    h("td", { className: T.td + " min-w-[14rem] text-slate-800" }, r.ten_ccdc || "—"),
                    h("td", { className: T.td + " whitespace-nowrap font-mono text-[12px] text-slate-600" }, r.serial || "—"),
                    h("td", { className: T.num + " text-slate-700" }, fmtInt(r.so_luong)),
                    h("td", { className: T.td + " whitespace-nowrap tabular-nums text-slate-600" }, fmtDate(r.ngay_ky_gui)),
                    h("td", { className: T.td + " whitespace-nowrap text-slate-600" }, r.ktv_phu_trach || "—"),
                    isTb && h("td", { className: T.num + " text-slate-600" }, r.nguyen_gia != null ? fmtTien(r.nguyen_gia) : "—"),
                    isTb && h("td", { className: T.num + " text-slate-700" }, r.gtcl != null ? fmtTien(r.gtcl) : "—")))))));
  }

  const mienOrder = (m) => m === "Miền Bắc" ? 0 : m === "Miền Nam" ? 1 : m === "Miền Trung" ? 2 : 3;

  // Tổng của dòng mẹ Miền. Hệ số tính trên tổng, chỉ lấy BV có khấu hao / có kỳ dự kiến.
  function tongNhom(list) {
    const sum = (k) => list.reduce((s, r) => s + (r[k] || 0), 0);
    const coKh = list.filter((r) => r.khau_hao_12t > 0);
    const kh12 = coKh.reduce((s, r) => s + r.khau_hao_12t, 0);
    const coDk = list.filter((r) => r.du_kien && r.du_kien.khau_hao > 0);
    const khDk = coDk.reduce((s, r) => s + r.du_kien.khau_hao, 0);
    return {
      sl: sum("sl"), sl_tb: sum("sl_tb"), co_quota: list.some((r) => r.co_quota),
      quota_tien_on_hand: sum("quota_tien_on_hand"), quota_tien_sap_toi: sum("quota_tien_sap_toi"),
      dt_thuc_hien: sum("dt_thuc_hien"), quota_tien_con_lai: sum("quota_tien_con_lai"),
      dt_12t: sum("dt_12t"), gtcl: sum("gtcl"), nguyen_gia: sum("nguyen_gia"), khau_hao_12t: kh12,
      he_so_dau_tu: kh12 > 0 ? coKh.reduce((s, r) => s + r.dt_12t, 0) / kh12 : null,
      he_so_dau_tu_du_kien: khDk > 0 ? coDk.reduce((s, r) => s + r.du_kien.quota, 0) / khDk : null,
    };
  }

  function PhanBoScreen({ user }) {
    const f = useKgFilters(user, { requireNhom: true });
    const reload = useReload();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loai, setLoai] = useState("");
    const [tab, setTab] = useState("co_ccdc");
    const [sanInput, setSanInput] = useState(() => String(readSan()));
    const [dong, setDong] = useState(() => new Set()); // miền đang thu gọn
    const [popup, setPopup] = useState(null);
    const sanTy = Number(sanInput) > 0 ? Number(sanInput) : SAN_MAC_DINH;
    useEffect(() => { saveSan(sanTy); }, [sanTy]);

    useEffect(() => {
      if (f.loading) return;
      let alive = true;
      setLoading(true); setError("");
      api("phan_bo_ccdc", { nhom_san_pham: f.nhom || null, fiscal_year: f.fy, mien: f.mien })
        .then((res) => { if (alive) { setData(res); setLoading(false); } })
        .catch((e) => { if (alive) { setError(e.message || String(e)); setLoading(false); } });
      return () => { alive = false; };
    }, [f.loading, f.nhom, f.fy, f.mien.join("|"), reload]);
    useEffect(() => { setLoai(""); }, [data && data.nhom_san_pham, data && data.fy]);

    // Lọc 1 loại CCDC → SL CCDC chỉ đếm loại đó
    const rows = ((data && data.rows) || []).map((r) => ({ ...r, sl: loai ? (r.loai[loai] || 0) : r.sl_ccdc }));

    const filters = h(KgFilters, { f });
    if (!data) return h(React.Fragment, null, filters, h(LoadingBlock, { error: error || f.error }));
    if (!data.nhom_san_pham) return h(React.Fragment, null, filters,
      h(Empty, null, "Chưa có snapshot ký gửi — vào tab Chi tiết theo kỳ để upload."));

    const coCcdc = rows.filter((r) => r.sl > 0 || r.sl_tb > 0);
    const khongQuota = coCcdc.filter((r) => !r.co_quota);
    const tabs = [
      { key: "co_ccdc", label: "Đang ký gửi", list: coCcdc },
      { key: "tat_ca", label: "Tất cả BV", list: rows },
    ];
    const shown = (tabs.find((t) => t.key === tab) || tabs[0]).list.slice()
      .sort((a, b) => (b.quota_tien_on_hand + b.quota_tien_sap_toi) - (a.quota_tien_on_hand + a.quota_tien_sap_toi));
    // Dòng mẹ Miền, dòng con là các BV thuộc miền đó
    const groups = [];
    for (const r of shown) {
      const k = r.mien || "";
      let g = groups.find((x) => x.mien === k);
      if (!g) groups.push(g = { mien: k, list: [] });
      g.list.push(r);
    }
    groups.sort((a, b) => mienOrder(a.mien) - mienOrder(b.mien));
    for (const g of groups) g.tong = tongNhom(g.list);
    const toggle = (m) => setDong((s) => { const n = new Set(s); n.has(m) ? n.delete(m) : n.add(m); return n; });
    const allClosed = groups.length > 0 && groups.every((g) => dong.has(g.mien));

    // Ô SL bấm được → popup danh sách CCDC / TB của BV (hoặc cả miền)
    const kindLabel = (kind) => kind === "TB" ? "Thiết bị" : "CCDC" + (loai ? " · " + loai : "");
    const slCell = (kind, n, list, ten, cls) => h("td", { className: T.num + " " + cls },
      n > 0
        ? h("button", {
            type: "button", title: "Xem danh sách " + (kind === "TB" ? "thiết bị" : "CCDC"),
            onClick: () => setPopup({
              kind, title: kindLabel(kind) + " — " + ten, loai: kind === "CCDC" ? loai : "",
              multiBv: list.length > 1, keys: new Set(list.map(bvKey)),
            }),
            className: "tabular-nums text-blue-600 underline decoration-dotted underline-offset-2 hover:text-blue-800",
          }, fmtInt(n))
        : "—");
    const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
    // Hệ số dự kiến chung: Σ quota kỳ / Σ khấu hao kỳ của các BV có kỳ dự kiến
    const coDuKien = rows.filter((r) => r.du_kien && r.du_kien.khau_hao > 0);
    const khDuKien = coDuKien.reduce((s, r) => s + r.du_kien.khau_hao, 0);
    const hsDuKienChung = khDuKien > 0 ? coDuKien.reduce((s, r) => s + r.du_kien.quota, 0) / khDuKien : null;

    return h("div", { className: "space-y-4" },
      filters,
      loading && h(RefreshingBar),
      error && h(LoadingBlock, { error }),

      h("div", { className: "flex flex-wrap items-center gap-2" },
        h(FilterSelect, { label: "Loại CCDC", searchable: true, options: data.loai_options, selected: loai ? [loai] : [], onChange: (v) => setLoai(v[0] || "") }),
        h("label", { className: "flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[13px]" },
          h("span", { className: "text-slate-400" }, "Dthu sàn:"),
          h("input", {
            type: "number", min: 0, step: 1, value: sanInput, onChange: (e) => setSanInput(e.target.value),
            className: "w-14 border-0 bg-transparent p-0 text-right text-[13px] font-medium tabular-nums text-blue-700 outline-none",
          }),
          h("span", { className: "text-slate-400" }, "tỷ ₫")),
        h("div", { className: "flex-1" }),
        h("span", { className: "text-[12px] text-slate-500" },
          "CCDC: snapshot ", h("b", { className: "font-semibold text-slate-700" }, fmtKy(data.snapshot.ky_cap_nhat)),
          " · Quota: ", h("b", { className: "font-semibold text-slate-700" }, data.nam_tai_chinh),
          data.current_month ? h(React.Fragment, null, " · TH đến ", h("b", { className: "font-semibold text-slate-700" }, fmtKy(data.current_month + "-01"))) : null)),

      h("div", { className: "grid grid-cols-2 gap-3 md:grid-cols-4" },
        h(StatCard, { label: "Quota khả dụng", value: fmtTien(sum("quota_tien_con_lai")), accent: true,
          sub: "Onhand " + fmtTien(sum("quota_tien_on_hand")) + " · Upcoming " + fmtTien(sum("quota_tien_sap_toi")) }),
        h(StatCard, { label: "BV đang ký gửi", value: fmtInt(coCcdc.length), sub: "SL CCDC " + fmtInt(coCcdc.reduce((s, r) => s + r.sl, 0)) + " · SL TB " + fmtInt(sum("sl_tb")) }),
        h(StatCard, { label: "GTCL thiết bị", value: fmtTien(sum("gtcl")),
          sub: "Nguyên giá " + fmtTien(sum("nguyen_gia")) + " · HS ĐT dự kiến " + fmtLan(hsDuKienChung) }),
        h(StatCard, { label: "Ký gửi nhưng không có quota", swatch: "bg-amber-500", value: fmtInt(khongQuota.length), sub: khongQuota.length ? "Kiểm tra mã BV ↔ mã KH" : "Mọi BV ký gửi đều có quota" })),

      h(Panel, {
        title: "Quota và CCDC theo bệnh viện",
        subtitle: "Quota Onhand = thầu cũ + đợt đã tới tháng thầu · Quota Upcoming = đợt chưa tới tháng · Quota khả dụng = Onhand − TH YTD" +
          (data.dt_12t_tu ? " · Dthu TH 12T = " + fmtKy(data.dt_12t_tu + "-01") + "–" + fmtKy(data.dt_12t_den + "-01") : " · Dthu TH 12T") +
          ", xanh khi > " + sanTy + " tỷ" +
          " · Hệ số đầu tư = Dthu TH 12T / khấu hao TB 12 tháng (1 năm khấu hao)" +
          " · Hệ số đầu tư dự kiến = quota / khấu hao TB trên cùng kỳ (từ tháng này tới khi hết hiệu lực quota hoặc hết khấu hao, mốc nào sớm hơn)",
        right: h(Segmented, { options: tabs.map((t) => ({ key: t.key, label: t.label, count: t.list.length })), value: tab, onChange: setTab }),
      },
        h("div", { className: "scroll-shadow overflow-x-auto" }, h("table", { className: T.table + " min-w-[1380px]" },
          h("thead", null, h("tr", { className: T.headRow },
            h("th", { className: "px-4 py-2 text-left font-semibold" },
              h("button", {
                type: "button", title: allClosed ? "Mở rộng tất cả" : "Thu gọn tất cả",
                onClick: () => setDong(allClosed ? new Set() : new Set(groups.map((g) => g.mien))),
                className: "inline-flex items-center gap-1 uppercase hover:text-slate-700",
              }, h(allClosed ? I.ChevronRight : I.ChevronDown, { size: 13 }), "Miền / Bệnh viện")),
            h("th", { className: T.th(true) }, "SL CCDC"), h("th", { className: T.th(true) }, "SL TB"), h("th", { className: T.th(true) }, "Quota Onhand"), h("th", { className: T.th(true) }, "Quota Upcoming"),
            h("th", { className: T.th(true) }, "TH YTD"), h("th", { className: T.th(true) }, "Quota khả dụng"),
            h("th", { className: T.th(true) }, "Dthu TH 12T"), h("th", { className: T.th(true) }, "Hệ số đầu tư"),
            h("th", { className: T.th(true) }, "GTCL thiết bị"), h("th", { className: "px-4 py-2 text-right font-semibold" }, "Hệ số đầu tư dự kiến"))),
          h("tbody", null,
            groups.length === 0
              ? h("tr", null, h("td", { colSpan: 11, className: "px-4 py-8 text-center text-slate-400" }, "Không có bệnh viện nào"))
              : groups.flatMap((g) => {
                  const t = g.tong;
                  const open = !dong.has(g.mien);
                  const tenMien = g.mien || "Chưa xác định miền";
                  const parent = h("tr", { key: "m|" + g.mien, className: "border-t border-slate-200 bg-blue-50/60 font-semibold" },
                    h("td", { className: "whitespace-nowrap px-4 py-2" },
                      h("button", {
                        type: "button", onClick: () => toggle(g.mien), "aria-expanded": open,
                        className: "inline-flex items-center gap-1.5 " + (g.mien ? "text-slate-800" : "italic text-slate-500"),
                      },
                        h(open ? I.ChevronDown : I.ChevronRight, { size: 14, className: "text-slate-400" }), tenMien,
                        h("span", { className: "ml-1 rounded-full bg-white px-1.5 text-[11px] font-medium not-italic text-slate-500" }, fmtInt(g.list.length) + " BV"))),
                    slCell("CCDC", t.sl, g.list, tenMien, "text-slate-800"),
                    slCell("TB", t.sl_tb, g.list, tenMien, "text-slate-800"),
                    h("td", { className: T.num + " text-slate-700" }, t.co_quota ? fmtTien(t.quota_tien_on_hand) : "—"),
                    h("td", { className: T.num + " text-slate-700" }, t.quota_tien_sap_toi > 0 ? fmtTien(t.quota_tien_sap_toi) : "—"),
                    h("td", { className: T.num + " text-slate-700" }, t.co_quota ? fmtTien(t.dt_thuc_hien) : "—"),
                    h("td", { className: T.num + " text-slate-900" }, t.co_quota ? fmtTien(t.quota_tien_con_lai) : "—"),
                    h("td", { className: T.num + " text-slate-700" }, t.dt_12t > 0 ? fmtTien(t.dt_12t) : "—"),
                    h("td", { className: T.num + " " + hsTone(t.he_so_dau_tu),
                      title: t.khau_hao_12t > 0 ? "Σ Dthu TH 12T / Σ khấu hao 12 tháng của các BV có thiết bị khấu hao" : undefined },
                      fmtLan(t.he_so_dau_tu)),
                    h("td", { className: T.num + " text-slate-800", title: t.gtcl > 0 ? "Nguyên giá " + fmtInt(t.nguyen_gia) : undefined },
                      t.gtcl > 0 ? fmtTien(t.gtcl) : "—"),
                    h("td", { className: "whitespace-nowrap px-4 py-2 text-right tabular-nums " + hsTone(t.he_so_dau_tu_du_kien),
                      title: "Σ quota trong kỳ / Σ khấu hao trong kỳ của các BV có kỳ dự kiến" },
                      fmtLan(t.he_so_dau_tu_du_kien)));
                  if (!open) return [parent];
                  return [parent, ...g.list.map((r, i) => h("tr", { key: bvKey(r), className: T.row(i) + " align-top" },
                  h("td", { className: "min-w-[16rem] py-2 pl-10 pr-3 text-slate-800" },
                    r.ma_bv && h("span", { className: "mr-1.5 font-mono text-[11px] text-slate-400" }, r.ma_bv), r.ten_bv || "—"),
                  slCell("CCDC", r.sl, [r], r.ten_bv || r.ma_bv, "text-slate-700"),
                  slCell("TB", r.sl_tb, [r], r.ten_bv || r.ma_bv, "text-slate-700"),
                  h("td", { className: T.num + " text-slate-600" }, r.co_quota ? fmtTien(r.quota_tien_on_hand) : "—"),
                  h("td", { className: T.num + " text-slate-600" },
                    r.quota_tien_sap_toi > 0 ? h("span", null, fmtTien(r.quota_tien_sap_toi),
                      r.thang_thau_sap_toi && h("div", { className: "text-[11px] text-slate-400" }, fmtKy(r.thang_thau_sap_toi + "-01"))) : "—"),
                  h("td", { className: T.num + " text-slate-600" }, r.co_quota ? fmtTien(r.dt_thuc_hien) : "—"),
                  h("td", { className: T.num + " font-semibold text-slate-800" }, r.co_quota ? fmtTien(r.quota_tien_con_lai) : "—"),
                  h("td", { className: T.num + (r.dt_12t > sanTy * 1e9 ? " bg-emerald-50 font-semibold text-emerald-700" : " text-slate-600") },
                    r.dt_12t > 0 ? fmtTien(r.dt_12t) : "—"),
                  h("td", { className: T.num + " font-semibold " + hsTone(r.he_so_dau_tu),
                    title: r.khau_hao_12t > 0 ? "Khấu hao 12 tháng " + fmtInt(r.khau_hao_12t) : undefined },
                    fmtLan(r.he_so_dau_tu)),
                  h("td", { className: T.num + " text-slate-700",
                    title: r.gtcl > 0 ? "Nguyên giá " + fmtInt(r.nguyen_gia) + " · " + fmtInt(r.sl_co_gia) + " thiết bị có giá" : undefined },
                    r.gtcl > 0 ? fmtTien(r.gtcl) : "—"),
                  h("td", { className: "whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums " + hsTone(r.he_so_dau_tu_du_kien),
                    title: r.du_kien ? "Kỳ " + fmtKy(r.du_kien.tu + "-01") + "–" + fmtKy(r.du_kien.den + "-01") +
                      "\nQuota trong kỳ " + fmtInt(r.du_kien.quota) + "\nKhấu hao trong kỳ " + fmtInt(r.du_kien.khau_hao) : undefined },
                    fmtLan(r.he_so_dau_tu_du_kien))))];
                }))))),
      h(ItemsPopup, { snapshotId: data.snapshot.id, target: popup, onClose: () => setPopup(null) }),
    );
  }

  window.CCDC_ROUTER.register("/phan-bo", PhanBoScreen);
})();
