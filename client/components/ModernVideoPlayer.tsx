import React, {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import {
  StyleSheet,
  View,
  Pressable,
  Modal,
  ActivityIndicator,
  ScrollView,
  Platform,
  StatusBar,
  PermissionsAndroid,
  AppState,
  AppStateStatus,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
  Svg,
} from "react-native-svg";

import { ThemedText } from "@/components/ThemedText";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { parseHLSQualities, isHLSStream } from "@/lib/hls-quality-parser";
import { parseDASHQualities, isDASHStream } from "@/lib/dash-quality-parser";
import { parseMSSQualities, isMSSStream } from "@/lib/mss-quality-parser";
import { Channel } from "@/types/playlist";
import { getChannelPlayerEngine, setChannelPlayerEngine } from "@/lib/storage";
import {
  TvPlayerView,
  TvPlayerCommands,
  NativeAudioTrack,
  NativeSubtitleTrack,
} from "../../modules/tv-player/src/index";
import { TVFocusablePressable } from "@/components/TVFocusablePressable";
import { DRMConfig, VideoQuality } from "@/components/AdvancedVideoPlayer";

const isTV = Platform.isTV;

const CONTROLS_TIMEOUT_MS = 4_500;

// Accent palette per spec
const ACCENT = {
  live: "#FF3B30",
  signal: "#3B82F6",
  quality: "#22C55E",
  subtitle: "#FACC15",
  audio: "#38BDF8",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.75)",
  textMuted: "rgba(255,255,255,0.55)",
  glass: "rgba(255,255,255,0.08)",
  glassBorder: "rgba(255,255,255,0.10)",
};

type ContentFit = "contain" | "cover" | "fill";
const CONTENT_FIT_OPTIONS: {
  label: string;
  icon: string;
  value: ContentFit;
}[] = [
  { label: "Fit", icon: "scan-outline", value: "contain" },
  { label: "Fill", icon: "expand-outline", value: "cover" },
  { label: "Stretch", icon: "resize-outline", value: "fill" },
];

export interface ModernVideoPlayerProps {
  source: string;
  title?: string;
  subtitle?: string;
  poster?: string;
  channelId?: string;
  /** Optional display position of the channel within its playlist (1-based). */
  channelNumber?: number;
  autoPlay?: boolean;
  backgroundPlay?: boolean;
  playerEngine?: "exoplayer" | "vlc";
  drm?: DRMConfig;
  headers?: Record<string, string>;
  qualities?: VideoQuality[];
  recentChannels?: Channel[];
  onError?: (error: string) => void;
  onBack?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onChannelSelect?: (channelId: string) => void;
  isFavorite?: boolean;
  onFavoritePress?: () => void;
  isLive?: boolean;
}

