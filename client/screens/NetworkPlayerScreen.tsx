import React, { useCallback, useEffect } from "react";
import { View, StatusBar, Pressable, StyleSheet, Platform } from "react-native";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import {
  AdvancedVideoPlayer,
  DRMConfig,
} from "@/components/AdvancedVideoPlayer";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import { USER_AGENT_STRINGS, UserAgent } from "@/lib/storage";
import { usePlaylist } from "@/context/PlaylistContext";

const isTV = Platform.isTV;

type NetworkPlayerRouteProp = RouteProp<RootStackParamList, "NetworkPlayer">;
type NetworkPlayerNavProp = NativeStackNavigationProp<
  RootStackParamList,
  "NetworkPlayer"
>;

let NavigationBarModule: any = null;

async function loadNavBar() {
  if (Platform.OS === "android" && !NavigationBarModule) {
    try {
      NavigationBarModule = require("expo-navigation-bar");
    } catch {}
  }
}

async function hideNavBar() {
  if (Platform.OS === "android" && NavigationBarModule) {
    try {
      await NavigationBarModule.setVisibilityAsync("hidden");
      await NavigationBarModule.setBehaviorAsync("overlay-swipe");
    } catch {}
  }
}

async function showNavBar() {
  if (Platform.OS === "android" && NavigationBarModule) {
    try {
      await NavigationBarModule.setVisibilityAsync("visible");
    } catch {}
  }
}

/** Safe trim — returns "" if value is null/undefined (guards against corrupted AsyncStorage). */
function safeTrim(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** Derive a human-readable title from a URL (hostname), falling back to a default. */
function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname || "Network Stream";
  } catch {
    return "Network Stream";
  }
}

export default function NetworkPlayerScreen() {
  const navigation = useNavigation<NetworkPlayerNavProp>();
  const route = useRoute<NetworkPlayerRouteProp>();
  const { config } = route.params;
  const { settings } = usePlaylist();

  useEffect(() => {
    loadNavBar().then(() => hideNavBar());
    return () => {
      showNavBar();
    };
  }, []);

  const handleBack = useCallback(() => {
    if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  const handleError = useCallback((error: string) => {
    console.error("Network stream error:", error);
  }, []);

  /** Build DRMConfig only when a recognisable DRM scheme and license URL are provided. */
  const drm: DRMConfig | undefined = (() => {
    const rawValue = safeTrim(config.drmLicenseUrl);
    if (!rawValue) return undefined;

    const scheme = config.drmScheme?.toLowerCase?.() ?? "";
    let type: DRMConfig["type"];
    if (scheme === "widevine") type = "widevine";
    else if (scheme === "playready") type = "playready";
    else if (scheme === "clearkey") type = "clearkey";
    else if (scheme === "fairplay") type = "fairplay";
    else {
      // Unknown DRM scheme — do not silently default to clearkey. Log and skip
      // DRM configuration so ExoPlayer attempts cleartext playback rather than
      // trying an incorrect DRM scheme which would always fail.
      console.warn(`[NetworkPlayer] Unknown DRM scheme "${config.drmScheme}" — DRM disabled`);
      return undefined;
    }

    // ClearKey may be supplied as an embedded key (KID:KEY or a W3C ClearKey
    // JSON document) rather than as a license-server URL. The UI hint on the
    // input instructs users to enter the key directly for ClearKey. Detect this
    // here so the embedded key is routed to licenseKey, and the native side
    // builds a local ClearKey callback instead of trying to HTTP-GET the key.
    if (type === "clearkey") {
      const looksLikeUrl = /^https?:\/\//i.test(rawValue);
      if (!looksLikeUrl) {
        return { type, licenseKey: rawValue };
      }
    }

    return { type, licenseServer: rawValue };
  })();

  /** Build request headers from cookie / referer / origin / user-agent.
   *  All fields use safeTrim() to guard against null/undefined from
   *  corrupted AsyncStorage data (e.g. values written by an older app version). */
  const headers: Record<string, string> = {};
  const cookie = safeTrim(config.cookie);
  const referer = safeTrim(config.referer);
  const origin = safeTrim(config.origin);
  if (cookie) headers["Cookie"] = cookie;
  if (referer) headers["Referer"] = referer;
  if (origin) headers["Origin"] = origin;

  const uaString =
    config.userAgent === "custom"
      ? safeTrim(config.customUserAgent)
      : (USER_AGENT_STRINGS[config.userAgent as UserAgent] ?? "");
  if (uaString) headers["User-Agent"] = uaString;

  const streamUrl = safeTrim(config.url);

  if (!streamUrl) {
    return (
      <View style={[styles.container, styles.center]}>
        <StatusBar hidden />
        <Ionicons name="alert-circle" size={40} color={Colors.dark.error} />
        <ThemedText type="h4" style={styles.errorTitle}>
          No Stream URL
        </ThemedText>
        <ThemedText type="body" style={styles.errorSub}>
          Go back and enter a Media Stream URL.
        </ThemedText>
        <Pressable
          onPress={handleBack}
          style={styles.errorButton}
          focusable={true}
          hasTVPreferredFocus={true}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <ThemedText type="body" style={{ color: Colors.dark.primary }}>
            Go Back
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar hidden translucent backgroundColor="transparent" />
      <AdvancedVideoPlayer
        source={streamUrl}
        title={titleFromUrl(streamUrl)}
        autoPlay={true}
        drm={drm}
        headers={Object.keys(headers).length > 0 ? headers : undefined}
        onError={handleError}
        onBack={handleBack}
        // Respect the user's global backgroundPlay and playerEngine settings.
        // Previously these were always left at their defaults (false / "exoplayer"),
        // meaning background audio never worked and the engine preference was ignored.
        backgroundPlay={settings.backgroundPlay}
        playerEngine={settings.playerEngine}
        // isLive is intentionally left at its default (true) here because network
        // streams are usually live. Users who need VOD playback can use PlayerScreen
        // via a playlist. Keeping it true avoids showing a misleading duration for
        // actual live streams which report C.TIME_UNSET as their duration.
        isLive={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  errorTitle: {
    marginTop: Spacing.md,
    color: "#FFFFFF",
  },
  errorSub: {
    marginTop: Spacing.sm,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },
  errorButton: {
    marginTop: Spacing.xl,
    padding: Spacing.md,
    backgroundColor: Colors.dark.primary + "30",
    borderRadius: BorderRadius.sm,
  },
});
