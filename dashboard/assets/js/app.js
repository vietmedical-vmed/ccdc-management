// Bootstrap: check token → render LoginGate hoặc Shell với router.
// Shell cùng bố cục bidding-and-contract: header (module + user + Reload/Đăng xuất), hàng "Lọc", tab gạch chân.
(function () {
  const { useState, useEffect, useMemo } = React;
  const h = React.createElement;
  const { LoginGate } = window.CCDC_AUTH;
  const { api, getToken, getUser, clearToken } = window.CCDC_API;
  const R = window.CCDC_ROUTER;
  const { I, ReloadContext, FilterSlotContext } = window.CCDC_UI;

  const MODULES = {
    kygui: {
      title: "KÝ GỬI CCDC & THIẾT BỊ",
      label: "Ký gửi",
      keys: window.CCDC_KG.KEYS,
      tabs: [
        { path: "/dashboard", label: "Tổng quan" },
        { path: "/ky-gui", label: "Chi tiết theo kỳ" },
        { path: "/phan-bo", label: "Phân bổ theo quota" },
      ],
    },
    taisan: {
      title: "TÀI SẢN CCDC & THIẾT BỊ",
      label: "Tài sản",
      keys: [],
      tabs: [{ path: "/tai-san", label: "Danh sách tài sản" }],
    },
  };
  const moduleOf = (path) =>
    Object.keys(MODULES).find((id) => MODULES[id].tabs.some((t) => t.path === path)) || "kygui";

  const ROLE_BADGE = {
    admin:   { label: "Admin",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
    manager: { label: "Manager", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    pm:      { label: "PM",      cls: "bg-violet-50 text-violet-700 border-violet-200" },
    am:      { label: "AM",      cls: "bg-teal-50 text-teal-700 border-teal-200" },
  };

  const initials = (u) => {
    const src = (u.ho_ten || u.username || "").trim();
    if (!src) return "CT";
    const parts = src.split(/\s+/);
    return (parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : src.slice(0, 2)).toUpperCase();
  };

  function Shell({ user, onLogout }) {
    const path = R.useRoute();
    const query = R.useQuery();
    const Screen = R.get(path);
    const modId = moduleOf(path);
    const mod = MODULES[modId];
    const badge = ROLE_BADGE[user.role];

    const [nonce, setNonce] = useState(0);
    const [slotEl, setSlotEl] = useState(null);
    const [filterCount, setFilterCount] = useState(0);
    const slot = useMemo(() => ({
      el: slotEl,
      mount: () => setFilterCount((n) => n + 1),
      unmount: () => setFilterCount((n) => n - 1),
    }), [slotEl]);

    const keep = new URLSearchParams();
    for (const k of mod.keys) query.getAll(k).forEach((v) => keep.append(k, v));

    const reload = () => { window.CCDC_KG.invalidateSnapshots(); setNonce((n) => n + 1); };

    return h(ReloadContext.Provider, { value: nonce },
      h(FilterSlotContext.Provider, { value: slot },
        h("div", { className: "min-h-screen" },
          h("header", { className: "sticky top-0 z-30 border-b border-slate-200 bg-white" },
            h("div", { className: "flex flex-wrap items-center justify-between gap-4 px-4 py-3 md:px-6" },
              h("div", { className: "flex flex-wrap items-center gap-x-6 gap-y-2" },
                h("div", { className: "flex items-center gap-3" },
                  h("div", { className: "grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-500 text-sm font-bold text-white" }, initials(user)),
                  h("div", { className: "leading-tight" },
                    h("div", { className: "text-base font-bold text-slate-900 md:text-lg" }, mod.title),
                    h("div", { className: "mt-0.5 flex items-center gap-2 text-xs text-slate-500" },
                      user.ho_ten || user.username,
                      badge && h("span", { className: "rounded border px-1.5 py-0.5 text-[10px] font-semibold " + badge.cls }, badge.label)))),
                h("div", { className: "flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5" },
                  Object.keys(MODULES).map((id) => h("a", {
                    key: id, href: R.href(MODULES[id].tabs[0].path),
                    className: "rounded px-3 py-1 text-[13px] " + (id === modId ? "bg-white font-semibold text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"),
                  }, MODULES[id].label))),
              ),
              h("div", { className: "flex flex-col items-end gap-2" },
                h("div", { className: "text-right text-[9px] italic text-slate-400" },
                  "Designed and developed by ", h("span", { className: "font-semibold not-italic text-slate-500" }, "Do Hoang Giang")),
                h("div", { className: "flex items-center gap-2" },
                  h("button", { type: "button", onClick: reload,
                    className: "flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-blue-700" },
                    h(I.RefreshCw, { size: 14 }), "Reload"),
                  h("button", { type: "button", onClick: onLogout,
                    className: "flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700" },
                    h(I.LogOut, { size: 14 }), "Đăng xuất"))),
            ),

            h("div", { className: "flex flex-wrap items-center gap-2.5 border-t border-slate-100 px-4 py-2 md:px-6" + (filterCount > 0 ? "" : " hidden") },
              h("span", { className: "pl-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500" }, "Lọc"),
              h("div", { ref: setSlotEl, className: "contents" })),

            h("nav", { className: "flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-4 md:px-6" },
              mod.tabs.map((t) => h("a", {
                key: t.path, href: R.href(t.path, keep),
                className: "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors " +
                  (t.path === path ? "border-blue-500 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-700"),
              }, t.label))),
          ),

          h("main", { className: "px-4 py-4 md:px-6" },
            Screen
              ? h(Screen, { key: path, user })
              : h("div", { className: "text-[13px] text-slate-500" }, "Màn hình chưa được xây: ", path)),
        )));
  }

  function App() {
    const [user, setUser] = useState(getUser());
    const [checking, setChecking] = useState(!!getToken());

    useEffect(() => {
      if (!getToken()) { setChecking(false); return; }
      let alive = true;
      api("whoami").then((res) => {
        if (!alive) return;
        if (res && res.ok && res.user) {
          setUser({
            username: res.user.username,
            ho_ten: res.user.ho_ten || res.user.username,
            role: String(res.user.role || "").toLowerCase(),
            scope: res.user.scope || "",
            bu: res.user.bu || "",
            mien: res.user.mien || "",
            permission: res.permission || {},
          });
        } else {
          clearToken();
          setUser(null);
        }
        setChecking(false);
      }).catch(() => {
        clearToken();
        setUser(null);
        setChecking(false);
      });
      return () => { alive = false; };
    }, []);

    const onLogout = () => { clearToken(); setUser(null); window.location.hash = ""; };

    // Mở mới/điều hướng vào trang → luôn về Tổng quan; bấm Reload/F5 → giữ màn đang xem
    useEffect(() => {
      try {
        const nav = performance.getEntriesByType("navigation")[0];
        const navType = nav ? nav.type : "navigate";
        if (navType !== "reload" && R.currentPath() !== "/dashboard") {
          window.location.hash = "/dashboard";
        }
      } catch (_) { /* bỏ qua nếu API không hỗ trợ */ }
    }, []);

    useEffect(() => {
      const boot = document.getElementById("boot");
      if (boot) boot.style.display = "none";
    }, []);

    if (checking) return h("div", { className: "min-h-screen flex items-center justify-center text-sm text-slate-500" }, "Đang kiểm tra phiên đăng nhập…");
    if (!user)   return h(LoginGate, { onAuth: setUser });
    return h(Shell, { user, onLogout });
  }

  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(h(App));
})();
