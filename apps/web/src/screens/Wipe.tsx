import { useApp } from '../store';
import './flow.css';

/**
 * The logo wipe (SPEC v5 §8): two candy panels close over the screen with our logo (0.8 s), the
 * screen swaps underneath, then they open (0.35 s). Timing lives in the store's `go()`; this only
 * draws the current state. It also eats taps while it's up.
 */
export function Wipe() {
  const wipe = useApp((s) => s.wipe);
  if (wipe === 'idle') return null;
  return (
    <div className={`wipe ${wipe}`} aria-hidden>
      <div className="wipe-half top">
        <i />
      </div>
      <div className="wipe-half bottom">
        <i />
      </div>
      <div className="wipe-logo">
        <img src="/brand/logo.webp" alt="" draggable={false} />
      </div>
    </div>
  );
}
