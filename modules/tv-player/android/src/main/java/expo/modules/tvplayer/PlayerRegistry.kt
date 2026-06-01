package expo.modules.tvplayer

import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/**
 * Singleton that bridges TvPlayerView → TvPlayerService.
 * 
 * TvPlayerView registers the ExoPlayer instance here when it's created,
 * so TvPlayerService can build its MediaSession against the player.
 */
@UnstableApi
object PlayerRegistry {
    @Volatile
    var player: ExoPlayer? = null
        private set
    
    fun registerPlayer(exoPlayer: ExoPlayer) {
        player = exoPlayer
    }
    
    fun unregisterPlayer() {
        player = null
    }
}
