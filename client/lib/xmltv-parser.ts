import { fetchPlaylistNative } from "../../modules/tv-player/src/index";
import { gunzipSync, strFromU8 } from "fflate";
import * as FileSystemLegacy from "expo-file-system/legacy";
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

function pickTag(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? stripCdata(m[1]) : undefined;
}

function pickIcon(block: string): string | undefined {
  const m = block.match(/<icon\s[^>]*src\s*=\s*"([^"]+)"[^>]*\/?>/i);
  return m ? m[1].trim() : undefined;
}

/**
 * Lightweight regex XMLTV parser (no external dep, Hermes-safe).
 * Keeps only programmes within [now-12h, now+48h] to bound memory.
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
  const channelRe =
    /<channel\s[^>]*id\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
  let cm: RegExpExecArray | null;
  while ((cm = channelRe.exec(xml)) !== null) {
    const id = cm[1].trim();
    const body = cm[2];
    const names: string[] = [];
    const dnRe = /<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/gi;
    let dn: RegExpExecArray | null;
    while ((dn = dnRe.exec(body)) !== null) {
      const n = stripCdata(dn[1]);
      if (n) names.push(n);
    }
    if (id) channelNames.set(id, names);
  }

  const programs: Omit<EpgProgram, "channelId">[] = [];
  const progRe = /<programme\s([^>]*)>([\s\S]*?)<\/programme>/gi;
  let pm: RegExpExecArray | null;
  let idx = 0;
  while ((pm = progRe.exec(xml)) !== null) {
    const attrs = pm[1];
    const body = pm[2];
    const startM = attrs.match(/start\s*=\s*"([^"]+)"/i);
    const stopM = attrs.match(/stop\s*=\s*"([^"]+)"/i);
    const chM = attrs.match(/channel\s*=\s*"([^"]+)"/i);
    if (!startM || !stopM || !chM) continue;
    const start = parseXmltvTime(startM[1]);
    const end = parseXmltvTime(stopM[1]);
    if (!start || !end || end <= from || start >= to) continue;
    const title = pickTag(body, "title") || "No title";
    programs.push({
      id: `epg_${start}_${idx++}`,
      xmltvChannelId: chM[1].trim(),
      title,
      desc: pickTag(body, "desc"),
      icon: pickIcon(body),
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

async function fetchXmlContent(url: string): Promise<string> {
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

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const len = clean.length;
  const outLen =
    Math.floor((len * 3) / 4) -
    (clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = B64.indexOf(clean[i + 2]);
    const d = B64.indexOf(clean[i + 3]);
    const n = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (o < outLen) out[o++] = (n >> 16) & 255;
    if (o < outLen) out[o++] = (n >> 8) & 255;
    if (o < outLen) out[o++] = n & 255;
  }
  return out;
}

/**
 * Downloads a (possibly gzipped) EPG file to the cache dir and decodes it
 * to an XML string. Sniffs the gzip magic bytes rather than trusting the
 * extension or Content-Type, so mislabeled sources work too.
 */
async function downloadAndDecode(url: string): Promise<string> {
  const dir = FileSystemLegacy.cacheDirectory;
  if (!dir) {
    const resp = await fetch(url, {
      headers: { "User-Agent": PRYSM_USER_AGENT, Accept: "*/*" },
    });
    if (!resp.ok) throw new Error(`EPG fetch failed: ${resp.status}`);
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length < 2) throw new Error("Empty EPG download");
    const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const xmlBytes = isGzip ? gunzipSync(bytes) : bytes;
    const xml = strFromU8(xmlBytes);
    if (!xml.includes("<tv") && !xml.includes("<programme")) {
      throw new Error("URL did not return XMLTV data");
    }
    return xml;
  }
  const tmp = `${dir}epg_${Date.now()}.bin`;
  try {
    const dl = await FileSystemLegacy.downloadAsync(url, tmp, {
      headers: { "User-Agent": PRYSM_USER_AGENT, Accept: "*/*" },
    });
    const b64 = await FileSystemLegacy.readAsStringAsync(dl.uri, {
      encoding: FileSystemLegacy.EncodingType.Base64,
    });
    const bytes = base64ToBytes(b64);
    if (bytes.length < 2) throw new Error("Empty EPG download");
    const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const xmlBytes = isGzip ? gunzipSync(bytes) : bytes;
    const xml = strFromU8(xmlBytes);
    if (!xml.includes("<tv") && !xml.includes("<programme")) {
      throw new Error("URL did not return XMLTV data");
    }
    return xml;
  } finally {
    try {
      const info = await FileSystemLegacy.getInfoAsync(tmp);
      if (info.exists) await FileSystemLegacy.deleteAsync(tmp);
    } catch {
      // best-effort cleanup
    }
  }
}

export async function fetchAndParseEPG(
  url: string,
): Promise<ReturnType<typeof parseXMLTV>> {
  const xml = await fetchXmlContent(url);
  return parseXMLTV(xml);
}
