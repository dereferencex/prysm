/**
 * In-process ring-buffer log store for the in-app log viewer.
 *
 * Captures four sources of logs (see {@link LogSource}):
 *   - "js"      — JS console.log / warn / error and React error-boundary catches.
 *   - "native"  — lines streamed from `logcat` (filtered to the app PID).
 *   - "crash"   — stack-trace files written by NativeCrashHandler before a
 *                 native crash killed the process, surfaced on next launch.
 *   - "network" — fetch / XMLHttpRequest calls logged by the network wrapper.
 *
 * Bounded to {@link MAX_ENTRIES} so memory stays predictable on low-end
 * Android TV boxes. Entries are also persisted to AsyncStorage (debounced,
 * newest {@link PERSIST_MAX_ENTRIES} only) so the previous session survives
 * app restarts; call {@link loadPersistedLogs} once at startup and
 * {@link flushLogs} when the app backgrounds.
 *
 * Every stored message is clamped to {@link MAX_MESSAGE_LENGTH} and has
 * credential-looking URLs redacted before it enters the buffer — this also
 * protects the Share/export path in LogsScreen for free.
 *
 * Callers subscribe via {@link subscribe}; notifications are coalesced to at
 * most one per {@link NOTIFY_THROTTLE_MS}, so a logcat storm costs ~5
 * consumer renders/second regardless of line rate.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogSource = "js" | "native" | "crash" | "network";

export interface LogEntry {
  /** Unix timestamp (ms). */
  ts: number;
  level: LogLevel;
  source: LogSource;
  /** Source tag, e.g. a logger name or PID:tag. */
  tag?: string;
  message: string;
}

const MAX_ENTRIES = 2000;
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

// AsyncStorage key + bounds for disk persistence. Only the newest slice of
// the buffer is written back — keeps stringify + flash wear small.
const STORAGE_KEY = "prysm_logs";
const PERSIST_MAX_ENTRIES = 500;
const PERSIST_DEBOUNCE_MS = 1500;

// A single huge log line (logged response body, playlist object, ...) must
// not dominate memory or the persisted payload.
export const MAX_MESSAGE_LENGTH = 2048;

// Listener notifications are coalesced: during log storms consumers should
// re-render at most ~5×/second instead of once per line.
const NOTIFY_THROTTLE_MS = 200;

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/g;
const REDACT_KEY_RE =
  /(token|api[_-]?key|passwd|password|secret|auth|authorization|signature|sig|credential)/i;

/**
 * Mask credential-looking query params and userinfo (`user:pass@host`) in a
 * URL, then cap its length.
 */
export function redactUrl(raw: string, maxLen = 512): string {
  try {
    const parsed = new URL(raw);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    const search = new URLSearchParams(parsed.search);
    let touched = false;
    for (const key of Array.from(search.keys())) {
      if (REDACT_KEY_RE.test(key)) {
        search.set(key, "***");
        touched = true;
      }
    }
    if (touched) parsed.search = search.toString();
    const out = parsed.toString();
    return out.length > maxLen ? `${out.slice(0, maxLen)}...` : out;
  } catch {
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}...` : raw;
  }
}

/** Redact URLs embedded in free-form text (native/player/network lines). */
function redactEmbeddedUrls(message: string): string {
  if (!message.includes("://")) return message;
  return message.replace(URL_RE, (m) => redactUrl(m));
}

function clampMessage(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
    : message;
}

const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPending = false;
let persistedLoaded = false;

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

// Cap how many entries the buffer keeps; trades detail for memory.
function trim(): void {
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

function notifyListeners(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // listener errors must not break the capture pipeline
    }
  }
}

/** Coalesce writes so the logcat hot path never blocks on storage I/O. */
function schedulePersist(): void {
  if (persistPending) return;
  persistPending = true;
  persistTimer = setTimeout(() => {
    persistPending = false;
    persistTimer = null;
    void persistToStorage();
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Coalesce listener notifications: at most one fire per throttle window no
 * matter how many entries arrived, keeping storm-time render cost flat.
 */
function scheduleNotify(): void {
  if (notifyTimer !== null) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    notifyListeners();
  }, NOTIFY_THROTTLE_MS);
}

async function persistToStorage(): Promise<void> {
  try {
    const snapshot = entries.slice(-PERSIST_MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Persistence must never break the capture pipeline.
  }
}

/**
 * Load the previous session's entries from disk. Safe to call once at
 * startup; subsequent calls are no-ops. Appends a session marker and
 * re-sorts by timestamp so old → new ordering is preserved.
 */
export async function loadPersistedLogs(): Promise<void> {
  if (persistedLoaded) return;
  persistedLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const valid = (parsed as LogEntry[]).filter(
      (e): e is LogEntry =>
        !!e &&
        typeof e.ts === "number" &&
        typeof e.message === "string" &&
        typeof e.level === "string",
    );
    if (valid.length === 0) return;
    entries.push(...valid);
    entries.push({
      ts: Date.now(),
      level: "info",
      source: "js",
      tag: "LogCapture",
      message: "==== previous session loaded ====",
    });
    entries.sort((a, b) => a.ts - b.ts);
    trim();
    scheduleNotify();
  } catch {
    // Unreadable/corrupt persisted logs — start fresh.
  }
}

/** Immediately write the current buffer to disk (e.g. on app background). */
export function flushLogs(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistPending = false;
  void persistToStorage();
}

/** Append a new entry. Trims to {@link MAX_ENTRIES} and notifies listeners.
 *  The message is clamped and URL-redacted here so every source (console,
 *  native logcat, network wrapper, crash files) gets the same guarantees. */
export function appendLog(entry: LogEntry): void {
  entries.push({
    ...entry,
    message: clampMessage(redactEmbeddedUrls(entry.message)),
  });
  trim();
  scheduleNotify();
  schedulePersist();
}

/** Snapshot of the current buffer (oldest → newest). */
export function getLogs(): LogEntry[] {
  return entries.slice();
}

/** Snapshot of the current buffer filtered by minimum level. */
export function getFilteredLogs(minLevel: LogLevel): LogEntry[] {
  const min = LEVEL_WEIGHT[minLevel];
  return entries.filter((e) => LEVEL_WEIGHT[e.level] >= min);
}

/** Subscribe to add events. Returns an unsubscribe function. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Wipe the in-memory buffer and the persisted copy. Crash files are NOT
 *  removed here. */
export function clearLogs(): void {
  entries.length = 0;
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
    persistPending = false;
  }
  void AsyncStorage.removeItem(STORAGE_KEY);
  scheduleNotify();
}

const ORDER: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];

/** Compare two levels for ordering. */
export function levelAtLeast(a: LogLevel, b: LogLevel): boolean {
  return LEVEL_WEIGHT[a] >= LEVEL_WEIGHT[b];
}

export { MAX_ENTRIES, ORDER as LEVEL_ORDER };
