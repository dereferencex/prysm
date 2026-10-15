// Shared flag between the app-level orientation policy (App.tsx) and the
// in-player rotate control. When the user explicitly rotates via the player
// button, the app must not re-apply its "unlock so the sensor decides" policy
// on player state changes (e.g. switching channels), otherwise the manual
// landscape lock would be silently dropped.

let manualLockActive = false;

export function setManualOrientationLock(active: boolean): void {
  manualLockActive = active;
}

export function isManualOrientationLockActive(): boolean {
  return manualLockActive;
}
