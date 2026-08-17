// API helper: gọi edge function ccdc-login / ccdc-api.
// Convention chuẩn org:
//   - login: POST /functions/v1/ccdc-login  body = { username, password, [newPassword] }
//   - action: POST /functions/v1/ccdc-api   body = { action, token, payload }
(function () {
  const C = window.CCDC_CONFIG;
  const FN_LOGIN = C.SUPABASE_URL + "/functions/v1/" + C.FN_LOGIN_NAME;
  const FN_API   = C.SUPABASE_URL + "/functions/v1/" + C.FN_API_NAME;

  function getToken() {
    return sessionStorage.getItem(C.TOKEN_STORAGE_KEY)
        || localStorage.getItem(C.TOKEN_STORAGE_KEY)
        || "";
  }
  function setToken(token, remember) {
    (remember ? localStorage : sessionStorage).setItem(C.TOKEN_STORAGE_KEY, token);
  }
  function clearToken() {
    sessionStorage.removeItem(C.TOKEN_STORAGE_KEY);
    localStorage.removeItem(C.TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(C.USER_STORAGE_KEY);
    localStorage.removeItem(C.USER_STORAGE_KEY);
  }

  function getUser() {
    const s = sessionStorage.getItem(C.USER_STORAGE_KEY)
           || localStorage.getItem(C.USER_STORAGE_KEY);
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  }
  function setUser(user, remember) {
    (remember ? localStorage : sessionStorage).setItem(
      C.USER_STORAGE_KEY, JSON.stringify(user)
    );
  }

  async function api(action, payload = {}) {
    const isLogin = action === "login";
    const url = isLogin ? FN_LOGIN : FN_API;
    const bodyObj = isLogin ? payload : { action, token: getToken(), payload };

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": C.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + C.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(bodyObj),
      });
    } catch (e) {
      throw new Error("Không kết nối được máy chủ: " + ((e && e.message) || e));
    }

    let data = null;
    try { data = await res.json(); } catch { /* body rỗng / không phải JSON */ }

    if (!res.ok || (data && data.ok === false)) {
      const err = (data && data.error) || ("HTTP " + res.status);
      if (err === "unauthorized") clearToken();
      throw new Error(err);
    }
    if (!data) throw new Error("Máy chủ trả về dữ liệu rỗng");
    return data;
  }

  window.CCDC_API = { api, getToken, setToken, clearToken, getUser, setUser };
})();
