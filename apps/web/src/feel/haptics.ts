// Phone vibration on big moments only (a tap, the Champion charging, breach / overrun / payout).
// Uses `navigator.vibrate` where it exists (Android browsers; iOS Safari has none and stays still).
// Off on desktops without touch, and off when the player turns it off in the match cog menu,
// which writes localStorage['ldgb.vibe'] = 'off'. Separate from the sound toggle on purpose.

export type HapticKind = 'tap' | 'charged' | 'big';

const VIBE_KEY = 'ldgb.vibe';

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 15,
  charged: 40,
  big: [80, 40, 60], // buzz, gap, smaller buzz: reads as a "thud" rather than a long drone
};

/** True on a touch device whose browser can vibrate. */
export function vibeSupported(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return coarse || navigator.maxTouchPoints > 0;
}

export function vibeEnabled(): boolean {
  try {
    return localStorage.getItem(VIBE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setVibeEnabled(on: boolean) {
  try {
    localStorage.setItem(VIBE_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode etc.: nothing to remember */
  }
}

/** Vibrate for a big moment. Silently does nothing where unsupported, off, or before a user gesture. */
export function haptic(kind: HapticKind) {
  if (!vibeSupported() || !vibeEnabled()) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* some browsers throw when blocked: fine */
  }
}
