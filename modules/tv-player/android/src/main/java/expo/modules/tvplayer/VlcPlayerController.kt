package expo.modules.tvplayer

import android.content.Context
import android.graphics.SurfaceTexture
import android.net.Uri
import android.util.Log
import android.view.Surface
import android.view.SurfaceView
import android.view.TextureView
import android.view.ViewGroup
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout

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
    @Volatile
    private var released = false

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
        autoPlay: Boolean,
    ) {
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

        mediaPlayer = org.videolan.libvlc.MediaPlayer(libVLC).apply {
            setEventListener { event ->
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
                        callbacks?.onError("VLC playback error")
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
                            // Set window size when video output is ready
                            val view = surfaceView ?: textureView
                            view?.post {
                                val w = view.width
                                val h = view.height
                                Log.d(TAG, "VLC: Setting window size on Vout ${w}x${h}")
                                if (w > 0 && h > 0) {
                                    this@VlcPlayerController.mediaPlayer?.vlcVout?.setWindowSize(w, h)
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

    override fun clearVideoSurface() {
        mediaPlayer?.let {
            try {
                it.vlcVout?.detachViews()
            } catch (e: Exception) {
                Log.w(TAG, "Error detaching VLC views: ${e.message}")
            }
        }
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
                    
                    // Wait for view to be laid out before setting window size
                    surfaceView?.viewTreeObserver?.addOnGlobalLayoutListener(object : android.view.ViewTreeObserver.OnGlobalLayoutListener {
                        override fun onGlobalLayout() {
                            val w = surfaceView?.width ?: 0
                            val h = surfaceView?.height ?: 0
                            Log.d(TAG, "VLC: SurfaceView laid out ${w}x${h}")
                            if (w > 0 && h > 0) {
                                vlcVout.setWindowSize(w, h)
                                updateVlcScale()
                                surfaceView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                            }
                        }
                    })
                    
                    // Listen for layout changes
                    surfaceView?.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                        val w = right - left
                        val h = bottom - top
                        Log.d(TAG, "VLC: SurfaceView layout changed ${w}x${h}")
                        if (w > 0 && h > 0) {
                            vlcVout.setWindowSize(w, h)
                            updateVlcScale()
                        }
                    }
                    
                    surfaceView?.holder?.addCallback(object : android.view.SurfaceHolder.Callback {
                        override fun surfaceCreated(holder: android.view.SurfaceHolder) {
                            Log.d(TAG, "VLC: Surface created")
                        }
                        override fun surfaceChanged(holder: android.view.SurfaceHolder, format: Int, width: Int, height: Int) {
                            Log.d(TAG, "VLC: Surface changed ${width}x${height}")
                            if (width > 0 && height > 0) {
                                vlcVout.setWindowSize(width, height)
                                updateVlcScale()
                            }
                        }
                        override fun surfaceDestroyed(holder: android.view.SurfaceHolder) {}
                    })
                }
                textureView != null -> {
                    val st = textureView?.surfaceTexture
                    if (st != null) {
                        Log.d(TAG, "Attaching VLC to TextureView surface")
                        vlcVout.setVideoSurface(Surface(st), null)
                        if (!vlcVout.areViewsAttached()) {
                            vlcVout.attachViews()
                        }
                        // Wait for view to be laid out before setting window size
                        textureView?.viewTreeObserver?.addOnGlobalLayoutListener(object : android.view.ViewTreeObserver.OnGlobalLayoutListener {
                            override fun onGlobalLayout() {
                                val w = textureView?.width ?: 0
                                val h = textureView?.height ?: 0
                                Log.d(TAG, "VLC: TextureView laid out ${w}x${h}")
                                if (w > 0 && h > 0) {
                                    vlcVout.setWindowSize(w, h)
                                    updateVlcScale()
                                    textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                                }
                            }
                        })
                    } else {
                        Log.d(TAG, "SurfaceTexture not ready, waiting...")
                        textureView?.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                            override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                                Log.d(TAG, "SurfaceTexture now available, attaching VLC")
                                vlcVout.setVideoSurface(Surface(surfaceTexture), null)
                                if (!vlcVout.areViewsAttached()) {
                                    vlcVout.attachViews()
                                }
                                // Wait for view to be laid out before setting window size
                                textureView?.viewTreeObserver?.addOnGlobalLayoutListener(object : android.view.ViewTreeObserver.OnGlobalLayoutListener {
                                    override fun onGlobalLayout() {
                                        val w = textureView?.width ?: 0
                                        val h = textureView?.height ?: 0
                                        Log.d(TAG, "VLC: TextureView laid out ${w}x${h}")
                                        if (w > 0 && h > 0) {
                                            vlcVout.setWindowSize(w, h)
                                            updateVlcScale()
                                            textureView?.viewTreeObserver?.removeOnGlobalLayoutListener(this)
                                        }
                                    }
                                })
                                // Listen for layout changes
                                textureView?.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                                    val w = right - left
                                    val h = bottom - top
                                    Log.d(TAG, "VLC: TextureView layout changed ${w}x${h}")
                                    if (w > 0 && h > 0) {
                                        vlcVout.setWindowSize(w, h)
                                        updateVlcScale()
                                    }
                                }
                            }
                            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {
                                Log.d(TAG, "VLC: SurfaceTexture size changed ${w}x${h}")
                            }
                            override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                                vlcVout.setVideoSurface(null, null)
                                return false
                            }
                            override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
                        }
                    }
                    
                    // Listen for layout changes (only if surface texture was already available)
                    if (st != null) {
                        textureView?.addOnLayoutChangeListener { _, left, top, right, bottom, _, _, _, _ ->
                            val w = right - left
                            val h = bottom - top
                            Log.d(TAG, "VLC: TextureView layout changed ${w}x${h}")
                            if (w > 0 && h > 0) {
                                vlcVout.setWindowSize(w, h)
                                updateVlcScale()
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error attaching VLC video output: ${e.message}", e)
        }
    }

    private fun reportVideoSize() {
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
        mediaPlayer?.play()
        isPlayingState = true
        Log.d(TAG, "VLC play() called")
    }

    override fun pause() {
        mediaPlayer?.pause()
        isPlayingState = false
        Log.d(TAG, "VLC pause() called")
    }

    override fun seekTo(positionMs: Long) {
        mediaPlayer?.time = positionMs
    }

    override fun setVolume(volume: Float) {
        mediaPlayer?.volume = (volume * 100).toInt()
    }

    override fun selectAudioTrack(groupIndex: Int, trackIndex: Int) {
        val player = mediaPlayer ?: return
        val tracks = player.audioTracks
        val trackId = tracks.getOrNull(trackIndex) ?: return
        player.setAudioTrack(trackId.id)
        Log.d(TAG, "VLC: Selected audio track index=$trackIndex, id=${trackId.id}")
    }

    override fun selectSubtitleTrack(groupIndex: Int, trackIndex: Int) {
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
        // For live streams, position can exceed duration
        // Clamp to duration to prevent progress bar overflow
        return if (duration > 0 && position > duration) duration else position
    }
    override fun getDuration(): Long {
        val length = mediaPlayer?.length ?: 0L
        // For live streams, VLC can return very large duration values
        // Treat streams with duration > 24 hours as live streams (duration = 0)
        return if (length > 86400000L) 0L else length
    }
    override fun isPlaying(): Boolean = mediaPlayer?.isPlaying ?: false

    fun setResizeMode(mode: Int) {
        currentResizeMode = mode
        updateVlcScale()
    }

    private fun updateVlcScale() {
        val player = mediaPlayer ?: return
        when (currentResizeMode) {
            0 -> { // FIT - maintain aspect ratio, fit within window
                player.setScale(0f)
                player.setAspectRatio(null)
            }
            1 -> { // FILL - stretch to fill window (ignore aspect ratio)
                player.setScale(0f)
                // Get surface dimensions and set aspect ratio to match
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

    private fun release(silent: Boolean = false) {
        if (released) return
        released = true
        savedPosition = getCurrentPosition()
        try {
            mediaPlayer?.let {
                it.setEventListener(null)
                it.stop()
                it.vlcVout?.detachViews()
                it.release()
            }
            mediaPlayer = null
            libVLC?.release()
            libVLC = null
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing VLC: ${e.message}", e)
        }
        if (!silent) {
            Log.d(TAG, "VLC player released, saved position: $savedPosition")
        }
    }

    override fun release() {
        release(silent = false)
    }
}
