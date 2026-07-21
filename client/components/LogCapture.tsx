import { useEffect, useRef } from "react";

import { appendLog, type LogLevel, type LogSource } from "@/lib/logStore";
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
 *   - live native logcat lines via modules/logcat-reader (Kotlin) emitted
 *     as source="native" with the severity parsed from the threadtime
 *     logcat letter (V/D/I/W/E/F). Captures ExoPlayerController/Log.d/i/w/e,
 *     TvPlayerModule events, MediaPeriod / LoadControl / Buffering state
 *     changes, and anything else that hits Android logcat from our PID.
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
 * Parse one `logcat -v threadtime` line into the LogEntry shape.
 *
 * threadtime format:
 *   MM-DD HH:MM:SS.ms  PID  TID  LEVEL  TAG: MSG
 * Example:
 *   07-21 14:23:05.123  1234  5678 I ExoPlayerController: built and prepared
 *
 * Defensive: malformed lines (e.g. logcat's "--------- beginning of main"
 * divider, or empty lines from buffer races) get level=info with the raw
 * line as the message so the user still sees them in the viewer.
 */
function parseLogcatLine(raw: string): {
  level: LogLevel;
  tag?: string;
  message: string;
} {
  // Skip the "--------- beginning of ..." banner that logcat emits on start.
  if (raw.startsWith("---------")) {
    return { level: "debug", message: raw };
  }

  // Split: [date+time] [pid] [tid] [level] [tag: msg]
  // threadtime separates fields with whitespace, but the tag follows the
  // single-letter level directly with no space — e.g. "I ExoPlayerCtrl: msg"
  const m = raw.match(
    /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+([VDIWEF])\s+([^:]+):\s?(.*)$/,
  );
  if (!m) {
    return { level: "info", message: raw };
  }

  const levelLetter = m[1];
  const tag = m[2].trim();
  const message = m[3];

  const levelMap: Record<string, LogLevel> = {
    V: "debug",
    D: "debug",
    I: "info",
    W: "warn",
    E: "error",
    F: "fatal",
  };

  return {
    level: levelMap[levelLetter] ?? "info",
    tag,
    message,
  };
}

export function LogCapture(): null {
  const installedRef = useRef(false);

  useEffect(() => {
    if (installedRef.current) return;
    installedRef.current = true;

    // Guard against double-mount in StrictMode by using the module flag too.
    if (installed) return;
    installed = true;

    appendLog({
      ts: Date.now(),
      level: "info",
      source: "js" as LogSource,
      tag: "LogCapture",
      message: "Log capture initialised",
    });

    const restoreConsole = patchConsole();
    const restoreHandler = attachGlobalExceptionHandler();

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

    // Start streaming native logcat lines (Android 13+ only; on older
    // versions startLogcatCapture returns false and we no-op). Each line
    // is parsed from threadtime format and forwarded to the ring buffer
    // with source="native".
    let logcatActive = false;
    startLogcatCapture().then((ok) => {
      logcatActive = ok;
    });

    const removeLogcatListener = addLogcatLineListener((event) => {
      const parsed = parseLogcatLine(event.raw);
      appendLog({
        ts: Date.now(),
        level: parsed.level,
        source: "native",
        tag: parsed.tag,
        message: parsed.message,
      });
    });

    return () => {
      restoreConsole();
      restoreHandler();
      removeLogcatListener();
      if (logcatActive) stopLogcatCapture();
      installed = false;
    };
  }, []);

  return null;
}
