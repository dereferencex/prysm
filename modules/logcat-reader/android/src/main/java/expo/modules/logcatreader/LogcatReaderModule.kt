package expo.modules.logcatreader

import android.os.Build
import android.os.Process
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
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
 * process (and child threads). An app can read its own process's logcat
 * lines without any permission on every Android version since 4.1;
 * READ_LOGS (needed for other apps'/system logs) is privileged-only and
 * not grantable to ordinary apps, so the reader is scoped to our PID.
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
  private var logcatProcess: java.lang.Process? = null

  override fun definition() = ModuleDefinition {
    Name("LogcatReader")

    Events("logcatLine")

    AsyncFunction("start") { promise: Promise ->
      try {
        startReader()
        promise.resolve(true)
      } catch (_: Exception) {
        promise.resolve(false)
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      try {
        stopReader()
        promise.resolve(Unit)
      } catch (_: Exception) {
        promise.resolve(Unit)
      }
    }

    OnStartObserving {
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

    // Any app can read its own process's logcat lines without permission
    // since Android 4.1 (API 16); READ_LOGS is only for other apps'/system
    // logs and isn't grantable to ordinary apps anyway. So `--pid` works on
    // every supported Android version. Some OEM ROMs (notably MIUI) further
    // restrict logcat, in which case the stream just stays empty — the JS
    // side degrades gracefully.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
      android.util.Log.i(
        TAG,
        "logcat reading needs Android 7+; skipping on API ${Build.VERSION.SDK_INT}",
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