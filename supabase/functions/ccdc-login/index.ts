// Supabase Edge Function: ccdc-login
// Pattern chuẩn chung org (giống sale_target-login, order-login, kpi login):
//   - Đọc shared.users, xác thực SHA-256(salt:pw) hoặc SHA-256(pw) nếu không salt
//   - Phát token = base64url(payloadJSON) + "." + base64url(HMAC-SHA256), hạn 8h
//   - Ký bằng TOKEN_SECRET (dùng chung mọi app trong project)
//
// Deploy:
//   supabase functions deploy ccdc-login --no-verify-jwt --project-ref nrfxymnfmjhbsgpipvkb
// Secret (một lần cho cả project, nếu chưa có):
//   supabase secrets set TOKEN_SECRET=<chuoi_bi_mat_dai>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const enc = new TextEncoder();

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes: Uint8Array) {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return new Uint8Array(sig);
}

async function signToken(payload: Record<string, unknown>, secret: string) {
  const p = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(secret, p));
  return `${p}.${sig}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  const secret = Deno.env.get("TOKEN_SECRET");
  if (!secret) return json({ ok: false, error: "TOKEN_SECRET chua duoc set" }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_body" }, 400); }

  const { username, password, newPassword } = body ?? {};
  if (!username || !password) return json({ ok: false, error: "missing_credentials" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: user, error } = await admin
    .schema("shared").from("users")
    .select("username, password_hash, salt, role, scope, bu, mien, ho_va_ten")
    .eq("username", username)
    .maybeSingle();

  if (error || !user) return json({ ok: false, error: "invalid" }, 401);

  const toHash = user.salt ? (user.salt + ":" + password) : password;
  const inputHash = await sha256Hex(toHash);
  if (inputHash.toLowerCase() !== String(user.password_hash).toLowerCase()) {
    return json({ ok: false, error: "invalid" }, 401);
  }

  // Đổi mật khẩu: xác thực xong thì update, KHÔNG phát token → user đăng nhập lại
  if (newPassword !== undefined && newPassword !== null && newPassword !== "") {
    if (String(newPassword).length < 6) return json({ ok: false, error: "weak_password" }, 400);
    if (String(newPassword) === String(password)) return json({ ok: false, error: "same_password" }, 400);
    const newHash = await sha256Hex(user.salt ? (user.salt + ":" + String(newPassword)) : String(newPassword));
    const { error: upErr } = await admin
      .schema("shared").from("users")
      .update({ password_hash: newHash })
      .eq("username", user.username);
    if (upErr) return json({ ok: false, error: "update_failed" }, 500);
    return json({ ok: true, changed: true });
  }

  const exp = Math.floor(Date.now() / 1000) + 8 * 60 * 60;
  const token = await signToken(
    {
      username: user.username,
      ho_ten: user.ho_va_ten || user.username,
      role: String(user.role || "").toLowerCase(),
      mien: user.mien || "MB",
      bu: user.bu ?? "",
      scope: user.scope ?? "",
      exp,
    },
    secret,
  );

  return json({
    ok: true,
    token,
    username: user.username,
    ho_ten: user.ho_va_ten || user.username,
    role: user.role,
    scope: user.scope,
    bu: user.bu,
    mien: user.mien,
  });
});
