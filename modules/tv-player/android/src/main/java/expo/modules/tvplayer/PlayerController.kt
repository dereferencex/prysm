package expo.modules.tvplayer

import android.view.SurfaceView
import android.view.TextureView

interface PlayerController {

    interface Callbacks {
        fun onReady()
        fun onError(message: String)
        fun onPlayingChanged(isPlaying: Boolean)
        fun onBufferingChanged(isBuffering: Boolean)
        fun onPositionChanged(positionMs: Long, durationMs: Long)
        fun onTracksChanged(audioTracks: List<Map<String, Any>>, subtitleTracks: List<Map<String, Any>>)
        fun onVideoSizeChanged(width: Int, height: Int, pixelWidthHeightRatio: Float)
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
    )

    fun setVideoSurfaceView(surfaceView: SurfaceView)
    fun setTextureView(textureView: TextureView)
    fun clearVideoSurface()

    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun setVolume(volume: Float)

    fun selectAudioTrack(groupIndex: Int, trackIndex: Int)
    fun selectSubtitleTrack(groupIndex: Int, trackIndex: Int)

    fun getCurrentPosition(): Long
    fun getDuration(): Long
    fun isPlaying(): Boolean

    fun setCallbacks(callbacks: Callbacks)
    fun release()
}
