import { useState, useEffect, useRef } from "react";

/**
 * useSessionState — a drop-in replacement for useState that persists the value to sessionStorage.
 * This lets a page keep its inputs / results when the user navigates away and comes back.
 *
 * @param {string} key      Unique storage key (e.g. "domain-analysis:input")
 * @param {*}      initial  Initial value if nothing is stored yet
 */
export function useSessionState(key, initial) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw !== null && raw !== undefined) return JSON.parse(raw);
    } catch {
      /* ignore parse errors */
    }
    return initial;
  });

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    try {
      if (value === undefined) {
        window.sessionStorage.removeItem(key);
      } else {
        window.sessionStorage.setItem(key, JSON.stringify(value));
      }
    } catch {
      /* quota / serialization errors ignored */
    }
  }, [key, value]);

  return [value, setValue];
}

export default useSessionState;
