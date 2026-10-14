import { fetchPlaylistNative } from "../../modules/tv-player/src/index";
import { gunzipSync, strFromU8 } from "fflate";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { File } from "expo-file-system";
import type { EpgProgram } from "@/types/epg";
import { PRYSM_USER_AGENT } from "./m3u-parser";

/**
 * Extracts EPG (XMLTV) URLs from an M3U header line.
 * Supports: url-tvg="...", x-tvg-url="...", tvg-url="..."
 * Multiple URLs may be comma or space separated (quoted or unquoted).
 */
export function extractEpgUrlsFromM3U(content: string): string[] {
  const firstLines = content.slice(0, 8192).split("\n").slice(0, 30).join("\n");
  const urls: string[] = [];
  const attrRegex =
    /(?:url-tvg|x-tvg-url|tvg-url)\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(firstLines)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    // Split on comma, semicolon, pipe or whitespace to support multi-EPG headers
    for (const part of raw.split(/[\s,;|]+/)) {
      const u = part.trim().replace(/^["']|["']$/g, "");
      if (u && (u.startsWith("http://") || u.startsWith("https://"))) {
        if (!urls.includes(u)) urls.push(u);
      }
    }
  }
  return urls;
}

/** Parse XMLTV datetime: "20250904180000 +0000" or "20250904180000" */
export function parseXmltvTime(s: string): number {
  const m = s
    .trim()
    .match(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/,
    );
  if (!m) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  }
  const [, Y, Mo, D, H, Mi, S, sign, TzH, TzM] = m;
  let ms = Date.UTC(
    Number(Y),
    Number(Mo) - 1,
    Number(D),
    Number(H),
    Number(Mi),
    Number(S),
  );
  if (sign && TzH) {
    const offsetMin = Number(TzH) * 60 + Number(TzM || "0");
    ms -= (sign === "+" ? 1 : -1) * offsetMin * 60 * 1000;
  }
  return ms;
}

/** Yield to the event loop so the UI (touches, spinner) can run. */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function stripCdata(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

/** Value of a space-separated attribute in a raw open-tag string. */
function attr(attrs: string, name: string): string | undefined {
  const key = ` ${name}="`;
  const i = attrs.indexOf(key);
  if (i === -1) return undefined;
  const vStart = i + key.length;
  const q = attrs.indexOf('"', vStart);
  if (q === -1) return undefined;
  return attrs.slice(vStart, q);
}

function isTagBoundary(code: number): boolean {
  // whitespace (9,10,13,32) or '>' (62)
  return code === 9 || code === 10 || code === 13 || code === 32 || code === 62;
}

interface Block {
  /** Raw attribute string of the open tag (between `<tag` and `>`). */
  attrs: string;
  /** Body boundaries in the source string — slice lazily when needed. */
  bodyStart: number;
  bodyEnd: number;
  source: string;
}

/**
 * IndexOf-based element scanner. Avoids lazy multiline regexes
 * (`[\s\S]*?`) which are pathologically slow on 25MB+ documents in Hermes.
 */
function* scanBlocks(xml: string, tag: string): Generator<Block> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  while ((i = xml.indexOf(open, i)) !== -1) {
    const after = i + open.length;
    if (!isTagBoundary(xml.charCodeAt(after))) {
      i = after;
      continue;
    }
    const gt = xml.indexOf(">", after);
    if (gt === -1) return;
    const end = xml.indexOf(close, gt + 1);
    if (end === -1) return;
    yield {
      attrs: xml.slice(after, gt),
      bodyStart: gt + 1,
      bodyEnd: end,
      source: xml,
    };
    i = end + close.length;
  }
}

/** Text content of the first `<tag>` (optionally with attrs) in `body`. */
function tagText(body: string, tag: string): string | undefined {
  const open = `<${tag}`;
  let i = 0;
  while ((i = body.indexOf(open, i)) !== -1) {
    const after = i + open.length;
    if (!isTagBoundary(body.charCodeAt(after))) {
      i = after;
      continue;
    }
    const gt = body.indexOf(">", after);
    if (gt === -1) return undefined;
    const end = body.indexOf(`</${tag}>`, gt + 1);
    if (end === -1) return undefined;
    return stripCdata(body.slice(gt + 1, end));
  }
  return undefined;
}

/** src of the first `<icon src="...">` in body. */
function iconSrc(body: string): string | undefined {
  const i = body.indexOf("<icon");
  if (i === -1) return undefined;
  const after = i + "<icon".length;
  if (!isTagBoundary(body.charCodeAt(after))) return undefined;
  const gt = body.indexOf(">", after);
  if (gt === -1) return undefined;
  return attr(body.slice(after, gt), "src");
}

function collectDisplayNames(body: string): string[] {
  const names: string[] = [];
  for (const b of scanBlocks(body, "display-name")) {
    const n = stripCdata(b.source.slice(b.bodyStart, b.bodyEnd));
    if (n) names.push(n);
  }
  return names;
}

