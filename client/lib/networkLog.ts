/**
 * Network request logging for the in-app log viewer.
 *
 * Wraps `global.fetch` and `XMLHttpRequest` so every request the app makes
 * is recorded into the shared ring buffer (source="network") with method,
 * redacted URL, HTTP status and duration.
 *
 * The logcat reader captures the same requests' native side; this module
 * adds the JS side (and works on every Android version).
 *
 * Redaction: query params whose names look like credentials
 * (token/api_key/password/... ) plus URL userinfo (`user:pass@host`) are
 * masked so secrets never hit the log. The shared redactUrl() lives in
 * logStore, which also redacts every entry at append time — covering
 * native/logcat lines that this module never sees.
 * Only request metadata is logged — never bodies or headers.
 */

import { appendLog, redactUrl, type LogLevel } from "@/lib/logStore";

function statusLevel(status: number): LogLevel {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  return "info";
}

let installed = false;

/**
 * Install fetch + XMLHttpRequest wrappers. Returns an uninstall function.
 * Idempotent — calling twice returns a no-op uninstaller.
 */
export function installNetworkLogging(): () => void {
  if (installed) return () => {};
  installed = true;

  const g = globalThis as any;
  const originalFetch: ((input: any, init?: any) => Promise<any>) | undefined =
    g.fetch;
  const originalOpen: ((...args: any[]) => any) | undefined =
    g.XMLHttpRequest?.prototype?.open;
  const originalSend: ((...args: any[]) => any) | undefined =
    g.XMLHttpRequest?.prototype?.send;

  if (typeof originalFetch === "function") {
    g.fetch = async (input: any, init?: any) => {
      const startedAt = Date.now();
      const method = (init?.method ?? input?.method ?? "GET").toUpperCase();
      const rawUrl =
        typeof input === "string" ? input : (input?.url ?? String(input));
      const redacted = redactUrl(String(rawUrl));

      try {
        const response = await originalFetch.call(g, input, init);
        appendLog({
          ts: startedAt,
          level: statusLevel(response.status),
          source: "network",
          tag: "fetch",
          message: `${method} ${redacted} -> ${response.status} (${
            Date.now() - startedAt
          }ms)`,
        });
        return response;
      } catch (error: any) {
        appendLog({
          ts: startedAt,
          level: "error",
          source: "network",
          tag: "fetch",
          message: `${method} ${redacted} -> FAILED (${
            Date.now() - startedAt
          }ms) ${error?.message ?? String(error)}`,
        });
        throw error;
      }
    };
  }

  if (originalOpen && originalSend && g.XMLHttpRequest?.prototype) {
    const proto = g.XMLHttpRequest.prototype;

    proto.open = function open(
      this: any,
      method: string,
      url: string,
      ...rest: any[]
    ) {
      this.__prysmLog = {
        method: (method || "GET").toUpperCase(),
        url: redactUrl(String(url ?? "")),
        startedAt: 0,
      };
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    proto.send = function send(this: any, body?: any) {
      if (this.__prysmLog) {
        this.__prysmLog.startedAt = Date.now();
      }
      const report = () => {
        if (typeof this.removeEventListener === "function") {
          this.removeEventListener("loadend", report);
        }
        const meta = this.__prysmLog;
        if (!meta) return;
        this.__prysmLog = undefined;
        const duration = meta.startedAt ? Date.now() - meta.startedAt : 0;
        const status = this.status;
        appendLog({
          ts: meta.startedAt || Date.now(),
          level: status === 0 ? "warn" : statusLevel(status),
          source: "network",
          tag: "xhr",
          message: `${meta.method} ${meta.url} -> ${
            status === 0 ? "no response" : status
          } (${duration}ms)`,
        });
      };
      if (typeof this.addEventListener === "function") {
        this.addEventListener("loadend", report);
      }
      return originalSend.apply(this, [body]);
    };
  }

  return () => {
    installed = false;
    if (typeof originalFetch === "function") g.fetch = originalFetch;
    if (originalOpen && g.XMLHttpRequest?.prototype) {
      g.XMLHttpRequest.prototype.open = originalOpen;
    }
    if (originalSend && g.XMLHttpRequest?.prototype) {
      g.XMLHttpRequest.prototype.send = originalSend;
    }
  };
}
