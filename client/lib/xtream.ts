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

/** Builds the M3U Plus playlist URL that Xtream Codes servers expose. */
export function buildXtreamPlaylistUrl({
  server,
  username,
  password,
}: XtreamCredentials): string {
  const base = normalizeXtreamServer(server);
  const user = username.trim();
  if (!user) {
    throw new Error("Please enter your username");
  }
  if (!password) {
    throw new Error("Please enter your password");
  }

  return (
    `${base}/get.php?username=${encodeURIComponent(user)}` +
    `&password=${encodeURIComponent(password)}&type=m3u_plus&output=ts`
  );
}
