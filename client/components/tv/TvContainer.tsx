import React, { useState, useCallback } from "react";
import { View, StyleSheet, Platform, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { TvTopNav, TvTabName } from "./TvTopNav";
import { TvLiveTvScreen } from "./TvLiveTvScreen";
import { TvHomeScreen } from "./TvHomeScreen";
import { TvSearchScreen } from "./TvSearchScreen";
import { EpgGuideView } from "@/components/EpgGuideView";
import SettingsScreen from "@/screens/SettingsScreen";
import { usePlaylist } from "@/context/PlaylistContext";
import { useEpg } from "@/context/EpgContext";
import { useTheme } from "@/hooks/useTheme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function TvContainer() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp>();
  const { theme } = useTheme();
  const { playlist } = usePlaylist();
  const epg = useEpg();

  const [activeTab, setActiveTab] = useState<TvTabName>("Live TV");

  const handleSelectTab = useCallback((tab: TvTabName) => {
    setActiveTab(tab);
  }, []);

  const renderActiveContent = () => {
    switch (activeTab) {
      case "Home":
        return <TvHomeScreen onNavigateTab={handleSelectTab} />;
      case "Live TV":
        return <TvLiveTvScreen categoryTypeFilter="all" />;
      case "Movies":
        return <TvLiveTvScreen categoryTypeFilter="movies" />;
      case "Series":
        return <TvLiveTvScreen categoryTypeFilter="series" />;
      case "Guide":
        return (
          <View style={styles.guideContainer}>
            <EpgGuideView
              channels={playlist?.channels || []}
              getProgramsForChannel={epg.getProgramsForChannel}
              onSelectChannel={(id) =>
                navigation.navigate("Player", { channelId: id })
              }
            />
          </View>
        );
      case "Search":
        return <TvSearchScreen />;
      case "Settings":
        return (
          <View style={styles.settingsContainer}>
            <SettingsScreen />
          </View>
        );
      default:
        return <TvLiveTvScreen categoryTypeFilter="all" />;
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar hidden={Platform.isTV} barStyle="light-content" />

      {/* Top Navigation Bar with Prysm brand title */}
      <View style={[styles.navWrapper, { paddingTop: Math.max(insets.top, 8) }]}>
        <TvTopNav
          activeTab={activeTab}
          onSelectTab={handleSelectTab}
          brandTitle="Prysm"
          theme={theme}
        />
      </View>

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
        {renderActiveContent()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#070D18", // Deep midnight dark blue matching screenshot
  },
  navWrapper: {
    backgroundColor: "transparent",
  },
  contentWrapper: {
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
