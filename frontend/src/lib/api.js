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

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e))).filter(Boolean).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
