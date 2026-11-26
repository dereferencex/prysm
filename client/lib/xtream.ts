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
