import { useEffect, useRef } from "react";

import { appendLog, type LogLevel, type LogSource } from "@/lib/logStore";
import { getPendingCrashes } from "../../modules/crash-handler/src";

/**
 * Invisible component mounted high in the tree (see App.tsx) to attach all
 * log capture sources. Renders nothing. Idempotent — installing twice is
 * safe; the second install is a no-op.
 *
 * Captured sources:
 *   - console.log / info / warn / error / debug / trace
 *   - ErrorUtils global handler (uncaught JS exceptions, including fatal
 *     red-screen exceptions on debug builds)
 *   - native (JVM) uncaught-exception stack traces written by
 *     modules/crash-handler (Kotlin) on a previous run, surfaced here as
 *     level="fatal" source="crash" via getPendingCrashes().
 *
 * Not captured:
 *   - real-time Android `logcat` — requires Runtime.exec, no RN API.
 *     File-based breadcrumb above is the practical alternative, since the
 *     thing callers actually need is the crash stacktrace, not all stdout.
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

    return () => {
      restoreConsole();
      restoreHandler();
      installed = false;
    };
  }, []);

  return null;
}
