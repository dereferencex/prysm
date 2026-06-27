export interface DRMInfo {
  /** DRM system type. "fairplay" is reserved for future iOS support. */
  type?: "widevine" | "playready" | "clearkey" | "fairplay";
  /** License server URL. Must be a valid HTTP(S) URL — never a PSSH blob.
   *  Used for Widevine / PlayReady license acquisition. May be empty for
   *  ClearKey when the key is embedded in {@link licenseKey}. */
  licenseServer?: string;
  /** Embedded license key, used only for ClearKey when no license server
   *  is involved. May be either a `KID:KEY` pair or a full W3C ClearKey JSON
   *  document ({"keys":[...],"type":...}). Never a URL. */
  licenseKey?: string;
  /** Optional HTTP headers for license requests. */
  headers?: Record<string, string>;
  /** Optional certificate URL (Widevine provisioning / PlayReady cert chain). */
  certificateUrl?: string;
  /** Raw base64 PSSH initialization data extracted from the manifest.
   *  Passed as DRM initialization data to the player — NOT used as a URL. */
  pssh?: string;
}

export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  tvgId?: string;
  tvgName?: string;
  drm?: DRMInfo;
  headers?: Record<string, string>;
  isLive?: boolean;
  quality?: string;
}

export interface Playlist {
  id: string;
  name: string;
  url?: string;
  channels: Channel[];
  categories: string[];
  lastUpdated: number;
}

export interface PlaylistState {
  currentPlaylist: Playlist | null;
  favorites: string[];
  recentChannels: string[];
  lastPlayedChannel: string | null;
}
