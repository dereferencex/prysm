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

/** Detects the manifest type from URL using both extension and path signals,
 *  consistent with isHLSStream() in hls-quality-parser.ts. */
function detectManifestType(url: string): "dash" | "hls" | "unknown" {
  // Strip query string for extension matching to avoid false positives like
  // ?format=mpd-vod triggering DASH detection on an HLS URL.
  const withoutQuery = url.split("?")[0].toLowerCase();
  if (withoutQuery.endsWith(".mpd")) return "dash";
  if (withoutQuery.endsWith(".m3u8") || withoutQuery.endsWith(".m3u")) return "hls";
  // Fallback: check common path signals (extension-less URLs)
  const lowerFull = url.toLowerCase();
  if (lowerFull.includes("/dash/") || lowerFull.includes("manifest.mpd")) return "dash";
  if (
    lowerFull.includes(".m3u8") ||
    lowerFull.includes("/hls/") ||
    lowerFull.includes("playlist")
  ) return "hls";
  return "unknown";
}

export async function extractDRMFromManifest(
  manifestUrl: string,
  customHeaders?: Record<string, string>,
): Promise<DRMInfo | undefined> {
  const type = detectManifestType(manifestUrl);
  if (type === "dash") return extractDRMFromDASH(manifestUrl, customHeaders);
  if (type === "hls") return extractDRMFromHLS(manifestUrl, customHeaders);
  return undefined;
}

async function extractDRMFromHLS(
  masterUrl: string,
  customHeaders?: Record<string, string>,
): Promise<DRMInfo | undefined> {
  try {
    const response = await fetch(masterUrl, {
      headers: {
        Accept: "*/*",
        ...(customHeaders || {}),
      },
    });
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
    // AES-128 is native HLS whole-segment encryption — ExoPlayer decrypts it
    // directly. It is NOT EME/CDM DRM. Treating it as DRM misclassified
    // ordinary AES-128 streams as ClearKey (esp. with KEYFORMAT="identity",
    // the HLS default for native key delivery) and broke playback.
    if (method !== "SAMPLE-AES" && method !== "SAMPLE-AES-CTR") continue;

    // KEYFORMAT attribute — parseHLSAttributes already strips surrounding quotes.
    const keyFormat = attrs.KEYFORMAT || "";

    // Widevine: KEYFORMAT contains Widevine system UUID
    if (keyFormat.includes("edef8ba9")) {
      const uri = attrs.URI;
      if (uri) return { type: "widevine", licenseServer: uri };
    }

    // PlayReady: KEYFORMAT contains PlayReady system UUID
    if (keyFormat.includes("9a04f079")) {
      const uri = attrs.URI;
      if (uri) return { type: "playready", licenseServer: uri };
    }

    // ClearKey identity KEYFORMAT (W3C EME ClearKey)
    // Note: parseHLSAttributes strips quotes so we compare without quotes.
    if (
      keyFormat === "identity" ||
      keyFormat === "urn:uuid:1077efec-c0b2-4d02-ace3-3c1e52e2fb4b"
    ) {
      const uri = attrs.URI;
      if (uri) {
        if (uri.startsWith("data:")) {
          // Inline key embedded in the URI
          const keyData = parseClearKeyDataUri(uri);
          if (keyData) return keyData;
          // Unparseable data: URI — still ClearKey, store as embedded key
          return { type: "clearkey", licenseKey: uri };
        }
        // Regular URL — store as license server
        return { type: "clearkey", licenseServer: uri };
      }
    }

    // ClearKey with data: URI on any KEYFORMAT (fallback) — only if no
    // recognized DRM type was matched above to avoid mis-classifying
    // malformed Widevine/PlayReady tags as ClearKey.
    if (!keyFormat || keyFormat === "") {
      const uri = attrs.URI;
      if (uri && uri.startsWith("data:")) {
        const keyData = parseClearKeyDataUri(uri);
        if (keyData) return keyData;
      }
    }
  }

  return undefined;
}

/**
 * Parses HLS attribute lists into a Record where values already have their
 * surrounding quotes stripped.  This fixes the bug where
 * KEYFORMAT="identity" was stored as '"identity"' (with quotes) and failed
 * the `=== "identity"` comparison.
 */
function parseHLSAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const colonIndex = line.indexOf(":");
  if (colonIndex === -1) return attrs;
  const attrStr = line.substring(colonIndex + 1);

  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    // Strip surrounding double-quotes from the value so callers can compare
    // without worrying about quoting (e.g. keyFormat === "identity" works).
    const value = match[2];
    attrs[match[1]] = value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  }
  return attrs;
}

/**
 * Parses a ClearKey `data:` URI.  Handles:
 *  - `data:application/json;base64,<base64>`
 *  - `data:text/plain;charset=utf-8,<url-encoded-json>`
 *  - `data:application/octet-stream;base64,<base64>`
 *  - Raw unencoded JSON payload after the comma
 */
function parseClearKeyDataUri(dataUri: string): DRMInfo | undefined {
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex === -1) return undefined;

  const meta = dataUri.substring(0, commaIndex).toLowerCase(); // e.g. "data:application/json;base64"
  const rawPayload = dataUri.substring(commaIndex + 1);

  const isBase64 = meta.includes("base64");
  const isUrlEncoded = meta.includes("charset=utf-8") && !isBase64;

  // Decode the payload according to the declared encoding
  let jsonStr: string | undefined;

  if (isBase64) {
    try { jsonStr = atob(rawPayload); } catch { /* fall through */ }
  } else if (isUrlEncoded) {
    try { jsonStr = decodeURIComponent(rawPayload); } catch { /* fall through */ }
  }

  // If no encoding was declared or decoding failed, try the raw payload as JSON
  if (!jsonStr) {
    jsonStr = rawPayload;
  }

  return parseClearKeyJson(jsonStr);
}

function parseClearKeyJson(json: string): DRMInfo | undefined {
  try {
    const obj = JSON.parse(json);
    if (obj.keys && Array.isArray(obj.keys) && obj.keys.length > 0) {
      const key = obj.keys[0];
      if (key.kid && key.k) {
        // Validate expected lengths for a 128-bit AES key:
        //   hex:       32 chars
        //   base64url: 22 chars (no padding) or 24 chars (with padding)
        const kidOk = isValidKeyComponent(key.kid);
        const kOk = isValidKeyComponent(key.k);
        if (!kidOk || !kOk) return undefined;
        return { type: "clearkey", licenseKey: `${key.kid}:${key.k}` };
      }
    }
  } catch {
    // Not valid JSON
  }
  return undefined;
}

/** Validates that a ClearKey key/kid component has the right length for a 16-byte AES key. */
function isValidKeyComponent(value: string): boolean {
  const stripped = value.replace(/=/g, ""); // remove base64 padding
  // hex: 32 chars; base64url: 22 chars
  return stripped.length === 32 || stripped.length === 22;
}

async function extractDRMFromDASH(
  manifestUrl: string,
  customHeaders?: Record<string, string>,
): Promise<DRMInfo | undefined> {
  try {
    const response = await fetch(manifestUrl, {
      headers: {
        Accept: "*/*",
        ...(customHeaders || {}),
      },
    });
    if (!response.ok) return undefined;
    const content = await response.text();
    return parseDASHDRM(content);
  } catch {
    return undefined;
  }
}

function parseDASHDRM(content: string): DRMInfo | undefined {
  const lower = content.toLowerCase();

  // Widevine: look for ContentProtection with Widevine UUID
  if (lower.includes(WIDEVINE_UUID)) {
    const licenseUrl = extractDASHLicenseUrl(content, WIDEVINE_UUID);
    const pssh = extractPssh(content, WIDEVINE_UUID);
    // Only return a licenseServer if we found an actual URL, not a PSSH blob.
    return {
      type: "widevine",
      licenseServer: licenseUrl || undefined,
      pssh: pssh || undefined,
    } as DRMInfo;
  }

  // PlayReady
  if (lower.includes(PLAYREADY_UUID)) {
    const licenseUrl = extractDASHLicenseUrl(content, PLAYREADY_UUID);
    const pssh = extractPssh(content, PLAYREADY_UUID);
    return {
      type: "playready",
      licenseServer: licenseUrl || undefined,
      pssh: pssh || undefined,
    } as DRMInfo;
  }

  // ClearKey
  if (lower.includes("contentprotection") && lower.includes("clearkey")) {
    return { type: "clearkey" };
  }

  return undefined;
}

