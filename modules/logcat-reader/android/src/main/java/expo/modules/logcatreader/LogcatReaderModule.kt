package expo.modules.logcatreader

import android.os.Build
import android.os.Process
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.events.EventListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * Streams the app's own Android logcat lines into JS via an EventEmitter.
 *
 * Spawns: `logcat -v threadtime --pid=<this pid> --dividers`
 *
 * The `--pid` filter restricts output to lines originating from this
 * process (and child threads). On Android 13+ this works without any
 * permission because logd enforces per-UID/per-PID visibility. On
 * Android 12 and below, logcat from a non-system app requires the
 * READ_LOGS permission, which is gated as sensitive by Google Play —
 * so we no-op there rather than request it.
 *
 * Each line is delivered to JS verbatim as `{ raw: "<threadtime> ..." }`
 * — JS parses the severity letter (V/D/I/W/E/F) and forwards it into
 * the shared ring buffer (client/lib/logStore.ts) with source="native".
 *
 * The reader keeps running for the lifetime of the JS bundle. Calling
 * stop() kills the subprocess and joins the reader coroutine.
 */
class LogcatReaderModule : Module() {
  companion object {
    private const val TAG = "LogcatReader"
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var readerJob: Job? = null
  private var logcatProcess: Process? = null

  override fun definition() = ModuleDefinition {
    Name("LogcatReader")

    Events("logcatLine")

    AsyncFunction("start") { promise ->
      try {
        startReader()
        promise.resolve(true)
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }

    AsyncFunction("stop") { promise ->
      try {
        stopReader()
        promise.resolve(Unit)
      } catch (_: Exception) {
        promise.resolve(Unit)
      }
    }

    OnObservingEvent {
      // Trigger an initial reader start when the JS listener attaches,
      // so callers that only addListener don't need to remember start().
      if (readerJob == null) {
        try {
          startReader()
        } catch (_: Exception) {
          // Best effort; JS will get nothing until start() succeeds.
        }
      }
    }

    OnDestroy {
      stopReader()
      scope.cancel()
    }
  }

  /** Begin streaming logcat lines from the current process. */
  private fun startReader() {
    if (readerJob != null) return

    // Android 12 (API 31) and below block logcat from non-system apps
    // without READ_LOGS. We don't request that permission (Google Play
    // flags it as sensitive), so we no-op cleanly on those versions —
    // the crash-handler module still catches native fatal crashes.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      android.util.Log.i(
        TAG,
        "logcat reading needs Android 13+; skipping on API ${Build.VERSION.SDK_INT}",
      )
      return
    }

    val pid = Process.myPid()
    val cmd = arrayOf(
      "logcat",
      "-v", "threadtime",
      "--pid", pid.toString(),
      "--dividers",
    )

    val proc = Runtime.getRuntime().exec(cmd)
    logcatProcess = proc

    readerJob = scope.launch {
      try {
        BufferedReader(InputStreamReader(proc.inputStream)).use { r ->
          while (isActive && !Thread.currentThread().isInterrupted) {
            val line = r.readLine() ?: break
            try {
              sendEvent("logcatLine", mapOf("raw" to line))
            } catch (_: Exception) {
              // Event delivery may throw if no listeners / JS bridge
              // is tearing down — suppress to avoid killing the reader.
            }
          }
        }
      } catch (_: Exception) {
        // Stream closed — fall through to cleanup.
      } finally {
        try {
          proc.destroy()
        } catch (_: Exception) {
          // ignore
        }
        logcatProcess = null
        readerJob = null
      }
    }
  }

  private fun stopReader() {
    readerJob?.cancel()
    readerJob = null
    logcatProcess?.let {
      try {
        it.destroy()
      } catch (_: Exception) {
        // ignore
      }
    }
    logcatProcess = null
  }
}