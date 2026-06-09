package expo.modules.tvplayer

import android.content.Context
import android.graphics.SurfaceTexture
import android.net.Uri
import android.util.Base64
import android.util.Log
import android.view.Surface
import android.view.SurfaceView
import android.view.TextureView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaItem.DrmConfiguration
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager
import androidx.media3.exoplayer.drm.ExoMediaDrm
import androidx.media3.exoplayer.drm.MediaDrmCallback
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import okhttp3.OkHttpClient

/**
 * Detects whether [value] is a raw ClearKey in `keyId:key` format as opposed
 * to a license-server URL.  Accepts both hex-encoded and base64url-encoded
 * pairs.  A 128-bit AES key is exactly 16 bytes which encodes to:
 *   - 32 hex characters
 *   - 22 base64url characters (without padding) or 24 with padding
 *
 * The two character-set checks are performed separately so hex values (which
 * are a strict subset of base64url alphanumerics) are not ambiguously matched
 * by the base64url branch.
 */
private fun isRawClearKey(value: String): Boolean {
    val parts = value.split(":")
    if (parts.size != 2) return false

    fun isHex(s: String): Boolean =
        s.length == 32 && s.all { it in "0123456789abcdefABCDEF" }

    fun isBase64Url(s: String): Boolean {
        val stripped = s.trimEnd('=')
        return (stripped.length == 22 || stripped.length == 32) &&
            stripped.all { it in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" }
    }

    return parts.all { isHex(it) } || parts.all { isBase64Url(it) }
}

private fun hexToByteArray(hex: String): ByteArray {
    val cleanHex = hex.lowercase()
    return ByteArray(cleanHex.length / 2) { i ->
        cleanHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
}

/**
 * Detects whether [value] is a ClearKey JSON response body, e.g.
 * ```json
 * {"keys":[{"kty":"oct","kid":"…","k":"…"}],"type":"temporary"}
 * ```
 */
private fun isClearKeyJson(value: String): Boolean {
    val trimmed = value.trimStart()
    return trimmed.startsWith("{") && trimmed.contains("\"keys\"")
}

/**
 * A [MediaDrmCallback] that responds to ClearKey key requests with a locally
 * stored key — no network license-server round-trip required.
 *
 * The ClearKey protocol expects a JSON response like:
 * ```json
 * {"keys":[{"kty":"oct","kid":"<base64url>","k":"<base64url>"}]}
 * ```
 */
private class LocalClearKeyCallback(
    keyIdHex: String,
    keyHex: String,
) : MediaDrmCallback {

    private val keyIdB64: String
    private val keyB64: String

    init {
        keyIdB64 = toBase64Url(keyIdHex)
        keyB64 = toBase64Url(keyHex)
    }

    private fun toBase64Url(value: String): String {
        // Detect encoding using exact length checks for a 16-byte AES-128 key:
        //   hex       = 32 chars, all [0-9a-fA-F]
        //   base64url = 22 chars (no padding) or 24 chars (with padding)
        val stripped = value.trimEnd('=')
        val isHex = value.length == 32 && value.all { it in "0123456789abcdefABCDEF" }
        return if (isHex) {
            val bytes = hexToByteArray(value)
            Base64.encodeToString(
                bytes,
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
            )
        } else if ((stripped.length == 22 || stripped.length == 32) &&
            stripped.all { it in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" }) {
            // Already valid base64url — pass through as-is (strip any padding that
            // the ExoPlayer ClearKey engine doesn't expect)
            stripped
        } else {
            // Unrecognised format — attempt hex decode as a last resort. If this
            // throws, the exception propagates and buildPlayer() logs the error
            // before returning, preventing a silent garbage-key scenario.
            val bytes = hexToByteArray(value)
            Base64.encodeToString(
                bytes,
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
            )
        }
    }

    override fun executeProvisionRequest(
        uuid: java.util.UUID,
        request: ExoMediaDrm.ProvisionRequest,
    ): ByteArray {
        throw UnsupportedOperationException("ClearKey provisioning not supported")
    }

    override fun executeKeyRequest(
        uuid: java.util.UUID,
        request: ExoMediaDrm.KeyRequest,
    ): ByteArray {
        Log.d(TAG, "LocalClearKeyCallback: returning embedded key for ClearKey")
        return """{"keys":[{"kty":"oct","kid":"$keyIdB64","k":"$keyB64"}]}"""
            .toByteArray(Charsets.UTF_8)
    }

    companion object {
        private const val TAG = "ExoPlayerController"
    }
}

/**
 * A [MediaDrmCallback] that returns a pre-built ClearKey JSON response body
 * verbatim — used when the playlist embeds the JSON directly in `#KODIPROP`
 * `license_key` instead of a license-server URL.
 */
private class LocalClearKeyJsonCallback(
    private val jsonResponse: String,
) : MediaDrmCallback {

    override fun executeProvisionRequest(
        uuid: java.util.UUID,
        request: ExoMediaDrm.ProvisionRequest,
    ): ByteArray {
        throw UnsupportedOperationException("ClearKey provisioning not supported")
    }

    override fun executeKeyRequest(
        uuid: java.util.UUID,
        request: ExoMediaDrm.KeyRequest,
    ): ByteArray {
        Log.d(TAG, "LocalClearKeyJsonCallback: returning embedded JSON for ClearKey")
        return jsonResponse.toByteArray(Charsets.UTF_8)
    }

    companion object {
        private const val TAG = "ExoPlayerController"
    }
}

@UnstableApi
class ExoPlayerController(
    private val context: Context,
) : PlayerController {

    private var exoPlayer: ExoPlayer? = null
    private var callbacks: PlayerController.Callbacks? = null
    private var surfaceView: SurfaceView? = null
    private var textureView: TextureView? = null
    private var currentUrl: String = ""
    private var currentHeaders: Map<String, String> = emptyMap()
    private var currentDrmType: String? = null
    private var currentDrmLicenseUrl: String? = null
    private var currentDrmHeaders: Map<String, String>? = null
    private var currentDrmCertificateUrl: String? = null
    private var currentDrmPssh: String? = null
    private var currentAutoPlay: Boolean = true
    private var savedPosition: Long = 0L
    @Volatile
    private var released = false

    companion object {
        private const val TAG = "ExoPlayerController"
    }

    override fun setCallbacks(callbacks: PlayerController.Callbacks) {
        this.callbacks = callbacks
    }

    override fun load(
        url: String,
        headers: Map<String, String>,
        drmType: String?,
        drmLicenseUrl: String?,
        drmHeaders: Map<String, String>?,
        drmCertificateUrl: String?,
        drmPssh: String?,
        autoPlay: Boolean,
    ) {
        Log.d(TAG, "Loading URL: $url with DRM: ${drmType ?: "none"}")
        currentUrl = url
        currentHeaders = headers
        currentDrmType = drmType
        currentDrmLicenseUrl = drmLicenseUrl
        currentDrmHeaders = drmHeaders
        currentDrmCertificateUrl = drmCertificateUrl
        currentDrmPssh = drmPssh
        currentAutoPlay = autoPlay
        buildPlayer()
    }

    override fun setVideoSurfaceView(surfaceView: SurfaceView) {
        this.surfaceView = surfaceView
        exoPlayer?.setVideoSurfaceView(surfaceView)
    }

    override fun setTextureView(textureView: TextureView) {
        this.textureView = textureView
        exoPlayer?.let { attachTextureView(it, textureView) }
    }

    override fun clearVideoSurface() {
        exoPlayer?.let {
            it.setVideoSurface(null)
            it.setVideoSurfaceView(null)
        }
    }

    override fun play() {
        exoPlayer?.play()
        Log.d(TAG, "play() called")
    }

    override fun pause() {
        exoPlayer?.pause()
        Log.d(TAG, "pause() called")
    }

    override fun seekTo(positionMs: Long) {
        exoPlayer?.seekTo(positionMs)
    }

    override fun setVolume(volume: Float) {
        exoPlayer?.volume = volume
    }

    override fun selectAudioTrack(groupIndex: Int, trackIndex: Int) {
        val player = exoPlayer ?: return
        val tracks = player.currentTracks
        val groups = tracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
        val group = groups.getOrNull(groupIndex) ?: return
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, trackIndex)
            )
            .build()
        Log.d(TAG, "Selected audio track: group=$groupIndex, track=$trackIndex")
    }

    override fun selectSubtitleTrack(groupIndex: Int, trackIndex: Int) {
        val player = exoPlayer ?: return
        val params = player.trackSelectionParameters.buildUpon()
        if (groupIndex < 0) {
            params.setIgnoredTextSelectionFlags(C.SELECTION_FLAG_DEFAULT)
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
            Log.d(TAG, "Subtitles disabled")
        } else {
            val tracks = player.currentTracks
            val groups = tracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
            val group = groups.getOrNull(groupIndex) ?: return
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            params.setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, trackIndex)
            )
            Log.d(TAG, "Selected subtitle track: group=$groupIndex, track=$trackIndex")
        }
        player.trackSelectionParameters = params.build()
    }

    override fun getCurrentPosition(): Long = exoPlayer?.currentPosition ?: 0L
    override fun getDuration(): Long = exoPlayer?.duration?.takeIf { it != C.TIME_UNSET } ?: 0L
    override fun isPlaying(): Boolean = exoPlayer?.isPlaying ?: false

    fun releasePlayer(silent: Boolean = false) {
        if (released) return
        released = true
        savedPosition = getCurrentPosition()
        exoPlayer?.let { player ->
            PlayerRegistry.unregisterPlayer()
            player.removeListener(aspectRatioListener)
            player.removeListener(playerListener)
            player.removeListener(subtitleListener)
            player.setVideoSurface(null)
            player.setVideoSurfaceView(null)
            player.stop()
            player.release()
        }
        exoPlayer = null
        if (!silent) {
            Log.d(TAG, "Player released, saved position: $savedPosition")
        }
    }

    override fun release() {
        releasePlayer()
    }

    private fun getStreamMimeType(url: String): String? {
        val lower = url.lowercase().split("?")[0]
        return when {
            lower.endsWith(".m3u8") || lower.endsWith(".m3u") -> "application/x-mpegURL"
            lower.endsWith(".ts") -> "video/mp2t"
            lower.endsWith(".mpd") -> "application/dash+xml"
            lower.endsWith(".ism/") || lower.endsWith(".ismc") ||
                lower.contains(".ism/manifest") -> "application/vnd.ms-sstr+xml"
            lower.endsWith(".mp4") || lower.endsWith(".m4s") -> "video/mp4"
            lower.endsWith(".aac") -> "audio/aac"
            lower.endsWith(".mp3") -> "audio/mpeg"
            lower.contains("/service?method=channel.stream") ||
                lower.contains("/live/") ||
                lower.contains("/stream/") -> "video/mp2t"
            else -> null
        }
    }

    private fun buildPlayer() {
        releasePlayer(silent = true)
        released = false

        val okHttpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .addHeader("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                currentHeaders.forEach { (k, v) -> req.addHeader(k, v) }
                chain.proceed(req.build())
            }
            .build()

        val dataSourceFactory = DefaultDataSource.Factory(
            context, OkHttpDataSource.Factory(okHttpClient),
        )

        // Detect raw ClearKey (hex keyId:key) vs JSON response vs license-server URL
        val rawClearKeyParts = if (currentDrmType?.lowercase() == "clearkey"
            && !currentDrmLicenseUrl.isNullOrEmpty()
            && isRawClearKey(currentDrmLicenseUrl!!)
        ) {
            currentDrmLicenseUrl!!.split(":")
        } else {
            null
        }
        val isClearKeyJsonBody = currentDrmType?.lowercase() == "clearkey"
            && !currentDrmLicenseUrl.isNullOrEmpty()
            && rawClearKeyParts == null
            && isClearKeyJson(currentDrmLicenseUrl!!)

        // For raw ClearKey or embedded JSON, provide a local DRM callback so
        // ExoPlayer doesn't try to POST to a non-URL string.
        val mediaSourceFactory = if (rawClearKeyParts != null || isClearKeyJsonBody) {
            val callback: MediaDrmCallback = if (rawClearKeyParts != null) {
                Log.d(TAG, "Using local ClearKey callback (raw key detected)")
                LocalClearKeyCallback(rawClearKeyParts[0], rawClearKeyParts[1])
            } else {
                Log.d(TAG, "Using local ClearKey JSON callback (embedded JSON detected)")
                LocalClearKeyJsonCallback(currentDrmLicenseUrl!!)
            }
            // Build a single shared DRM session manager for this playback session.
            // Previously a new DefaultDrmSessionManager was constructed inside the
            // provider lambda which is called per-track, causing a resource leak.
            val drmSessionManagerForClearKey = DefaultDrmSessionManager.Builder()
                .apply {
                    // Apply any custom license-request headers to the ClearKey session
                    if (!currentDrmHeaders.isNullOrEmpty()) {
                        setKeyRequestParameters(currentDrmHeaders!!)
                    }
                }
                .build(callback)
            DefaultMediaSourceFactory(dataSourceFactory)
                .setDrmSessionManagerProvider { mediaItem ->
                    val uuid = mediaItem.localConfiguration?.drmConfiguration?.uuid
                    // Always return the pre-built manager — never create a new one
                    // inside the lambda to avoid MediaDrm instance leaks.
                    if (uuid == C.CLEARKEY_UUID) drmSessionManagerForClearKey
                    else drmSessionManagerForClearKey
                }
        } else {
            DefaultMediaSourceFactory(dataSourceFactory)
        }

        val audioAttrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val renderersFactory = DefaultRenderersFactory(context)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)

        val trackSelector = DefaultTrackSelector(context).apply {
            setParameters(
                buildUponParameters()
                    .setAllowAudioMixedMimeTypeAdaptiveness(true)
                    .setAllowAudioMixedChannelCountAdaptiveness(true)
                    .setAllowAudioMixedDecoderSupportAdaptiveness(true)
                    .setAllowVideoMixedMimeTypeAdaptiveness(true)
                    .build()
            )
        }

        val player = ExoPlayer.Builder(context)
            .setRenderersFactory(renderersFactory)
            .setTrackSelector(trackSelector)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttrs, false)
            .setHandleAudioBecomingNoisy(true)
            .build()

        surfaceView?.let { player.setVideoSurfaceView(it) }
        textureView?.let { attachTextureView(player, it) }

        player.addListener(aspectRatioListener)
        player.addListener(playerListener)
        player.addListener(subtitleListener)

        val mediaItemBuilder = MediaItem.Builder()
            .setUri(Uri.parse(currentUrl))
            .setMimeType(getStreamMimeType(currentUrl))

        val drmType = currentDrmType
        val drmHeaders = currentDrmHeaders
        // Guard against both null/empty drmType and empty-string drmLicenseUrl.
        // "fairplay" is iOS-only — silently ignore it on Android rather than
        // passing an unknown UUID to ExoPlayer.
        val effectiveDrmType = drmType?.lowercase()?.takeIf {
            it.isNotEmpty() && it != "fairplay"
        }
        if (effectiveDrmType != null) {
            val uuid = when (effectiveDrmType) {
                "widevine"  -> C.WIDEVINE_UUID
                "playready" -> C.PLAYREADY_UUID
                "clearkey"  -> C.CLEARKEY_UUID
                else        -> {
                    Log.w(TAG, "Unknown DRM type '$drmType' — skipping DRM configuration")
                    null
                }
            }
            if (uuid != null) {
                if (rawClearKeyParts != null || isClearKeyJsonBody) {
                    // Local key — no network license request, no multi-session needed.
                    mediaItemBuilder.setDrmConfiguration(
                        DrmConfiguration.Builder(uuid).build()
                    )
                } else if (!currentDrmLicenseUrl.isNullOrBlank()) {
                    // Remote license server URL.
                    // setMultiSession(true) is only needed for live streams with key
                    // rotation. For standard single-session VOD/live streams it wastes
                    // resources and can confuse some license servers. Disabled by default.
                    val drmCfg = DrmConfiguration.Builder(uuid)
                        .setLicenseUri(currentDrmLicenseUrl)
                    if (!drmHeaders.isNullOrEmpty()) drmCfg.setLicenseRequestHeaders(drmHeaders)
                    // Apply PSSH initialization data if provided. This is the raw base64
                    // blob from the manifest — NOT used as a URL.
                    if (!currentDrmPssh.isNullOrBlank()) {
                        try {
                            val psshBytes = android.util.Base64.decode(
                                currentDrmPssh, android.util.Base64.DEFAULT
                            )
                            drmCfg.setInitData(
                                when (uuid) {
                                    C.WIDEVINE_UUID  -> "video/mp4"
                                    C.PLAYREADY_UUID -> "video/mp4"
                                    else             -> "video/mp4"
                                },
                                psshBytes,
                            )
                            Log.d(TAG, "Applied PSSH init data (${psshBytes.size} bytes) for $effectiveDrmType")
                        } catch (e: Exception) {
                            Log.w(TAG, "Failed to decode PSSH init data: ${e.message}")
                        }
                    }
                    mediaItemBuilder.setDrmConfiguration(drmCfg.build())
                } else {
                    Log.w(TAG, "DRM type '$drmType' set but no license URL provided — skipping DRM configuration")
                }
            }
        }

        player.setMediaItem(mediaItemBuilder.build())
        if (savedPosition > 0) {
            player.seekTo(savedPosition)
        }
        player.prepare()
        if (currentAutoPlay) player.playWhenReady = true

        exoPlayer = player
        PlayerRegistry.registerPlayer(player)
        Log.d(TAG, "ExoPlayer built and prepared")
    }

    private fun attachTextureView(player: ExoPlayer, tv: TextureView) {
        if (tv.isAvailable) player.setVideoSurface(Surface(tv.surfaceTexture))
        tv.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
                player.setVideoSurface(Surface(st))
            }
            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
            override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                player.setVideoSurface(null)
                return false
            }
            override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
        }
    }

    private val aspectRatioListener = object : Player.Listener {
        override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) {
            if (videoSize.width > 0 && videoSize.height > 0) {
                callbacks?.onVideoSizeChanged(
                    videoSize.width,
                    videoSize.height,
                    videoSize.pixelWidthHeightRatio.toFloat()
                )
            }
        }
    }

    private val subtitleListener = object : Player.Listener {
        override fun onCues(cueGroup: CueGroup) {
            // Cues are handled by TvPlayerView's SubtitleView
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_READY -> {
                    callbacks?.onReady()
                    callbacks?.onBufferingChanged(false)
                }
                Player.STATE_BUFFERING -> {
                    callbacks?.onBufferingChanged(true)
                }
                Player.STATE_ENDED,
                Player.STATE_IDLE -> {}
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            callbacks?.onPlayingChanged(isPlaying)
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.e(TAG, "Playback error: ${error.errorCodeName} (${error.errorCode}) - ${error.message}")

            // Map structured ExoPlayer DRM error codes to user-readable messages so
            // the JS layer (and the fallback dialog) can distinguish DRM failures
            // from generic network errors. This prevents the VLC fallback from being
            // offered for DRM errors where VLC would also fail.
            val message = when (error.errorCode) {
                PlaybackException.ERROR_CODE_DRM_SCHEME_UNSUPPORTED ->
                    "DRM_ERROR: DRM scheme not supported on this device (${error.errorCodeName})"
                PlaybackException.ERROR_CODE_DRM_PROVISIONING_FAILED ->
                    "DRM_ERROR: Device provisioning failed — try clearing app data (${error.errorCodeName})"
                PlaybackException.ERROR_CODE_DRM_CONTENT_ERROR ->
                    "DRM_ERROR: Stream is encrypted but no valid DRM session could be established (${error.errorCodeName})"
                PlaybackException.ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED ->
                    "DRM_ERROR: License acquisition failed — check license server URL and network (${error.errorCodeName})"
                PlaybackException.ERROR_CODE_DRM_DISALLOWED_OPERATION ->
                    "DRM_ERROR: Operation not permitted by the DRM license (${error.errorCodeName})"
                PlaybackException.ERROR_CODE_DRM_SYSTEM_ERROR ->
                    "DRM_ERROR: DRM system error — device may not support the required security level (${error.errorCodeName})"
                PlaybackException.ERROR_CODE_DRM_SESSION_NOT_OPENED ->
                    "DRM_ERROR: DRM session could not be opened (${error.errorCodeName})"
                PlaybackException.ERROR_CODE_DRM_DEVICE_REVOKED ->
                    "DRM_ERROR: Device has been revoked by the DRM system (${error.errorCodeName})"
                else -> error.message ?: "Unknown playback error (${error.errorCodeName})"
            }
            callbacks?.onError(message)
        }

        override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
            val audioTracks = mutableListOf<Map<String, Any>>()
            val subtitleTracks = mutableListOf<Map<String, Any>>()

            tracks.groups.forEachIndexed { groupIdx, group ->
                when (group.type) {
                    C.TRACK_TYPE_AUDIO -> {
                        for (trackIdx in 0 until group.length) {
                            val format = group.getTrackFormat(trackIdx)
                            audioTracks.add(mapOf(
                                "groupIndex" to groupIdx,
                                "trackIndex" to trackIdx,
                                "id" to "audio_${groupIdx}_${trackIdx}",
                                "label" to (format.label ?: format.language ?: "Track ${audioTracks.size + 1}"),
                                "language" to (format.language ?: ""),
                                "isSelected" to group.isTrackSelected(trackIdx),
                            ))
                        }
                    }
                    C.TRACK_TYPE_TEXT -> {
                        for (trackIdx in 0 until group.length) {
                            val format = group.getTrackFormat(trackIdx)
                            subtitleTracks.add(mapOf(
                                "groupIndex" to groupIdx,
                                "trackIndex" to trackIdx,
                                "id" to "sub_${groupIdx}_${trackIdx}",
                                "label" to (format.label ?: format.language ?: "Subtitle ${subtitleTracks.size + 1}"),
                                "language" to (format.language ?: ""),
                                "isSelected" to group.isTrackSelected(trackIdx),
                            ))
                        }
                    }
                    else -> {}
                }
            }

            callbacks?.onTracksChanged(audioTracks, subtitleTracks)
        }
    }
}