/**
 * Extracts the actual license server URL from a DASH ContentProtection element.
 * Checks (in order):
 *  1. `<dashif:laurl>` element (DASH-IF IOP v4.3+)
 *  2. `laurl` attribute on the ContentProtection element
 *  3. PlayReady `<mspr:pro>` base64 blob → decodes the inner XML for `<LA_URL>`
 *
 * Returns undefined if no URL is found (caller should NOT use the PSSH as a URL).
 */
function extractDASHLicenseUrl(content: string, uuid: string): string | undefined {
  // Narrow the search to the ContentProtection block for this UUID to avoid
  // matching tags from a different DRM system's block.
  const uuidLower = uuid.toLowerCase();
  const contentLower = content.toLowerCase();
  const cpStart = contentLower.indexOf(uuidLower);
  if (cpStart === -1) return undefined;

  // Find the enclosing ContentProtection element (look backward for the opening tag)
  const tagStart = contentLower.lastIndexOf("<contentprotection", cpStart);
  if (tagStart === -1) return undefined;

  // Find closing tag (either </ContentProtection> or self-closing />)
  let cpEnd = contentLower.indexOf("</contentprotection>", cpStart);
  if (cpEnd === -1) {
    const selfClose = contentLower.indexOf("/>", cpStart);
    cpEnd = selfClose !== -1 ? selfClose + 2 : content.length;
  } else {
    cpEnd += "</contentprotection>".length;
  }

  const cpBlock = content.substring(tagStart, cpEnd);

  // 1. DASH-IF `<dashif:laurl>` element
  const laurlMatch = cpBlock.match(/<dashif:laurl[^>]*>([^<]+)<\/dashif:laurl>/i);
  if (laurlMatch) return laurlMatch[1].trim();

  // 2. `laurl` attribute on the ContentProtection element itself
  const laurlAttrMatch = cpBlock.match(/\blasurl\s*=\s*["']([^"']+)["']/i);
  if (laurlAttrMatch) return laurlAttrMatch[1].trim();

  // 3. PlayReady `<mspr:pro>` — base64-encoded PlayReady Object XML containing <LA_URL>
  const msproMatch = cpBlock.match(/<mspr:pro[^>]*>([A-Za-z0-9+/=\s]+)<\/mspr:pro>/i);
  if (msproMatch) {
    try {
      // The PlayReady Object is a UTF-16LE XML document.
      const decoded = atob(msproMatch[1].replace(/\s/g, ""));
      // Convert UTF-16LE bytes to a JS string (skip the BOM / header bytes)
      let xml = "";
      for (let i = 0; i < decoded.length - 1; i += 2) {
        const code = decoded.charCodeAt(i) | (decoded.charCodeAt(i + 1) << 8);
        if (code > 0) xml += String.fromCharCode(code);
      }
      const laUrlMatch = xml.match(/<LA_URL[^>]*>([^<]+)<\/LA_URL>/i);
      if (laUrlMatch) return laUrlMatch[1].trim();
    } catch {
      // Malformed base64 or XML — ignore
    }
  }

  return undefined;
}

/**
 * Extracts the PSSH base64 blob for the given DRM system UUID.
 * Iterates over ALL `<cenc:pssh>` elements and returns the one whose
 * preceding content (within the same ContentProtection block) contains
 * the target UUID — fixing the bug where the first PSSH was always returned
 * regardless of which DRM system it belonged to.
 */
function extractPssh(content: string, uuid: string): string | undefined {
  const uuidLower = uuid.toLowerCase();
  const contentLower = content.toLowerCase();

  const psshRegex = new RegExp(
    `<cenc:pssh[^>]*>\\s*([A-Za-z0-9+/=]+)\\s*</cenc:pssh>`,
    "gi",
  );

  let match: RegExpExecArray | null;
  while ((match = psshRegex.exec(content)) !== null) {
    // For each PSSH box, look back to the nearest ContentProtection opening tag
    // and check whether it belongs to the requested DRM system UUID.
    const psshStart = match.index;
    const cpTagStart = contentLower.lastIndexOf("<contentprotection", psshStart);
    if (cpTagStart === -1) continue;

    const cpHeader = contentLower.substring(cpTagStart, psshStart);
    if (cpHeader.includes(uuidLower)) {
      return match[1].trim();
    }
  }
  return undefined;
}
