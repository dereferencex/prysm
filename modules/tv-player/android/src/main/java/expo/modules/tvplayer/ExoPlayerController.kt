package expo.modules.tvplayer

import android.content.Context
import android.graphics.SurfaceTexture
import android.net.Uri
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
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import okhttp3.OkHttpClient

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
    private var currentAutoPlay: Boolean = true
    private var savedPosition: Long = 0L

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
        autoPlay: Boolean,
    ) {
        Log.d(TAG, "Loading URL: $url with DRM: ${drmType ?: "none"}")
        currentUrl = url
        currentHeaders = headers
        currentDrmType = drmType
        currentDrmLicenseUrl = drmLicenseUrl
        currentDrmHeaders = drmHeaders
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
        savedPosition = getCurrentPosition()
        exoPlayer?.let { player ->
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
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
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
        if (!drmType.isNullOrEmpty() && !currentDrmLicenseUrl.isNullOrEmpty()) {
            val uuid = when (drmType.lowercase()) {
                "widevine"  -> C.WIDEVINE_UUID
                "playready" -> C.PLAYREADY_UUID
                "clearkey"  -> C.CLEARKEY_UUID
                else        -> null
            }
            if (uuid != null) {
                val drmCfg = DrmConfiguration.Builder(uuid).setLicenseUri(currentDrmLicenseUrl)
                if (!drmHeaders.isNullOrEmpty()) drmCfg.setLicenseRequestHeaders(drmHeaders)
                mediaItemBuilder.setDrmConfiguration(drmCfg.build())
            }
        }

        player.setMediaItem(mediaItemBuilder.build())
        if (savedPosition > 0) {
            player.seekTo(savedPosition)
        }
        player.prepare()
        if (currentAutoPlay) player.playWhenReady = true

        exoPlayer = player
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
            Log.e(TAG, "Playback error: ${error.errorCodeName} - ${error.message}")
            callbacks?.onError(error.message ?: "Unknown playback error")
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
