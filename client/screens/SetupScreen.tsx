import React, { useState, useRef } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  ActivityIndicator,
  Pressable,
  ScrollView,
  Modal,
  Platform,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, RouteProp } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Haptics from "expo-haptics";

import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { Button } from "@/components/Button";
import { useTheme } from "@/hooks/useTheme";
import { usePlaylist } from "@/context/PlaylistContext";
import { useOrientation } from "@/hooks/useOrientation";
import { Spacing, BorderRadius } from "@/constants/theme";
import { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  buildXtreamApiUrl,
  buildXtreamPlaylistUrl,
  checkXtreamAccount,
} from "@/lib/xtream";
import { fetchText } from "@/lib/m3u-parser";

type SourceMode = "url" | "xtream";

type SetupRouteProp = RouteProp<RootStackParamList, "Setup">;
type SetupNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Setup"
>;

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<SetupNavigationProp>();
  const route = useRoute<SetupRouteProp>();
  const fromSettings = route.params?.fromSettings ?? false;
  const { theme, isDark } = useTheme();
  const { isPortrait, isLandscape, width, height } = useOrientation();
  const {
    loadPlaylistFromUrl,
    loadPlaylistFromFile,
    isLoadingPlaylist,
    cancelLoading,
  } = usePlaylist();

  const [playlistName, setPlaylistName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingType, setLoadingType] = useState<"url" | "file" | null>(null);
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState("");
  const abortRef = useRef(false);
  const [isCloseFocused, setIsCloseFocused] = useState(false);
  const [isFileFocused, setIsFileFocused] = useState(false);
  const [isCancelFocused, setIsCancelFocused] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [urlFocused, setUrlFocused] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("url");
  const [xtreamServer, setXtreamServer] = useState("");
  const [xtreamUsername, setXtreamUsername] = useState("");
  const [xtreamPassword, setXtreamPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const isXtream = sourceMode === "xtream";
  const canSubmit = isXtream
    ? !!xtreamServer.trim() && !!xtreamUsername.trim() && !!xtreamPassword
    : !!url.trim();

  const isCompact = height < 500;
  const isTVDevice = Platform.isTV;

  const handleCancelLoading = () => {
    abortRef.current = true;
    cancelLoading();
    setShowLoadingModal(false);
    setLoadingType(null);
    setLoadingProgress("");
  };

  const handleLoadFromUrl = async () => {
    let playlistUrl = url.trim();
    let apiUrl = "";
    if (isXtream) {
      try {
        const creds = {
          server: xtreamServer,
          username: xtreamUsername,
          password: xtreamPassword,
        };
        playlistUrl = buildXtreamPlaylistUrl(creds);
        apiUrl = buildXtreamApiUrl(creds);
      } catch (err: any) {
        setError(err.message);
        return;
      }
    } else if (!playlistUrl) {
      setError("Please enter a valid URL");
      return;
    }

    if (!playlistName.trim()) {
      setError("Please enter a playlist name");
      return;
    }

    try {
      setError(null);
      setLoadingType("url");
      setShowLoadingModal(true);
      abortRef.current = false;
      if (!isTVDevice) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      if (isXtream) {
        setLoadingProgress("Signing in to Xtream server...");
        const account = await fetchText(apiUrl);
        if (!account.ok) {
          throw new Error(
            `Couldn't reach the Xtream server (${account.error || "no response"})`,
          );
        }
        const accountError = checkXtreamAccount(account.text);
        if (accountError) throw new Error(accountError);
        setLoadingProgress("Downloading channel list...");
      } else {
        setLoadingProgress("Fetching playlist...");
      }

      await loadPlaylistFromUrl(playlistUrl, playlistName.trim());
      if (!isTVDevice)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowLoadingModal(false);
      if (fromSettings) {
        navigation.goBack();
      } else {
        navigation.reset({ index: 0, routes: [{ name: "Main" }] });
      }
    } catch (err: any) {
      setError(err.message || "Failed to load playlist");
      if (!isTVDevice)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setShowLoadingModal(false);
    } finally {
      setLoadingType(null);
    }
  };

  const handleLoadFromFile = async () => {
    try {
      setError(null);
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/x-mpegurl",
          "audio/x-mpegurl",
          "audio/mpegurl",
          "application/vnd.apple.mpegurl",
          "audio/x-scpls",
          "application/pls+xml",
          "application/xspf+xml",
          "application/json",
          "*/*",
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      if (!playlistName.trim()) {
        setPlaylistName(
          file.name.replace(/\.(m3u8?|pls|xspf|json)$/i, "") || "",
        );
      }

      setLoadingType("file");
      setShowLoadingModal(true);
      setLoadingProgress("Parsing playlist file...");
      abortRef.current = false;
      if (!isTVDevice) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const content = await new FileSystem.File(file.uri).text();

      const nameToUse =
        playlistName.trim() ||
        file.name.replace(/\.(m3u8?|pls|xspf|json)$/i, "") ||
        "My Playlist";
      await loadPlaylistFromFile(content, nameToUse);
      if (!isTVDevice)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowLoadingModal(false);
      if (fromSettings) {
        navigation.goBack();
      } else {
        navigation.reset({
          index: 0,
          routes: [{ name: "Main" }],
        });
      }
    } catch (err: any) {
      setError(err.message || "Failed to load file");
      if (!isTVDevice)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setShowLoadingModal(false);
    } finally {
      setLoadingType(null);
    }
  };

  const handleClose = () => {
    if (!isTVDevice) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.goBack();
  };

  return (
    <ThemedView style={styles.container}>
      {fromSettings ? (
        <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable
            onPress={handleClose}
            onFocus={() => setIsCloseFocused(true)}
            onBlur={() => setIsCloseFocused(false)}
            style={
              [
                styles.closeButton,
                isTVDevice && styles.closeButtonTv,
                isCloseFocused && [
                  styles.closeButtonFocused,
                  { backgroundColor: theme.primary + "20" },
                ],
              ] as ViewStyle[]
            }
            hitSlop={16}
            focusable={true}
            accessibilityLabel="Close"
            accessibilityRole="button"
          >
            <Ionicons
              name="close"
              size={isTVDevice ? 32 : 28}
              color={theme.text}
            />
          </Pressable>
          <ThemedText type="h4" style={styles.headerTitle}>
            Add Playlist
          </ThemedText>
          <View style={styles.closeButton} />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: fromSettings ? Spacing.md : insets.top + Spacing.lg,
            paddingBottom: insets.bottom + Spacing.lg,
            paddingLeft: insets.left + Spacing.lg,
            paddingRight: insets.right + Spacing.lg,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.content,
            isLandscape ? styles.contentWide : styles.contentNarrow,
          ]}
        >
          {!fromSettings ? (
            <View
              style={[styles.branding, isCompact && styles.brandingCompact]}
            >
              <View
                style={[
                  styles.iconContainer,
                  isCompact && styles.iconContainerCompact,
                  { backgroundColor: theme.primary + "20" },
                ]}
              >
                <Ionicons
                  name="prism"
                  size={isCompact ? 36 : 44}
                  color={theme.primary}
                />
              </View>
              <ThemedText type={isCompact ? "h2" : "h1"} style={styles.title}>
                Prysm
              </ThemedText>
              {!isCompact ? (
                <ThemedText
                  type="body"
                  style={[styles.subtitle, { color: theme.textSecondary }]}
                >
                  Add your playlist to start watching
                </ThemedText>
              ) : null}
            </View>
          ) : null}

          <View
            style={[
              styles.form,
              isLandscape ? styles.formWide : styles.formNarrow,
            ]}
          >
            <View
              style={[
                styles.inputSection,
                { maxWidth: isTVDevice ? 420 : isLandscape ? 320 : 400 },
              ]}
            >
              <ThemedText
                type={isTVDevice ? "h3" : "h4"}
                style={[
                  styles.sectionTitle,
                  isCompact && styles.sectionTitleCompact,
                ]}
              >
                Playlist Name
              </ThemedText>
              <View
                style={[
                  styles.inputContainer,
                  {
                    backgroundColor: theme.backgroundDefault,
                    borderColor: nameFocused
                      ? theme.primary
                      : theme.backgroundSecondary,
                  },
                  isCompact && styles.inputContainerCompact,
                  isTVDevice && styles.inputContainerTv,
                ]}
              >
                <Ionicons
                  name="bookmark"
                  size={isTVDevice ? 22 : 18}
                  color={nameFocused ? theme.primary : theme.textSecondary}
                  style={styles.inputIcon}
                />
                <TextInput
                  value={playlistName}
                  onChangeText={setPlaylistName}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  placeholder="My Playlist"
                  placeholderTextColor={theme.textSecondary}
                  style={[
                    styles.input,
                    { color: theme.text },
                    isTVDevice && styles.inputTv,
                  ]}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="next"
                  editable={!isLoadingPlaylist}
                  showSoftInputOnFocus={true}
                  testID="name-input"
                />
              </View>

              <View
                style={[
                  styles.modeToggle,
                  { backgroundColor: theme.backgroundDefault },
                  isTVDevice && styles.sectionTitleTv,
                ]}
                accessibilityRole="tablist"
              >
                {(
                  [
                    ["url", "Playlist URL", "link"],
                    ["xtream", "Xtream Codes", "key"],
                  ] as const
                ).map(([mode, label, icon]) => {
                  const selected = sourceMode === mode;
                  const focused = focusedField === `mode-${mode}`;
                  return (
                    <Pressable
                      key={mode}
                      onPress={() => {
                        setSourceMode(mode);
                        setError(null);
                      }}
                      onFocus={() => setFocusedField(`mode-${mode}`)}
                      onBlur={() => setFocusedField(null)}
                      disabled={isLoadingPlaylist}
                      focusable={!isLoadingPlaylist}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                      accessibilityLabel={label}
                      style={[
                        styles.modeOption,
                        isTVDevice && styles.modeOptionTv,
                        selected && { backgroundColor: theme.primary },
                        focused &&
                          !selected && {
                            backgroundColor: theme.primary + "20",
                          },
                      ]}
                      testID={`mode-${mode}`}
                    >
                      <Ionicons
                        name={icon}
                        size={isTVDevice ? 20 : 16}
                        color={selected ? theme.buttonText : theme.text}
                      />
                      <ThemedText
                        type="small"
                        style={[
                          styles.modeOptionText,
                          { color: selected ? theme.buttonText : theme.text },
                          isTVDevice && styles.fileButtonTextTv,
                        ]}
                      >
                        {label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              {isXtream ? (
                <>
                  {(
                    [
                      {
                        key: "server",
                        title: "Server URL",
                        icon: "server",
                        value: xtreamServer,
                        onChange: setXtreamServer,
                        placeholder: "http://example.com:8080",
                        keyboardType: "url",
                      },
                      {
                        key: "username",
                        title: "Username",
                        icon: "person",
                        value: xtreamUsername,
                        onChange: setXtreamUsername,
                        placeholder: "Username",
                        keyboardType: "default",
                      },
                      {
                        key: "password",
                        title: "Password",
                        icon: "lock-closed",
                        value: xtreamPassword,
                        onChange: setXtreamPassword,
                        placeholder: "Password",
                        keyboardType: "default",
                      },
                    ] as const
                  ).map((field) => {
                    const focused = focusedField === field.key;
                    const isPassword = field.key === "password";
                    return (
                      <React.Fragment key={field.key}>
                        <ThemedText
                          type={isTVDevice ? "h3" : "h4"}
                          style={[
                            styles.sectionTitle,
                            isCompact && styles.sectionTitleCompact,
                          ]}
                        >
                          {field.title}
                        </ThemedText>
                        <View
                          style={[
                            styles.inputContainer,
                            {
                              backgroundColor: theme.backgroundDefault,
                              borderColor: focused
                                ? theme.primary
                                : theme.backgroundSecondary,
                            },
                            isCompact && styles.inputContainerCompact,
                            isTVDevice && styles.inputContainerTv,
                          ]}
                        >
                          <Ionicons
                            name={field.icon}
                            size={isTVDevice ? 22 : 18}
                            color={
                              focused ? theme.primary : theme.textSecondary
                            }
                            style={styles.inputIcon}
                          />
                          <TextInput
                            value={field.value}
                            onChangeText={field.onChange}
                            onFocus={() => setFocusedField(field.key)}
                            onBlur={() => setFocusedField(null)}
                            placeholder={field.placeholder}
                            placeholderTextColor={theme.textSecondary}
                            style={[
                              styles.input,
                              { color: theme.text },
                              isTVDevice && styles.inputTv,
                            ]}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType={field.keyboardType}
                            secureTextEntry={isPassword && !showPassword}
                            textContentType={
                              isPassword
                                ? "password"
                                : field.key === "username"
                                  ? "username"
                                  : "URL"
                            }
                            returnKeyType={isPassword ? "done" : "next"}
                            onSubmitEditing={
                              isPassword ? handleLoadFromUrl : undefined
                            }
                            editable={!isLoadingPlaylist}
                            showSoftInputOnFocus={true}
                            testID={`xtream-${field.key}-input`}
                          />
                          {isPassword ? (
                            <Pressable
                              onPress={() => setShowPassword((v) => !v)}
                              hitSlop={12}
                              accessibilityRole="button"
                              accessibilityLabel={
                                showPassword ? "Hide password" : "Show password"
                              }
                            >
                              <Ionicons
                                name={showPassword ? "eye-off" : "eye"}
                                size={isTVDevice ? 22 : 18}
                                color={theme.textSecondary}
                              />
                            </Pressable>
                          ) : null}
                        </View>
                      </React.Fragment>
                    );
                  })}
                </>
              ) : (
                <>
                  <ThemedText
                    type={isTVDevice ? "h3" : "h4"}
                    style={[
                      styles.sectionTitle,
                      isCompact && styles.sectionTitleCompact,
                    ]}
                  >
                    Enter Playlist URL
                  </ThemedText>
                  <View
                    style={[
                      styles.inputContainer,
                      {
                        backgroundColor: theme.backgroundDefault,
                        borderColor: urlFocused
                          ? theme.primary
                          : theme.backgroundSecondary,
                      },
                      isCompact && styles.inputContainerCompact,
                      isTVDevice && styles.inputContainerTv,
                    ]}
                  >
                    <Ionicons
                      name="link"
                      size={isTVDevice ? 22 : 18}
                      color={urlFocused ? theme.primary : theme.textSecondary}
                      style={styles.inputIcon}
                    />
                    <TextInput
                      value={url}
                      onChangeText={setUrl}
                      onFocus={() => setUrlFocused(true)}
                      onBlur={() => setUrlFocused(false)}
                      placeholder="https://example.com/playlist"
                      placeholderTextColor={theme.textSecondary}
                      style={[
                        styles.input,
                        { color: theme.text },
                        isTVDevice && styles.inputTv,
                      ]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      returnKeyType="done"
                      onSubmitEditing={handleLoadFromUrl}
                      editable={!isLoadingPlaylist}
                      showSoftInputOnFocus={true}
                      testID="url-input"
                    />
                  </View>
                </>
              )}

              <Button
                onPress={handleLoadFromUrl}
                disabled={
                  isLoadingPlaylist || !canSubmit || !playlistName.trim()
                }
                style={
                  [
                    styles.button,
                    isCompact && styles.buttonCompact,
                    isTVDevice && styles.buttonTv,
                  ] as ViewStyle[]
                }
              >
                {loadingType === "url" ? (
                  <ActivityIndicator size="small" color={theme.buttonText} />
                ) : isXtream ? (
                  "Sign In"
                ) : (
                  "Load Playlist"
                )}
              </Button>

              <View
                style={[
                  styles.dividerContainer,
                  isLandscape ? styles.dividerWide : styles.dividerNarrow,
                ]}
              >
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                />
                <ThemedText
                  type="small"
                  style={[
                    styles.dividerText,
                    { color: theme.textSecondary },
                    isTVDevice && styles.dividerTextTv,
                  ]}
                >
                  OR
                </ThemedText>
                <View
                  style={[
                    styles.divider,
                    { backgroundColor: theme.backgroundSecondary },
                  ]}
                />
              </View>

              <Pressable
                onPress={handleLoadFromFile}
                onFocus={() => setIsFileFocused(true)}
                onBlur={() => setIsFileFocused(false)}
                disabled={isLoadingPlaylist}
                focusable={!isLoadingPlaylist}
                hasTVPreferredFocus={isTVDevice && !isLoadingPlaylist}
                accessibilityLabel="Choose file"
                accessibilityRole="button"
                style={
                  [
                    styles.fileButton,
                    {
                      backgroundColor: theme.backgroundDefault,
                      borderColor: theme.primary + "40",
                    },
                    isCompact && styles.fileButtonCompact,
                    isTVDevice && styles.fileButtonTv,
                    isFileFocused && [
                      styles.fileButtonFocused,
                      { backgroundColor: theme.primary + "15" },
                    ],
                  ] as ViewStyle[]
                }
                testID="file-picker-btn"
              >
                {loadingType === "file" ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <>
                    <Ionicons
                      name="cloud-upload"
                      size={isTVDevice ? 28 : 22}
                      color={theme.primary}
                    />
                    <ThemedText
                      type={isTVDevice ? "body" : "small"}
                      style={[
                        styles.fileButtonText,
                        isTVDevice && styles.fileButtonTextTv,
                      ]}
                    >
                      Choose File
                    </ThemedText>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>

        {error ? (
          <View
            style={[
              styles.errorContainer,
              { backgroundColor: theme.error + "20" },
            ]}
          >
            <Ionicons name="alert-circle" size={14} color={theme.error} />
            <ThemedText
              type="small"
              style={[
                styles.errorText,
                { color: theme.error },
                isTVDevice && styles.errorTextTv,
              ]}
            >
              {error}
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={showLoadingModal} transparent animationType="fade">
        <View style={styles.loadingModal}>
          <View
            style={[
              styles.loadingContent,
              { backgroundColor: theme.backgroundDefault },
              isTVDevice && styles.loadingContentTv,
            ]}
          >
            <ActivityIndicator size="large" color={theme.primary} />
            <ThemedText type="body" style={styles.loadingText}>
              {loadingProgress}
            </ThemedText>
            <ThemedText
              type="small"
              style={[
                { color: theme.textSecondary },
                isTVDevice && styles.errorTextTv,
              ]}
            >
              This may take a moment for large playlists
            </ThemedText>
            <Pressable
              onPress={handleCancelLoading}
              onFocus={() => setIsCancelFocused(true)}
              onBlur={() => setIsCancelFocused(false)}
              focusable={true}
              accessibilityLabel="Cancel loading"
              accessibilityRole="button"
              style={
                [
                  styles.cancelButton,
                  { borderColor: theme.textSecondary + "40" },
                  isTVDevice && styles.cancelButtonTv,
                  isCancelFocused && [
                    styles.cancelButtonFocused,
                    { backgroundColor: theme.primary + "20" },
                  ],
                ] as ViewStyle[]
              }
            >
              <ThemedText type="body" style={{ color: theme.textSecondary }}>
                Cancel
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
  },
  contentWide: {
    flexDirection: "row",
    gap: Spacing["4xl"],
  },
  contentNarrow: {
    flexDirection: "column",
    gap: Spacing["2xl"],
  },
  branding: {
    alignItems: "center",
  },
  brandingCompact: {
    marginBottom: 0,
  },
  iconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  iconContainerCompact: {
    width: 68,
    height: 68,
    borderRadius: 34,
    marginBottom: Spacing.md,
  },
  title: {
    marginBottom: Spacing.xs,
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    maxWidth: 260,
  },
  form: {
    alignItems: "center",
  },
  formWide: {
    flexDirection: "column",
    gap: Spacing.lg,
  },
  formNarrow: {
    flexDirection: "column",
    gap: Spacing.lg,
    width: "100%",
    maxWidth: 400,
    paddingHorizontal: Spacing.lg,
  },
  inputSection: {
    width: "100%",
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
  },
  sectionTitleCompact: {
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.md,
    height: 44,
    marginBottom: Spacing.md,
    borderWidth: 1,
  },
  inputContainerCompact: {
    height: 40,
  },
  inputIcon: {
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  button: {
    height: 44,
  },
  modeToggle: {
    flexDirection: "row",
    borderRadius: BorderRadius.sm,
    padding: 4,
    gap: 4,
    marginBottom: Spacing.md,
  },
  modeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    height: 36,
    borderRadius: BorderRadius.xs,
  },
  modeOptionTv: {
    height: 48,
  },
  modeOptionText: {
    fontWeight: "600",
  },
  buttonCompact: {
    height: 40,
  },
  dividerContainer: {
    alignItems: "center",
    marginVertical: Spacing.md,
  },
  dividerWide: {
    gap: Spacing.sm,
  },
  dividerNarrow: {
    flexDirection: "row",
    gap: Spacing.md,
    width: "100%",
  },
  divider: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 11,
  },
  fileButton: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.sm,
    padding: Spacing.lg,
    borderWidth: 2,
    borderStyle: "dashed",
    gap: Spacing.sm,
    minWidth: 120,
  },
  fileButtonFocused: {
    borderStyle: "solid",
    transform: [{ scale: 1.02 }],
  },
  fileButtonCompact: {
    padding: Spacing.md,
    flexDirection: "row",
    gap: Spacing.sm,
  },
  fileButtonText: {
    fontWeight: "600",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.sm,
    borderRadius: BorderRadius.xs,
    marginTop: Spacing.xl,
  },
  errorText: {
    marginLeft: Spacing.sm,
    flex: 0,
    fontSize: 12,
  },
  loadingModal: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing["2xl"],
  },
  loadingContent: {
    padding: Spacing["2xl"],
    borderRadius: BorderRadius.lg,
    alignItems: "center",
    gap: Spacing.md,
    minWidth: 200,
  },
  loadingText: {
    marginTop: Spacing.sm,
  },
  cancelButton: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  cancelButtonFocused: {},
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerTitle: {
    textAlign: "center",
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 2,
    borderColor: "transparent",
  },
  closeButtonFocused: {},
  // TV sizing — larger D-pad targets and text for leanback screens.
  closeButtonTv: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.sm,
  },
  sectionTitleTv: {
    marginTop: Spacing.md,
  },
  inputContainerTv: {
    height: 56,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
  },
  inputTv: {
    fontSize: 16,
  },
  buttonTv: {
    height: 52,
    width: "100%",
    borderRadius: BorderRadius.md,
  },
  dividerTextTv: {
    fontSize: 13,
  },
  fileButtonTv: {
    minHeight: 80,
    minWidth: 220,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing["2xl"],
    borderRadius: BorderRadius.md,
    width: "100%",
  },
  fileButtonTextTv: {
    fontSize: 16,
  },
  errorTextTv: {
    fontSize: 14,
  },
  loadingContentTv: {
    minWidth: 380,
    padding: Spacing["3xl"],
    borderRadius: BorderRadius.lg,
  },
  cancelButtonTv: {
    paddingHorizontal: Spacing["2xl"],
    paddingVertical: Spacing.md,
  },
});
