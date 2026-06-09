package expo.modules.tvplayer

import android.content.Context
import android.graphics.SurfaceTexture
import android.net.Uri
import android.util.Log
import android.view.Surface
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewTreeObserver
import android.view.ViewGroup
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout

/**
 * VLC-based player controller with comprehensive lifecycle safety.
 *
 * ## Threading model
 *
 * - **UI thread**: all Android View callbacks (surface, layout), load(), release(),
 *   clearVideoSurface(), play/pause/seek.
 * - **VLC native thread**: event callbacks (setEventListener lambda).
 * - **Module queue**: AsyncFunction calls from React Native bridge.
 *
 * ## Crash scenarios fixed
 *
 * ### 1. Surface destroyed before release()
 *    Android destroys the SurfaceView surface *before* onDetachedFromWindow() fires
 *    during back-gesture navigation. VLC's native renderer continues writing to the
 *    destroyed surface → native SIGSEGV.
 *    **Fix**: Detach VLC video output in surfaceDestroyed()/onSurfaceTextureDestroyed()
 *    so VLC stops rendering immediately.
 *
 * ### 2. VLC event fires after release() starts
 *    release() sets released=true then setEventListener(null). But VLC events fire on
 *    a native thread — an event can enter the callback after released=true but before
 *    setEventListener(null) takes effect. The callback accesses this.length (MediaPlayer
 *    property) on a player about to be released → native crash.
 *    **Fix**: if (released) guard at the top of the event listener + null-safe access
 *    to mediaPlayer in all callbacks.
 *
 * ### 3. Anonymous listeners never removed
 *    attachVideoOutput() registers anonymous OnGlobalLayoutListener, OnLayoutChangeListener,
 *    SurfaceHolder.Callback, TextureView.SurfaceTextureListener. These capture vlcVout
 *    from the closure. After release(), layout/surface events still fire → listener calls
 *    vlcVout.setWindowSize() on released Vout → native crash.
 *    **Fix**: Store listener references in fields. Remove them in release() and
 *    clearVideoSurface().
 *
 * ### 4. Multiple listener registrations
 *    attachVideoOutput() can be called multiple times (channel switch, PiP return).
 *    Each call stacks new anonymous listeners without removing old ones → listener leak.
 *    **Fix**: Remove old listeners before adding new ones.
 *
 * ### 5. reportTracks()/reportVideoSize() after release
 *    VLC Playing event calls reportTracks() which accesses mediaPlayer.audioTracks.
 *    If mediaPlayer is being released concurrently → native crash.
 *    **Fix**: if (released) guard at the top of both methods.
 *
 * ### 6. view.post() after view detachment
 *    VLC Vout event handler does view.post { ... }. If the view is detached, the
 *    Runnable may still execute from the message queue → accesses released MediaPlayer.
 *    **Fix**: Guard with released + mediaPlayer null check.
 */
