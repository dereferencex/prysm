package expo.modules.tvplayer

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.SurfaceTexture
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.Rational
import android.view.Gravity
import android.view.Surface
import android.view.SurfaceView
import android.view.TextureView
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import android.app.PictureInPictureParams
import androidx.media3.common.util.UnstableApi
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.SubtitleView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

@UnstableApi
@SuppressLint("ViewConstructor")
class TvPlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext), PlayerController.Callbacks {

    companion object {
        private const val TAG = "TvPlayerView"

        /**
         * Delay before the post-entry layout pass. The system PiP enter
         * transition runs ~300 ms; laying out earlier uses the animating
         * window frame and leaves TextureView compositing a fullscreen-size
         * buffer into the small window (video renders zoomed until the next
         * forced redraw — e.g. dragging the window).
         */
        private const val PIP_SETTLE_DELAY_MS = 350L
    }

    override val shouldUseAndroidLayout: Boolean = true

    private val playerManager = PlayerManager(context)
    private var playerEngine: PlayerEngine = PlayerEngine.EXOPLAYER

    private val isTV: Boolean = context.packageManager
        .hasSystemFeature("android.hardware.type.television") ||
        context.packageManager.hasSystemFeature("android.software.leanback")

    private val aspectFrame = AspectRatioFrameLayout(context).apply {
        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        setAspectRatio(16f / 9f)
    }

    private val surfaceView: SurfaceView? = if (isTV) SurfaceView(context) else null
    private val textureView: TextureView? = if (!isTV) TextureView(context) else null
    private val subtitleView = SubtitleView(context)

    private var backgroundAudioEnabled = false
    private var serviceStarting = false
    private var currentUrl: String? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val positionPoller = object : Runnable {
        override fun run() {
            val p = playerManager
            onPositionChange(mapOf(
                "position" to p.getCurrentPosition(),
                "duration" to p.getDuration(),
            ))
            mainHandler.postDelayed(this, 1000)
        }
    }

    val onReady by EventDispatcher()
    val onError by EventDispatcher()
    val onPlayingChange by EventDispatcher()
    val onBufferingChange by EventDispatcher()
    val onBackgroundAudioChange by EventDispatcher()
    val onPositionChange by EventDispatcher()
    val onTracksChange by EventDispatcher()
    val onPipModeChange by EventDispatcher()
    val onEngineChange by EventDispatcher()

    init {
        gravity = Gravity.CENTER
        orientation = VERTICAL

        val fillParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
        if (isTV) {
            aspectFrame.addView(surfaceView, fillParams)
        } else {
            aspectFrame.addView(textureView, fillParams)
        }

        subtitleView.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION)
        aspectFrame.addView(subtitleView, fillParams)

