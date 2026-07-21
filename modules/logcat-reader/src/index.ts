import { requireOptionalNativeModule, Platform } from "expo-modules-core";

/**
 * Native logcat reader. Spawns `logcat -v threadtime --pid=<this process's
 * PID>` on Android, reads lines on a background thread, and emits them via
 * the LogcatReader's EventEmitter as events named "logcatLine".
 *
 * On Android 13+ an app can read its own PID's logcat lines without
 * READ_LOGS (per-process isolation in logd). On Android 12 and below
 * reading logcat at all requires READ_LOGS, which is a sensitive Google
 * Play permission; we therefore no-op on <13 unless the user grants it
 * via adb. The crash-handler module still catches native fatal crashes
 * on those versions via Thread.setDefaultUncaughtExceptionHandler.
 *
 * The emitted line shape is:
 *   { raw: "07-21 14:23:05.123  1234  5678 I ExoPlayerController: ..." }
 * JS side (client/components/LogCapture.tsx) parses the level letter and
 * pushes the entry into the shared ring buffer with source="native".
 */

export interface LogcatLineEvent {
  raw: string;
}

interface LogcatReaderModuleType {
  start(): Promise<boolean>;
  stop(): Promise<void>;
  addListener(
    eventName: "logcatLine",
    listener: (event: LogcatLineEvent) => void,
  ): void;
  removeListener(
    eventName: "logcatLine",
    listener: (event: LogcatLineEvent) => void,
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
  listener: (event: LogcatLineEvent) => void,
): () => void {
  if (!LogcatReaderModule) return () => {};
  LogcatReaderModule.addListener("logcatLine", listener);
  return () => {
    LogcatReaderModule.removeListener("logcatLine", listener);
  };
}
