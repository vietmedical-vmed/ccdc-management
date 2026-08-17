// Hash router tối giản: #/dashboard, #/dm-vat-tu, #/giao-dich, #/tai-san, #/ngan-sach
// Đăng ký screen: CCDC_ROUTER.register(path, component). Bootstrap gọi useRoute() để lấy path hiện tại.
(function () {
  const { useState, useEffect } = React;

  const registry = new Map();
  function register(path, component) { registry.set(path, component); }
  function get(path) { return registry.get(path); }
  function list() { return Array.from(registry.keys()); }

  function currentPath() {
    const h = (window.location.hash || "").replace(/^#/, "");
    return h || "/dashboard";
  }
  function navigate(path) {
    if (!path.startsWith("/")) path = "/" + path;
    if (currentPath() !== path) window.location.hash = path;
  }
  function useRoute() {
    const [path, setPath] = useState(currentPath());
    useEffect(() => {
      const onHash = () => setPath(currentPath());
      window.addEventListener("hashchange", onHash);
      return () => window.removeEventListener("hashchange", onHash);
    }, []);
    return path;
  }

  window.CCDC_ROUTER = { register, get, list, currentPath, navigate, useRoute };
})();
