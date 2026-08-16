/**
 * jobRegistry — a small module-level store that lets an in-flight scan survive
 * a page unmount.  Two kinds of "jobs" are supported:
 *
 *   1. Polling jobs  (Domain Analysis, AEO Content Optimizer)
 *        POST /path  →  { id }
 *        GET  /path/{id}  →  { status: "processing" | "done" | "error", ...result }
 *      The status endpoint is polled every 3 s until done/error, at the module
 *      level, so navigating away from the page does NOT cancel the poll.
 *
 *   2. Single-shot jobs (Visibility, Citations, Reddit)
 *        POST /path  →  full result JSON in a single response
 *      The axios promise is kept in the registry so a returning component can
 *      subscribe to it.
 *
 * A page component uses `subscribe(key, cb)` on mount.  `cb` is called
 * synchronously with the current snapshot AND on every state change afterwards
 * ({ status: "idle" | "running" | "done" | "error", result?, error? }).
 *
 * The registry also mirrors the *jobId* to sessionStorage so a HARD reload
 * (F5 while a Domain Analysis is running) can still resume the poll.
 */

import { http } from "@/lib/api";

const _state = new Map();        // key -> { status, result?, error?, jobId?, startedAt }
const _listeners = new Map();    // key -> Set<cb>
const _polls = new Map();        // key -> interval id
const _promises = new Map();     // key -> Promise (single-shot in-flight)

const SS_JOB_KEY = (key) => `job:${key}:jobId`;
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_SECONDS = 240; // 4 minutes hard cap

function _emit(key) {
  const snap = _state.get(key) || { status: "idle" };
  const subs = _listeners.get(key);
  if (subs) subs.forEach((cb) => {
    try { cb(snap); } catch { /* ignore */ }
  });
}

function _set(key, patch) {
  const cur = _state.get(key) || { status: "idle" };
  _state.set(key, { ...cur, ...patch });
  _emit(key);
}

export function getState(key) {
  return _state.get(key) || { status: "idle" };
}

export function subscribe(key, cb) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(cb);
  // Fire once with current snapshot so late subscribers see the running state
  try { cb(getState(key)); } catch { /* ignore */ }
  return () => {
    const set = _listeners.get(key);
    if (set) set.delete(cb);
  };
}

/** Manually replace the result (e.g. when the user clicks a "past" card). */
export function setResult(key, result) {
  _set(key, { status: "done", result, error: undefined });
}

/** Clear the state for a key (e.g. after acknowledging an error). */
export function reset(key) {
  const iid = _polls.get(key);
  if (iid) { clearInterval(iid); _polls.delete(key); }
  _promises.delete(key);
  _state.delete(key);
  try { window.sessionStorage.removeItem(SS_JOB_KEY(key)); } catch { /* ignore */ }
  _emit(key);
}

/** Wipe the entire registry — used on logout so a returning user doesn't see the previous user's data. */
export function clearAll() {
  _polls.forEach((iid) => clearInterval(iid));
  _polls.clear();
  _promises.clear();
  _state.clear();
  _listeners.forEach((set) => set.clear());
  // Note: listeners themselves are NOT removed — mounted components still hold their unsubscribe
  // closures; they'll simply stop receiving updates until they subscribe again.
}

// ---------- polling jobs -----------------------------------------------------

/**
 * Start a polling job.  `postPath` is called with `postBody`; the returned
 * `{id}` is polled at `statusPathTemplate.replace("{id}", id)` every 3 s.
 */
export async function startPollingJob({ key, postPath, postBody, statusPathTemplate }) {
  // Nothing running yet — kick off the POST
  _set(key, { status: "running", result: undefined, error: undefined, startedAt: Date.now() });
  let jobId;
  try {
    const { data } = await http.post(postPath, postBody);
    jobId = data.id;
    if (!jobId) throw new Error("Server did not return a job id");
    _set(key, { jobId });
    try { window.sessionStorage.setItem(SS_JOB_KEY(key), jobId); } catch { /* ignore */ }
  } catch (e) {
    _set(key, { status: "error", error: e });
    throw e;
  }
  _startPollingInterval(key, statusPathTemplate.replace("{id}", jobId));
}

/**
 * Resume polling for a jobId that was previously started (either persisted in
 * sessionStorage from a hard reload, or already running from an earlier mount).
 * Called by page components on mount when they detect a saved job id.
 */
export function resumePollingJob({ key, jobId, statusPathTemplate }) {
  // If we're already polling this key, nothing to do.
  if (_polls.has(key)) return;
  _set(key, { status: "running", jobId, startedAt: Date.now() });
  _startPollingInterval(key, statusPathTemplate.replace("{id}", jobId));
}

function _startPollingInterval(key, statusUrl) {
  // Fire one immediate check, then interval
  let elapsed = 0;
  const check = async () => {
    try {
      const { data } = await http.get(statusUrl);
      if (data.status === "done") {
        clearInterval(_polls.get(key));
        _polls.delete(key);
        try { window.sessionStorage.removeItem(SS_JOB_KEY(key)); } catch { /* ignore */ }
        _set(key, { status: "done", result: data, error: undefined });
      } else if (data.status === "error") {
        clearInterval(_polls.get(key));
        _polls.delete(key);
        try { window.sessionStorage.removeItem(SS_JOB_KEY(key)); } catch { /* ignore */ }
        _set(key, { status: "error", error: data.error || "Scan failed" });
      }
      // else: still processing — keep polling
    } catch (e) {
      // Network error while polling => treat as error (matches prior behaviour)
      clearInterval(_polls.get(key));
      _polls.delete(key);
      try { window.sessionStorage.removeItem(SS_JOB_KEY(key)); } catch { /* ignore */ }
      _set(key, { status: "error", error: e });
    }
  };
  check(); // immediate check
  const iid = setInterval(async () => {
    elapsed += POLL_INTERVAL_MS / 1000;
    if (elapsed > POLL_MAX_SECONDS) {
      clearInterval(iid);
      _polls.delete(key);
      try { window.sessionStorage.removeItem(SS_JOB_KEY(key)); } catch { /* ignore */ }
      _set(key, { status: "error", error: "Timed out" });
      return;
    }
    check();
  }, POLL_INTERVAL_MS);
  _polls.set(key, iid);
}

/** Read a persisted jobId (used by pages to see if they should resume on mount). */
export function readPersistedJobId(key) {
  try { return window.sessionStorage.getItem(SS_JOB_KEY(key)); } catch { return null; }
}

// ---------- single-shot jobs -------------------------------------------------

/**
 * Fire a single-shot POST that returns the result in one response.
 * The Promise is kept in the registry so navigating away and back before it
 * completes will still surface the result on the returning page.
 */
export function startSingleShotJob({ key, postPath, postBody }) {
  // If one is already in-flight for this key just return it (dedupe).
  if (_promises.has(key)) return _promises.get(key);
  _set(key, { status: "running", result: undefined, error: undefined, startedAt: Date.now() });
  const p = http.post(postPath, postBody)
    .then((r) => {
      _set(key, { status: "done", result: r.data, error: undefined });
      return r.data;
    })
    .catch((e) => {
      _set(key, { status: "error", error: e });
      throw e;
    })
    .finally(() => {
      _promises.delete(key);
    });
  _promises.set(key, p);
  return p;
}

/** True if a single-shot request is currently in flight for this key. */
export function hasSingleShotInFlight(key) {
  return _promises.has(key);
}