export const ModernVideoPlayer = React.memo(function ModernVideoPlayer({
  source,
  title,
  subtitle,
  poster,
  channelId,
  channelNumber,
  autoPlay = true,
  backgroundPlay = false,
  playerEngine: defaultEngine = "exoplayer",
  headers,
  drm,
  qualities: propQualities = [],
  recentChannels = [],
  onError,
  onBack,
  onNext,
  onPrevious,
  onChannelSelect,
  isFavorite,
  onFavoritePress,
  isLive = true,
}: ModernVideoPlayerProps) {
  useKeepAwake();

  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // ── Refs ─────────────────────────────────────────────────────────────────
  const tvPlayerRef = useRef<any>(null);
  const nativeReadyRef = useRef(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showControlsRef = useRef(false);
  const isPlayingRef = useRef(false);
  const isBackgroundPlayingRef = useRef(false);
  const isInPiPRef = useRef(false);
  const consecutiveErrorCountRef = useRef(0);

  // Focus refs for D-pad routing
  const backBtnRef = useRef<any>(null);
  const prevBtnRef = useRef<any>(null);
  const playPauseBtnRef = useRef<any>(null);
  const nextBtnRef = useRef<any>(null);
  const favBtnRef = useRef<any>(null);
  const settingsBtnRef = useRef<any>(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [showControls, setShowControlsState] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nativeReady, setNativeReady] = useState(false);
  const [contentFit, setContentFit] = useState<ContentFit>("contain");
  const [currentSource, setCurrentSource] = useState(source);
  const [activePlayerEngine, setActivePlayerEngine] = useState(defaultEngine);

  const [detectedQualities, setDetectedQualities] = useState<VideoQuality[]>(
    [],
  );
  const [selectedQuality, setSelectedQuality] = useState<string | null>(null);
  const [nativeAudioTracks, setNativeAudioTracks] = useState<
    NativeAudioTrack[]
  >([]);
  const [nativeSubtitleTracks, setNativeSubtitleTracks] = useState<
    NativeSubtitleTrack[]
  >([]);
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<string | null>(
    null,
  );
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<
    string | null
  >(null);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showQualityModal, setShowQualityModal] = useState(false);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [showEngineModal, setShowEngineModal] = useState(false);
  const [showAspectModal, setShowAspectModal] = useState(false);

  // Live clock
  const [now, setNow] = useState(() => new Date());

  // ── Animated values ──────────────────────────────────────────────────────
  const controlsOpacity = useSharedValue(0);
  const infoTranslateY = useSharedValue(24);
  const infoOpacity = useSharedValue(0);

  // ── Controls show/hide ───────────────────────────────────────────────────
  const cancelHideTimer = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
      controlsTimerRef.current = null;
    }
  }, []);

  const setShowControls = useCallback(
    (visible: boolean, autoHideOnTV = false) => {
      cancelHideTimer();
      setShowControlsState(visible);
      showControlsRef.current = visible;
      controlsOpacity.value = withTiming(visible ? 1 : 0, {
        duration: 220,
      });
      if (visible && (!isTV || autoHideOnTV)) {
        controlsTimerRef.current = setTimeout(() => {
          setShowControls(false, autoHideOnTV);
        }, CONTROLS_TIMEOUT_MS);
      }
    },
    [cancelHideTimer, controlsOpacity],
  );

  const scheduleHide = useCallback(() => {
    cancelHideTimer();
    controlsTimerRef.current = setTimeout(() => {
      setShowControls(false, true);
    }, CONTROLS_TIMEOUT_MS);
  }, [cancelHideTimer, setShowControls]);

  const showAndScheduleHide = useCallback(() => {
    if (!showControlsRef.current) {
      setShowControls(true, true);
    } else {
      scheduleHide();
    }
  }, [scheduleHide, setShowControls]);

  // Keep refs in sync for the TVEventHandler closure.
  const scheduleHideRef = useRef(scheduleHide);
  scheduleHideRef.current = scheduleHide;
  const showAndScheduleHideRef = useRef(showAndScheduleHide);
  showAndScheduleHideRef.current = showAndScheduleHide;

  // Intro animation when controls first appear after load.
  useEffect(() => {
    infoOpacity.value = withTiming(1, { duration: 280 });
    infoTranslateY.value = withTiming(0, { duration: 280 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Source changes ───────────────────────────────────────────────────────
  useEffect(() => {
    setCurrentSource(source);
    setSelectedQuality(null);
    setDetectedQualities([]);
    setError(null);
    setIsLoading(true);
    consecutiveErrorCountRef.current = 0;
    // Re-trigger intro animation on channel change.
    infoOpacity.value = 0;
    infoTranslateY.value = 18;
    infoOpacity.value = withTiming(1, { duration: 260 });
    infoTranslateY.value = withTiming(0, { duration: 260 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Per-channel engine preference.
  useEffect(() => {
    let cancelled = false;
    if (channelId) {
      getChannelPlayerEngine(channelId).then((eng) => {
        if (!cancelled && eng && eng !== activePlayerEngine) {
          setActivePlayerEngine(eng);
        }
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  // ── Quality detection ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const url = currentSource;
    if (!url) return;
    (async () => {
      let q: VideoQuality[] = [];
      try {
        if (isHLSStream(url)) q = await parseHLSQualities(url);
        else if (isDASHStream(url)) q = await parseDASHQualities(url);
        else if (isMSSStream(url)) q = await parseMSSQualities(url);
      } catch {
        q = [];
      }
      if (!cancelled && q.length > 0) setDetectedQualities(q);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentSource]);

  // Reduce the `drm` object to a primitive signature so the loadSource effect
  // doesn't re-fire on every render due to a new object identity for the same
  // DRM config. This is the root cause of the "double load on channel change":
  // PlayerScreen mounts with drm=undefined, fires loadSource, then async
  // manifest DRM detection resolves to a new object → re-fires loadSource →
  // ExoPlayer is torn down and rebuilt mid-first-buffer.
  const drmSignature = useMemo(
    () =>
      drm
        ? `${drm.type || ""}|${drm.licenseServer || ""}|${drm.licenseKey || ""}|${drm.certificateUrl || ""}|${drm.pssh || ""}`
        : "",
    [drm],
  );

  // ── Native player load ───────────────────────────────────────────────────
  const loadSource = useCallback(() => {
    if (!tvPlayerRef.current) return;
    setIsLoading(true);
    setError(null);
    consecutiveErrorCountRef.current = 0;
    TvPlayerCommands.setPlayerEngine(tvPlayerRef, activePlayerEngine);
    TvPlayerCommands.loadSource(tvPlayerRef, {
      url: currentSource,
      headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
      drmType: drm?.type,
      drmLicenseUrl: drm?.licenseServer,
      drmLicenseKey: drm?.licenseKey,
      drmHeaders: drm?.headers,
      drmPssh: drm?.pssh,
      autoPlay,
    });
    // drmSignature replaces drm (object) so the callback identity is stable
    // across renders with the same DRM config.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource, headers, drmSignature, autoPlay, activePlayerEngine]);

  useEffect(() => {
    if (nativeReadyRef.current) loadSource();
    // nativeReadyRef is not reactive — intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource, headers, drmSignature, autoPlay, activePlayerEngine]);

  const loadSourceRef = useRef(loadSource);
  loadSourceRef.current = loadSource;

  const nativeViewRef = useCallback((node: any) => {
    (tvPlayerRef as React.MutableRefObject<any>).current = node;
    if (node && !nativeReadyRef.current) {
      nativeReadyRef.current = true;
      setNativeReady(true);
      setTimeout(() => loadSourceRef.current(), 50);
    }
  }, []);

  // Release on unmount — native onDetachedFromWindow handles cleanup.
  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // ── Background audio sync on mount ───────────────────────────────────────
  useEffect(() => {
    const sync = async () => {
      const isEnabled =
        await TvPlayerCommands.isBackgroundAudioEnabled(tvPlayerRef);
      if (isEnabled !== undefined) {
        isBackgroundPlayingRef.current = isEnabled;
      }
    };
    const t = setTimeout(sync, 100);
    return () => clearTimeout(t);
  }, []);

  // Enable background audio when setting is on and playback starts.
  useEffect(() => {
    if (!backgroundPlay || !isPlaying || !nativeReady) return;
    const enable = async () => {
      await new Promise((r) => setTimeout(r, 100));
      if (
        Platform.OS === "android" &&
        parseInt(String(Platform.Version), 10) >= 33
      ) {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) return;
        } catch {
          return;
        }
      }
      TvPlayerCommands.enableBackgroundAudio(tvPlayerRef);
      TvPlayerCommands.setMediaMetadata(tvPlayerRef, {
        title: title || "",
        artist: subtitle || "Live TV",
        artworkUri: poster,
      });
    };
    enable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundPlay, isPlaying, nativeReady]);

  // AppState handling — pause when backgrounded unless background play is on.
  useEffect(() => {
    const handler = async (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (!backgroundPlay && !isInPiPRef.current) {
          if (isBackgroundPlayingRef.current)
            TvPlayerCommands.disableBackgroundAudio(tvPlayerRef);
          TvPlayerCommands.pause(tvPlayerRef);
        }
      } else if (next === "active") {
        if (isTV && isBackgroundPlayingRef.current)
          TvPlayerCommands.play(tvPlayerRef);
      }
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, [backgroundPlay]);

  // ── Derived display values ───────────────────────────────────────────────
  const allQualities = useMemo(() => {
    if (detectedQualities.length > 0) return detectedQualities;
    return propQualities;
  }, [detectedQualities, propQualities]);

  // ── Playback actions ─────────────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    if (!isPlayingRef.current) {
      TvPlayerCommands.play(tvPlayerRef);
    } else {
      TvPlayerCommands.pause(tvPlayerRef);
    }
    if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleQualitySelect = useCallback(
    (label: string | null) => {
      setSelectedQuality(label);
      const q = label ? allQualities.find((x) => x.label === label) : null;
      if (q?.url && q.url !== currentSource) {
        setCurrentSource(q.url);
        setError(null);
        setIsLoading(true);
      }
      setShowQualityModal(false);
      scheduleHide();
    },
    [allQualities, currentSource, scheduleHide],
  );

  const changePlayerEngine = useCallback(
    (engine: "exoplayer" | "vlc") => {
      setActivePlayerEngine(engine);
      if (channelId) setChannelPlayerEngine(channelId, engine);
      if (tvPlayerRef.current) {
        // PlayerManager.switchEngine() already reloads the current source
        // from lastLoadParams and resumes playback. Calling loadSource() here
        // too would cause a SECOND full ExoPlayer rebuild.
        TvPlayerCommands.setPlayerEngine(tvPlayerRef, engine);
        setError(null);
        setIsLoading(true);
        consecutiveErrorCountRef.current = 0;
      }
      setShowEngineModal(false);
      scheduleHide();
    },
    [channelId, scheduleHide],
  );

  const handleSelectAudio = useCallback(
    (track: NativeAudioTrack) => {
      TvPlayerCommands.selectAudioTrack(
        tvPlayerRef,
        track.groupIndex,
        track.trackIndex,
      );
      setSelectedAudioTrack(track.id);
      setShowAudioModal(false);
      scheduleHide();
    },
    [scheduleHide],
  );

  const handleSelectSubtitle = useCallback(
    (track: NativeSubtitleTrack) => {
      TvPlayerCommands.selectSubtitleTrack(
        tvPlayerRef,
        track.groupIndex,
        track.trackIndex,
      );
      setSelectedSubtitleTrack(track.id);
      setShowSubtitleModal(false);
      scheduleHide();
    },
    [scheduleHide],
  );

  const handleContentFit = useCallback(
    (fit: ContentFit) => {
      setContentFit(fit);
      TvPlayerCommands.setResizeMode(tvPlayerRef, fit);
      setShowAspectModal(false);
      scheduleHide();
    },
    [scheduleHide],
  );

  // ── Native callbacks ────────────────────────────────────────────────────
  const onReady = useCallback(() => setIsLoading(false), []);
  const onErrorCb = useCallback(
    (e: { nativeEvent: { message: string } }) => {
      const msg = e.nativeEvent?.message || "Playback error";
      consecutiveErrorCountRef.current += 1;
      if (consecutiveErrorCountRef.current >= 3) {
        setError(msg);
      }
      setIsLoading(false);
      onError?.(msg);
    },
    [onError],
  );
  const onPlayingChange = useCallback(
    (e: { nativeEvent: { isPlaying: boolean } }) => {
      const playing = e.nativeEvent.isPlaying;
      isPlayingRef.current = playing;
      setIsPlaying(playing);
      if (playing) {
        setIsLoading(false);
        consecutiveErrorCountRef.current = 0;
      }
    },
    [],
  );
  const onBufferingChange = useCallback(
    (e: { nativeEvent: { isBuffering: boolean } }) => {
      setIsBuffering(e.nativeEvent.isBuffering);
    },
    [],
  );
  const onTracksChange = useCallback(
    (e: {
      nativeEvent: {
        audioTracks: NativeAudioTrack[];
        subtitleTracks: NativeSubtitleTrack[];
      };
    }) => {
      const a = e.nativeEvent.audioTracks || [];
      const s = e.nativeEvent.subtitleTracks || [];
      setNativeAudioTracks(a);
      setNativeSubtitleTracks(s);
      const selA = a.find((t) => t.isSelected);
      setSelectedAudioTrack(selA?.id ?? null);
      const selS = s.find((t) => t.isSelected);
      setSelectedSubtitleTrack(selS?.id ?? null);
    },
    [],
  );
  const onPip = useCallback((e: { nativeEvent: { isInPiP: boolean } }) => {
    isInPiPRef.current = e.nativeEvent.isInPiP;
  }, []);
  const onBackgroundAudioChange = useCallback(
    (e: { nativeEvent: { enabled: boolean } }) => {
      isBackgroundPlayingRef.current = e.nativeEvent.enabled;
    },
    [],
  );

  // ── TV D-pad handler ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isTV) return;
    let TVEventHandler: any;
    try {
      TVEventHandler =
        require("react-native/Libraries/Components/TV/TVEventHandler").default;
    } catch {
      return;
    }
    if (!TVEventHandler?.addListener) return;

    const sub = TVEventHandler.addListener((evt: any) => {
      if (!evt) return;
      const { eventType } = evt;
      if (["up", "down", "playPause"].includes(eventType)) {
        if (!showControlsRef.current) {
          showAndScheduleHideRef.current();
        } else {
          scheduleHideRef.current();
        }
        return;
      }
      if (eventType === "select") {
        if (!showControlsRef.current) {
          showAndScheduleHideRef.current();
        } else {
          scheduleHideRef.current();
        }
        return;
      }
      if (eventType === "left" || eventType === "right") {
        if (!showControlsRef.current) {
          showAndScheduleHideRef.current();
        } else {
          scheduleHideRef.current();
        }
        return;
      }
      if (eventType === "back") {
        if (showControlsRef.current) {
          setShowControls(false);
        } else {
          onBack?.();
        }
        return;
      }
      if (eventType === "menu") {
        showAndScheduleHideRef.current();
        return;
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Touch gesture (mobile) — tap toggles controls ─────────────────────────
  const toggleControls = useCallback(() => {
    if (showControlsRef.current) {
      setShowControls(false);
    } else {
      setShowControls(true, true);
    }
  }, [setShowControls]);
  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        runOnJS(toggleControls)();
      }),
    [toggleControls],
  );

  // ── Derived display values ───────────────────────────────────────────────
  const resolutionLabel = useMemo(() => {
    if (selectedQuality) return selectedQuality;
    if (allQualities[0])
      return allQualities[0].resolution || allQualities[0].label;
    return "Adaptive";
  }, [allQualities, selectedQuality]);

  const audioLabel = useMemo(() => {
    const sel = nativeAudioTracks.find((t) => t.id === selectedAudioTrack);
    if (sel?.label) return sel.label;
    if (nativeAudioTracks.length > 1)
      return `${nativeAudioTracks.length} Tracks`;
    return "Stereo";
  }, [nativeAudioTracks, selectedAudioTrack]);

  const engineLabel = activePlayerEngine === "vlc" ? "VLC" : "ExoPlayer";

  // Quality / signal meter values (presentational, derived from settings).
  const { signalPct, qualityPct } = useMemo(() => {
    // Quality bar reflects videoQuality preference.
    let qp = 100;
    // (propQualities not used to drive meter; signal remains nominal.)
    if (propQualities.length === 0) qp = 92;
    else qp = 88;
    return { signalPct: error ? 18 : 94, qualityPct: qp };
  }, [error, propQualities.length]);

  const clockStr = useMemo(() => {
    const h = now.getHours().toString().padStart(2, "0");
    const m = now.getMinutes().toString().padStart(2, "0");
    const s = now.getSeconds().toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [now]);
  const dateStr = useMemo(() => {
    const d = now.getDate().toString().padStart(2, "0");
    const mo = (now.getMonth() + 1).toString().padStart(2, "0");
    return `${d}/${mo}/${now.getFullYear()}`;
  }, [now]);
  const dayStr = useMemo(() => {
    return now.toLocaleDateString(undefined, { weekday: "long" });
  }, [now]);

  const channelNumberStr = useMemo(() => {
    if (channelNumber != null)
      return Math.max(1, channelNumber).toString().padStart(3, "0");
    return null;
  }, [channelNumber]);

  const nextChannel = useMemo(() => {
    // The parent passes "recent" channels (excluding current). Use the first
    // as a stand-in "next" entry for the now/next strip.
    return recentChannels[0];
  }, [recentChannels]);

  const nextStartTime = useMemo(() => {
    // Notional +30 min to give the timeslot visual context.
    const d = new Date(now.getTime() + 30 * 60 * 1000);
    return `${d.getHours().toString().padStart(2, "0")}:${d
      .getMinutes()
      .toString()
      .padStart(2, "0")}`;
  }, [now]);

  // ── Animated styles ───────────────────────────────────────────────────────
  const controlsAnim = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));
  const infoAnim = useAnimatedStyle(() => ({
    opacity: infoOpacity.value,
    transform: [{ translateY: infoTranslateY.value }],
  }));

  const closeButton = (
    <TVFocusablePressable
      onPress={() => {
        if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onBack?.();
      }}
      baseStyle={styles.topBtn}
      focusedStyle={styles.topBtnFocused}
      viewRef={backBtnRef}
      accessibilityLabel="Back"
    >
      <Ionicons name="chevron-back" size={26} color={ACCENT.textPrimary} />
    </TVFocusablePressable>
  );

  const favButton = (
    <TVFocusablePressable
      onPress={() => {
        if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onFavoritePress?.();
        scheduleHide();
      }}
      baseStyle={styles.topBtn}
      focusedStyle={styles.topBtnFocused}
      viewRef={favBtnRef}
      accessibilityLabel={isFavorite ? "Remove favorite" : "Add favorite"}
    >
      <Ionicons
        name={isFavorite ? "heart" : "heart-outline"}
        size={24}
        color={isFavorite ? ACCENT.live : ACCENT.textPrimary}
      />
    </TVFocusablePressable>
  );

  const settingsButton = (
    <TVFocusablePressable
      onPress={() => {
        if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setShowSettingsModal(true);
      }}
      baseStyle={styles.topBtn}
      focusedStyle={styles.topBtnFocused}
      viewRef={settingsBtnRef}
      accessibilityLabel="Settings"
    >
      <Ionicons name="settings-outline" size={24} color={ACCENT.textPrimary} />
    </TVFocusablePressable>
  );

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={[styles.root, { width, height }]}>
        <StatusBar hidden translucent backgroundColor="transparent" />

        {/* Background video */}
        <TvPlayerView
          ref={nativeViewRef}
          style={StyleSheet.absoluteFillObject}
          onReady={onReady}
          onError={onErrorCb}
          onPlayingChange={onPlayingChange}
          onBufferingChange={onBufferingChange}
          onTracksChange={onTracksChange}
          onPipModeChange={onPip}
          onBackgroundAudioChange={onBackgroundAudioChange}
        />

        {/* Tap layer (mobile) */}
        {!isTV && (
          <GestureDetector gesture={tapGesture}>
            <View style={StyleSheet.absoluteFillObject} collapsable={false} />
          </GestureDetector>
        )}

        {/* Vignette + bottom gradient overlays (cinematic) */}
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id="bottomGrad" x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0%" stopColor="#000000" stopOpacity={0.92} />
                <Stop offset="38%" stopColor="#000000" stopOpacity={0.55} />
                <Stop offset="60%" stopColor="#000000" stopOpacity={0.18} />
                <Stop offset="100%" stopColor="#000000" stopOpacity={0} />
              </LinearGradient>
              <RadialGradient id="vignette" cx="50%" cy="50%" r="75%">
                <Stop offset="55%" stopColor="#000000" stopOpacity={0} />
                <Stop offset="100%" stopColor="#000000" stopOpacity={0.55} />
              </RadialGradient>
            </Defs>
            <Rect
              x="0"
              y={height * 0.55}
              width={width}
              height={height * 0.45}
              fill="url(#bottomGrad)"
            />
            <Rect
              x="0"
              y="0"
              width={width}
              height={height}
              fill="url(#vignette)"
            />
          </Svg>
        </View>

        {/* Loading / buffering spinner */}
        {(isLoading || isBuffering) && !error && (
          <View style={styles.centerOverlay} pointerEvents="none">
            <ActivityIndicator size="large" color={ACCENT.textPrimary} />
            <ThemedText
              type="body"
              style={[styles.loadingText, { color: ACCENT.textSecondary }]}
            >
              {isBuffering ? "Buffering…" : "Loading…"}
            </ThemedText>
          </View>
        )}

        {/* Error overlay */}
        {error && (
          <View style={styles.centerOverlay}>
            <Ionicons name="alert-circle" size={48} color={ACCENT.live} />
            <ThemedText
              type="h4"
              style={[styles.loadingText, { color: ACCENT.textPrimary }]}
            >
              Playback Error
            </ThemedText>
            <ThemedText
              type="small"
              style={[
                styles.loadingText,
                { color: ACCENT.textSecondary, marginTop: 4 },
              ]}
              numberOfLines={2}
            >
              {error}
            </ThemedText>
            <TVFocusablePressable
              onPress={() => {
                setError(null);
                setIsLoading(true);
                consecutiveErrorCountRef.current = 0;
                loadSource();
              }}
              baseStyle={styles.retryBtn}
              focusedStyle={styles.retryBtnFocused}
              accessibilityLabel="Retry"
            >
              <ThemedText
                type="body"
                style={{ color: ACCENT.textPrimary, fontWeight: "600" }}
              >
                Retry
              </ThemedText>
            </TVFocusablePressable>
          </View>
        )}

        {/* Controls overlay */}
        <Animated.View
          pointerEvents={showControls ? "auto" : "none"}
          style={[StyleSheet.absoluteFill, controlsAnim]}
        >
          {/* Top bar */}
          <View
            style={[
              styles.topBar,
              {
                paddingTop: Math.max(insets.top, 32),
                paddingLeft: Math.max(insets.left, 32),
                paddingRight: Math.max(insets.right, 32),
              },
            ]}
          >
            {closeButton}
            <View style={styles.topBarRight}>
              {favButton}
              {settingsButton}
              <View style={styles.clockWrap}>
                <ThemedText
                  style={[styles.clockDay, { color: ACCENT.textSecondary }]}
                >
                  {dayStr}
                </ThemedText>
                <ThemedText
                  style={[styles.clockDate, { color: ACCENT.textSecondary }]}
                >
                  {dateStr}
                </ThemedText>
                <ThemedText
                  style={[styles.clockTime, { color: ACCENT.textPrimary }]}
                >
                  {clockStr}
                </ThemedText>
              </View>
            </View>
          </View>

          {/* Bottom info bar */}
          <Animated.View
            style={[
              styles.bottomBar,
              {
                paddingBottom: Math.max(insets.bottom, 40),
                paddingLeft: Math.max(insets.left, 48),
                paddingRight: Math.max(insets.right, 48),
              },
              infoAnim,
            ]}
          >
            <View style={styles.bottomBarRow}>
              {/* ── Left: logo card ───────────────────────────────────────── */}
              <View style={styles.logoSection}>
                <View style={styles.logoCard}>
                  {poster ? (
                    <Image
                      source={{ uri: poster }}
                      style={styles.logoImage}
                      contentFit="contain"
                      transition={200}
                    />
                  ) : (
                    <ThemedText
                      style={[styles.logoFallback, { color: "#1A1A1A" }]}
                    >
                      {(title || "TV").slice(0, 1).toUpperCase()}
                    </ThemedText>
                  )}
                </View>
              </View>

              {/* ── Center: channel metadata + stats ──────────────────────── */}
              <View style={styles.metaSection}>
                {channelNumberStr && (
                  <ThemedText
                    style={[
                      styles.channelNumber,
                      { color: ACCENT.textPrimary },
                    ]}
                  >
                    {channelNumberStr}
                  </ThemedText>
                )}
                <ThemedText
                  style={[styles.channelName, { color: ACCENT.textPrimary }]}
                  numberOfLines={2}
                >
                  {title || "Untitled Channel"}
                </ThemedText>
                <ThemedText
                  style={[styles.streamMeta, { color: ACCENT.textMuted }]}
                >
                  {resolutionLabel}
                  {` · ${engineLabel}`}
                  {` · ${audioLabel}`}
                </ThemedText>

                {/* Playback stats */}
                <View style={styles.statsRow}>
                  <StatBar
                    label="Signal"
                    value={signalPct}
                    color={ACCENT.signal}
                  />
                  <StatBar
                    label="Quality"
                    value={qualityPct}
                    color={ACCENT.quality}
                  />
                </View>
                {isLive && (
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <ThemedText
                      style={[
                        styles.livePillText,
                        { color: ACCENT.textPrimary },
                      ]}
                    >
                      LIVE
                    </ThemedText>
                  </View>
                )}
              </View>

              {/* ── Right: now/next EPG-style strip ───────────────────────── */}
              <View style={styles.epgSection}>
                <View style={styles.glassCard}>
                  <View style={styles.epgNow}>
                    <View style={styles.liveBadge}>
                      <ThemedText
                        style={[
                          styles.liveBadgeText,
                          { color: ACCENT.textPrimary },
                        ]}
                      >
                        LIVE
                      </ThemedText>
                    </View>
                    <ThemedText
                      style={[styles.epgTime, { color: ACCENT.textSecondary }]}
                    >
                      Now
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={[
                      styles.epgProgramTitle,
                      { color: ACCENT.textPrimary },
                    ]}
                    numberOfLines={2}
                  >
                    {title || "Now Playing"}
                  </ThemedText>
                  {subtitle ? (
                    <ThemedText
                      style={[
                        styles.epgProgramSub,
                        { color: ACCENT.textMuted },
                      ]}
                      numberOfLines={1}
                    >
                      {subtitle}
                    </ThemedText>
                  ) : null}

                  {nextChannel ? (
                    <View style={styles.epgNext}>
                      <ThemedText
                        style={[styles.epgTime, { color: ACCENT.textMuted }]}
                      >
                        {nextStartTime} · Next
                      </ThemedText>
                      <ThemedText
                        style={[
                          styles.epgNextTitle,
                          { color: ACCENT.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {nextChannel.name}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            {/* Transport row + feature indicators */}
            <View style={styles.bottomFooter}>
              <View style={styles.transportRow}>
                <TVFocusablePressable
                  onPress={() => {
                    if (!isTV)
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onPrevious?.();
                  }}
                  baseStyle={styles.transportBtn}
                  focusedStyle={styles.transportBtnFocused}
                  viewRef={prevBtnRef}
                  accessibilityLabel="Previous channel"
                >
                  <Ionicons
                    name="play-skip-back"
                    size={22}
                    color={ACCENT.textPrimary}
                  />
                </TVFocusablePressable>

                <TVFocusablePressable
                  onPress={handlePlayPause}
                  baseStyle={styles.transportBtnPrimary}
                  focusedStyle={styles.transportBtnPrimaryFocused}
                  viewRef={playPauseBtnRef}
                  accessibilityLabel="Play or pause"
                >
                  <Ionicons
                    name={isPlaying ? "pause" : "play"}
                    size={28}
                    color={ACCENT.textPrimary}
                  />
                </TVFocusablePressable>

                <TVFocusablePressable
                  onPress={() => {
                    if (!isTV)
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onNext?.();
                  }}
                  baseStyle={styles.transportBtn}
                  focusedStyle={styles.transportBtnFocused}
                  viewRef={nextBtnRef}
                  accessibilityLabel="Next channel"
                >
                  <Ionicons
                    name="play-skip-forward"
                    size={22}
                    color={ACCENT.textPrimary}
                  />
                </TVFocusablePressable>
              </View>

              <FeatureIndicators
                engineLabel={engineLabel}
                audioCount={nativeAudioTracks.length}
                subtitleCount={nativeSubtitleTracks.length}
                isLive={isLive}
              />
            </View>
          </Animated.View>
        </Animated.View>

        {/* ── Settings modal ───────────────────────────────────────────────── */}
        <Modal
          visible={showSettingsModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSettingsModal(false)}
        >
          <Pressable
            style={sModal.overlay}
            onPress={() => setShowSettingsModal(false)}
          >
            <View style={sModal.card}>
              <ThemedText style={sModal.title}>Player</ThemedText>
              <ScrollView style={{ maxHeight: 360 }}>
                <ModalRow
                  icon="hardware-chip-outline"
                  label="Quality"
                  value={selectedQuality || resolutionLabel || "Auto"}
                  onPress={() => {
                    setShowSettingsModal(false);
                    setShowQualityModal(true);
                  }}
                />
                <ModalRow
                  icon="musical-notes-outline"
                  label="Audio"
                  value={
                    nativeAudioTracks.find((t) => t.id === selectedAudioTrack)
                      ?.label ||
                    (nativeAudioTracks.length > 1
                      ? `${nativeAudioTracks.length} tracks`
                      : "Default")
                  }
                  onPress={() => {
                    setShowSettingsModal(false);
                    setShowAudioModal(true);
                  }}
                />
                <ModalRow
                  icon="captions-outline"
                  label="Subtitles"
                  value={
                    nativeSubtitleTracks.find(
                      (t) => t.id === selectedSubtitleTrack,
                    )?.label ||
                    (nativeSubtitleTracks.length > 0 ? "Available" : "Off")
                  }
                  onPress={() => {
                    setShowSettingsModal(false);
                    setShowSubtitleModal(true);
                  }}
                />
                <ModalRow
                  icon="settings-outline"
                  label="Player Engine"
                  value={engineLabel}
                  onPress={() => {
                    setShowSettingsModal(false);
                    setShowEngineModal(true);
                  }}
                />
                <ModalRow
                  icon="expand-outline"
                  label="Aspect Ratio"
                  value={
                    CONTENT_FIT_OPTIONS.find((o) => o.value === contentFit)
                      ?.label || "Fit"
                  }
                  onPress={() => {
                    setShowSettingsModal(false);
                    setShowAspectModal(true);
                  }}
                />
              </ScrollView>
            </View>
          </Pressable>
        </Modal>

        {/* Quality modal */}
        <ChoiceModal
          visible={showQualityModal}
          title="Quality"
          onClose={() => setShowQualityModal(false)}
          options={[
            { label: "Auto", value: null as string | null },
            ...allQualities.map((q) => ({
              label: q.label,
              value: q.label as string | null,
            })),
          ]}
          selectedValue={selectedQuality}
          onSelect={(opt) => handleQualitySelect(opt.value)}
        />

        {/* Audio modal */}
        <ChoiceModal
          visible={showAudioModal}
          title="Audio Track"
          onClose={() => setShowAudioModal(false)}
          options={nativeAudioTracks.map((t) => ({
            label: t.label,
            value: t.id,
          }))}
          selectedValue={selectedAudioTrack}
          onSelect={(opt) => {
            const track = nativeAudioTracks.find((t) => t.id === opt.value);
            if (track) handleSelectAudio(track);
          }}
        />

        {/* Subtitle modal */}
        <ChoiceModal
          visible={showSubtitleModal}
          title="Subtitles"
          onClose={() => setShowSubtitleModal(false)}
          options={nativeSubtitleTracks.map((t) => ({
            label: t.label,
            value: t.id,
          }))}
          selectedValue={selectedSubtitleTrack}
          onSelect={(opt) => {
            const track = nativeSubtitleTracks.find((t) => t.id === opt.value);
            if (track) handleSelectSubtitle(track);
          }}
        />

        {/* Engine modal */}
        <ChoiceModal
          visible={showEngineModal}
          title="Player Engine"
          onClose={() => setShowEngineModal(false)}
          options={[
            { label: "ExoPlayer (Media3)", value: "exoplayer" as const },
            { label: "VLC", value: "vlc" as const },
          ]}
          selectedValue={activePlayerEngine}
          onSelect={(opt) =>
            changePlayerEngine(opt.value as "exoplayer" | "vlc")
          }
        />

        {/* Aspect modal */}
        <ChoiceModal
          visible={showAspectModal}
          title="Aspect Ratio"
          onClose={() => setShowAspectModal(false)}
          options={CONTENT_FIT_OPTIONS.map((o) => ({
            label: o.label,
            value: o.value,
          }))}
          selectedValue={contentFit}
          onSelect={(opt) => handleContentFit(opt.value as ContentFit)}
        />
      </View>
    </GestureHandlerRootView>
  );
});

// ── Sub-components ───────────────────────────────────────────────────────────

function StatBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.statWrap}>
      <ThemedText style={[styles.statLabel, { color: ACCENT.textMuted }]}>
        {label}
      </ThemedText>
      <View style={styles.statTrack}>
        <View
          style={[
            styles.statFill,
            {
              width: `${Math.max(0, Math.min(100, value))}%`,
              backgroundColor: color,
            },
          ]}
        />
      </View>
      <ThemedText style={[styles.statPct, { color: ACCENT.textSecondary }]}>
        {Math.round(value)}%
      </ThemedText>
    </View>
  );
}

function FeatureIndicators({
  engineLabel,
  audioCount,
  subtitleCount,
  isLive,
}: {
  engineLabel: string;
  audioCount: number;
  subtitleCount: number;
  isLive: boolean;
}) {
  return (
    <View style={styles.featureRow}>
      {isLive && <FeatureChip color={ACCENT.live} label="Live" />}
      <FeatureChip color={ACCENT.quality} label={engineLabel} />
      {audioCount > 1 && (
        <FeatureChip color={ACCENT.audio} label={`${audioCount} Audio`} />
      )}
      {subtitleCount > 0 && <FeatureChip color={ACCENT.subtitle} label="CC" />}
    </View>
  );
}

function FeatureChip({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.featureChip}>
      <View style={[styles.featureSquare, { backgroundColor: color }]} />
      <ThemedText
        style={[styles.featureLabel, { color: ACCENT.textSecondary }]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

function ModalRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: string;
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <TVFocusablePressable
      onPress={onPress}
      baseStyle={sModal.row}
      focusedStyle={sModal.rowFocused}
      accessibilityLabel={label}
    >
      <Ionicons name={icon as any} size={20} color={ACCENT.textPrimary} />
      <View style={sModal.rowText}>
        <ThemedText style={sModal.rowLabel}>{label}</ThemedText>
        <ThemedText
          style={[sModal.rowValue, { color: ACCENT.textSecondary }]}
          numberOfLines={1}
        >
          {value}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={ACCENT.textMuted} />
    </TVFocusablePressable>
  );
}

interface ChoiceOption<T = any> {
  label: string;
  value: T;
}

function ChoiceModal<T>({
  visible,
  title,
  options,
  selectedValue,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: ChoiceOption<T>[];
  selectedValue: T | null;
  onSelect: (opt: ChoiceOption<T>) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={sModal.overlay} onPress={onClose}>
        <View style={sModal.card}>
          <ThemedText style={sModal.title}>{title}</ThemedText>
          <ScrollView style={{ maxHeight: 360 }}>
            {options.length === 0 ? (
              <ThemedText
                style={[sModal.emptyText, { color: ACCENT.textSecondary }]}
              >
                No options available
              </ThemedText>
            ) : (
              options.map((opt, idx) => {
                const isSelected = opt.value === selectedValue;
                return (
                  <TVFocusablePressable
                    key={`${opt.label}-${idx}`}
                    onPress={() => onSelect(opt)}
                    baseStyle={[
                      sModal.option,
                      isSelected && sModal.optionSelected,
                    ]}
                    focusedStyle={sModal.optionFocused}
                    hasTVPreferredFocus={idx === 0}
                    accessibilityLabel={opt.label}
                  >
                    <ThemedText
                      style={[sModal.optionText, { color: ACCENT.textPrimary }]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </ThemedText>
                    {isSelected && (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={Colors.dark.primary}
                      />
                    )}
                  </TVFocusablePressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  loadingText: {
    marginTop: Spacing.md,
    fontWeight: "500",
  },
  retryBtn: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  retryBtnFocused: {
    backgroundColor: "rgba(255,255,255,0.22)",
    transform: [{ scale: 1.05 }],
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  topBtnFocused: {
    backgroundColor: "rgba(255,255,255,0.20)",
    transform: [{ scale: 1.08 }],
  },
  clockWrap: {
    alignItems: "flex-end",
    marginLeft: Spacing.sm,
    gap: 2,
  },
  clockDay: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  clockDate: {
    fontSize: 12,
    fontWeight: "400",
  },
  clockTime: {
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
  },
  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  bottomBarRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: Spacing["2xl"],
  },
  logoSection: {
    alignItems: "flex-start",
  },
  logoCard: {
    width: 110,
    height: 110,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  logoImage: {
    width: "92%",
    height: "92%",
  },
  logoFallback: {
    fontSize: 40,
    fontWeight: "700",
  },
  metaSection: {
    flex: 1,
    alignItems: "flex-start",
    justifyContent: "flex-end",
    gap: 4,
  },
  channelNumber: {
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: 1,
    lineHeight: 44,
  },
  channelName: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 0.4,
    lineHeight: 32,
  },
  streamMeta: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: "row",
    gap: Spacing.xl,
    marginTop: Spacing.md,
  },
  statWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    width: 52,
  },
  statTrack: {
    width: 110,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
  statFill: {
    height: "100%",
    borderRadius: 2,
  },
  statPct: {
    fontSize: 11,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.md,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: "rgba(255,59,48,0.18)",
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACCENT.live,
  },
  livePillText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  epgSection: {
    width: 320,
    alignItems: "flex-end",
  },
  glassCard: {
    width: "100%",
    borderRadius: 20,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: ACCENT.glass,
    borderColor: ACCENT.glassBorder,
    borderWidth: 1,
    gap: 4,
  },
  epgNow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  liveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    backgroundColor: ACCENT.live,
  },
  liveBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  epgTime: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  epgProgramTitle: {
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
    marginTop: 2,
  },
  epgProgramSub: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  epgNext: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  epgNextTitle: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  bottomFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.lg,
  },
  transportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  transportBtn: {
    width: 48,
    height: 48,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  transportBtnFocused: {
    backgroundColor: "rgba(255,255,255,0.22)",
    transform: [{ scale: 1.1 }],
  },
  transportBtnPrimary: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  transportBtnPrimaryFocused: {
    backgroundColor: "rgba(255,255,255,0.32)",
    transform: [{ scale: 1.08 }],
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.lg,
  },
  featureChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  featureSquare: {
    width: 10,
    height: 10,
    borderRadius: 3,
  },
  featureLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});

const sModal = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 20,
    padding: Spacing.xl,
    backgroundColor: "rgba(26,26,26,0.92)",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: ACCENT.textPrimary,
    marginBottom: Spacing.md,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  rowFocused: {
    backgroundColor: "rgba(255,255,255,0.10)",
    transform: [{ scale: 1.03 }],
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: ACCENT.textPrimary,
  },
  rowValue: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    marginBottom: 4,
  },
  optionSelected: {
    backgroundColor: "rgba(77,208,225,0.18)",
  },
  optionFocused: {
    backgroundColor: "rgba(255,255,255,0.10)",
    transform: [{ scale: 1.04 }],
  },
  optionText: {
    fontSize: 15,
    fontWeight: "500",
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: Spacing.lg,
  },
});
