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
import androidx.media3.common.DrmInitData
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaItem.DrmConfiguration
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackGroup
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.drm.DefaultDrmSessionManager
import androidx.media3.exoplayer.drm.ExoMediaDrm
import androidx.media3.exoplayer.drm.FrameworkMediaDrm
import androidx.media3.exoplayer.drm.HttpMediaDrmCallback
import androidx.media3.exoplayer.drm.MediaDrmCallback
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaPeriod
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.SampleStream
import androidx.media3.exoplayer.source.TrackGroupArray
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.exoplayer.trackselection.ExoTrackSelection
import androidx.media3.exoplayer.upstream.Allocator
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import okhttp3.OkHttpClient
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.TimeUnit

private val sharedOkHttpClient: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .build()

private const val DEFAULT_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

private fun isRawClearKey(value: String): Boolean {
    val parts = value.split(":")
    if (parts.size != 2) return false

    fun isHex(s: String): Boolean =
        s.length == 32 && s.all { it in "0123456789abcdefABCDEF" }

    fun isBase64Url(s: String): Boolean {
        val stripped = s.trimEnd('=')
        if (stripped.length != 22 && stripped.length != 24) return false
        return stripped.all { it in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" }
    }

    return parts.all { isHex(it) } || parts.all { isBase64Url(it) }
}

private fun isClearKeyJson(value: String): Boolean {
    val trimmed = value.trimStart()
    if (!trimmed.startsWith("{")) return false
    if (!trimmed.contains("\"keys\"")) return false
    return trimmed.contains("\"kty\"") &&
        trimmed.contains("\"kid\"") &&
        trimmed.contains("\"k\"")
}

private fun hexToByteArray(hex: String): ByteArray {
    val cleanHex = hex.lowercase()
    require(cleanHex.length % 2 == 0) { "Hex string must have even length" }
    return ByteArray(cleanHex.length / 2) { i ->
        cleanHex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
    }
}

private fun normalizeToBase64Url(value: String): String? {
    val stripped = value.trimEnd('=')
    val isHex = value.length == 32 && value.all { it in "0123456789abcdefABCDEF" }
    return if (isHex) {
        val bytes = hexToByteArray(value)
        Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    } else if (stripped.length == 22 || stripped.length == 24) {
        if (stripped.all { it in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" }) {
            stripped
        } else null
    } else {
        null
    }
}

private fun buildClearKeyPssh(keyId: String): ByteArray {
    val stripped = keyId.trimEnd('=')
    val keyIdBytes = if (stripped.length == 22 || stripped.length == 24) {
        Base64.decode(keyId, Base64.URL_SAFE or Base64.NO_WRAP)
    } else {
        hexToByteArray(keyId)
    }

    require(keyIdBytes.size == 16) {
        "ClearKey KID must be exactly 16 bytes (128 bits), got ${keyIdBytes.size} bytes"
    }

    val clearKeyUuid = byteArrayOf(
        0x10, 0x77, 0xef.toByte(), 0xec.toByte(),
        0xc0.toByte(), 0xb2.toByte(), 0x4d, 0x02,
        0xac.toByte(), 0xe3.toByte(), 0x3c, 0x1e,
        0x52, 0xe2.toByte(), 0xfb.toByte(), 0x4b,
    )
    val kidCount = 1
    val dataSize = 0
    val boxSize = 4 + 4 + 4 + 16 + 4 + keyIdBytes.size + 4
    val buf = ByteBuffer.allocate(boxSize).order(java.nio.ByteOrder.BIG_ENDIAN)
    buf.putInt(boxSize)
    buf.put("pssh".toByteArray(Charsets.US_ASCII))
    buf.put(1)
    buf.put(byteArrayOf(0, 0, 0))
    buf.put(clearKeyUuid)
    buf.putInt(kidCount)
    buf.put(keyIdBytes)
    buf.putInt(dataSize)
    return buf.array()
}

private class LocalClearKeyCallback(
    keyIdHex: String,
    keyHex: String,
) : MediaDrmCallback {

    private val keyIdB64: String
    private val keyB64: String

    init {
        keyIdB64 = normalizeToBase64Url(keyIdHex)
            ?: throw IllegalArgumentException("Invalid ClearKey keyId encoding: $keyIdHex")
        keyB64 = normalizeToBase64Url(keyHex)
            ?: throw IllegalArgumentException("Invalid ClearKey key encoding: $keyHex")
    }

    override fun executeProvisionRequest(
        uuid: UUID,
        request: ExoMediaDrm.ProvisionRequest,
    ): MediaDrmCallback.Response {
        throw UnsupportedOperationException("ClearKey provisioning not supported")
    }

    override fun executeKeyRequest(
        uuid: UUID,
        request: ExoMediaDrm.KeyRequest,
    ): MediaDrmCallback.Response {
        Log.d(TAG, "LocalClearKeyCallback: returning embedded key for ClearKey")
        return MediaDrmCallback.Response(
            """{"keys":[{"kty":"oct","kid":"$keyIdB64","k":"$keyB64"}]}"""
                .toByteArray(Charsets.UTF_8),
        )
    }

    companion object {
        private const val TAG = "ExoPlayerController"
    }
}

private class LocalClearKeyJsonCallback(
    private val jsonResponse: String,
) : MediaDrmCallback {

    override fun executeProvisionRequest(
        uuid: UUID,
        request: ExoMediaDrm.ProvisionRequest,
    ): MediaDrmCallback.Response {
        throw UnsupportedOperationException("ClearKey provisioning not supported")
    }

    override fun executeKeyRequest(
        uuid: UUID,
        request: ExoMediaDrm.KeyRequest,
    ): MediaDrmCallback.Response {
        Log.d(TAG, "LocalClearKeyJsonCallback: returning embedded JSON for ClearKey")
        return MediaDrmCallback.Response(jsonResponse.toByteArray(Charsets.UTF_8))
    }

    companion object {
        private const val TAG = "ExoPlayerController"
    }
}

@UnstableApi
private class PsshInjectingMediaSourceFactory(
    private val delegate: MediaSource.Factory,
    private val psshData: ByteArray,
) : MediaSource.Factory {

    private val drmInitData = DrmInitData(
        listOf(DrmInitData.SchemeData(C.CLEARKEY_UUID, "cenc", psshData)),
    )

    override fun createMediaSource(mediaItem: MediaItem): MediaSource {
        val source = delegate.createMediaSource(mediaItem)
        return PsshInjectingMediaSource(source, drmInitData)
    }

    override fun setDrmSessionManagerProvider(
        drmSessionManagerProvider: androidx.media3.exoplayer.drm.DrmSessionManagerProvider,
    ): MediaSource.Factory {
        return PsshInjectingMediaSourceFactory(
            delegate.setDrmSessionManagerProvider(drmSessionManagerProvider),
            psshData,
        )
    }

    override fun setLoadErrorHandlingPolicy(
        loadErrorHandlingPolicy: LoadErrorHandlingPolicy,
    ): MediaSource.Factory {
        return PsshInjectingMediaSourceFactory(
            delegate.setLoadErrorHandlingPolicy(loadErrorHandlingPolicy),
            psshData,
        )
    }

    override fun getSupportedTypes(): IntArray = delegate.supportedTypes
}

@UnstableApi
private class PsshInjectingMediaSource(
    private val delegate: MediaSource,
    private val drmInitData: DrmInitData,
) : MediaSource by delegate {

    override fun createPeriod(
        id: MediaSource.MediaPeriodId,
        allocator: Allocator,
        startPositionUs: Long,
    ): MediaPeriod {
        val period = delegate.createPeriod(id, allocator, startPositionUs)
        return PsshInjectingMediaPeriod(period, drmInitData)
    }

    override fun releasePeriod(mediaPeriod: MediaPeriod) {
        if (mediaPeriod is PsshInjectingMediaPeriod) {
            delegate.releasePeriod(mediaPeriod.delegate)
        } else {
            delegate.releasePeriod(mediaPeriod)
        }
    }
}

@UnstableApi
private class PsshInjectingMediaPeriod(
    val delegate: MediaPeriod,
    private val drmInitData: DrmInitData,
) : MediaPeriod by delegate {

    private var injectedTrackGroups: TrackGroupArray? = null
    private val injectedToOriginal = HashMap<TrackGroup, TrackGroup>()

    override fun getTrackGroups(): TrackGroupArray {
        injectedTrackGroups?.let { return it }

        val original = delegate.trackGroups
        val injectedGroups = Array(original.length) { groupIndex ->
            val group = original[groupIndex]
            val injectedTracks = Array(group.length) { trackIndex ->
                group.getFormat(trackIndex).buildUpon()
                    .setDrmInitData(drmInitData)
                    .build()
            }
            TrackGroup(*injectedTracks).also { injectedToOriginal[it] = group }
        }
        val result = TrackGroupArray(*injectedGroups)
        injectedTrackGroups = result
        return result
    }

    override fun selectTracks(
        selections: Array<out ExoTrackSelection?>,
        mayRetainStreamFlags: BooleanArray,
        streams: Array<out SampleStream?>,
        streamResetFlags: BooleanArray,
        positionUs: Long,
    ): Long {
        val mappedSelections = Array(selections.size) { i ->
            val sel = selections[i] ?: return@Array null
            val originalGroup = injectedToOriginal[sel.trackGroup] ?: return@Array sel
            object : ExoTrackSelection by sel {
                override fun getTrackGroup(): TrackGroup = originalGroup
            }
        }
        @Suppress("UNCHECKED_CAST")
        return delegate.selectTracks(
            mappedSelections as Array<ExoTrackSelection?>,
            mayRetainStreamFlags,
            streams as Array<SampleStream?>,
            streamResetFlags,
            positionUs,
        )
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
    private var currentDrmPssh: String? = null
    private var currentAutoPlay: Boolean = true
    private var savedPosition: Long = 0L
    private var pendingHlsFallback = false

    private var currentTextureSurface: Surface? = null
    private var currentSurfaceTextureListener: TextureView.SurfaceTextureListener? = null

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
        releaseTextureSurface()
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
        val group = tracks.groups.getOrNull(groupIndex) ?: return
        if (group.type != C.TRACK_TYPE_AUDIO) {
            Log.w(TAG, "selectAudioTrack: group $groupIndex is not audio (type=${group.type})")
            return
        }
        player.trackSelectionParameters = player.trackSelectionParameters
            .buildUpon()
            .setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, trackIndex),
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
            val group = tracks.groups.getOrNull(groupIndex) ?: return
            if (group.type != C.TRACK_TYPE_TEXT) {
                Log.w(TAG, "selectSubtitleTrack: group $groupIndex is not text (type=${group.type})")
                return
            }
            params.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            params.setOverrideForType(
                androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, trackIndex),
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
        releaseTextureSurface()
        if (!silent) {
            Log.d(TAG, "Player released, saved position: $savedPosition")
        }
    }

    override fun release() {
        releasePlayer()
    }

    private fun getStreamMimeType(url: String, forceHls: Boolean = false): String? {
        if (forceHls) return "application/x-mpegURL"
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
            lower.endsWith(".mkv") || lower.endsWith(".webm") -> "video/x-matroska"
            lower.endsWith(".flv") -> "video/x-flv"
            lower.endsWith(".mpg") || lower.endsWith(".mpeg") || lower.endsWith(".mpe") -> "video/mpeg"
            lower.endsWith(".3gp") -> "video/3gpp"
            lower.endsWith(".avi") -> "video/x-msvideo"
            lower.endsWith(".wav") -> "audio/wav"
            lower.endsWith(".ogg") || lower.endsWith(".oga") -> "audio/ogg"
            lower.endsWith(".ac3") || lower.endsWith(".ec3") -> "audio/eac3"
            lower.endsWith(".f4v") -> "video/x-flv"
            lower.contains("/stream/") && lower.contains("channel") -> "video/mp2t"
            lower.contains("/play/") && lower.contains("stream") -> "video/mp2t"
            lower.contains("/live/") ||
                lower.contains("/stream/") ||
                lower.contains("/channel/") ||
                lower.contains("/hls/") ||
                lower.contains("/dash/") ||
                lower.contains("m3u8") -> "application/x-mpegURL"
            else -> null
        }
    }

    private fun buildPlayer() {
        releasePlayer(silent = true)
        released = false

        val okHttpClient = sharedOkHttpClient.newBuilder()
            .addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .addHeader("User-Agent", DEFAULT_USER_AGENT)
                currentHeaders.forEach { (k, v) -> req.addHeader(k, v) }
                chain.proceed(req.build())
            }
            .build()

        val dataSourceFactory = DefaultDataSource.Factory(
            context, OkHttpDataSource.Factory(okHttpClient),
        )

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

        val drmSessionManager: DefaultDrmSessionManager? = when {
            rawClearKeyParts != null || isClearKeyJsonBody -> {
                val callback: MediaDrmCallback = if (rawClearKeyParts != null) {
                    Log.d(TAG, "Using local ClearKey callback (raw key detected)")
                    LocalClearKeyCallback(rawClearKeyParts[0], rawClearKeyParts[1])
                } else {
                    Log.d(TAG, "Using local ClearKey JSON callback (embedded JSON detected)")
                    LocalClearKeyJsonCallback(currentDrmLicenseUrl!!)
                }
                DefaultDrmSessionManager.Builder()
                    .setUuidAndExoMediaDrmProvider(C.CLEARKEY_UUID, FrameworkMediaDrm.DEFAULT_PROVIDER)
                    .apply {
                        if (!currentDrmHeaders.isNullOrEmpty()) {
                            setKeyRequestParameters(currentDrmHeaders!!)
                        }
                    }
                    .build(callback)
            }

            currentDrmType?.lowercase()?.let { it == "widevine" || it == "playready" } == true
                && !currentDrmLicenseUrl.isNullOrBlank() -> {
                val drmCallback = HttpMediaDrmCallback(
                    currentDrmLicenseUrl!!,
                    dataSourceFactory,
                )
                val drmUuid = when (currentDrmType!!.lowercase()) {
                    "widevine" -> C.WIDEVINE_UUID
                    "playready" -> C.PLAYREADY_UUID
                    else -> C.WIDEVINE_UUID
                }
                Log.d(TAG, "Built HttpMediaDrmCallback for $currentDrmType " +
                    "(license URL: $currentDrmLicenseUrl)")
                DefaultDrmSessionManager.Builder()
                    .setUuidAndExoMediaDrmProvider(drmUuid, FrameworkMediaDrm.DEFAULT_PROVIDER)
                    .apply {
                        if (!currentDrmHeaders.isNullOrEmpty()) {
                            setKeyRequestParameters(currentDrmHeaders!!)
                        }
                    }
                    .build(drmCallback)
            }

            else -> null
        }

        var mediaSourceFactory: MediaSource.Factory = DefaultMediaSourceFactory(dataSourceFactory)

        if (drmSessionManager != null) {
            mediaSourceFactory = mediaSourceFactory
                .setDrmSessionManagerProvider { drmSessionManager }
        }

        val needsPsshInjection = rawClearKeyParts != null && drmSessionManager != null
        if (needsPsshInjection) {
            val psshData = buildClearKeyPssh(rawClearKeyParts!![0])
            Log.d(TAG, "Built ClearKey PSSH from keyId (${psshData.size} bytes)")
            mediaSourceFactory = PsshInjectingMediaSourceFactory(mediaSourceFactory, psshData)
        }

        val audioAttrs = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        val renderersFactory = DefaultRenderersFactory(context)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)

        val trackSelector = DefaultTrackSelector(context).apply {
            setParameters(
                buildUponParameters()
                    .setAllowAudioMixedMimeTypeAdaptiveness(true)
                    .setAllowAudioMixedChannelCountAdaptiveness(true)
                    .setAllowAudioMixedDecoderSupportAdaptiveness(true)
                    .setAllowVideoMixedMimeTypeAdaptiveness(true)
                    .build(),
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
            .setMimeType(getStreamMimeType(currentUrl, forceHls = pendingHlsFallback))

        val drmType = currentDrmType
        val drmHeaders = currentDrmHeaders
        val effectiveDrmType = drmType?.lowercase()?.takeIf {
            it.isNotEmpty() && it != "fairplay"
        }
        if (effectiveDrmType != null) {
            val uuid = when (effectiveDrmType) {
                "widevine" -> C.WIDEVINE_UUID
                "playready" -> C.PLAYREADY_UUID
                "clearkey" -> C.CLEARKEY_UUID
                else -> {
                    Log.w(TAG, "Unknown DRM type '$drmType' — skipping DRM configuration")
                    null
                }
            }
            if (uuid != null) {
                if (rawClearKeyParts != null || isClearKeyJsonBody) {
                    Log.d(TAG, "ClearKey local playback — PSSH injected via MediaSource wrapper")
                } else if (!currentDrmLicenseUrl.isNullOrBlank()) {
                    val drmCfg = DrmConfiguration.Builder(uuid)
                        .setLicenseUri(currentDrmLicenseUrl)
                    if (!drmHeaders.isNullOrEmpty()) drmCfg.setLicenseRequestHeaders(drmHeaders)
                    Log.d(TAG, "DRM config: $effectiveDrmType, uuid=$uuid, " +
                        "licenseUri=$currentDrmLicenseUrl, headers=${drmHeaders?.keys}")
                    mediaItemBuilder.setDrmConfiguration(drmCfg.build())
                } else {
                    Log.w(TAG, "DRM type '$drmType' set but no license URL provided " +
                        "— skipping DRM configuration")
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
        removeTextureViewListener(tv)

        if (tv.isAvailable) {
            val surface = Surface(tv.surfaceTexture)
            currentTextureSurface = surface
            player.setVideoSurface(surface)
        }

        val listener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
                if (released) return
                releaseTextureSurface()
                val surface = Surface(st)
                currentTextureSurface = surface
                player.setVideoSurface(surface)
            }

            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}

            override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                releaseTextureSurface()
                player.setVideoSurface(null)
                return true
            }

            override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
        }
        currentSurfaceTextureListener = listener
        tv.surfaceTextureListener = listener
    }

    private fun releaseTextureSurface() {
        currentTextureSurface?.let { surface ->
            try {
                surface.release()
            } catch (e: Exception) {
                Log.w(TAG, "Error releasing TextureView Surface: ${e.message}")
            }
        }
        currentTextureSurface = null
    }

    private fun removeTextureViewListener(tv: TextureView) {
        if (tv.surfaceTextureListener === currentSurfaceTextureListener) {
            tv.surfaceTextureListener = null
        }
        currentSurfaceTextureListener = null
    }

    private val aspectRatioListener = object : Player.Listener {
        override fun onVideoSizeChanged(videoSize: androidx.media3.common.VideoSize) {
            if (videoSize.width > 0 && videoSize.height > 0) {
                callbacks?.onVideoSizeChanged(
                    videoSize.width,
                    videoSize.height,
                    videoSize.pixelWidthHeightRatio.toFloat(),
                )
            }
        }
    }

    private val subtitleListener = object : Player.Listener {
        override fun onCues(cueGroup: CueGroup) {
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(state: Int) {
            when (state) {
                Player.STATE_READY -> {
                    pendingHlsFallback = false
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
            Log.e(TAG, "Playback error: ${error.errorCodeName} (${error.errorCode}) " +
                "- ${error.message}")

            if (!pendingHlsFallback &&
                error.errorCode == PlaybackException.ERROR_CODE_IO_UNSPECIFIED
            ) {
                val mimeType = getStreamMimeType(currentUrl)
                val looksLikeIptv = currentUrl.lowercase().let { url ->
                    url.contains("/live/") || url.contains("/stream/") ||
                        url.contains("/channel/") || url.contains("/hls/") ||
                        url.contains("m3u8")
                }
                if (mimeType == null && looksLikeIptv) {
                    Log.w(TAG, "Unrecognized IPTV stream format — retrying with HLS fallback")
                    pendingHlsFallback = true
                    load(
                        currentUrl,
                        currentHeaders,
                        currentDrmType,
                        currentDrmLicenseUrl,
                        currentDrmHeaders,
                        drmCertificateUrl = null,
                        currentDrmPssh,
                        currentAutoPlay,
                    )
                    return
                }
            }
            pendingHlsFallback = false

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
                2006 ->
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
                            audioTracks.add(
                                mapOf(
                                    "groupIndex" to groupIdx,
                                    "trackIndex" to trackIdx,
                                    "id" to "audio_${groupIdx}_${trackIdx}",
                                    "label" to (format.label ?: format.language
                                        ?: "Track ${audioTracks.size + 1}"),
                                    "language" to (format.language ?: ""),
                                    "isSelected" to group.isTrackSelected(trackIdx),
                                ),
                            )
                        }
                    }
                    C.TRACK_TYPE_TEXT -> {
                        for (trackIdx in 0 until group.length) {
                            val format = group.getTrackFormat(trackIdx)
                            subtitleTracks.add(
                                mapOf(
                                    "groupIndex" to groupIdx,
                                    "trackIndex" to trackIdx,
                                    "id" to "sub_${groupIdx}_${trackIdx}",
                                    "label" to (format.label ?: format.language
                                        ?: "Subtitle ${subtitleTracks.size + 1}"),
                                    "language" to (format.language ?: ""),
                                    "isSelected" to group.isTrackSelected(trackIdx),
                                ),
                            )
                        }
                    }
                    else -> {}
                }
            }

            callbacks?.onTracksChanged(audioTracks, subtitleTracks)
        }
    }
}
