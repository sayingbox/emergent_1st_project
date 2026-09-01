import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { http, formatApiErrorDetail, setUnauthorizedHandler } from "@/lib/api";
import { clearAll as clearJobRegistry } from "@/lib/jobRegistry";
import { toast } from "sonner";

const AuthContext = createContext(null);

// How often we silently re-check the session with the backend.
// Any expiry will be caught here (or by the 401 interceptor on any protected request).
const SESSION_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// Session-scoped keys that hold per-page inputs / results; wiped on logout.
const SESSION_KEYS_PREFIXES = [
  "domain-analysis:",
  "visibility:",
  "citations:",
  "reddit:",
  "optimizer:",
  "job:", // in-flight job ids persisted by jobRegistry
];

function clearPersistedSession() {
  // Wipe the in-memory job registry so a re-login (potentially by a different user)
  // doesn't inherit the previous session's results / in-flight scans.
  try { clearJobRegistry(); } catch { /* ignore */ }
  try {
    const toRemove = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && SESSION_KEYS_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
    }
    toRemove.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = anon, object = user
  const [ready, setReady] = useState(false);
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Boot: check who we are.
  useEffect(() => {
    http.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setUser(false))
      .finally(() => setReady(true));
  }, []);

  // Handle a 401 from any authed request => session expired: log the user out cleanly.
  const forceLogout = useCallback(() => {
    // Only react if we thought we were logged in.
    if (!userRef.current) return;
    clearPersistedSession();
    setUser(false);
    toast.error("Your session has expired. Please sign in again.");
    // Small delay to let the toast render before redirect (react-router will handle the route change).
    try {
      if (window.location.pathname !== "/login") {
        window.location.replace("/login");
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(forceLogout);
    return () => setUnauthorizedHandler(null);
  }, [forceLogout]);

  // Periodic background session probe. If cookie has expired the backend returns 401
  // and the interceptor above will fire forceLogout.
  useEffect(() => {
    if (!user) return undefined;
    const id = setInterval(() => {
      http.get("/auth/me").catch(() => {
        /* interceptor handles 401 */
      });
    }, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [user]);

  const login = async (email, password, remember = false) => {
    try {
      const { data } = await http.post("/auth/login", { email, password, remember });
      setUser(data);
      return { ok: true, user: data };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  };

  const register = async (name, email, password) => {
    try {
      const { data } = await http.post("/auth/register", { name, email, password });
      setUser(data);
      return { ok: true, user: data };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  };

  const logout = async () => {
    await http.post("/auth/logout").catch(() => {});
    clearPersistedSession();
    setUser(false);
  };

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await http.get("/auth/me");
      setUser(data);
      return data;
    } catch {
      setUser(false);
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
