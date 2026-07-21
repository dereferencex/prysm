package expo.modules.crashhandler

import android.os.Build
import android.os.Process
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Captures native (JVM) uncaught-exception stack traces to a file before
 * the process dies, so the in-app log viewer can surface them on the
 * next launch.
 *
 * Files land at: <cacheDir>/prysm-crashes/prysm-crash-<ts>-<pid>.txt
 *
 * JS side (modules/crash-handler/src/index.ts → getPendingCrashes()) calls
 * getAndConsumePendingCrashes() at launch to read and remove them, then
 * pushes them into the in-memory log ring buffer (client/lib/logStore.ts).
 *
 * The previous handler (if any) is still invoked after we've flushed the
 * trace so system-level crash dialogs / ANR workflows keep working.
 *
 * Install timing: Expo modules' OnCreate hook runs during Application
 * registration (before the React Native bundle loads), so the handler is
 * in place before any JS-initiated native code runs — catching even
 * early-boot native crashes that take the app down at the splash screen.
 */
class CrashHandlerModule : Module() {
  companion object {
    private const val TAG = "PrysmCrashHandler"
    private const val DIR_NAME = "prysm-crashes"
    private const val CONSUMED_NAME = "consumed"
  }

  private var installed = false

  override fun definition() = ModuleDefinition {
    Name("CrashHandler")

    // Install as early as possible — before JS bundle loads.
    OnCreate {
      installHandler()
    }

    AsyncFunction("getAndConsumePendingCrashes") { promise: Promise ->
      try {
        val crashes = readAndConsumeCrashFiles()
        promise.resolve(crashes)
      } catch (e: Exception) {
        // Never let log retrieval propagate as a crash.
        promise.resolve(emptyList<Map<String, String>>())
      }
    }
  }

  private fun installHandler() {
    if (installed) return
    installed = true

    val app = appContext.reactContext?.applicationContext
      ?: return  // No app context yet — try again on next load if needed.

    val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        writeStackTrace(app, thread, throwable)
      } catch (_: Throwable) {
        // Best-effort — never shadow the original crash.
      }
      // Hand off to the platform's crash dialog / process termination.
      if (previousHandler != null) {
        previousHandler.uncaughtException(thread, throwable)
      } else {
        Process.killProcess(Process.myPid())
      }
    }
  }

  private fun crashDir(app: android.content.Context): File {
    return File(app.cacheDir, DIR_NAME).also { if (!it.exists()) it.mkdirs() }
  }

  private fun consumedDir(app: android.content.Context): File {
    return File(crashDir(app), CONSUMED_NAME).also {
      if (!it.exists()) it.mkdirs()
    }
  }

  private fun writeStackTrace(
    app: android.content.Context,
    thread: Thread,
    t: Throwable,
  ) {
    val dir = crashDir(app)
    if (!dir.exists()) dir.mkdirs()

    val ts = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
    val crashFile = File(dir, "prysm-crash-$ts-${Process.myPid()}.txt")

    val sw = StringWriter()
    PrintWriter(sw).use { pw ->
      pw.println("Prysm native crash")
      pw.println("Thread: ${thread.name} (${thread.id})")
      pw.println("Date: ${Date()}")
      pw.println("App: ${app.packageName}")
      pw.println(
        "Device: ${Build.MANUFACTURER} ${Build.MODEL}",
      )
      pw.println(
        "Android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
      )
      pw.println(
        "ABI: ${Build.SUPPORTED_ABIS?.joinToString(",") ?: "unknown"}",
      )
      pw.println()
      pw.println("Stack trace:")
      t.printStackTrace(pw)
    }

    crashFile.writeText(sw.toString())
  }

  /** Reads every crash file in <cacheDir>/prysm-crashes/, returns its
   *  filename+content, then moves the file into <cacheDir>/prysm-crashes/consumed/
   *  so it doesn't reappear on the next launch. */
  private fun readAndConsumeCrashFile(): List<Map<String, String>> {
    val app = appContext.reactContext?.applicationContext ?: return emptyList()
    val dir = crashDir(app)
    if (!dir.exists() || !dir.isDirectory) return emptyList()

    val consumed = consumedDir(app)
    if (!consumed.exists()) consumed.mkdirs()

    val results = mutableListOf<Map<String, String>>()
    val files = dir.listFiles { f ->
      f.isFile && f.name.endsWith(".txt")
    }?.sortedBy { it.lastModified() } ?: return emptyList()

    for (file in files) {
      try {
        val content = file.readText()
        results.add(
          mapOf(
            "filename" to file.name,
            "content" to content,
          ),
        )
        // Move aside so it doesn't reappear.
        val target = File(consumed, file.name)
        if (!file.renameTo(target)) {
          // Fallback: copy then delete original.
          file.copyTo(target, overwrite = true)
          file.delete()
        }
      } catch (_: Exception) {
        // Skip malformed files.
      }
    }
    return results
  }
}