import { requireOptionalNativeModule } from "expo-modules-core";

export interface PendingCrash {
  /** Filename, e.g. "prysm-crash-20240704-120155-12345.txt". */
  filename: string;
  /** Full UTF-8 contents written by the native handler. */
  content: string;
}

interface CrashHandlerModuleType {
  /** JS-callable. Returns crash files written on a previous run, then consumes them. */
  getAndConsumePendingCrashes(): Promise<PendingCrash[]>;
}

const CrashHandlerModule =
  requireOptionalNativeModule<CrashHandlerModuleType>("CrashHandler");

/**
 * Returns crash trace files written by the native Kotlin handler on a
 * previous run, then moves them aside so they don't reappear next launch.
 * Returns [] if the native module isn't available (e.g. on non-Android).
 */
export async function getPendingCrashes(): Promise<PendingCrash[]> {
  if (!CrashHandlerModule) return [];
  try {
    return await CrashHandlerModule.getAndConsumePendingCrashes();
  } catch {
    return [];
  }
}
