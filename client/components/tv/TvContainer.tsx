import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  StyleSheet,
  Platform,
  StatusBar,
  TVFocusGuideView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { TvTopNav, TvTabName } from "./TvTopNav";
import { TvLiveTvScreen } from "./TvLiveTvScreen";
import { TvHomeScreen } from "./TvHomeScreen";
import { TvSearchScreen } from "./TvSearchScreen";
import { TvFavoritesScreen } from "./TvFavoritesScreen";
import { EpgGuideView } from "@/components/EpgGuideView";
import SettingsScreen from "@/screens/SettingsScreen";
import { usePlaylist } from "@/context/PlaylistContext";
import { useEpg } from "@/context/EpgContext";
import { useTheme } from "@/hooks/useTheme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function TvContainer() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState<TvTabName>("Home");

  const handleSelectTab = useCallback((tab: TvTabName) => {
    setActiveTab(tab);
  }, []);

  const renderActiveContent = () => {
    switch (activeTab) {
      case "Home":
        return <TvHomeScreen onNavigateTab={handleSelectTab} />;
      case "Live TV":
        return <TvLiveTvScreen categoryTypeFilter="all" />;
      case "Favorites":
        return <TvFavoritesScreen />;
      case "Movies":
        return <TvLiveTvScreen categoryTypeFilter="movies" />;
      case "Series":
        return <TvLiveTvScreen categoryTypeFilter="series" />;
      case "Guide":
        return <TvGuideScreen />;
      case "Search":
        return <TvSearchScreen />;
      case "Settings":
        return (
          <View style={styles.settingsContainer}>
            <SettingsScreen embedded />
          </View>
        );
      default:
        return <TvLiveTvScreen categoryTypeFilter="all" />;
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: theme.backgroundRoot }]}>
      <StatusBar hidden={Platform.isTV} barStyle="light-content" />

      {/* Top navigation — its own focus row. Left/right moves between tabs;
          down crosses into the content area. */}
      <TvTopNav
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        brandTitle="Prysm"
        theme={theme}
      />

      {/* Active Tab Screen Content */}
      <View
        style={[
          styles.contentWrapper,
          {
            paddingBottom: Math.max(insets.bottom, 8),
            paddingLeft: Math.max(insets.left, 0),
            paddingRight: Math.max(insets.right, 0),
          },
        ]}
      >
        {/* TVFocusGuide restores focus to the last focused element when a
            player/child screen closes and focus returns to this tab. Keyed by
            tab so autoFocus re-runs on every tab switch — without this, D-pad
            focus can be lost after switching to a freshly mounted screen
            (hasTVPreferredFocus races inside the guide). */}
        <TVFocusGuideView
          key={activeTab}
          autoFocus={Platform.isTV}
          style={styles.focusGuide}
        >
          {renderActiveContent()}
        </TVFocusGuideView>
      </View>
    </View>
  );
}

function TvGuideScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { playlist } = usePlaylist();
  const { getProgramsForChannel } = useEpg();
  const channels = useMemo(() => playlist?.channels || [], [playlist]);
  const handleSelectChannel = useCallback(
    (id: string) => navigation.navigate("Player", { channelId: id }),
    [navigation],
  );

  return (
    <View style={styles.guideContainer}>
      <EpgGuideView
        channels={channels}
        getProgramsForChannel={getProgramsForChannel}
        onSelectChannel={handleSelectChannel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  contentWrapper: {
    flex: 1,
  },
  focusGuide: {
    flex: 1,
  },
  guideContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  settingsContainer: {
    flex: 1,
  },
});
