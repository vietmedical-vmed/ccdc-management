// Bộ lọc dùng chung của module Ký gửi (Tổng quan / Chi tiết theo kỳ / Phân bổ): FY, Nhóm SP, Miền.
// Lưu trên URL (#/path?fy=2026&nhom=…&mien=…) nên chuyển tab vẫn giữ.
(function () {
  const { useState, useEffect } = React;
  const h = React.createElement;
  const { api } = window.CCDC_API;
  const R = window.CCDC_ROUTER;
  const { FilterBar, FilterSelect, fyOf, fyLabel, useReload, btn } = window.CCDC_UI;

  const ALL_MIEN = ["Miền Bắc", "Miền Trung", "Miền Nam"];
  const KEYS = ["fy", "nhom", "mien"];

  // Danh sách snapshot dùng chung cho các tab; upload xong gọi invalidateSnapshots() để mọi màn tải lại.
  let cache = null;
  let version = 0;
  const listeners = new Set();
  const invalidateSnapshots = () => { cache = null; version++; listeners.forEach((fn) => fn(version)); };
  function loadSnapshots() {
    if (!cache) cache = api("snapshot_list").then((r) => r.rows || []).catch((e) => { cache = null; throw e; });
    return cache;
  }

  function useSnapshots() {
    const reload = useReload();
    const [ver, setVer] = useState(version);
    const [state, setState] = useState({ rows: null, error: "" });
    useEffect(() => { listeners.add(setVer); return () => { listeners.delete(setVer); }; }, []);
    useEffect(() => {
      let alive = true;
      loadSnapshots()
        .then((rows) => alive && setState({ rows, error: "" }))
        .catch((e) => alive && setState({ rows: [], error: e.message || String(e) }));
      return () => { alive = false; };
    }, [reload, ver]);
    return state;
  }

  // requireNhom: màn chỉ xem được 1 nhóm SP → khi URL chưa chọn thì lấy nhóm đầu tiên.
  function useKgFilters(user, { requireNhom = false } = {}) {
    const q = R.useQuery();
    const snaps = useSnapshots();
    const rows = snaps.rows || [];
    const curFy = fyOf();
    const fy = Number(q.get("fy")) || curFy;
    const nhomOptions = [...new Set(rows.map((s) => s.nhom_san_pham))].sort((a, b) => a.localeCompare(b, "vi"));
    const nhomRaw = q.get("nhom") || "";
    const nhom = nhomRaw && nhomOptions.includes(nhomRaw) ? nhomRaw : requireNhom ? (nhomOptions[0] || "") : (nhomRaw || "");
    const pm = user?.permission?.filterMien;
    const permMien = pm ? [].concat(pm) : null;
    const mienOptions = permMien ? ALL_MIEN.filter((m) => permMien.includes(m)) : ALL_MIEN;
    const mien = q.getAll("mien").filter((m) => mienOptions.includes(m));
    const fyOptions = [...new Set([curFy, ...rows.map((s) => Number(s.fiscal_year))])].sort((a, b) => b - a);
    return {
      fy, nhom, mien, nhomOptions, mienOptions, fyOptions, requireNhom,
      snapshots: rows, loading: snaps.rows === null, error: snaps.error,
      hasFilter: fy !== curFy || !!nhomRaw || mien.length > 0,
    };
  }

  function KgFilters({ f }) {
    return h(FilterBar, null,
      h(FilterSelect, {
        label: "Năm TC", allowAll: false, options: f.fyOptions.map((y) => ({ value: String(y), label: fyLabel(y) + " (T4/" + y + "–T3/" + (y + 1) + ")" })),
        selected: [String(f.fy)], onChange: (v) => R.setQuery({ fy: v[0] }),
      }),
      h(FilterSelect, {
        label: "Nhóm SP", searchable: true, allowAll: !f.requireNhom, options: f.nhomOptions,
        selected: f.nhom ? [f.nhom] : [], onChange: (v) => R.setQuery({ nhom: v[0] || "" }),
      }),
      f.mienOptions.length > 1 && h(FilterSelect, {
        label: "Miền", multiple: true, options: f.mienOptions, selected: f.mien, onChange: (v) => R.setQuery({ mien: v }),
      }),
      f.hasFilter && h("button", { type: "button", onClick: () => R.setQuery({ fy: "", nhom: "", mien: [] }), className: "px-1 " + btn.link }, "Bỏ lọc"),
    );
  }

  window.CCDC_KG = { useKgFilters, KgFilters, invalidateSnapshots, KEYS, ALL_MIEN };
})();