        addView(aspectFrame, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
            1f,
        ))

        if (!isTV) {
            PipRegistry.setPipListener(this)
        }

        playerManager.setCallbacks(this)

        when {
            isTV && surfaceView != null -> playerManager.setVideoSurfaceView(surfaceView)
            textureView != null -> playerManager.setTextureView(textureView)
        }
    }

    fun setPlayerEngine(engine: String) {
        val newEngine = when (engine.lowercase()) {
            "vlc" -> PlayerEngine.VLC
            else -> PlayerEngine.EXOPLAYER
        }
        if (newEngine != playerEngine) {
            Log.d(TAG, "Setting player engine to $newEngine (was $playerEngine)")
            playerEngine = newEngine
            playerManager.switchEngine(newEngine)
            onEngineChange(mapOf("engine" to newEngine.name.lowercase()))
        }
    }

    fun setResizeMode(mode: Int) {
        aspectFrame.resizeMode = mode
        aspectFrame.requestLayout()
        requestLayout()
        playerManager.setResizeMode(mode)
    }

    fun load(
        url: String,
        headers: Map<String, String>,
        drmType: String?,
        drmLicenseUrl: String?,
        drmLicenseKey: String? = null,
        drmHeaders: Map<String, String>?,
        drmPssh: String? = null,
        autoPlay: Boolean,
    ) {
        Log.d(TAG, "load() called with engine=$playerEngine, url=$url, drm=${drmType ?: "none"}")

        // Previously, loading the same URL would just call play() and skip rebuilding the
        // player. This is wrong when:
        //  - The DRM license has expired and the user retries → we must re-acquire the license.
        //  - The player is in an error state → we must reinitialize.
        // We now always rebuild the player on explicit load() calls. The same-URL skip was a
        // micro-optimisation that caused hard-to-debug DRM expiry failures.

        // Fix race condition: release the existing player BEFORE registering the new
        // session in PlayerRegistry so stopPlayback() on the old view doesn't interfere
        // with the new player being set up.
        releasePlayer()
        PlayerRegistry.registerPlayer(exoPlayer = null, view = this)
        currentUrl = url
        playerManager.load(url, headers, drmType, drmLicenseUrl, drmLicenseKey, drmHeaders, drmPssh, autoPlay)
    }

    fun play() { playerManager.play() }
    fun pause() { playerManager.pause() }
    fun seekTo(positionMs: Long) { playerManager.seekTo(positionMs) }
    fun setVolume(volume: Float) { playerManager.setVolume(volume) }

    /** True when this device/activity combination can enter PiP. */
    fun isPiPSupported(): Boolean =
        !isTV &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            context.packageManager.hasSystemFeature(
                PackageManager.FEATURE_PICTURE_IN_PICTURE,
            )

    /** Returns true when PiP entry was initiated. */
    fun enterPip(): Boolean {
        if (!isPiPSupported()) return false
        if (playerEngine == PlayerEngine.VLC) return false
        val activity = appContext.currentActivity ?: return false

        PipRegistry.isEnteringPip = true
        try {
            val ratio = PipRegistry.aspectRatio
            val builder = PictureInPictureParams.Builder()
                .setAspectRatio(Rational(ratio.numerator, ratio.denominator))
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                builder.setAutoEnterEnabled(false)
                // Seamless resize scales the existing surface buffer
                // without a relayout, which renders as a wrongly
                // zoomed picture during the entry transition.
                builder.setSeamlessResizeEnabled(false)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val loc = IntArray(2)
                aspectFrame.getLocationOnScreen(loc)
                builder.setSourceRectHint(
                    Rect(loc[0], loc[1], loc[0] + aspectFrame.width, loc[1] + aspectFrame.height),
                )
                builder.setTitle(context.applicationInfo.loadLabel(activity.packageManager))
            }
            activity.enterPictureInPictureMode(builder.build())
            return true
        } catch (e: Exception) {
            PipRegistry.isEnteringPip = false
            Log.w(TAG, "enterPip failed: ${e.message}")
            return false
        }
    }

    /**
     * Single owner of PiP transition side effects. Invoked from MainActivity
     * via PipRegistry while the view is alive and attached.
     */
    fun onPipModeChangedFromSystem(isInPip: Boolean) {
        if (isInPip) {
            stopPoller()
            schedulePipSettleLayoutPasses()
        } else {
            if (!backgroundAudioEnabled) {
                when {
                    surfaceView != null -> playerManager.setVideoSurfaceView(surfaceView)
                    textureView != null -> playerManager.setTextureView(textureView)
                }
                if (playerManager.isPlaying()) mainHandler.post { playerManager.play() }
            }
            if (playerManager.isPlaying()) startPoller()
            textureView?.invalidate()
        }
        mainHandler.post {
            onPipModeChange(mapOf("isInPiP" to isInPip))
        }
    }

    /**
     * After the enter transition settles, force one full layout pass and
     * repaint. Without this the first composited frames reuse the pre-PiP
     * measurements/surface buffer, which shows the video zoomed until some
     * other event (e.g. dragging the window) triggers a redraw.
     */
    private fun schedulePipSettleLayoutPasses() {
        mainHandler.post { textureView?.invalidate() }
        mainHandler.postDelayed({
            aspectFrame.forceLayout()
            aspectFrame.requestLayout()
            aspectFrame.invalidate()
            textureView?.invalidate()
        }, PIP_SETTLE_DELAY_MS)
    }

    fun getCurrentPosition(): Long = playerManager.getCurrentPosition()
    fun getDuration(): Long = playerManager.getDuration()
    fun isPlaying(): Boolean = playerManager.isPlaying()
    fun isBackgroundAudioEnabled(): Boolean = backgroundAudioEnabled
    fun getPlayerEngine(): String = playerEngine.name.lowercase()

    fun setMediaMetadata(title: String, artist: String, artworkUri: String?) {
        // Only relevant for ExoPlayer's MediaSession
        // VLC doesn't support media metadata in the same way
    }

    fun selectAudioTrack(groupIndex: Int, trackIndex: Int) {
        playerManager.selectAudioTrack(groupIndex, trackIndex)
    }

    fun selectSubtitleTrack(groupIndex: Int, trackIndex: Int) {
        playerManager.selectSubtitleTrack(groupIndex, trackIndex)
    }

    fun enableBackgroundAudio() {
        if (backgroundAudioEnabled || serviceStarting) return
        if (playerEngine != PlayerEngine.EXOPLAYER) {
            Log.w(TAG, "Background audio only supported with ExoPlayer")
            Toast.makeText(context, "Background play requires ExoPlayer. Switch to ExoPlayer in settings.", Toast.LENGTH_LONG).show()
            return
        }

        serviceStarting = true
        TvPlayerService.backgroundPlayEnabled = true

        val intent = Intent(context, TvPlayerService::class.java)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            backgroundAudioEnabled = true
            onBackgroundAudioChange(mapOf("enabled" to true))
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start background audio service", e)
        } finally {
            serviceStarting = false
        }
    }

    fun disableBackgroundAudio(silent: Boolean = false) {
        if (!backgroundAudioEnabled) return
        backgroundAudioEnabled = false
        TvPlayerService.backgroundPlayEnabled = false
        try {
            context.stopService(Intent(context, TvPlayerService::class.java))
        } catch (_: Exception) {}
        if (!silent) {
            try { onBackgroundAudioChange(mapOf("enabled" to false)) } catch (_: Exception) {}
        }
    }

    fun releasePlayer() {
        PipRegistry.isPlayerActive = false
        stopPoller()
        disableBackgroundAudio(silent = true)
        playerManager.release()
        currentUrl = null
        // Don't carry the previous channel's ratio into the next PiP entry.
        PipRegistry.aspectRatio = Rational(16, 9)
        // Note: activeView is NOT cleared here. It is only cleared when the
        // view is actually destroyed (onDetachedFromWindow). This ensures that
        // PlayerRegistry.registerPlayer() can still find the old view and call
        // stopPlayback() on it when a new view loads a different channel.
    }
    
    fun stopPlayback() {
        Log.d(TAG, "stopPlayback() called - stopping player for new channel")
        playerManager.pause()
        disableBackgroundAudio(silent = true)
    }

    // ── PlayerController.Callbacks implementation ────────────────────────────

    override fun onReady() {
        onReady(mapOf<String, Any>())
        onBufferingChange(mapOf("isBuffering" to false))
        startPoller()
    }

    override fun onError(message: String) {
        stopPoller()
        Log.e(TAG, "Player error: $message")
        onError(mapOf("message" to message))
    }

    override fun onPlayingChanged(isPlaying: Boolean) {
        onPlayingChange(mapOf("isPlaying" to isPlaying))
        if (isPlaying) startPoller() else stopPoller()
    }

    override fun onBufferingChanged(isBuffering: Boolean) {
        onBufferingChange(mapOf("isBuffering" to isBuffering))
    }

    override fun onPositionChanged(positionMs: Long, durationMs: Long) {
        // Handled by positionPoller
    }

    override fun onTracksChanged(audioTracks: List<Map<String, Any>>, subtitleTracks: List<Map<String, Any>>) {
        onTracksChange(mapOf(
            "audioTracks" to audioTracks,
            "subtitleTracks" to subtitleTracks,
        ))
    }

    override fun onVideoSizeChanged(width: Int, height: Int, pixelWidthHeightRatio: Float) {
        if (width > 0 && height > 0) {
            val ratio = (width * pixelWidthHeightRatio).toFloat() / height
            aspectFrame.setAspectRatio(ratio)
            requestLayout()
            if (!isTV && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                // Track the DISPLAY ratio (anamorphic streams have a pixel
                // aspect ≠ 1), not the raw encoded pixels — the PiP window
                // should match what the viewer actually sees. Rational only
                // takes integers, so scale both sides before reducing.
                try {
                    val scaledW = (width * pixelWidthHeightRatio * 1000).toInt()
                    val scaledH = height * 1000
                    if (scaledW > 0 && scaledH > 0) {
                        PipRegistry.aspectRatio = Rational(scaledW, scaledH)
                        if (PipRegistry.isInPipMode) {
                            appContext.currentActivity?.setPictureInPictureParams(
                                PictureInPictureParams.Builder()
                                    .setAspectRatio(PipRegistry.aspectRatio)
                                    .build(),
                            )
                        }
                    }
                } catch (_: Exception) {
                    // Keep the previous/default ratio on malformed sizes.
                }
            }
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private fun startPoller() {
        mainHandler.removeCallbacks(positionPoller)
        mainHandler.post(positionPoller)
    }

    private fun stopPoller() {
        mainHandler.removeCallbacks(positionPoller)
    }

    override fun onDetachedFromWindow() {
        // VLC cannot play background audio — always fully release before the
        // surface is destroyed, otherwise its native render thread crashes
        // when it tries to draw to the destroyed surface (SIGSEGV).
        val vlcNeedsRelease = playerManager.getCurrentEngine() == PlayerEngine.VLC

        if ((!backgroundAudioEnabled && !PipRegistry.isInPipMode && !PipRegistry.isEnteringPip) || vlcNeedsRelease) {
            releasePlayer()
            PlayerRegistry.clearActiveView()
        } else {
            // ExoPlayer with background audio / PiP — detach the surface but
            // leave the player alive so it resumes when reattached.
            playerManager.clearVideoSurface()
        }

        super.onDetachedFromWindow()
        if (!isTV) PipRegistry.clearPipListener(this)

        if (backgroundAudioEnabled || PipRegistry.isInPipMode) {
            stopPoller()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!isTV) PipRegistry.setPipListener(this)
        if (backgroundAudioEnabled || PipRegistry.isInPipMode) {
            when {
                isTV && surfaceView != null -> playerManager.setVideoSurfaceView(surfaceView)
                textureView != null -> playerManager.setTextureView(textureView)
            }
            if (playerManager.isPlaying()) {
                startPoller()
            }
        }
    }
}
