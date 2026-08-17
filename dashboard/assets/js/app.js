// Bootstrap: check token → render LoginGate hoặc Shell với router.
(function () {
  const { useState, useEffect } = React;
  const h = React.createElement;
  const { LoginGate } = window.CCDC_AUTH;
  const { api, getToken, getUser, clearToken } = window.CCDC_API;
  const R = window.CCDC_ROUTER;

  const NAV = [
    { path: "/dashboard",  label: "Tổng quan" },
    { path: "/dm-vat-tu",  label: "Danh mục" },
    { path: "/giao-dich",  label: "Giao dịch" },
    { path: "/tai-san",    label: "Tài sản" },
    { path: "/ngan-sach",  label: "Ngân sách" },
  ];

  function Shell({ user, onLogout }) {
    const path = R.useRoute();
    const Screen = R.get(path);

    return h("div", { className: "min-h-screen bg-slate-50" },
      h("header", { className: "bg-white border-b border-slate-200" },
        h("div", { className: "max-w-7xl mx-auto px-4 h-14 flex items-center gap-4" },
          h("div", { className: "flex items-center gap-2" },
            h("div", {
              className: "w-8 h-8 rounded-md bg-blue-500 text-white grid place-items-center font-bold text-sm",
            }, "CT"),
            h("div", { className: "font-semibold text-slate-900 text-sm" }, "Quản lý CCDC & Thiết bị"),
          ),
          h("nav", { className: "flex items-center gap-1 ml-4 flex-1" },
            NAV.map((it) => h("button", {
              key: it.path,
              onClick: () => R.navigate(it.path),
              className: "px-3 py-1.5 rounded-md text-sm font-medium " +
                (path === it.path
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-100"),
            }, it.label)),
          ),
          h("div", { className: "flex items-center gap-3" },
            h("div", { className: "text-xs text-slate-600" },
              h("div", { className: "font-semibold text-slate-900" }, user.ho_ten || user.username),
              h("div", null, user.role || "—"),
            ),
            h("button", {
              onClick: onLogout,
              className: "text-xs text-slate-600 hover:text-red-600 border border-slate-200 px-2 py-1 rounded",
            }, "Đăng xuất"),
            h("div", { className: "text-[10px] text-slate-400 italic border-l border-slate-200 pl-3 hidden md:block" },
              "Designed and developed by ",
              h("span", { className: "font-semibold text-slate-500 not-italic" }, "Do Hoang Giang"),
            ),
          ),
        ),
      ),
      h("main", { className: "max-w-7xl mx-auto" },
        Screen
          ? h(Screen, { user })
          : h("div", { className: "p-6 text-slate-500 text-sm" }, "Màn hình chưa được xây: ", path),
      ),
    );
  }

  function App() {
    const [user, setUser] = useState(getUser());
    const [checking, setChecking] = useState(!!getToken());

    // Verify token hiện có bằng whoami khi khởi động (nếu có token nhưng chưa có user)
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

    // Ẩn boot spinner khi App đã mount
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
