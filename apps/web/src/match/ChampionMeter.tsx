import { useEffect, useRef } from 'react';
import * as client from '@lil-dudes/client';
import type { LaneView, MatchSource } from '@lil-dudes/client';
import { haptic, sfx } from '../feel/sound';
import { useHud } from '../hud';
import type { MatchFeed } from './feed';
import './hud.css';

/**
 * Champion data a v5 lane carries (SPEC v5 §4, §9). Typed here so the button lights up as soon as
 * the v5 client sends it; a v4 lane has none of it and the button stays hidden.
 */
interface ChampLane {
  /** Fills 1 per fight tick while alive; full at CHAMP_TICKS. Carries from Fight 1 into Fight 2. */
  champMeter: number;
  /** Fired, waiting for the next volley to spawn the Champion. */
  champPending?: boolean;
}

/** A v5 source: `champion()` makes my next volley a Champion cohort (burner-signed on chain). */
interface ChampSource extends MatchSource {
  champion(): void;
}

/** Full meter, in ticks: the v5 client's `CHAMP_TICKS` when exported, else the spec's 160 (8 s). */
const CHAMP_FULL: number = (client as unknown as { CHAMP_TICKS?: number }).CHAMP_TICKS ?? 160;
const RING_R = 33;
const RING_LEN = 2 * Math.PI * RING_R;

function champLane(lane: LaneView | null): (LaneView & ChampLane) | null {
  return lane && 'champMeter' in lane ? (lane as LaneView & ChampLane) : null;
}

function champSource(source: MatchSource): ChampSource | null {
  return typeof (source as Partial<ChampSource>).champion === 'function' ? (source as ChampSource) : null;
}

/**
 * The Champion: a round button by the thumb with a circular charge meter. Renders nothing until
 * the lane view has champion data and the source can fire it.
 */
export function ChampionButton({ feed }: { feed: MatchFeed }) {
  // Re-render with the HUD (≤ 10 Hz) and read the meter straight from the feed.
  useHud((s) => s.tick);
  const lane = champLane(feed.me);
  const source = champSource(feed.source);
  const full = !!lane && lane.champMeter >= CHAMP_FULL;
  const wasFull = useRef(false);

  useEffect(() => {
    if (full && !wasFull.current) {
      sfx.champCharged();
      haptic('charged');
    }
    wasFull.current = full;
  }, [full]);

  if (!lane || !source) return null;
  const k = Math.max(0, Math.min(1, lane.champMeter / CHAMP_FULL));
  const pending = !!lane.champPending;
  const live = lane.phase !== 'dead' && lane.phase !== 'done';
  const ready = full && live && !pending;
  return (
    <button
      className={`champ ${ready ? 'charged' : ''} ${pending ? 'pending' : ''}`}
      disabled={!ready}
      onClick={() => {
        if (!ready) return;
        source.champion();
        sfx.champLaunch();
      }}
      title={ready ? 'Launch your Champion' : 'Champion charging'}
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
    </button>
  );
}
