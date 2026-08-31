import axios from "axios";

const envBackend = process.env.REACT_APP_BACKEND_URL;
const sameHost = (() => {
  try {
    return new URL(envBackend).origin === window.location.origin;
  } catch {
    return false;
  }
})();
const BACKEND_URL = sameHost ? envBackend : window.location.origin;
export const API = `${BACKEND_URL}/api`;

export const http = axios.create({ baseURL: API, withCredentials: true });

// ---- 401 auto-logout ----
// Endpoints that legitimately return 401 without meaning "session expired".
const AUTH_PROBE_PATHS = ["/auth/login", "/auth/register", "/auth/me"];
let onUnauthorized = null;

/** Register a handler (called from AuthContext) that fires when any authed request 401s. */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

http.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url || "";
    if (status === 401 && !AUTH_PROBE_PATHS.some((p) => url.endsWith(p))) {
      try {
        onUnauthorized && onUnauthorized();
      } catch {
        /* ignore */
      }
    }
    return Promise.reject(error);
  },
);

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
