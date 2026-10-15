import React, { useCallback, useEffect } from "react";
import { StyleSheet, View, ActivityIndicator, Platform } from "react-native";
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  LinkingOptions,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as ScreenOrientation from "expo-screen-orientation";
import * as Device from "expo-device";
import {
  useFonts,
  Rubik_400Regular,
  Rubik_500Medium,
  Rubik_600SemiBold,
  Rubik_700Bold,
} from "@expo-google-fonts/rubik";

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";

import RootStackNavigator from "@/navigation/RootStackNavigator";
import { PlaylistProvider } from "@/context/PlaylistContext";
import { EpgProvider } from "@/context/EpgContext";
import { ThemeProvider, useThemeContext } from "@/context/ThemeContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LogCapture } from "@/components/LogCapture";
import { Colors } from "@/constants/theme";
import {
  isManualOrientationLockActive,
  setManualOrientationLock,
} from "@/lib/orientation";
import { RootStackParamList } from "@/navigation/RootStackNavigator";

// Deep link config — handles prysmplayer://play?channelId=<id> from the
// Android TV launcher home row tiles.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["prysmplayer://"],
  config: {
    screens: {
      Main: {
        // prysmplayer://favourites → open channels tab
        path: "favourites",
      },
      Player: {
        // prysmplayer://play?channelId=<id> → open player
        path: "play",
        parse: {
          channelId: (id: string) => id,
        },
      },
    },
  },
};

SplashScreen.preventAutoHideAsync();

function AppContent() {
  const { isDark, theme } = useThemeContext();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  // Orientation policy: TV stays landscape, player screens rotate freely so
  // video can be watched in landscape, every other screen is portrait-locked —
  // so backing out of the player returns the app to portrait.
  const configureOrientation = useCallback(async () => {
    try {
      const isTV = Platform.isTV || Device.deviceType === Device.DeviceType.TV;

      if (isTV) {
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.LANDSCAPE,
        );
        return;
      }

      const state = navigationRef.getRootState();
      const routeName = state?.routes[state.index]?.name;
      const isPlayerRoute =
        routeName === "Player" || routeName === "NetworkPlayer";

      if (isPlayerRoute) {
        // A manual lock from the in-player rotate button wins — switching
        // channels must not silently drop it.
        if (!isManualOrientationLockActive()) {
          await ScreenOrientation.unlockAsync();
        }
      } else {
        setManualOrientationLock(false);
        await ScreenOrientation.lockAsync(
          ScreenOrientation.OrientationLock.PORTRAIT_UP,
        );
      }
    } catch (error) {
      console.log("Orientation lock not supported:", error);
    }
  }, [navigationRef]);

  const navigationTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: theme.backgroundRoot,
          card: theme.backgroundDefault,
          primary: theme.primary,
          text: theme.text,
          border: theme.backgroundSecondary,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: theme.backgroundRoot,
          card: theme.backgroundDefault,
          primary: theme.primary,
          text: theme.text,
          border: theme.backgroundSecondary,
        },
      };

  return (
    <GestureHandlerRootView
      style={[styles.root, { backgroundColor: theme.backgroundRoot }]}
    >
      <KeyboardProvider>
        <PlaylistProvider>
          <EpgProvider>
            <NavigationContainer
              ref={navigationRef}
              theme={navigationTheme}
              linking={linking}
              onReady={configureOrientation}
              onStateChange={configureOrientation}
            >
              <RootStackNavigator />
            </NavigationContainer>
          </EpgProvider>
        </PlaylistProvider>
        <StatusBar style={isDark ? "light" : "dark"} />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Rubik_400Regular,
    Rubik_500Medium,
    Rubik_600SemiBold,
    Rubik_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.dark.primary} />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <ThemeProvider>
            <LogCapture />
            <AppContent />
          </ThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.dark.backgroundRoot,
    justifyContent: "center",
    alignItems: "center",
  },
});
