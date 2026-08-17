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

  const initials = (u) => {
    const src = (u.ho_ten || u.username || "").trim();
    if (!src) return "CT";
    const parts = src.split(/\s+/);
    const s = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : src.slice(0, 2);
    return s.toUpperCase();
  };

  function Shell({ user, onLogout }) {
    const path = R.useRoute();
    const Screen = R.get(path);
    const subtitle = user.ho_ten || user.username || "—";

    return h("div", { className: "min-h-screen bg-slate-50" },
      h("header", { className: "bg-white border-b border-slate-200" },
        h("div", { className: "max-w-7xl mx-auto px-4" },
          // Hàng trên: avatar + tiêu đề · credit góc phải + nút
          h("div", { className: "flex items-start justify-between pt-3 gap-4" },
            h("div", { className: "flex items-center gap-3" },
              h("div", {
                className: "w-11 h-11 rounded-full bg-blue-500 text-white grid place-items-center font-bold text-sm shrink-0",
              }, initials(user)),
              h("div", { className: "leading-tight" },
                h("div", { className: "font-bold text-slate-900 text-base md:text-lg" }, "QUẢN LÝ CCDC & THIẾT BỊ"),
                h("div", { className: "text-xs text-slate-500 mt-0.5" }, subtitle),
              ),
            ),
            h("div", { className: "flex flex-col items-end gap-2" },
              h("div", { className: "text-[11px] text-slate-400 italic hidden md:block" },
                "Designed and developed by ",
                h("span", { className: "font-semibold text-slate-500 not-italic" }, "Do Hoang Giang"),
              ),
              h("div", { className: "flex items-center gap-2" },
                h("button", {
                  onClick: () => window.location.reload(),
                  className: "flex items-center gap-1.5 text-xs text-slate-600 hover:bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-md",
                }, h("span", null, "⟳"), "Reload"),
                h("button", {
                  onClick: onLogout,
                  className: "flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-600 hover:border-red-200 border border-slate-200 px-2.5 py-1.5 rounded-md",
                }, h("span", null, "⎋"), "Đăng xuất"),
              ),
            ),
          ),
          // Hàng dưới: tab gạch chân
          h("nav", { className: "flex items-center gap-5 md:gap-6 mt-3 overflow-x-auto" },
            NAV.map((it) => h("button", {
              key: it.path,
              onClick: () => R.navigate(it.path),
              className: "relative px-0.5 pb-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors " +
                (path === it.path
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"),
            }, it.label)),
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
