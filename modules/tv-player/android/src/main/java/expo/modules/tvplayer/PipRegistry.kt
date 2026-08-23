package expo.modules.tvplayer

import android.util.Rational
import java.lang.ref.WeakReference

/**
 * Bridges TvPlayerView ↔ MainActivity for PiP.
 *
 * TvPlayerView sets [isPlayerActive] = true when a source is loaded and playing,
 * false when released. MainActivity reads this in onPictureInPictureModeChanged()
 * handling to coordinate state.
 *
 * [isInPipMode] is set by MainActivity.onPictureInPictureModeChanged() so that
 * TvPlayerView can force a re-layout when the window shrinks/grows.
 */
object PipRegistry {
    /** True when a player is active and PiP should be triggered on Home press. */
    @Volatile var isPlayerActive: Boolean = false

    /** Aspect ratio for the PiP window — updated when video size changes. */
    @Volatile var aspectRatio: Rational = Rational(16, 9)

    /** True while the activity is in PiP mode. Set by MainActivity. */
    @Volatile var isInPipMode: Boolean = false

    /**
     * Set to true in TvPlayerView.enterPip() before calling
     * enterPictureInPictureMode(). Cleared by MainActivity when
     * onPictureInPictureModeChanged fires. Bridges the race window where
     * onDetachedFromWindow runs before the PiP mode callback arrives.
     */
    @Volatile var isEnteringPip: Boolean = false

    /**
     * The view that owns PiP handling, held weakly so an unmounted player
     * screen can never pin the Activity through this singleton.
     */
    private var listenerRef: WeakReference<TvPlayerView>? = null

    fun setPipListener(view: TvPlayerView) {
        listenerRef = WeakReference(view)
    }

    fun clearPipListener(view: TvPlayerView) {
        if (listenerRef?.get() === view) listenerRef = null
    }

    /**
     * Called by MainActivity.onPictureInPictureModeChanged(). Routes the event
     * to the registered view if it is still alive and attached; a collected or
     * detached listener is skipped rather than invoked against dead state.
     */
    fun dispatchPipModeChanged(isInPip: Boolean) {
        val view = listenerRef?.get()
        if (view == null) {
            listenerRef = null
            return
        }
        if (!view.isAttachedToWindow) return
        view.onPipModeChangedFromSystem(isInPip)
    }
}
