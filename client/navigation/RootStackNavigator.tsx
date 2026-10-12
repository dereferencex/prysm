import React from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import MainTabNavigator from "@/navigation/MainTabNavigator";
import SetupScreen from "@/screens/SetupScreen";
import PlayerScreen from "@/screens/PlayerScreen";
import NetworkStreamScreen from "@/screens/NetworkStreamScreen";
import NetworkPlayerScreen from "@/screens/NetworkPlayerScreen";
import LogsScreen from "@/screens/LogsScreen";
import { usePlaylist } from "@/context/PlaylistContext";
import { useScreenOptions } from "@/hooks/useScreenOptions";
import { NetworkStreamConfig } from "@/lib/storage";

export type RootStackParamList = {
  Setup: { fromSettings?: boolean } | undefined;
  Main: undefined;
  Player: { channelId: string };
  NetworkStream: undefined;
  NetworkPlayer: { config: NetworkStreamConfig };
  Logs: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000",
  },
});

export default function RootStackNavigator() {
  const { isLoading } = usePlaylist();
  const screenOptions = useScreenOptions();

  if (isLoading) {
    // Cold start — show a branded loader instead of a black screen while the
    // playlist/storage hydrates.
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4DD0E1" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Main"
        component={MainTabNavigator}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Setup"
        component={SetupScreen}
        options={{
          headerShown: false,
          presentation: "modal",
          animation: "slide_from_bottom",
        }}
      />
      <Stack.Screen
        name="Player"
        component={PlayerScreen}
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
          animation: "fade",
          autoHideHomeIndicator: true,
          navigationBarHidden: true,
        }}
      />
      <Stack.Screen
        name="NetworkStream"
        component={NetworkStreamScreen}
        options={{
          headerShown: false,
          animation: "slide_from_right",
        }}
      />
      <Stack.Screen
        name="NetworkPlayer"
        component={NetworkPlayerScreen}
        options={{
          headerShown: false,
          presentation: "fullScreenModal",
          animation: "fade",
          autoHideHomeIndicator: true,
          navigationBarHidden: true,
        }}
      />
      <Stack.Screen
        name="Logs"
        component={LogsScreen}
        options={{
          headerTitle: "Logs",
        }}
      />
    </Stack.Navigator>
  );
}
