import React, { useEffect, useMemo, useCallback, useState } from "react";
import {
  StyleSheet,
  View,
  Pressable,
  StatusBar,
  Platform,
  useWindowDimensions,
} from "react-native";

const isTV = Platform.isTV;
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import {
  AdvancedVideoPlayer,
  VideoQuality,
  DRMConfig,
} from "@/components/AdvancedVideoPlayer";
import { usePlaylist } from "@/context/PlaylistContext";
import { Colors, Spacing, BorderRadius } from "@/constants/theme";
import { extractDRMFromManifest } from "@/lib/manifest-drm-extractor";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

type PlayerRouteProp = RouteProp<RootStackParamList, "Player">;
type PlayerNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Player"
>;

const DEFAULT_QUALITIES: VideoQuality[] = [
  { label: "1080p", resolution: "1080p", bitrate: 5000000 },
  { label: "720p", resolution: "720p", bitrate: 2500000 },
  { label: "480p", resolution: "480p", bitrate: 1000000 },
  { label: "360p", resolution: "360p", bitrate: 500000 },
];

let NavigationBarModule: any = null;

async function loadNavigationBarModule() {
  if (Platform.OS === "android" && !NavigationBarModule) {
    try {
      NavigationBarModule = require("expo-navigation-bar");
    } catch (e) {
      console.log("Navigation bar module not available");
    }
  }
}

async function hideNavigationBar() {
  if (Platform.OS === "android" && NavigationBarModule) {
    try {
      await NavigationBarModule.setVisibilityAsync("hidden");
      await NavigationBarModule.setBehaviorAsync("overlay-swipe");
    } catch (e) {
      console.log("Navigation bar control not available");
    }
  }
}

async function showNavigationBar() {
  if (Platform.OS === "android" && NavigationBarModule) {
    try {
      await NavigationBarModule.setVisibilityAsync("visible");
    } catch (e) {
      console.log("Navigation bar control not available");
    }
  }
}

