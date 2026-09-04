import { fetchPlaylistNative } from "../../modules/tv-player/src/index";
import type { EpgProgram } from "@/types/epg";
import { PRYSM_USER_AGENT } from "./m3u-parser";

/**
 * Extracts EPG (XMLTV) URLs from an M3U header line.
 * Supports: url-tvg="...", x-tvg-url="...", tvg-url="..."
 * Multiple URLs may be comma or space separated (quoted or unquoted).
 */
export function extractEpgUrlsFromM3U(content: string): string[] {
  const firstLines = content.slice(0, 4096).split("\n").slice(0, 5).join("\n");
  const urls: string[] = [];
  const attrRegex =
    /(?:url-tvg|x-tvg-url|tvg-url)\s*=\s*(?:"([^"]+)"|'([^']+)'|(\S+))/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(firstLines)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    // Split on comma or whitespace to support multi-EPG headers
    for (const part of raw.split(/[\s,]+/)) {
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
  try {
    const result = await fetchPlaylistNative(url);
    if (result.success && result.content) {
      if (
        result.content.includes("<tv") ||
        result.content.includes("<programme")
      ) {
        return result.content;
      }
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
    throw new Error("URL did not return XMLTV data");
  }
  return text;
}

export async function fetchAndParseEPG(
  url: string,
): Promise<ReturnType<typeof parseXMLTV>> {
  const xml = await fetchXmlContent(url);
  return parseXMLTV(xml);
}