/**
 * Lightweight XMLTV parser (no external dep, Hermes-safe).
 * Keeps only programmes within [now-12h, now+48h] to bound memory.
 * Synchronous — callers with large feeds should use parseXMLTVAsync.
 */
export function parseXMLTV(
  xml: string,
  opts?: { now?: number; pastHours?: number; futureHours?: number },
): {
  programs: Omit<EpgProgram, "channelId">[];
  channelNames: Map<string, string[]>;
} {
  const now = opts?.now ?? Date.now();
  const from = now - (opts?.pastHours ?? 12) * 3600 * 1000;
  const to = now + (opts?.futureHours ?? 48) * 3600 * 1000;

  const channelNames = new Map<string, string[]>();
  for (const b of scanBlocks(xml, "channel")) {
    const id = attr(b.attrs, "id");
    if (!id) continue;
    const names = collectDisplayNames(b.source.slice(b.bodyStart, b.bodyEnd));
    if (id) channelNames.set(id, names);
  }

  const programs: Omit<EpgProgram, "channelId">[] = [];
  let idx = 0;
  for (const b of scanBlocks(xml, "programme")) {
    const startRaw = attr(b.attrs, "start");
    const stopRaw = attr(b.attrs, "stop");
    const ch = attr(b.attrs, "channel");
    if (!startRaw || !stopRaw || !ch) continue;
    const start = parseXmltvTime(startRaw);
    const end = parseXmltvTime(stopRaw);
    if (!start || !end || end <= from || start >= to) continue;
    const body = b.source.slice(b.bodyStart, b.bodyEnd);
    const title = tagText(body, "title") || "No title";
    programs.push({
      id: `epg_${start}_${idx++}`,
      xmltvChannelId: ch,
      title,
      desc: tagText(body, "desc"),
      icon: iconSrc(body),
      start,
      end,
    });
    // Safety cap: 60k programmes max
    if (programs.length >= 60000) break;
  }
  // Sort by start for binary-search / windowing later
  programs.sort((a, b) => a.start - b.start);
  return { programs, channelNames };
}

/**
 * Async XMLTV parser: identical output to parseXMLTV, but yields to the
 * event loop periodically so large feeds (25MB+ XML) don't freeze the UI.
 */
export async function parseXMLTVAsync(
  xml: string,
  opts?: { now?: number; pastHours?: number; futureHours?: number },
): Promise<{
  programs: Omit<EpgProgram, "channelId">[];
  channelNames: Map<string, string[]>;
}> {
  const now = opts?.now ?? Date.now();
  const from = now - (opts?.pastHours ?? 12) * 3600 * 1000;
  const to = now + (opts?.futureHours ?? 48) * 3600 * 1000;
  const started = Date.now();

  const channelNames = new Map<string, string[]>();
  let channelWork = 0;
  for (const b of scanBlocks(xml, "channel")) {
    const id = attr(b.attrs, "id");
    if (id) {
      const names = collectDisplayNames(
        b.source.slice(b.bodyStart, b.bodyEnd),
      );
      channelNames.set(id, names);
    }
    if (++channelWork % 500 === 0) await yieldToUI();
  }
  console.log(
    `[epg] channels parsed: ${channelNames.size} in ${Date.now() - started}ms`,
  );

  const programs: Omit<EpgProgram, "channelId">[] = [];
  let idx = 0;
  let lastYield = Date.now();
  let scanned = 0;
  for (const b of scanBlocks(xml, "programme")) {
    const startRaw = attr(b.attrs, "start");
    const stopRaw = attr(b.attrs, "stop");
    const ch = attr(b.attrs, "channel");
    if (!startRaw || !stopRaw || !ch) continue;
    const start = parseXmltvTime(startRaw);
    const end = parseXmltvTime(stopRaw);
    if (!start || !end || end <= from || start >= to) continue;
    const body = b.source.slice(b.bodyStart, b.bodyEnd);
    const title = tagText(body, "title") || "No title";
    programs.push({
      id: `epg_${start}_${idx++}`,
      xmltvChannelId: ch,
      title,
      desc: tagText(body, "desc"),
      icon: iconSrc(body),
      start,
      end,
    });
    if (programs.length >= 60000) break;
    // Yield roughly every 30ms so the JS thread stays responsive
    if (Date.now() - lastYield > 30) {
      await yieldToUI();
      lastYield = Date.now();
    }
    if (++scanned % 100000 === 0) {
      console.log(`[epg] scanned ${scanned} programmes`);
    }
  }
  console.log(
    `[epg] programmes parsed: ${programs.length} in ${Date.now() - started}ms`,
  );
  programs.sort((a, b) => a.start - b.start);
  return { programs, channelNames };
}

