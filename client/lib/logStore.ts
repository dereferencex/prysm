/**
 * In-process ring-buffer log store for the in-app log viewer.
 *
 * Captures three sources of logs (see {@link LogSource}):
 *   - "js"    — JS console.log / warn / error and React error-boundary catches.
 *   - "native" — lines streamed from `logcat` (filtered to the app PID).
 *   - "crash"  — stack-trace files written by NativeCrashHandler before a
 *                native crash killed the process, surfaced on next launch.
 *
 * Bounded to {@link MAX_ENTRIES} so memory stays predictable on low-end
 * Android TV boxes. Callers subscribe via {@link subscribe} and re-render
 * on every new entry. Listeners are called synchronously and should be
 * cheap; the LogsScreen debounces its own renders.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogSource = "js" | "native" | "crash";

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

const entries: LogEntry[] = [];
const listeners = new Set<() => void>();

// Cap how many entries the buffer keeps; trades detail for memory.
function trim(): void {
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

/** Append a new entry. Trims to {@link MAX_ENTRIES} and notifies listeners. */
export function appendLog(entry: LogEntry): void {
  entries.push(entry);
  trim();
  for (const l of listeners) {
    try {
      l();
    } catch {
      // listener errors must not break the capture pipeline
    }
  }
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

/** Wipe the in-memory buffer. Persisted crash files are NOT removed here. */
export function clearLogs(): void {
  entries.length = 0;
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

const ORDER: LogLevel[] = ["debug", "info", "warn", "error", "fatal"];

/** Compare two levels for ordering. */
export function levelAtLeast(a: LogLevel, b: LogLevel): boolean {
  return LEVEL_WEIGHT[a] >= LEVEL_WEIGHT[b];
}

export { MAX_ENTRIES, ORDER as LEVEL_ORDER };
