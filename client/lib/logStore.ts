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
 * Android TV boxes. Entries are also persisted to AsyncStorage (debounced)
 * so the previous session survives app restarts; call {@link loadPersistedLogs}
 * once at startup and {@link flushLogs} when the app backgrounds.
 *
 * Callers subscribe via {@link subscribe} and re-render on every new entry.
 * Listeners are called synchronously and should be cheap; the LogsScreen
 * debounces its own renders.
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

// AsyncStorage key + bounds for disk persistence.
const STORAGE_KEY = "prysm_logs";
const MAX_PERSISTED = MAX_ENTRIES;
const PERSIST_DEBOUNCE_MS = 1500;

const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistPending = false;
let persistedLoaded = false;

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

async function persistToStorage(): Promise<void> {
  try {
    const snapshot = entries.slice(-MAX_PERSISTED);
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
    notifyListeners();
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

/** Append a new entry. Trims to {@link MAX_ENTRIES} and notifies listeners. */
export function appendLog(entry: LogEntry): void {
  entries.push(entry);
  trim();
  notifyListeners();
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
  void AsyncStorage.removeItem(STORAGE_KEY);
  notifyListeners();
}

const ORDER: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];

/** Compare two levels for ordering. */
export function levelAtLeast(a: LogLevel, b: LogLevel): boolean {
  return LEVEL_WEIGHT[a] >= LEVEL_WEIGHT[b];
}

export { MAX_ENTRIES, ORDER as LEVEL_ORDER };
