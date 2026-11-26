export interface XtreamCredentials {
  server: string;
  username: string;
  password: string;
}

const KNOWN_ENDPOINTS = /\/(get|player_api|xmltv)\.php$/i;

/**
 * Normalizes an Xtream Codes server address to `scheme://host[:port][/path]`
 * with no trailing slash, query or known endpoint suffix.
 */
export function normalizeXtreamServer(server: string): string {
  let value = server.trim();
  if (!value) {
    throw new Error("Please enter the server URL");
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = `http://${value}`;
  }

  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)/i.exec(value);
  if (!match) {
    throw new Error("Server URL must start with http:// or https://");
  }

  const scheme = match[1].toLowerCase();
  const host = match[2];
  const path = match[3].replace(/\/+$/, "").replace(KNOWN_ENDPOINTS, "");
  return `${scheme}://${host}${path}`;
}

function credentialQuery({ server, username, password }: XtreamCredentials): {
  base: string;
  query: string;
} {
  const base = normalizeXtreamServer(server);
  const user = username.trim();
  if (!user) {
    throw new Error("Please enter your username");
  }
  if (!password) {
    throw new Error("Please enter your password");
  }
  return {
    base,
    query:
      `username=${encodeURIComponent(user)}` +
      `&password=${encodeURIComponent(password)}`,
  };
}

/** Builds the M3U Plus playlist URL that Xtream Codes servers expose. */
export function buildXtreamPlaylistUrl(creds: XtreamCredentials): string {
  const { base, query } = credentialQuery(creds);
  return `${base}/get.php?${query}&type=m3u_plus&output=ts`;
}

/** Builds the player_api.php URL used to check the account before loading. */
export function buildXtreamApiUrl(creds: XtreamCredentials): string {
  const { base, query } = credentialQuery(creds);
  return `${base}/player_api.php?${query}`;
}

/**
 * Interprets a player_api.php response. Returns a user-facing error message,
 * or null when the account is usable. Unrecognised responses return null so
 * the playlist download still gets a chance (some panels answer oddly).
 */
export function checkXtreamAccount(body: string): string | null {
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  const info = data?.user_info;
  if (!info || typeof info !== "object") {
    return null;
  }
  if (Number(info.auth) === 0) {
    return "Wrong username or password";
  }
  const status = typeof info.status === "string" ? info.status.trim() : "";
  if (status && status.toLowerCase() !== "active") {
    return `Your Xtream account is ${status.toLowerCase()}`;
  }
  return null;
}

/**
 * Recognises a playlist URL produced by {@link buildXtreamPlaylistUrl}
 * (or any `.../get.php?username=..&password=..` link) and returns its parts.
 */
export function parseXtreamGetUrl(
  url: string,
): { base: string; username: string; password: string } | null {
  const match = /^(https?:\/\/[^?#\s]+)\/get\.php\?([^#\s]*)$/i.exec(
    url.trim(),
  );
  if (!match) return null;
  const params: Record<string, string> = {};
  for (const pair of match[2].split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    try {
      params[pair.slice(0, eq).toLowerCase()] = decodeURIComponent(
        pair.slice(eq + 1).replace(/\+/g, " "),
      );
    } catch {
      return null;
    }
  }
  if (!params.username || !params.password) return null;
  return {
    base: match[1],
    username: params.username,
    password: params.password,
  };
}

export interface XtreamChannelDraft {
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
}

/** Picks the stream container to request, preferring MPEG-TS like get.php. */
export function pickXtreamOutput(userInfo: any): string {
  const formats: unknown = userInfo?.allowed_output_formats;
  if (Array.isArray(formats) && formats.length > 0) {
    const list = formats.map((f) => String(f).toLowerCase());
    if (list.includes("ts")) return "ts";
    if (list.includes("m3u8")) return "m3u8";
  }
  return "ts";
}

/**
 * Converts player_api.php `get_live_categories` + `get_live_streams`
 * responses into channel drafts (no ids yet) and an ordered category list.
 * Categories keep the provider's order; streams keep their `num` order.
 */
export function xtreamLiveToChannels(
  base: string,
  username: string,
  password: string,
  categories: any,
  streams: any,
  output = "ts",
): { channels: XtreamChannelDraft[]; categories: string[] } {
  const catNames = new Map<string, string>();
  const catOrder: string[] = [];
  if (Array.isArray(categories)) {
    for (const c of categories) {
      const id = String(c?.category_id ?? "");
      const name = String(c?.category_name ?? "").trim();
      if (!id || !name || catNames.has(id)) continue;
      catNames.set(id, name);
      catOrder.push(name);
    }
  }

  const user = encodeURIComponent(username);
  const pass = encodeURIComponent(password);
  const used = new Set<string>();
  const channels: XtreamChannelDraft[] = [];

  const list = Array.isArray(streams) ? [...streams] : [];
  list.sort((a, b) => (Number(a?.num) || 0) - (Number(b?.num) || 0));

  for (const s of list) {
    const streamId = s?.stream_id;
    if (streamId === undefined || streamId === null || streamId === "") {
      continue;
    }
    const direct =
      typeof s.direct_source === "string" &&
      /^https?:\/\//i.test(s.direct_source)
        ? s.direct_source
        : "";
    const group = catNames.get(String(s.category_id ?? "")) ?? "Uncategorized";
    used.add(group);
    const logo =
      typeof s.stream_icon === "string" && s.stream_icon ? s.stream_icon : "";
    const tvgId =
      typeof s.epg_channel_id === "string" && s.epg_channel_id
        ? s.epg_channel_id
        : "";
    channels.push({
      name: String(s.name ?? `Channel ${streamId}`).trim(),
      url: direct || `${base}/live/${user}/${pass}/${streamId}.${output}`,
      group,
      ...(logo ? { logo } : {}),
      ...(tvgId ? { tvgId } : {}),
    });
  }

  const ordered = catOrder.filter((c) => used.has(c));
  if (used.has("Uncategorized") && !ordered.includes("Uncategorized")) {
    ordered.push("Uncategorized");
  }
  return { channels, categories: ordered };
}
