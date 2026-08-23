import { requireOptionalNativeModule, Platform } from "expo-modules-core";

/**
 * Native logcat reader. Spawns `logcat -v threadtime --pid=<this process's
 * PID>` on Android, reads lines on a background thread, and emits them via
 * the LogcatReader's EventEmitter as batched events named "logcatLines"
 * ({ lines: string[] }, flushed every ~200 ms or 50 lines) to keep bridge
 * traffic flat during log storms.
 *
 * An app can read its own process's logcat lines without any permission
 * since Android 4.1; READ_LOGS (needed for other apps'/system logs) is
 * privileged-only, so the reader is scoped to our PID on every supported
 * Android version. Some OEM ROMs restrict logcat further, in which case
 * the stream stays empty and the app degrades gracefully. The
 * crash-handler module still catches native fatal crashes via
 * Thread.setDefaultUncaughtExceptionHandler.
 *
 * Each raw line looks like:
 *   "07-21 14:23:05.123  1234  5678 I ExoPlayerController: ..."
 * JS side (client/components/LogCapture.tsx) parses the level letter and
 * timestamp and pushes the entry into the shared ring buffer with
 * source="native".
 */

export interface LogcatLinesEvent {
  lines: string[];
}

interface LogcatReaderModuleType {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  addListener(
    eventName: "logcatLines",
    listener: (event: LogcatLinesEvent) => void,
  ): void;
  removeListener(
    eventName: "logcatLines",
    listener: (event: LogcatLinesEvent) => void,
  ): void;
}

const LogcatReaderModule =
  Platform.OS === "android"
    ? requireOptionalNativeModule<LogcatReaderModuleType>("LogcatReader")
    : null;

export function startLogcatCapture(): Promise<boolean> {
  if (!LogcatReaderModule) return Promise.resolve(false);
  return LogcatReaderModule.start().catch(() => false);
}

export function stopLogcatCapture(): Promise<void> {
  if (!LogcatReaderModule) return Promise.resolve();
  return LogcatReaderModule.stop().catch(() => {});
}

export function addLogcatLineListener(
  listener: (event: LogcatLinesEvent) => void,
): () => void {
  if (!LogcatReaderModule) return () => {};
  LogcatReaderModule.addListener("logcatLines", listener);
  return () => {
    LogcatReaderModule.removeListener("logcatLines", listener);
  };
}
