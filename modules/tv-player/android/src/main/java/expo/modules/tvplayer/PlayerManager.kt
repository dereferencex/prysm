package expo.modules.tvplayer

import android.content.Context
import android.util.Log
import android.view.SurfaceView
import android.view.TextureView

class PlayerManager(
    private val context: Context,
) {

    companion object {
        private const val TAG = "PlayerManager"
        private const val MAX_CONSECUTIVE_ERRORS = 3
    }

    private var currentEngine: PlayerEngine = PlayerEngine.EXOPLAYER
    private var exoController: ExoPlayerController? = null
    private var vlcController: VlcPlayerController? = null
    private var activeController: PlayerController? = null
    private var callbacks: PlayerController.Callbacks? = null
    private var consecutiveErrorCount = 0
    private var isSwitching = false
    private var lastLoadParams: LoadParams? = null
    private var pendingSurfaceView: SurfaceView? = null
    private var pendingTextureView: TextureView? = null

    data class LoadParams(
        val url: String,
        val headers: Map<String, String>,
        val drmType: String?,
        val drmLicenseUrl: String?,
        val drmHeaders: Map<String, String>?,
        val drmCertificateUrl: String?,
        val drmPssh: String?,
        val autoPlay: Boolean,
    )

    fun setCallbacks(callbacks: PlayerController.Callbacks) {
        this.callbacks = callbacks
        exoController?.setCallbacks(ForwardingCallbacks(callbacks))
        vlcController?.setCallbacks(ForwardingCallbacks(callbacks))
    }

    fun getCurrentEngine(): PlayerEngine = currentEngine

    fun switchEngine(newEngine: PlayerEngine) {
        if (isSwitching) {
            Log.w(TAG, "Engine switch already in progress, ignoring request")
            return
        }
        if (newEngine == currentEngine) {
            Log.d(TAG, "Already using $newEngine, no switch needed")
            return
        }

        Log.d(TAG, "Switching engine from $currentEngine to $newEngine")
        isSwitching = true

        val savedPosition = activeController?.getCurrentPosition() ?: 0L
        val wasPlaying = activeController?.isPlaying() ?: false

        activeController?.release()
        activeController = null

        currentEngine = newEngine
        consecutiveErrorCount = 0

        activeController = getOrCreateController(newEngine)
        activeController?.setCallbacks(ForwardingCallbacks(callbacks))
        applyPendingSurface(activeController!!)

        lastLoadParams?.let { params ->
            activeController?.load(
                params.url,
                params.headers,
                params.drmType,
                params.drmLicenseUrl,
                params.drmHeaders,
                params.drmCertificateUrl,
                params.drmPssh,
                false,
            )
            if (savedPosition > 0) {
                activeController?.seekTo(savedPosition)
            }
            if (wasPlaying) {
                activeController?.play()
            }
        }

        isSwitching = false
        Log.d(TAG, "Engine switch complete to $newEngine")
    }

    fun load(
        url: String,
        headers: Map<String, String>,
        drmType: String?,
        drmLicenseUrl: String?,
        drmHeaders: Map<String, String>?,
        drmCertificateUrl: String? = null,
        drmPssh: String? = null,
        autoPlay: Boolean,
    ) {
        consecutiveErrorCount = 0
        lastLoadParams = LoadParams(url, headers, drmType, drmLicenseUrl, drmHeaders, drmCertificateUrl, drmPssh, autoPlay)

        if (activeController == null) {
            activeController = getOrCreateController(currentEngine)
            activeController?.setCallbacks(ForwardingCallbacks(callbacks))
            applyPendingSurface(activeController!!)
        }

        activeController?.load(url, headers, drmType, drmLicenseUrl, drmHeaders, drmCertificateUrl, drmPssh, autoPlay)
    }

    fun setVideoSurfaceView(surfaceView: SurfaceView) {
        pendingSurfaceView = surfaceView
        pendingTextureView = null
        activeController?.setVideoSurfaceView(surfaceView)
    }

    fun setTextureView(textureView: TextureView) {
        pendingTextureView = textureView
        pendingSurfaceView = null
        activeController?.setTextureView(textureView)
    }

    fun clearVideoSurface() {
        pendingSurfaceView = null
        pendingTextureView = null
        activeController?.clearVideoSurface()
    }

    private fun applyPendingSurface(controller: PlayerController) {
        pendingSurfaceView?.let { controller.setVideoSurfaceView(it) }
        pendingTextureView?.let { controller.setTextureView(it) }
    }

    fun play() { activeController?.play() }
    fun pause() { activeController?.pause() }
    fun seekTo(positionMs: Long) { activeController?.seekTo(positionMs) }
    fun setVolume(volume: Float) { activeController?.setVolume(volume) }

    fun setResizeMode(mode: Int) {
        // Only VLC needs to know about resize mode changes
        // ExoPlayer handles it automatically through AspectRatioFrameLayout
        if (activeController is VlcPlayerController) {
            (activeController as VlcPlayerController).setResizeMode(mode)
        }
    }

    fun selectAudioTrack(groupIndex: Int, trackIndex: Int) {
        activeController?.selectAudioTrack(groupIndex, trackIndex)
    }

    fun selectSubtitleTrack(groupIndex: Int, trackIndex: Int) {
        activeController?.selectSubtitleTrack(groupIndex, trackIndex)
    }

    fun getCurrentPosition(): Long = activeController?.getCurrentPosition() ?: 0L
    fun getDuration(): Long = activeController?.getDuration() ?: 0L
    fun isPlaying(): Boolean = activeController?.isPlaying() ?: false

    fun reportError(isDrmError: Boolean = false) {
        consecutiveErrorCount++
        Log.w(TAG, "Consecutive error count: $consecutiveErrorCount (isDrmError=$isDrmError)")

        val hasDrm = !lastLoadParams?.drmType.isNullOrEmpty()

        // If VLC is the active engine and DRM is configured, VLC will never succeed.
        // Auto-switch to ExoPlayer immediately on the first error rather than letting
        // the user see repeated "DRM not supported by VLC" messages.
        if (currentEngine == PlayerEngine.VLC && hasDrm) {
            Log.e(TAG, "VLC cannot play DRM content — auto-switching to ExoPlayer")
            consecutiveErrorCount = 0
            switchEngine(PlayerEngine.EXOPLAYER)
            return
        }

        if (consecutiveErrorCount >= MAX_CONSECUTIVE_ERRORS && currentEngine == PlayerEngine.EXOPLAYER) {
            if (hasDrm || isDrmError) {
                Log.w(TAG, "Max errors reached but DRM is configured — not switching to VLC (unsupported)")
                return
            }
            Log.e(TAG, "Max consecutive errors reached, auto-switching to VLC")
            switchEngine(PlayerEngine.VLC)
        }
    }

    fun reportSuccess() {
        if (consecutiveErrorCount > 0) {
            Log.d(TAG, "Playback success, resetting error count")
        }
        consecutiveErrorCount = 0
    }

    fun release() {
        val savedExo = exoController
        val savedVlc = vlcController
        exoController = null
        vlcController = null
        activeController = null
        lastLoadParams = null
        savedExo?.release()
        savedVlc?.release()
        Log.d(TAG, "PlayerManager released all resources")
    }

    private fun getOrCreateController(engine: PlayerEngine): PlayerController {
        return when (engine) {
            PlayerEngine.EXOPLAYER -> {
                if (exoController == null) {
                    exoController = ExoPlayerController(context)
                }
                exoController!!
            }
            PlayerEngine.VLC -> {
                if (vlcController == null) {
                    vlcController = VlcPlayerController(context)
                }
                vlcController!!
            }
        }
    }

    private inner class ForwardingCallbacks(
        private val outer: PlayerController.Callbacks?,
    ) : PlayerController.Callbacks {
        override fun onReady() {
            reportSuccess()
            outer?.onReady()
        }

        override fun onError(message: String) {
            // DRM errors are prefixed with "DRM_ERROR:" by ExoPlayerController and
            // VlcPlayerController. Pass this flag to reportError() so it doesn't
            // offer the VLC fallback for errors that VLC also cannot handle.
            val isDrmError = message.startsWith("DRM_ERROR:")
            reportError(isDrmError)
            outer?.onError(message)
        }

        override fun onPlayingChanged(isPlaying: Boolean) {
            outer?.onPlayingChanged(isPlaying)
        }

        override fun onBufferingChanged(isBuffering: Boolean) {
            outer?.onBufferingChanged(isBuffering)
        }

        override fun onPositionChanged(positionMs: Long, durationMs: Long) {
            outer?.onPositionChanged(positionMs, durationMs)
        }

        override fun onTracksChanged(audioTracks: List<Map<String, Any>>, subtitleTracks: List<Map<String, Any>>) {
            outer?.onTracksChanged(audioTracks, subtitleTracks)
        }

        override fun onVideoSizeChanged(width: Int, height: Int, pixelWidthHeightRatio: Float) {
            outer?.onVideoSizeChanged(width, height, pixelWidthHeightRatio)
        }
    }
}
