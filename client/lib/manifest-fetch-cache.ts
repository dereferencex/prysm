/**
 * Shared in-memory cache for fetched stream manifests.
 *
 * Background: on every channel change the app fetches the same manifest up
 * to two times from the JS thread — once by the DRM extractor
 * (`manifest-drm-extractor.ts`) and once by the quality parser
 * (`hls-quality-parser.ts` / `dash-quality-parser.ts` / `mss-quality-parser.ts`).
 * ExoPlayer also fetches the manifest itself via OkHttp on the native side,
 * but those two JS fetches race it for bandwidth and triple the latency on
 * throttled IPTV servers. This cache dedupes the JS-side fetches: concurrent
 * callers for the same URL+headers share one `Promise<string>` and a 10 s
 * short-lived entry so back-to-back channel changes don't hammer the server.
 */

interface CacheEntry {
  promise: Promise<string>;
  timestamp: number;
}

const TTL_MS = 10_000;
const MAX_ENTRIES = 32;

const cache = new Map<string, CacheEntry>();

function makeKey(url: string, headers?: Record<string, string>): string {
  if (!headers || Object.keys(headers).length === 0) return url;
  // Stable, sorted key so header order doesn't matter.
  const sorted = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}`)
    .join("|");
  return `${url}\0${sorted}`;
}

/**
 * Fetches `url` with optional `customHeaders` and returns the response body
 * as text. Concurrent calls with the same url+headers share one network
 * request. Cached for {@link TTL_MS}.
 */
export function fetchManifestText(
  url: string,
  customHeaders?: Record<string, string>,
): Promise<string> {
  const key = makeKey(url, customHeaders);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now - hit.timestamp < TTL_MS) {
    return hit.promise;
  }

  // Evict expired entries to keep the map bounded.
  if (cache.size >= MAX_ENTRIES) {
    for (const [k, e] of cache) {
      if (now - e.timestamp >= TTL_MS) cache.delete(k);
    }
    // If still at capacity, drop the oldest entry.
    if (cache.size >= MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestTs = Infinity;
      for (const [k, e] of cache) {
        if (e.timestamp < oldestTs) {
          oldestTs = e.timestamp;
          oldestKey = k;
        }
      }
      if (oldestKey) cache.delete(oldestKey);
    }
  }

  const promise = (async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "*/*",
        ...(customHeaders || {}),
      },
    });
    if (!response.ok) {
      throw new Error(`fetch ${url} → HTTP ${response.status}`);
    }
    return response.text();
  })();

  cache.set(key, { promise, timestamp: now });

  // If the fetch rejects, evict so the next caller can retry immediately.
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });

  return promise;
}

/** Clears the cache. Intended for tests. */
export function clearManifestCache(): void {
  cache.clear();
}
