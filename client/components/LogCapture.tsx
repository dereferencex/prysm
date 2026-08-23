import { useEffect } from "react";
import { AppState } from "react-native";

import {
  appendLog,
  loadPersistedLogs,
  flushLogs,
  type LogLevel,
  type LogSource,
} from "@/lib/logStore";
import { installNetworkLogging } from "@/lib/networkLog";
import { getPendingCrashes } from "../../modules/crash-handler/src";
import {
  startLogcatCapture,
  stopLogcatCapture,
  addLogcatLineListener,
} from "../../modules/logcat-reader/src";

/**
 * Invisible component mounted high in the tree (see App.tsx) to attach all
 * log capture sources. Renders nothing. Idempotent — installing twice is
 * safe; the second install is a no-op.
 *
 * Captured sources:
 *   - console.log / info / warn / error / debug / trace (JS)
 *   - ErrorUtils global handler (uncaught JS exceptions, including fatal
 *     red-screen exceptions on debug builds)
 *   - native (JVM) uncaught-exception stack traces written by
 *     modules/crash-handler (Kotlin) on a previous run, surfaced here as
 *     level="fatal" source="crash" via getPendingCrashes()
 *   - live native logcat lines via modules/logcat-reader (Kotlin), delivered
 *     in batches as source="native" with the severity parsed from the
 *     threadtime letter (V/D/I/W/E/F) and the timestamp parsed from the line
 *     itself. Lines mirrored from our own JS console (tag ReactNativeJS) are
 *     dropped so console output isn't captured twice. Captures
 *     ExoPlayerController/Log.d/i/w/e, TvPlayerModule events,
 *     MediaPeriod / LoadControl / Buffering state changes, and anything else
 *     that hits Android logcat from our PID.
 *   - fetch / XMLHttpRequest calls via client/lib/networkLog, logged as
 *     source="network".
 *
 * The previous session's entries are also loaded from AsyncStorage (see
 * logStore) and flushed whenever the app leaves the foreground.
 */

let installed = false;

const consoleLevelMap: Record<string, LogLevel> = {
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
  trace: "debug",
};

function patchConsole(): () => void {
  const originals: Record<string, (...args: any[]) => void> = {};

  for (const fn of [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
  ] as const) {
    const original = (console as any)[fn].bind(console);
    originals[fn] = original;
    (console as any)[fn] = (...args: any[]) => {
      try {
        const msg = args
          .map((a) =>
            typeof a === "string"
              ? a
              : a instanceof Error
                ? `${a.name}: ${a.message}\n${a.stack ?? ""}`
                : (() => {
                    try {
                      return JSON.stringify(a);
                    } catch {
                      return String(a);
                    }
                  })(),
          )
          .join(" ");
        appendLog({
          ts: Date.now(),
          level: consoleLevelMap[fn] ?? "info",
          source: "js",
          tag: "console",
          message: msg,
        });
      } catch {
        // never let logging itself throw
      }
      originals[fn](...args);
    };
  }

  return () => {
    for (const fn of Object.keys(originals)) {
      (console as any)[fn] = originals[fn];
    }
  };
}

function attachGlobalExceptionHandler(): () => void {
  const ErrorUtils = (global as any).ErrorUtils;
  if (!ErrorUtils?.setGlobalHandler) return () => {};

  const prev = ErrorUtils.getGlobalHandler?.();

  const handler = (error: Error, isFatal?: boolean) => {
    try {
      appendLog({
        ts: Date.now(),
        level: isFatal ? "fatal" : "error",
        source: "js",
        tag: "ErrorUtils",
        message: `${error?.name ?? "Error"}: ${error?.message ?? ""}\n${
          error?.stack ?? ""
        }`,
      });
      if (isFatal) flushLogs();
    } catch {
      // ignore
    }
    if (typeof prev === "function") {
      try {
        prev(error, isFatal);
      } catch {
        // ignore
      }
    }
  };

  ErrorUtils.setGlobalHandler(handler);
  return () => {
    try {
      ErrorUtils.setGlobalHandler(prev ?? (() => {}));
    } catch {
      // ignore
    }
  };
}

/**
 * Convert a logcat threadtime stamp (MM-DD + wall-clock fields, no year) to
 * epoch ms using the current year, with guards for the Dec → Jan rollover.
 */
function threadtimeToEpochMs(
  monthDay: string,
  hh: number,
  mm: number,
  ss: number,
  ms3: number,
): number {
  const month = Number(monthDay.slice(0, 2)) - 1;
  const day = Number(monthDay.slice(3, 5));
  const now = new Date();
  let ts = new Date(now.getFullYear(), month, day, hh, mm, ss, ms3).getTime();
  const DAY_MS = 86_400_000;
  if (ts - Date.now() > DAY_MS) {
    // Stamp is in the future — it belongs to last December.
    ts = new Date(now.getFullYear() - 1, month, day, hh, mm, ss, ms3).getTime();
  } else if (Date.now() - ts > 300 * DAY_MS) {
    // Stamp is ~a year old — it belongs to next January.
    ts = new Date(now.getFullYear() + 1, month, day, hh, mm, ss, ms3).getTime();
  }
  return ts;
}

