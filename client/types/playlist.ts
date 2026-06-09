export interface DRMInfo {
  /** DRM system type. "fairplay" is reserved for future iOS support. */
  type?: "widevine" | "playready" | "clearkey" | "fairplay";
  /** License server URL. Must be a valid HTTP(S) URL — never a PSSH blob. */
  licenseServer?: string;
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