async function fetchXmlContent(url: string): Promise<string> {
  console.log(`[epg] fetchXmlContent: ${url}`);
  // Gzipped sources (e.g. *.xml.gz, like the popular matthuisman guides):
  // text fetch would return binary garbage, so download + inflate instead.
  const pathNoQuery = url.split("?")[0].toLowerCase();
  if (pathNoQuery.endsWith(".gz")) {
    return downloadAndDecode(url);
  }
  try {
    const result = await fetchPlaylistNative(url);
    if (result.success && result.content) {
      if (
        result.content.includes("<tv") ||
        result.content.includes("<programme")
      ) {
        return result.content;
      }
      // Binary (probably gzip) despite a non-.gz URL — fall through.
    }
  } catch {
    // fall through to JS fetch
  }
  const response = await fetch(url, {
    headers: { "User-Agent": PRYSM_USER_AGENT, Accept: "*/*" },
  });
  if (!response.ok) throw new Error(`EPG fetch failed: ${response.status}`);
  const text = await response.text();
  if (!text.includes("<tv") && !text.includes("<programme")) {
    // Mislabeled gzip (or other binary) — retry via download + inflate.
    try {
      return await downloadAndDecode(url);
    } catch {
      // fall through to the XMLTV error below
    }
    throw new Error("URL did not return XMLTV data");
  }
  return text;
}

/** Rejects if `promise` hasn't settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function validateXmltv(xml: string): string {
  if (!xml.includes("<tv") && !xml.includes("<programme")) {
    throw new Error("URL did not return XMLTV data");
  }
  return xml;
}

async function decodeBytesToXml(bytes: Uint8Array): Promise<string> {
  if (bytes.length < 2) throw new Error("Empty EPG download");
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzip) {
    // Let the UI paint before the synchronous inflate blocks the JS thread
    // (fflate's async gunzip needs Web Workers, unavailable in Hermes).
    await yieldToUI();
    return validateXmltv(strFromU8(gunzipSync(bytes)));
  }
  return validateXmltv(strFromU8(bytes));
}

/**
 * Downloads a (possibly gzipped) EPG file to the cache dir and decodes it
 * to an XML string. Sniffs the gzip magic bytes rather than trusting the
 * extension or Content-Type, so mislabeled sources work too.
 * Uses a 120s timeout so a stalled download can't hang the spinner forever.
 */
async function downloadAndDecode(url: string): Promise<string> {
  const TIMEOUT_MS = 120_000;
  const dir = FileSystemLegacy.cacheDirectory;
  if (!dir) {
    const resp = await withTimeout(
      fetch(url, {
        headers: { "User-Agent": PRYSM_USER_AGENT, Accept: "*/*" },
      }),
      TIMEOUT_MS,
      "EPG download",
    );
    if (!resp.ok) throw new Error(`EPG fetch failed: ${resp.status}`);
    const buf = await withTimeout(
      resp.arrayBuffer(),
      TIMEOUT_MS,
      "EPG download",
    );
    return decodeBytesToXml(new Uint8Array(buf));
  }
  const tmp = `${dir}epg_${Date.now()}.bin`;
  try {
    console.log("[epg] downloadAsync start");
    const dl = await withTimeout(
      FileSystemLegacy.downloadAsync(url, tmp, {
        headers: { "User-Agent": PRYSM_USER_AGENT, Accept: "*/*" },
      }),
      TIMEOUT_MS,
      "EPG download",
    );
    console.log(`[epg] download done: ${dl.status ?? ""} ${dl.uri}`);
    if (!dl.status || dl.status < 200 || dl.status >= 300) {
      throw new Error(`EPG download failed: HTTP ${dl.status ?? "unknown"}`);
    }
    // Read raw bytes directly — avoids a multi-megabyte base64 string
    // and the per-character decode loop that used to freeze the JS thread.
    const bytes = await withTimeout(
      new File(dl.uri).bytes(),
      TIMEOUT_MS,
      "EPG read",
    );
    console.log(`[epg] bytes read: ${bytes.length}`);
    const xml = await decodeBytesToXml(bytes);
    console.log(`[epg] decoded xml: ${xml.length} chars`);
    return xml;
  } finally {
    try {
      console.log("[epg] cleanup tmp");
      const info = await FileSystemLegacy.getInfoAsync(tmp);
      if (info.exists) await FileSystemLegacy.deleteAsync(tmp);
      console.log("[epg] cleanup done");
    } catch (e) {
      console.log(`[epg] cleanup error: ${e}`);
      // best-effort cleanup
    }
  }
}

export async function fetchAndParseEPG(
  url: string,
): Promise<ReturnType<typeof parseXMLTV>> {
  const xml = await fetchXmlContent(url);
  console.log("[epg] parse start");
  const parsed = await parseXMLTVAsync(xml);
  console.log(`[epg] parse done: ${parsed.programs.length} programs`);
  return parsed;
}