export default function PlayerScreen() {
  const { width, height } = useWindowDimensions();
  const navigation = useNavigation<PlayerNavigationProp>();
  const route = useRoute<PlayerRouteProp>();
  const { channelId } = route.params;

  const {
    getChannelById,
    favorites,
    toggleFavorite,
    addToRecent,
    playlist,
    settings,
    recentChannels,
  } = usePlaylist();

  const channel = getChannelById(channelId);
  const isFavorite = favorites.includes(channelId);

  const [manifestDrm, setManifestDrm] = useState<import("@/types/playlist").DRMInfo | undefined>(undefined);

  useEffect(() => {
    if (!channel) return;
    // If the channel already has KODIPROP DRM with a valid license URL, no
    // need to fetch from the manifest.
    if (channel.drm?.type && channel.drm?.licenseServer) {
      setManifestDrm(undefined);
      return;
    }
    let cancelled = false;
    extractDRMFromManifest(channel.url, channel.headers).then((drm) => {
      if (!cancelled) {
        // Only store DRM info that has both a type AND a usable licenseServer URL,
        // or is ClearKey (which may not need a license server URL). This prevents
        // partial DRM state (type set, licenseServer undefined) from being stored.
        if (drm?.type && (drm.licenseServer || drm.type === "clearkey")) {
          setManifestDrm(drm);
        } else {
          setManifestDrm(undefined);
        }
      }
    });
    return () => { cancelled = true; };
  }, [channel?.url, channel?.drm?.type, channel?.drm?.licenseServer, channel?.headers]);

  const recentChannelObjects = useMemo(() => {
    if (!playlist) return [];
    return recentChannels
      .filter((id) => id !== channelId)
      .slice(0, 4)
      .map((id) => getChannelById(id))
      .filter((ch) => ch !== undefined) as NonNullable<
      ReturnType<typeof getChannelById>
    >[];
  }, [recentChannels, channelId, playlist, getChannelById]);

  useEffect(() => {
    if (channel) {
      addToRecent(channel.id);
    }
  }, [channel]);

  useEffect(() => {
    loadNavigationBarModule().then(() => {
      hideNavigationBar();
    });
    return () => {
      showNavigationBar();
    };
  }, []);

  const handleBack = useCallback(() => {
    if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  }, [navigation]);

  const handleFavorite = useCallback(async () => {
    if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await toggleFavorite(channelId);
  }, [channelId, toggleFavorite]);

  const handleChannelNav = useCallback(
    (direction: "prev" | "next") => {
      if (!playlist) return;

      const currentIndex = playlist.channels.findIndex(
        (ch) => ch.id === channelId,
      );
      if (currentIndex === -1) return;

      let newIndex: number;
      if (direction === "prev") {
        newIndex =
          currentIndex === 0 ? playlist.channels.length - 1 : currentIndex - 1;
      } else {
        newIndex =
          currentIndex === playlist.channels.length - 1 ? 0 : currentIndex + 1;
      }

      const newChannel = playlist.channels[newIndex];
      if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.replace("Player", { channelId: newChannel.id });
    },
    [playlist, channelId, navigation],
  );

  const handleChannelSelect = useCallback(
    (selectedChannelId: string) => {
      if (!isTV) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (selectedChannelId === channelId) return;
      navigation.replace("Player", { channelId: selectedChannelId });
    },
    [channelId, navigation],
  );

  const handleError = useCallback((error: string) => {
    console.error("Player error:", error);
  }, []);

  const drmConfig = useMemo((): DRMConfig | undefined => {
    // Prefer KODIPROP-extracted DRM from the playlist
    if (channel?.drm?.type && channel.drm.licenseServer) {
      return {
        type: channel.drm.type as DRMConfig["type"],
        licenseServer: channel.drm.licenseServer,
        headers: channel.drm.headers,
        certificateUrl: channel.drm.certificateUrl,
        pssh: channel.drm.pssh,
      };
    }

    // Fall back to DRM extracted from the manifest itself.
    // manifestDrm is only set when it has both type and licenseServer (or is ClearKey).
    if (manifestDrm?.type && (manifestDrm.licenseServer || manifestDrm.type === "clearkey")) {
      return {
        type: manifestDrm.type as DRMConfig["type"],
        licenseServer: manifestDrm.licenseServer,
        headers: manifestDrm.headers,
        certificateUrl: manifestDrm.certificateUrl,
        pssh: manifestDrm.pssh,
      };
    }

    return undefined;
  }, [channel?.drm, manifestDrm]);

  const streamHeaders = useMemo(():
    | Record<string, string>
    | undefined => {
    if (!channel?.headers) return undefined;
    return Object.keys(channel.headers).length > 0 ? channel.headers : undefined;
  }, [channel?.headers]);

  if (!channel) {
    return (
      <View style={[styles.container, styles.errorContainer]}>
        <StatusBar hidden />
        <Ionicons name="alert-circle" size={40} color={Colors.dark.error} />
        <ThemedText type="h4" style={styles.errorTitle}>
          Channel Not Found
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
    <View style={[styles.container, { width, height }]}>
      <StatusBar hidden translucent backgroundColor="transparent" />
      <AdvancedVideoPlayer
        source={channel.url}
        title={channel.name}
        subtitle={channel.group}
        poster={channel.logo}
        channelId={channel.id}
        autoPlay={settings.autoPlay}
        backgroundPlay={settings.backgroundPlay}
        drm={drmConfig}
        headers={streamHeaders}
        qualities={DEFAULT_QUALITIES}
        recentChannels={recentChannelObjects}
        onError={handleError}
        onBack={handleBack}
        onNext={() => handleChannelNav("next")}
        onPrevious={() => handleChannelNav("prev")}
        onChannelSelect={handleChannelSelect}
        isFavorite={isFavorite}
        onFavoritePress={handleFavorite}
        isLive={channel.isLive !== false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#000000",
    overflow: "hidden",
  },
  errorContainer: {
    justifyContent: "center",
    alignItems: "center",
  },
  errorTitle: {
    marginTop: Spacing.md,
    color: "#FFFFFF",
  },
  errorButton: {
    marginTop: Spacing.xl,
    padding: Spacing.md,
    backgroundColor: Colors.dark.primary + "30",
    borderRadius: BorderRadius.sm,
  },
});
