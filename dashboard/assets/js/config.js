// Cấu hình endpoint. Cùng Supabase project với sale-target/order/kpi
// nên user shared.users dùng chung, token do ccdc-login phát ra.
window.CCDC_CONFIG = {
  SUPABASE_URL: "https://nrfxymnfmjhbsgpipvkb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yZnh5bW5mbWpoYnNncGlwdmtiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODk2OTQsImV4cCI6MjA5ODQ2NTY5NH0.cN-jTdPOLWKd9kNa1nNMENzHcY0_BftyYgPEbuVTWeo",
  FN_LOGIN_NAME: "ccdc-login",
  FN_API_NAME:   "ccdc-api",
  TOKEN_STORAGE_KEY: "ccdc.token.v1",
  USER_STORAGE_KEY:  "ccdc.user.v1",
};
