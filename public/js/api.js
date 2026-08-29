/**
 * api.js
 * ------------------------------------------------------------------
 * Tiny fetch wrapper shared by every page. Keeps the backend URL and
 * auth header logic in exactly one place instead of copy-pasted
 * across every page's script.
 * ------------------------------------------------------------------
 */

const Session = {
  save(token, role, user) {
    localStorage.setItem("ms_token", token);
    localStorage.setItem("ms_role", role);
    localStorage.setItem("ms_user", JSON.stringify(user));
  },
  token() { return localStorage.getItem("ms_token"); },
  role() { return localStorage.getItem("ms_role"); },
  user() {
    const raw = localStorage.getItem("ms_user");
    return raw ? JSON.parse(raw) : null;
  },
  clear() {
    localStorage.removeItem("ms_token");
    localStorage.removeItem("ms_role");
    localStorage.removeItem("ms_user");
  },
  /** Redirects to login if not authenticated as the expected role. */
  requireRole(expectedRole) {
    if (!this.token() || this.role() !== expectedRole) {
      window.location.href = "/login.html";
    }
  },
};

const Api = {
  async request(method, path, body, isFormData = false) {
    const headers = {};
    if (Session.token()) headers["Authorization"] = `Bearer ${Session.token()}`;
    if (!isFormData) headers["Content-Type"] = "application/json";

    const res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });

    if (res.status === 401) {
      Session.clear();
      window.location.href = "/login.html";
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  },
  get(path) { return this.request("GET", path); },
  post(path, body) { return this.request("POST", path, body); },
  put(path, body) { return this.request("PUT", path, body); },
  postForm(path, formData) { return this.request("POST", path, formData, true); },
};

function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