class VlcPlayerController(
    private val context: Context,
) : PlayerController {

    private var libVLC: LibVLC? = null
    private var mediaPlayer: org.videolan.libvlc.MediaPlayer? = null
    private var callbacks: PlayerController.Callbacks? = null
    private var videoLayout: VLCVideoLayout? = null
    private var surfaceView: SurfaceView? = null
    private var textureView: TextureView? = null
    private var currentUrl: String = ""
    private var currentHeaders: Map<String, String> = emptyMap()
    private var savedPosition: Long = 0L
    private var isPrepared = false
    private var isPlayingState = false
    private var durationMs: Long = 0L
    private var currentResizeMode: Int = 0 // 0 = FIT, 1 = FILL, 3 = ZOOM

    /**
     * Volatile flag checked by EVERY callback that accesses native VLC resources.
     * Set to true at the start of release() before any native teardown.
     * @Volatile ensures visibility across threads (UI, VLC native, module queue).
     */
    @Volatile
    private var released = false

    // ── Stored listener references ──────────────────────────────────────────
    // Anonymous listeners capture vlcVout from the attachVideoOutput() closure.
    // After release(), these closures still hold the now-invalid vlcVout reference.
    // We MUST remove them during release()/clearVideoSurface() to prevent native crashes.
    // Without storing references, we cannot call removeOnGlobalLayoutListener(),
    // removeOnLayoutChangeListener(), or removeCallback() — the anonymous lambdas
    // would stay registered and fire against released VLC objects.

    private var surfaceGlobalLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var surfaceLayoutChangeListener: View.OnLayoutChangeListener? = null
    private var surfaceHolderCallback: android.view.SurfaceHolder.Callback? = null

    private var textureGlobalLayoutListener: ViewTreeObserver.OnGlobalLayoutListener? = null
    private var textureLayoutChangeListener: View.OnLayoutChangeListener? = null
    private var textureSurfaceListener: TextureView.SurfaceTextureListener? = null

    companion object {
        private const val TAG = "VlcPlayerController"
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
        if (!drmType.isNullOrEmpty()) {
            Log.e(TAG, "DRM ($drmType) is not supported by VLC — refusing to play")
            // Prefix with DRM_ERROR so the JS layer can detect this as a DRM-specific
            // failure and suppress the "Switch to VLC?" fallback dialog (VLC cannot
            // play DRM content regardless of the error count).
            callbacks?.onError("DRM_ERROR: DRM content ($drmType) cannot be played with VLC. Switch to ExoPlayer in settings.")
            return
        }

        Log.d(TAG, "Loading URL: $url with VLC")
        currentUrl = url
        currentHeaders = headers
        savedPosition = 0L
        isPrepared = false
        isPlayingState = false

        release(silent = true)
        released = false

        val options = ArrayList<String>()
        options.add("--network-caching=3000")
        options.add("--live-caching=3000")
        options.add("--http-caching=3000")
        options.add("--file-caching=3000")
        options.add("--avcodec-hw=any")
        options.add("--no-video-title-show")
        options.add("--no-osd")

        try {
            libVLC = LibVLC(context.applicationContext, options)
            Log.d(TAG, "LibVLC initialized successfully")
        } catch (e: UnsatisfiedLinkError) {
            Log.e(TAG, "Failed to load LibVLC native libraries: ${e.message}", e)
            callbacks?.onError("VLC initialization failed: native libraries not loaded. ${e.message}")
            return
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize LibVLC: ${e.message}", e)
            callbacks?.onError("VLC initialization failed: ${e.message}")
            return
        }

        // ── FIX #2: VLC event listener safety ──────────────────────────────
        // The event listener lambda runs on VLC's native thread. It can fire
        // AFTER release() has set released=true but BEFORE setEventListener(null)
        // takes effect. Without the released guard, the callback accesses
        // this.length (MediaPlayer property) and callbacks on a player being
        // torn down → native crash.
        //
        // We also use mediaPlayer?.vlcVout instead of a captured vlcVout reference
        // because mediaPlayer is nulled in release() — the ?. operator returns null
        // safely.
        mediaPlayer = org.videolan.libvlc.MediaPlayer(libVLC).apply {
            setEventListener { event ->
                if (released) return@setEventListener
                when (event.type) {
                    org.videolan.libvlc.MediaPlayer.Event.Opening -> {
                        Log.d(TAG, "VLC: Opening stream")
                    }
                    org.videolan.libvlc.MediaPlayer.Event.Playing -> {
                        Log.d(TAG, "VLC: Playing started")
                        isPrepared = true
                        isPlayingState = true
                        reportTracks()
                        callbacks?.onReady()
                        callbacks?.onPlayingChanged(true)
                        callbacks?.onBufferingChanged(false)
                    }
                    org.videolan.libvlc.MediaPlayer.Event.Paused -> {
                        Log.d(TAG, "VLC: Paused")
                        isPlayingState = false
                        callbacks?.onPlayingChanged(false)
                    }
                    org.videolan.libvlc.MediaPlayer.Event.Stopped -> {
                        Log.d(TAG, "VLC: Stopped")
                        isPlayingState = false
                        callbacks?.onPlayingChanged(false)
                    }
                    org.videolan.libvlc.MediaPlayer.Event.EndReached -> {
                        Log.d(TAG, "VLC: End reached")
                        isPlayingState = false
                        callbacks?.onPlayingChanged(false)
                    }
                    org.videolan.libvlc.MediaPlayer.Event.EncounteredError -> {
                        Log.e(TAG, "VLC: Playback error encountered")
                        // Provide a more actionable error message. If the stream requires
                        // DRM this path is not reached (the DRM check at the top of load()
                        // fires first), so this is a genuine VLC playback failure.
                        callbacks?.onError("VLC playback error — stream may be incompatible with VLC. Try switching to ExoPlayer.")
                    }
                    org.videolan.libvlc.MediaPlayer.Event.Buffering -> {
                        val buffering = event.getBuffering()
                        callbacks?.onBufferingChanged(buffering < 100f)
                        if (buffering >= 100f && !isPrepared) {
                            isPrepared = true
                            callbacks?.onReady()
                        }
                    }
                    org.videolan.libvlc.MediaPlayer.Event.LengthChanged -> {
                        durationMs = this.length
                        Log.d(TAG, "VLC: Duration changed to $durationMs ms")
                    }
                    org.videolan.libvlc.MediaPlayer.Event.Vout -> {
                        val count = event.getVoutCount()
                        Log.d(TAG, "VLC: Vout count: $count")
                        if (count > 0) {
                            durationMs = this.length
                            reportVideoSize()
                            // ── FIX #6: view.post() safety ─────────────────
                            // This Runnable executes on the UI thread after the
                            // VLC event loop posts it. By the time it runs,
                            // release() may have nulled mediaPlayer. The released
                            // guard + mediaPlayer?.vlcVout null-safe chain
                            // prevents access to freed native objects.
                            val view = surfaceView ?: textureView
                            view?.post {
                                if (released) return@post
                                val w = view.width
                                val h = view.height
                                if (w > 0 && h > 0) {
                                    mediaPlayer?.vlcVout?.setWindowSize(w, h)
                                    updateVlcScale()
                                }
                            }
                            callbacks?.onReady()
                        }
                    }
                    else -> {}
                }
            }
        }

        val media = Media(libVLC, Uri.parse(url))
        media.setHWDecoderEnabled(true, true)
        media.addOption(":network-caching=3000")
        media.addOption(":live-caching=3000")
        media.addOption(":http-caching=3000")
        media.addOption(":http-user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

        headers.forEach { (key, value) ->
            media.addOption(":http-custom-header=$key: $value")
        }

        mediaPlayer?.setMedia(media)
        media.release()

        attachVideoOutput()

        if (autoPlay) {
            mediaPlayer?.play()
            isPlayingState = true
        }

        Log.d(TAG, "VLC media prepared, autoPlay=$autoPlay")
    }

    override fun setVideoSurfaceView(surfaceView: SurfaceView) {
        this.surfaceView = surfaceView
        this.textureView = null
        attachVideoOutput()
    }

    override fun setTextureView(textureView: TextureView) {
        this.textureView = textureView
        this.surfaceView = null
        attachVideoOutput()
    }

    /**
     * Detaches VLC video output from the surface without releasing the player.
     * Called from onDetachedFromWindow() when background audio is enabled and
     * the view must be released but playback continues.
     */
    override fun clearVideoSurface() {
        // ── FIX #3: Remove all stored listeners ──────────────────────────
        // Listeners capture vlcVout from the closure. After detaching views,
        // the vlcVout is invalid. Remove listeners FIRST to prevent them
        // from firing and accessing the invalid Vout.
        removeAllListeners()

        mediaPlayer?.let {
            try {
                it.vlcVout?.detachViews()
            } catch (e: Exception) {
                Log.w(TAG, "Error detaching VLC views: ${e.message}")
            }
        }
    }

    // ── Listener management ──────────────────────────────────────────────────

    /**
     * Removes all stored listeners from their parent Views.
     * Called before release() and clearVideoSurface() to prevent callbacks
     * from firing against released VLC objects.
     */
    private fun removeAllListeners() {
        // SurfaceView listeners
        surfaceGlobalLayoutListener?.let { listener ->
            try {
                surfaceView?.viewTreeObserver?.removeOnGlobalLayoutListener(listener)
            } catch (_: Exception) {}
        }
        surfaceGlobalLayoutListener = null

        surfaceLayoutChangeListener?.let { listener ->
            try {
                surfaceView?.removeOnLayoutChangeListener(listener)
            } catch (_: Exception) {}
        }
        surfaceLayoutChangeListener = null

        surfaceHolderCallback?.let { callback ->
            try {
                surfaceView?.holder?.removeCallback(callback)
            } catch (_: Exception) {}
        }
        surfaceHolderCallback = null

        // TextureView listeners
        textureGlobalLayoutListener?.let { listener ->
            try {
                textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(listener)
            } catch (_: Exception) {}
        }
        textureGlobalLayoutListener = null

        textureLayoutChangeListener?.let { listener ->
            try {
                textureView?.removeOnLayoutChangeListener(listener)
            } catch (_: Exception) {}
        }
        textureLayoutChangeListener = null

        textureSurfaceListener?.let { listener ->
            try {
                textureView?.surfaceTextureListener = null
            } catch (_: Exception) {}
        }
        textureSurfaceListener = null
    }

    private fun attachVideoOutput() {
        val player = mediaPlayer ?: return
        val vlcVout = player.vlcVout ?: return

        try {
            if (vlcVout.areViewsAttached()) {
                vlcVout.detachViews()
            }

            when {
                surfaceView != null -> {
                    Log.d(TAG, "Attaching VLC to SurfaceView")
                    vlcVout.setVideoView(surfaceView)
                    if (!vlcVout.areViewsAttached()) {
                        vlcVout.attachViews()
                    }

                    // ── FIX #3 & #4: Store listener references ────────────
                    // Remove old listeners first to prevent stacking on repeated calls.
                    // Store new references so removeAllListeners() can remove them later.

                    // ── OnGlobalLayoutListener ────────────────────────────
                    // Fires once when layout is measured. Calls setWindowSize()
                    // and updateVlcScale() to configure VLC's rendering region.
                    // Removed after first successful layout pass.
                    val glo = object : ViewTreeObserver.OnGlobalLayoutListener {
                        override fun onGlobalLayout() {
                            if (released) {
                                surfaceView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                                return
                            }
                            val w = surfaceView?.width ?: 0
                            val h = surfaceView?.height ?: 0
                            if (w > 0 && h > 0) {
                                mediaPlayer?.vlcVout?.setWindowSize(w, h)
                                updateVlcScale()
                                surfaceView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                            }
                        }
                    }
                    // Remove old listener before adding new one
                    surfaceGlobalLayoutListener?.let {
                        surfaceView?.viewTreeObserver?.removeOnGlobalLayoutListener(it)
                    }
                    surfaceGlobalLayoutListener = glo
                    surfaceView?.viewTreeObserver?.addOnGlobalLayoutListener(glo)

                    // ── OnLayoutChangeListener ────────────────────────────
                    // Fires on every layout change. Updates VLC window size
                    // to match the new SurfaceView dimensions.
                    val lcl = View.OnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                        if (released) return@OnLayoutChangeListener
                        val w = right - left
                        val h = bottom - top
                        if (w > 0 && h > 0) {
                            mediaPlayer?.vlcVout?.setWindowSize(w, h)
                            updateVlcScale()
                        }
                    }
                    surfaceLayoutChangeListener?.let {
                        surfaceView?.removeOnLayoutChangeListener(it)
                    }
                    surfaceLayoutChangeListener = lcl
                    surfaceView?.addOnLayoutChangeListener(lcl)

                    // ── SurfaceHolder.Callback ─────────────────────────────
                    // surfaceChanged: Updates VLC window size when the surface
                    //   dimensions change (rotation, resize).
                    // surfaceDestroyed: ── FIX #1: CRITICAL ──────────────────
                    //   During Android back-gesture navigation, Android destroys
                    //   the SurfaceView surface BEFORE onDetachedFromWindow() fires.
                    //   If VLC is still rendering to this surface, the native
                    //   renderer writes to freed memory → SIGSEGV.
                    //   We MUST call detachViews() here to stop VLC rendering
                    //   immediately when the surface goes away.
                    val shc = object : android.view.SurfaceHolder.Callback {
                        override fun surfaceCreated(holder: android.view.SurfaceHolder) {}
                        override fun surfaceChanged(holder: android.view.SurfaceHolder, format: Int, width: Int, height: Int) {
                            if (released) return
                            if (width > 0 && height > 0) {
                                mediaPlayer?.vlcVout?.setWindowSize(width, height)
                                updateVlcScale()
                            }
                        }
                        override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {
                            if (released) return
                            // Detach VLC from the surface immediately so its native
                            // renderer stops writing to the destroyed surface.
                            // release() will call detachViews() again idempotently.
                            try {
                                mediaPlayer?.vlcVout?.detachViews()
                            } catch (e: Exception) {
                                Log.w(TAG, "Error detaching VLC on surfaceDestroyed: ${e.message}")
                            }
                        }
                    }
                    surfaceHolderCallback?.let {
                        surfaceView?.holder?.removeCallback(it)
                    }
                    surfaceHolderCallback = shc
                    surfaceView?.holder?.addCallback(shc)
                }
                textureView != null -> {
                    val st = textureView?.surfaceTexture
                    if (st != null) {
                        Log.d(TAG, "Attaching VLC to TextureView surface")
                        vlcVout.setVideoSurface(Surface(st), null)
                        if (!vlcVout.areViewsAttached()) {
                            vlcVout.attachViews()
                        }

                        val glo = object : ViewTreeObserver.OnGlobalLayoutListener {
                            override fun onGlobalLayout() {
                                if (released) {
                                    textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                                    return
                                }
                                val w = textureView?.width ?: 0
                                val h = textureView?.height ?: 0
                                if (w > 0 && h > 0) {
                                    mediaPlayer?.vlcVout?.setWindowSize(w, h)
                                    updateVlcScale()
                                    textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                                }
                            }
                        }
                        textureGlobalLayoutListener?.let {
                            textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(it)
                        }
                        textureGlobalLayoutListener = glo
                        textureView?.viewTreeObserver?.addOnGlobalLayoutListener(glo)
                    } else {
                        Log.d(TAG, "SurfaceTexture not ready, waiting...")
                        // ── TextureView.SurfaceTextureListener ─────────────
                        // onSurfaceTextureAvailable: Attaches VLC to the newly
                        //   available surface texture and registers layout listeners.
                        // onSurfaceTextureDestroyed: ── FIX #1 ───────────────
                        //   Same as surfaceDestroyed for SurfaceView. During back
                        //   gesture, the SurfaceTexture is destroyed before
                        //   onDetachedFromWindow(). We must detach VLC's video
                        //   output here. Return false to prevent Android from
                        //   releasing the SurfaceTexture (we manage its lifecycle).
                        val tsl = object : TextureView.SurfaceTextureListener {
                            override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                                if (released) return
                                Log.d(TAG, "SurfaceTexture now available, attaching VLC")
                                mediaPlayer?.vlcVout?.setVideoSurface(Surface(surfaceTexture), null)
                                if (mediaPlayer?.vlcVout?.areViewsAttached() != true) {
                                    mediaPlayer?.vlcVout?.attachViews()
                                }
                                val glo = object : ViewTreeObserver.OnGlobalLayoutListener {
                                    override fun onGlobalLayout() {
                                        if (released) {
                                            textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                                            return
                                        }
                                        val w = textureView?.width ?: 0
                                        val h = textureView?.height ?: 0
                                        if (w > 0 && h > 0) {
                                            mediaPlayer?.vlcVout?.setWindowSize(w, h)
                                            updateVlcScale()
                                            textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                                        }
                                    }
                                }
                                textureGlobalLayoutListener?.let {
                                    textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(it)
                                }
                                textureGlobalLayoutListener = glo
                                textureView?.viewTreeObserver?.addOnGlobalLayoutListener(glo)

                                val lcl = View.OnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                                    if (released) return@OnLayoutChangeListener
                                    val w = right - left
                                    val h = bottom - top
                                    if (w > 0 && h > 0) {
                                        mediaPlayer?.vlcVout?.setWindowSize(w, h)
                                        updateVlcScale()
                                    }
                                }
                                textureLayoutChangeListener?.let {
                                    textureView?.removeOnLayoutChangeListener(it)
                                }
                                textureLayoutChangeListener = lcl
                                textureView?.addOnLayoutChangeListener(lcl)
                            }
                            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
                            override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                                // FIX #1: Detach VLC immediately when surface is destroyed.
                                // During back-gesture, this fires BEFORE onDetachedFromWindow().
                                // Without this, VLC's native renderer writes to freed surface memory.
                                if (!released) {
                                    try {
                                        mediaPlayer?.vlcVout?.setVideoSurface(null, null)
                                    } catch (e: Exception) {
                                        Log.w(TAG, "Error detaching VLC on surfaceTextureDestroyed: ${e.message}")
                                    }
                                }
                                return false
                            }
                            override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
                        }
                        textureSurfaceListener = tsl
                        textureView?.surfaceTextureListener = tsl
                    }

                    val lcl = View.OnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                        if (released) return@OnLayoutChangeListener
                        val w = right - left
                        val h = bottom - top
                        if (w > 0 && h > 0) {
                            mediaPlayer?.vlcVout?.setWindowSize(w, h)
                            updateVlcScale()
                        }
                    }
                    textureLayoutChangeListener?.let {
                        textureView?.removeOnLayoutChangeListener(it)
                    }
                    textureLayoutChangeListener = lcl
                    textureView?.addOnLayoutChangeListener(lcl)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error attaching VLC video output: ${e.message}", e)
        }
    }

    // ── FIX #5: reportVideoSize/reportTracks released guards ─────────────────
    // These are called from the VLC event listener (native thread). They access
    // mediaPlayer properties (media, audioTracks, spuTracks) which are freed
    // during release(). Without the released guard, these methods can access
    // freed native objects → crash.

    private fun reportVideoSize() {
        if (released) return
        try {
            val media = mediaPlayer?.media ?: return
            Log.d(TAG, "VLC: Checking ${media.trackCount} tracks for video size")
            for (i in 0 until media.trackCount) {
                val track = media.getTrack(i)
                Log.d(TAG, "VLC: Track $i type=${track.type}, codec=${track.codec}")
                if (track.type == 2) { // 2 = video track type in libvlc
                    val widthField = track.javaClass.getField("width")
                    val heightField = track.javaClass.getField("height")
                    val w = widthField.getInt(track)
                    val h = heightField.getInt(track)
                    Log.d(TAG, "VLC: Found video track ${w}x${h}")
                    if (w > 0 && h > 0) {
                        callbacks?.onVideoSizeChanged(w, h, 1.0f)
                    }
                    break
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not get video size: ${e.message}", e)
        }
    }

    private fun reportTracks() {
        if (released) return
        val player = mediaPlayer ?: return
        val audioTracks = mutableListOf<Map<String, Any>>()
        val subtitleTracks = mutableListOf<Map<String, Any>>()

        try {
            val currentAudioId = player.audioTrack
            player.audioTracks?.forEachIndexed { index, desc ->
                audioTracks.add(mapOf(
                    "groupIndex" to 0,
                    "trackIndex" to index,
                    "id" to "audio_0_${index}",
                    "label" to (desc.name ?: "Audio ${index + 1}"),
                    "language" to "",
                    "isSelected" to (desc.id == currentAudioId),
                ))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error reading VLC audio tracks: ${e.message}")
        }

        try {
            val currentSpuId = player.spuTrack
            player.spuTracks?.forEachIndexed { index, desc ->
                subtitleTracks.add(mapOf(
                    "groupIndex" to 0,
                    "trackIndex" to index,
                    "id" to "sub_0_${index}",
                    "label" to (desc.name ?: "Subtitle ${index + 1}"),
                    "language" to "",
                    "isSelected" to (desc.id == currentSpuId),
                ))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Error reading VLC subtitle tracks: ${e.message}")
        }

        if (audioTracks.isNotEmpty() || subtitleTracks.isNotEmpty()) {
            Log.d(TAG, "VLC: Reporting ${audioTracks.size} audio, ${subtitleTracks.size} subtitle tracks")
            callbacks?.onTracksChanged(audioTracks, subtitleTracks)
        }
    }

    override fun play() {
        if (released) return
        mediaPlayer?.play()
        isPlayingState = true
        Log.d(TAG, "VLC play() called")
    }

    override fun pause() {
        if (released) return
        mediaPlayer?.pause()
        isPlayingState = false
        Log.d(TAG, "VLC pause() called")
    }

    override fun seekTo(positionMs: Long) {
        if (released) return
        mediaPlayer?.time = positionMs
    }

    override fun setVolume(volume: Float) {
        if (released) return
        mediaPlayer?.volume = (volume * 100).toInt()
    }

    override fun selectAudioTrack(groupIndex: Int, trackIndex: Int) {
        if (released) return
        val player = mediaPlayer ?: return
        val tracks = player.audioTracks
        val trackId = tracks.getOrNull(trackIndex) ?: return
        player.setAudioTrack(trackId.id)
        Log.d(TAG, "VLC: Selected audio track index=$trackIndex, id=${trackId.id}")
    }

    override fun selectSubtitleTrack(groupIndex: Int, trackIndex: Int) {
        if (released) return
        val player = mediaPlayer ?: return
        if (groupIndex < 0) {
            player.setSpuTrack(-1)
            Log.d(TAG, "VLC: Subtitles disabled")
        } else {
            val tracks = player.spuTracks
            val trackId = tracks.getOrNull(trackIndex) ?: return
            player.setSpuTrack(trackId.id)
            Log.d(TAG, "VLC: Selected subtitle track index=$trackIndex, id=${trackId.id}")
        }
    }

    override fun getCurrentPosition(): Long {
        val position = mediaPlayer?.time ?: 0L
        val duration = getDuration()
        return if (duration > 0 && position > duration) duration else position
    }
    override fun getDuration(): Long {
        val length = mediaPlayer?.length ?: 0L
        return if (length > 86400000L) 0L else length
    }
    override fun isPlaying(): Boolean = mediaPlayer?.isPlaying ?: false

    fun setResizeMode(mode: Int) {
        currentResizeMode = mode
        updateVlcScale()
    }

    private fun updateVlcScale() {
        if (released) return
        val player = mediaPlayer ?: return
        when (currentResizeMode) {
            0 -> { // FIT - maintain aspect ratio, fit within window
                player.setScale(0f)
                player.setAspectRatio(null)
            }
            1 -> { // FILL - stretch to fill window (ignore aspect ratio)
                player.setScale(0f)
                val view = surfaceView ?: textureView
                val w = view?.width ?: 0
                val h = view?.height ?: 0
                if (w > 0 && h > 0) {
                    player.setAspectRatio("${w}:${h}")
                }
            }
            3 -> { // ZOOM - fill window while maintaining aspect ratio (may crop)
                player.setScale(0f)
                player.setAspectRatio(null)
            }
        }
    }

    // ── release() ────────────────────────────────────────────────────────────
    //
    // Release order is critical for thread safety:
    //
    // 1. if (released) return — idempotent, prevents double-release.
    //
    // 2. released = true — @Volatile ensures visibility to all threads before
    //    any native teardown begins. All callbacks check this flag first.
    //
    // 3. removeAllListeners() — remove Android view listeners that capture
    //    vlcVout from closures. Without this, layout/surface events fire into
    //    released VLC objects → native crash. MUST happen before detachViews()
    //    because listeners access vlcVout.
    //
    // 4. setEventListener(null) — stop VLC event callbacks BEFORE stop().
    //    stop() triggers VLC's internal event loop which fires Stopped events.
    //    Without nulling the listener first, those events reach our callback
    //    which accesses MediaPlayer properties on a player being torn down.
    //    Note: VLC's setEventListener is just a field assignment on the native
    //    thread's next event poll. There is a small race window between this
    //    call and the native thread seeing the null. The released guard in the
    //    event listener handles this race.
    //
    // 5. savedPosition = getCurrentPosition() — capture position BEFORE teardown.
    //
    // 6. Null out mediaPlayer/libVLC references — prevents stale access from
    //    any thread that hasn't seen released=true yet.
    //
    // 7. detachViews() — detach video output from the surface. Called AFTER
    //    removeAllListeners() so no listener can fire during/after detach.
    //    May also have been called earlier by surfaceDestroyed() (fix #1).
    //    Calling detachViews() when views are already detached is a no-op.
    //
    // 8. player.release() — free native VLC media player resources.
    //    After this, the MediaPlayer object is invalid. All references to it
    //    must be gone (we nulled mediaPlayer in step 6).
    //
    // 9. libVLC.release() — free native LibVLC instance. Must be last because
    //    the MediaPlayer holds a reference to it.
    //
    private fun release(silent: Boolean = false) {
        if (released) return

        // Step 1: Mark as released — all callbacks see this before accessing natives
        released = true

        // Step 2: Remove all Android view listeners to prevent callbacks against
        // released VLC objects (FIX #3, #4)
        removeAllListeners()

        // Step 3: Null the VLC event listener to stop VLC native thread callbacks
        val player = mediaPlayer
        val vlcLib = libVLC

        // Step 4: Null references before native teardown
        mediaPlayer = null
        libVLC = null

        // Step 5: Capture position before teardown
        savedPosition = try { player?.time ?: 0L } catch (_: Exception) { 0L }

        try {
            player?.let {
                // Null event listener FIRST — stop() fires Stopped events on
                // VLC's native thread. Without nulling, those events access
                // MediaPlayer properties during teardown.
                it.setEventListener(null)

                // Stop playback — triggers VLC to halt its internal decode/render loops
                it.stop()

                // Detach video output from surfaces. May already be detached
                // by surfaceDestroyed() (FIX #1). detachViews() is idempotent
                // when views are already detached.
                try {
                    it.vlcVout?.detachViews()
                } catch (e: Exception) {
                    Log.w(TAG, "Error during detachViews in release: ${e.message}")
                }

                // Release native MediaPlayer — frees all VLC internal resources
                it.release()
            }
        } catch (e: Throwable) {
            // Catch Throwable (not Exception) because VLC can throw native errors
            // that extend Error, not Exception. Swallowing prevents crashes from
            // propagating to the React Native bridge.
            Log.e(TAG, "Error releasing VLC MediaPlayer: ${e.message}", e)
        }

        try {
            vlcLib?.release()
        } catch (e: Throwable) {
            Log.e(TAG, "Error releasing LibVLC: ${e.message}", e)
        }

        if (!silent) {
            Log.d(TAG, "VLC player released, saved position: $savedPosition")
        }
    }

    override fun release() {
        release(silent = false)
    }
}
