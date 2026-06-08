import { DRMInfo } from "@/types/playlist";

/**
 * Extracts DRM information from HLS or DASH manifests when KODIPROP tags
 * are not present in the M3U playlist. This handles:
 *
 * - HLS: `#EXT-X-SESSION-KEY` and `#EXT-X-KEY` tags
 * - DASH: `<ContentProtection>` elements inside `<AdaptationSet>`
 */

const WIDEVINE_UUID = "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed";
const PLAYREADY_UUID = "9a04f079-9840-4286-ab92-e65be0885f95";

export async function extractDRMFromManifest(
  manifestUrl: string,
): Promise<DRMInfo | undefined> {
  const lower = manifestUrl.toLowerCase();
  if (lower.includes(".mpd")) {
    return extractDRMFromDASH(manifestUrl);
  }
  if (lower.includes(".m3u8") || lower.includes(".m3u")) {
    return extractDRMFromHLS(manifestUrl);
  }
  return undefined;
}

async function extractDRMFromHLS(
  masterUrl: string,
): Promise<DRMInfo | undefined> {
  try {
    const response = await fetch(masterUrl, { headers: { Accept: "*/*" } });
    if (!response.ok) return undefined;
    const content = await response.text();
    return parseHLSDRM(content);
  } catch {
    return undefined;
  }
}

function parseHLSDRM(content: string): DRMInfo | undefined {
  const lines = content.split("\n").map((l) => l.trim());

  for (const line of lines) {
    if (!line.startsWith("#EXT-X-SESSION-KEY:") && !line.startsWith("#EXT-X-KEY:")) {
      continue;
    }

    const attrs = parseHLSAttributes(line);
    const method = attrs.METHOD?.toUpperCase();
    if (method !== "SAMPLE-AES" && method !== "AES-128") continue;

    const keyFormat = attrs.KEYFORMAT || "";

    // Widevine
    if (keyFormat.includes("edef8ba9")) {
      const uri = stripQuotes(attrs.URI);
      if (uri) return { type: "widevine", licenseServer: uri };
    }

    // PlayReady
    if (keyFormat.includes("9a04f079")) {
      const uri = stripQuotes(attrs.URI);
      if (uri) return { type: "playready", licenseServer: uri };
    }

    // ClearKey with URI
    if (keyFormat === "identity" || keyFormat === "urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b") {
      const uri = stripQuotes(attrs.URI);
      if (uri) {
        // Could be a URL or a raw key
        if (uri.includes("://")) {
          return { type: "clearkey", licenseServer: uri };
        }
        // Inline key in format kid:key
        return { type: "clearkey", licenseServer: uri };
      }
    }

    // ClearKey with data: URI (inline key)
    const uri = stripQuotes(attrs.URI);
    if (uri && uri.startsWith("data:")) {
      const keyData = parseClearKeyDataUri(uri);
      if (keyData) return keyData;
    }
  }

  return undefined;
}

function parseHLSAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  // Get everything after the first colon
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return attrs;
  const attrStr = line.substring(colonIndex + 1);

  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function stripQuotes(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.replace(/^"|"$/g, "");
}

function parseClearKeyDataUri(dataUri: string): DRMInfo | undefined {
  // data:application/octet-stream;base64,<base64-encoded-json>
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex === -1) return undefined;
  const payload = dataUri.substring(commaIndex + 1);

  // Try to decode as base64 JSON
  try {
    const json = atob(payload);
    const obj = JSON.parse(json);
    if (obj.keys && Array.isArray(obj.keys) && obj.keys.length > 0) {
      const key = obj.keys[0];
      if (key.kid && key.k) {
        return { type: "clearkey", licenseServer: `${key.kid}:${key.k}` };
      }
    }
  } catch {
    // Not base64 JSON — try as raw JSON
    try {
      const obj = JSON.parse(payload);
      if (obj.keys && Array.isArray(obj.keys) && obj.keys.length > 0) {
        const key = obj.keys[0];
        if (key.kid && key.k) {
          return { type: "clearkey", licenseServer: `${key.kid}:${key.k}` };
        }
      }
    } catch {
      // Not valid JSON either
    }
  }
  return undefined;
}

async function extractDRMFromDASH(
  manifestUrl: string,
): Promise<DRMInfo | undefined> {
  try {
    const response = await fetch(manifestUrl, { headers: { Accept: "*/*" } });
    if (!response.ok) return undefined;
    const content = await response.text();
    return parseDASHDRM(content);
  } catch {
    return undefined;
  }
}

function parseDASHDRM(content: string): DRMInfo | undefined {
  // Use regex-based extraction since DOMParser may not be available in RN
  const lower = content.toLowerCase();

  // Widevine: look for ContentProtection with Widevine UUID
  if (lower.includes(WIDEVINE_UUID)) {
    const pssh = extractPssh(content, WIDEVINE_UUID);
    return { type: "widevine", licenseServer: pssh || undefined };
  }

  // PlayReady
  if (lower.includes(PLAYREADY_UUID)) {
    const pssh = extractPssh(content, PLAYREADY_UUID);
    return { type: "playready", licenseServer: pssh || undefined };
  }

  // ClearKey
  if (lower.includes("contentprotection") && lower.includes("clearkey")) {
    return { type: "clearkey" };
  }

  return undefined;
}

function extractPssh(content: string, uuid: string): string | undefined {
  // Look for pssh element: <cenc:pssh>base64data</cenc:pssh>
  const psshRegex = new RegExp(
    `<cenc:pssh[^>]*>\\s*([A-Za-z0-9+/=]+)\\s*</cenc:pssh>`,
    "gi",
  );
  const match = psshRegex.exec(content);
  if (match) {
    return match[1].trim();
  }
  return undefined;
}