/**
 * Parse one `logcat -v threadtime` line into LogEntry fields (without
 * source). Returns null for lines that should be dropped entirely:
 *   - logcat's "--------- beginning of ..." divider banners
 *   - lines tagged ReactNativeJS — those are RN's own logcat mirror of our
 *     console output, which patchConsole() already captures as source="js";
 *     keeping them would double-log every console call.
 *
 * threadtime format:
 *   MM-DD HH:MM:SS.ms  PID  TID  LEVEL  TAG: MSG
 * Example:
 *   07-21 14:23:05.123  1234  5678 I ExoPlayerController: built and prepared
 *
 * Defensive: malformed lines (e.g. continuation lines of a multi-line stack
 * trace, or empty lines from buffer races) get level=info with the raw line
 * as the message so the user still sees them in the viewer.
 */
interface ParsedLogcatLine {
  ts: number;
  level: LogLevel;
  tag?: string;
  message: string;
}

const THREADTIME_RE =
  /^(\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s+\d+\s+\d+\s+([VDIWEF])\s+([^:]+):\s?(.*)$/;

const LOGCAT_LEVEL_MAP: Record<string, LogLevel> = {
  V: "debug",
  D: "debug",
  I: "info",
  W: "warn",
  E: "error",
  F: "fatal",
};

// RN's logcat tag for mirrored JS console output (deduped against source=js).
const RN_MIRROR_TAG = "ReactNativeJS";

function parseLogcatLine(raw: string): ParsedLogcatLine | null {
  // Skip the "--------- beginning of ..." banner that logcat emits on start.
  if (raw.startsWith("---------")) return null;

  const m = raw.match(THREADTIME_RE);
  if (!m) {
    // Not a threadtime line — keep it as a raw info entry (continuation
    // lines of multi-line native stack traces land here).
    return { ts: Date.now(), level: "info", message: raw };
  }

  const [, monthDay, hh, mm, ss, ms3, levelLetter, rawTag, message] = m;
  const tag = rawTag.trim();

  // Our own console output, already captured via patchConsole() — drop.
  if (tag === RN_MIRROR_TAG) return null;

  return {
    ts: threadtimeToEpochMs(
      monthDay,
      Number(hh),
      Number(mm),
      Number(ss),
      Number(ms3),
    ),
    level: LOGCAT_LEVEL_MAP[levelLetter] ?? "info",
    tag,
    message,
  };
}

export function LogCapture(): null {
  useEffect(() => {
    // Guard against double-mount in StrictMode with the module flag.
    if (installed) return;
    installed = true;

    // Load the previous session's persisted entries first so the ring
    // buffer reads oldest → newest (logStore re-sorts by timestamp).
    void loadPersistedLogs();

    appendLog({
      ts: Date.now(),
      level: "info",
      source: "js" as LogSource,
      tag: "LogCapture",
      message: "Log capture initialised",
    });

    const restoreConsole = patchConsole();
    const restoreHandler = attachGlobalExceptionHandler();
    const restoreNetwork = installNetworkLogging();

    // Pull native crash traces written by modules/crash-handler on a prior
    // run, then push them into the ring buffer so they appear at the top
    // of the in-app log viewer as fatal/crash entries.
    getPendingCrashes()
      .then((crashes) => {
        for (const c of crashes) {
          appendLog({
            ts: Date.now(),
            level: "fatal",
            source: "crash",
            tag: "NativeCrashHandler",
            message: `${c.filename}\n${c.content}`,
          });
        }
      })
      .catch(() => {
        // module unavailable (non-Android, pre-prebuild) — silently skip
      });

    // Start streaming native logcat lines (own-PID logs are readable on
    // every supported Android version). Lines arrive in batches; each is
    // parsed from threadtime format and forwarded to the ring buffer with
    // source="native". stopLogcatCapture() is idempotent, so the cleanup
    // below always calls it — even if unmount happens before start()
    // resolves (otherwise an orphaned `logcat` process would keep running).
    void startLogcatCapture();

    const removeLogcatListener = addLogcatLineListener((event) => {
      for (const raw of event.lines) {
        const parsed = parseLogcatLine(raw);
        if (!parsed) continue;
        appendLog({
          ts: parsed.ts,
          level: parsed.level,
          source: "native",
          tag: parsed.tag,
          message: parsed.message,
        });
      }
    });

    // Flush the ring buffer to disk whenever the app leaves the
    // foreground, so a crash/force-stop doesn't lose the last lines.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flushLogs();
    });

    return () => {
      restoreConsole();
      restoreHandler();
      restoreNetwork();
      removeLogcatListener();
      appStateSub.remove();
      void stopLogcatCapture();
      installed = false;
    };
  }, []);

  return null;
}
