import { useEffect, useRef } from "react";

import { appendLog, type LogLevel, type LogSource } from "@/lib/logStore";

/**
 * Invisible component mounted high in the tree (see App.tsx) to attach all
 * log capture sources. Renders nothing. Idempotent — installing twice is
 * safe; the second install is a no-op.
 *
 * Captured sources:
 *   - console.log / info / warn / error / debug / trace
 *   - ErrorUtils global handler (unhandled JS exceptions, including
 *     fatal red-screen exceptions on debug builds)
 *
 * Not captured (would need a native module):
 *   - real-time Android `logcat` (requires Runtime.exec, no RN API)
 *   - native (JVM) fatal crashes — the JVM process dies before JS can run;
 *     capturing those needs `Thread.setDefaultUncaughtExceptionHandler`
 *     wired in from a Kotlin module under modules/.
 *
 * When a native crash module is added later, it can write to the same
 * `logStore` directly, or write a file to cache/prysm-crashes/ that a
 * future version of this component reads on next launch — the `crash`
 * LogSource in the store is already reserved for that path.
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

    return () => {
      restoreConsole();
      restoreHandler();
      installed = false;
    };
  }, []);

  return null;
}
