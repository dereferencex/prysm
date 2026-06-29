// Node-safe stub for the native tv-player module used by m3u-parser tests.
// The real module imports expo-modules-core / react-native which are not
// available in the Node unit-test environment. We only stub the surface the
// parser needs (fetchPlaylistNative).

export const fetchPlaylistNative = async (_url: string) => ({
  success: false as const,
  content: "",
});

export const TvPlayerView = (_props: any) => null;
export const TvPlayerCommands = {
  play: (_ref: any) => {},
  pause: (_ref: any) => {},
  seekTo: (_ref: any, _ms: number) => {},
};
export type NativeAudioTrack = {
  groupIndex: number;
  trackIndex: number;
  id: string;
  label: string;
  language: string;
  isSelected: boolean;
};
export type NativeSubtitleTrack = {
  groupIndex: number;
  trackIndex: number;
  id: string;
  label: string;
  language: string;
  isSelected: boolean;
};
export type TvPlayerLoadParams = {
  url: string;
  headers?: Record<string, string>;
  drmType?: string;
  drmLicenseUrl?: string;
  drmHeaders?: Record<string, string>;
  drmPssh?: string;
  autoPlay?: boolean;
};