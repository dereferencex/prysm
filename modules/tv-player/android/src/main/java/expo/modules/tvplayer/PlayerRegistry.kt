package expo.modules.tvplayer

import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import java.lang.ref.WeakReference

/**
 * Singleton that bridges TvPlayerView → TvPlayerService and ensures only one player is active.
 * 
 * TvPlayerView registers the ExoPlayer instance here when it's created,
 * so TvPlayerService can build its MediaSession against the player.
 * Also tracks the active TvPlayerView to stop previous players when a new one starts.
 */
@UnstableApi
object PlayerRegistry {
    @Volatile
    var player: ExoPlayer? = null
        private set
    
    private var activeView: WeakReference<TvPlayerView>? = null
    
    fun registerPlayer(exoPlayer: ExoPlayer? = null, view: TvPlayerView? = null) {
        // If registering a new view, stop any previous player
        if (view != null) {
            activeView?.get()?.let { oldView ->
                if (oldView !== view) {
                    oldView.stopPlayback()
                }
            }
            activeView = WeakReference(view)
        }
        
        // Update player reference if provided
        if (exoPlayer != null) {
            player = exoPlayer
        }
    }
    
    fun unregisterPlayer() {
        player = null
        activeView = null
    }
    
    fun clearActiveView() {
        activeView = null
    }
}
