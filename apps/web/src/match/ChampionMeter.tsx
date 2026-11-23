import { useEffect, useRef } from 'react';
import { CHAMP_TICKS } from '@lil-dudes/client';
import { haptic, sfx } from '../feel/sound';
import { useHud } from '../hud';
import type { MatchFeed } from './feed';
import './hud.css';

const RING_R = 33;
const RING_LEN = 2 * Math.PI * RING_R;

/**
 * The Champion meter by the thumb (rules v6). Not a button: every volley you fire charges it, and
 * once it is full, **letting go of the lane** launches the Champion (the sim does it on release).
 * Charging → a gold ring filling; full → it glows and says LET GO!; launched → it empties.
 */
export function ChampionMeter({ feed }: { feed: MatchFeed }) {
  // Re-render with the HUD (≤ 10 Hz) and read the meter straight from the feed.
  useHud((s) => s.tick);
  const lane = feed.me;
  const live = !!lane && lane.phase === 'fight';
  const full = !!lane && live && !lane.champPending && lane.champMeter >= CHAMP_TICKS;
  const wasFull = useRef(false);

  useEffect(() => {
    if (full && !wasFull.current) {
      sfx.champCharged();
      haptic('charged');
    }
    wasFull.current = full;
  }, [full]);

  if (!lane) return null;
  const k = Math.max(0, Math.min(1, lane.champMeter / CHAMP_TICKS));
  return (
    <div
      className={`champ ${full ? 'charged' : ''} ${lane.champPending ? 'pending' : ''} ${live ? '' : 'idle'}`}
      title={full ? 'Let go to launch your Champion' : 'Champion: charges while you fire'}
      aria-label={full ? 'Champion ready: let go to launch' : `Champion ${Math.round(k * 100)}% charged`}
    >
      <svg viewBox="0 0 80 80" aria-hidden>
        <circle className="champ-track" cx="40" cy="40" r={RING_R} />
        <circle
          className="champ-fill"
          cx="40"
          cy="40"
          r={RING_R}
          strokeDasharray={RING_LEN}
          strokeDashoffset={RING_LEN * (1 - k)}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <span className="champ-face">👑</span>
      {full && <span className="champ-tag">LET GO!</span>}
    </div>
  );
}
