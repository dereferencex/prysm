export interface EpgProgram {
  id: string;
  /** Matched Channel.id (stable ch_ hash) after tvg-id/name mapping */
  channelId: string;
  /** Raw xmltv channel id for debugging */
  xmltvChannelId: string;
  title: string;
  desc?: string;
  icon?: string;
  start: number;
  end: number;
}

export interface EpgNowNext {
  now?: EpgProgram;
  next?: EpgProgram;
}

export interface EpgCache {
  playlistId: string;
  sourceUrl: string;
  lastUpdated: number;
  programCount: number;
  programs: EpgProgram[];
}
