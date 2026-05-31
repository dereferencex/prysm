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
import org.videolan.libvlc.Media.VideoTrack
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
                }
                textureView != null -> {
                    val st = textureView?.surfaceTexture
                    if (st != null) {
                        Log.d(TAG, "Attaching VLC to TextureView surface")
                        vlcVout.setVideoSurface(Surface(st), null)
                        if (!vlcVout.areViewsAttached()) {
                            vlcVout.attachViews()
                        }
                    } else {
                        Log.d(TAG, "SurfaceTexture not ready, waiting...")
                        textureView?.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                            override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                                Log.d(TAG, "SurfaceTexture now available, attaching VLC")
                                vlcVout.setVideoSurface(Surface(surfaceTexture), null)
                                if (!vlcVout.areViewsAttached()) {
                                    vlcVout.attachViews()
                                }
                            }
                            override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) {}
                            override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                                vlcVout.setVideoSurface(null, null)
                                return false
                            }
                            override fun onSurfaceTextureUpdated(st: SurfaceTexture) {}
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error attaching VLC video output: ${e.message}", e)
        }
    }

    private fun reportVideoSize() {
        val media = mediaPlayer?.media ?: return
        for (i in 0 until media.trackCount) {
            val track = media.getTrack(i)
            if (track is VideoTrack) {
                val w = track.width
                val h = track.height
                if (w > 0 && h > 0) {
                    Log.d(TAG, "VLC: Video size ${w}x${h}")
                    callbacks?.onVideoSizeChanged(w, h, 1.0f)
                }
                break
            }
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

    override fun getCurrentPosition(): Long = mediaPlayer?.time ?: 0L
    override fun getDuration(): Long = mediaPlayer?.length ?: 0L
    override fun isPlaying(): Boolean = mediaPlayer?.isPlaying ?: false

    private fun release(silent: Boolean = false) {
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
