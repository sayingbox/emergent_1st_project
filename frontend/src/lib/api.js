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

export const http = axios.create({
  baseURL: API,
  withCredentials: true,
  // Fail cleanly on the client BEFORE Cloudflare's ~100s edge timeout returns
  // a generic "invalid or incomplete response" 502 page. This surfaces our own
  // friendly error toast instead.
  timeout: 95_000,
});

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
    // Convert axios timeout + Cloudflare 502 into a clean user-facing message.
    if (error?.code === "ECONNABORTED") {
      error.response = error.response || {};
      error.response.data = error.response.data || { detail: "The request is taking too long. Please retry — a fresh attempt usually succeeds." };
    } else if (error?.response?.status === 502 || error?.response?.status === 504) {
      const html = typeof error.response.data === "string" ? error.response.data : "";
      if (html.includes("Cloudflare") || html.includes("cf-error") || html.includes("invalid or incomplete response")) {
        error.response.data = { detail: "The server took too long to respond. Please retry — a fresh attempt usually succeeds." };
      }
    }
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
