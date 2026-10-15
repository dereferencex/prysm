# Changelog

All notable changes to Prysm are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning: [SemVer](https://semver.org/).

---

## [1.5.0] — 2026-10-15

### Added
- **Android TV 3-column interface** — home, channels, favorites, search and Live TV
  layouts with a live *Now Showing* panel and a persistent top navigation bar.
- **TV remote UX overhaul** — flat square focus indicators with a traveling solid
  fill, correct D-pad focus routing between control rows, and focus restoration
  when panels open and close.
- **Home tab on launch** — TV now opens on the Home screen instead of the last tab.
- **EPG / XMLTV program guide** — auto-detected from M3U (`tvg-id`, `x-tvg-url`),
  with a full guide view (grid on TV, list on mobile), *Now / Next* badges on
  channel cards, and *Now / Next* inside the player. On by default.
- **Material You dynamic color** — wallpaper-synthesized palettes on Android 12+
  via a new native module, plus a **manual seed color** picker and a true
  **Pitch Black** AMOLED theme.
- **System media controls** — play/pause, skip and metadata exposed through the
  Android media session for all playback.
- **In-app log viewer** — live native logcat, native crash traces, and copy /
  share / export, backed by `logcat-reader` and `crash-handler` modules.
- **Manual rotate control in the player** — toggle the screen between landscape
  and portrait without relying on system auto-rotate.
- **KODIPROP / EXTHTTP parsing** — `#KODIPROP stream_headers` and `#EXTHTTP`
  header blocks are now honoured when building stream requests.
- **x86 and x86_64 release APKs** — CI now publishes per-ABI builds for
  `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`, plus a universal APK.

### Changed
- **Orientation policy** — non-player screens are portrait-locked, player screens
  rotate freely, and backing out of a landscape video restores portrait.
- **Seed color menu** on TV is now a compact 4-column swatch grid instead of a
  long vertical list.
- **Playlist import** on TV got larger inputs with visible D-pad focus rings, a
  preferred focus on *Choose File*, and scaled-up buttons and dialogs.
- TV typography now binds Rubik weight-specific families; palette is theme-aware
  with pitch-black dynamic accents.
- Expo packages bumped to the SDK 54 expected patch versions.

---

## [1.4.2] — 2026-07-02

- F-Droid build gating (`PRYSM_FDROID`) and `app.config.js` resolution fix.
- HLS AES-128 DRM fix.
- Added `android.versionCode` (F-Droid requires a real integer).
- Settings now reads the app version dynamically via `expo-application`.

---

## [1.4.1] / [1.4.0]

- Playlist management: multiple saved playlists, edit, delete, auto-refresh.
- Network stream player with custom headers, User-Agent presets and DRM config.
- In-app APK updater.

---

## [1.3.x] and earlier

- Initial public releases: M3U loading from URL/file, categories, search,
  favorites, adaptive streaming (HLS/DASH/MSS), quality selection, and the
  Android TV remote experience.

[1.5.0]: https://github.com/dereferencex/prysm/compare/v1.4.2...v1.5.0
[1.4.2]: https://github.com/dereferencex/prysm/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/dereferencex/prysm/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/dereferencex/prysm/compare/v1.3.1...v1.4.0
