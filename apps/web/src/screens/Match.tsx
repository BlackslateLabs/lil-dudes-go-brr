import { useRef, useState, type PointerEvent } from 'react';
import { LANE_WIDTH, MATCH_TICKS, OfflineSource, PLANT_TICKS, RAID_TICKS, STAGES, TICKS_PER_SEC } from '@lil-dudes/client';
import { Arena } from '../arena/Arena';
import { setSoundEnabled, soundEnabled } from '../feel/sound';
import { useHud } from '../hud';
import { MiniLane } from '../match/MiniLane';
import { Tutorial } from '../match/Tutorial';
import type { MatchFeed } from '../match/feed';
import { canRig } from '../match/rig';
import { useFeed } from '../match/useFeed';
import { useMatchHud } from '../match/useMatchHud';

/** Finger travel (fraction of screen width) that sweeps the cannon across the whole lane. */
const DRAG_SPAN = 0.7;
const STAGE_LABELS = Array.from({ length: STAGES }, (_, i) => `Fight ${i + 1}`);

/** Match screen (MVP §3.6, v3): your lane full size, the opponent's lane as a mini-view. */
export function Match() {
  const feed = useFeed(() => {
    // `?seed=123` replays a specific match (testing); the seed also picks the layout.
    // `?autoplay=1` lets the bot drive your side too (demos, screenshots).
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    const seed = raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
    const selfBot = params.get('autoplay') === '1';
    // `?speed=4` plays the match faster (testing, screenshots). Clamped to 1–16.
    const speedRaw = Number(params.get('speed'));
    const speed = Number.isFinite(speedRaw) && speedRaw >= 1 ? Math.min(16, speedRaw) : 1;
    return new OfflineSource(seed === undefined ? { myName: 'You', selfBot, speed } : { myName: 'You', selfBot, speed, seed });
  });
  useMatchHud(feed);

  const drag = useRef<{ x: number } | null>(null);
  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dxPx = e.clientX - drag.current.x;
    drag.current.x = e.clientX;
    const width = e.currentTarget.getBoundingClientRect().width;
    feed.nudgeAim((dxPx / (width * DRAG_SPAN)) * LANE_WIDTH);
  };
  const onUp = () => {
    if (drag.current) feed.flushAim();
    drag.current = null;
  };

  return (
    <div
      className="screen match"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
    >
      <Arena feed={feed} interactive />
      <TopBar />
      <div className="mini-wrap">
        <MiniLane feed={feed} />
      </div>
      <Tutorial feed={feed} />
      <Prompts />
      <Overlays />
      <ThumbControls feed={feed} />
    </div>
  );
}

function StagePips({ stage, phase }: { stage: number; phase: string }) {
  return (
    <span className="pips" title={STAGE_LABELS[stage]}>
      {STAGE_LABELS.map((_, i) => (
        <i key={i} className={i < stage || phase === 'done' ? 'done' : i === stage ? 'on' : ''} />
      ))}
    </span>
  );
}

function TopBar() {
  const { names, gold, stage, phase, tick, status, stake } = useHud();
  const left = Math.max(0, Math.ceil((MATCH_TICKS - tick) / TICKS_PER_SEC));
  return (
    <div className="hud topbar">
      <div className="who me">
        <b>{names[0]}</b>
        <span className="pill gold">{gold[0]}</span>
        <StagePips stage={stage[0]} phase={phase[0]} />
      </div>
      <div className="centre">
        <div className="timer">{status === 'ended' ? '0:00' : formatTime(left)}</div>
        <div className="meta">
          <span>{stake > 0 ? `${stake / 1e9} SOL` : 'FREE'}</span>
        </div>
      </div>
      <div className="who them">
        {phase[1] === 'dead' ? <span className="tag dead">DEAD</span> : <StagePips stage={stage[1]} phase={phase[1]} />}
        <span className="pill gold">{gold[1]}</span>
        <b>{names[1]}</b>
      </div>
    </div>
  );
}

/** One-line prompts just above your cannon (TECH §5). */
function Prompts() {
  const { phase, myPhaseTick, raidTicks, peeking, rigging, names, stage } = useHud();
  let text: string | null = null;
  if (rigging) {
    text = `Tap a red gate: it becomes a trap on ${names[1]}'s side`;
  } else if (peeking) {
    text = 'Tap one of your ? gates to peek';
  } else if (phase[0] === 'plant') {
    const secs = Math.max(1, Math.ceil((PLANT_TICKS - myPhaseTick) / TICKS_PER_SEC));
    text = `${STAGE_LABELS[stage[0]]}: fire in ${secs}…`;
  } else if (phase[0] === 'raid') {
    const secs = Math.ceil((RAID_TICKS - raidTicks) / TICKS_PER_SEC);
    text = secs > 0 ? `Into the town hall! · ${secs}` : 'Into the town hall!';
  } else if (phase[0] === 'transit') {
    text = 'Stage cleared!';
  } else if (phase[0] === 'done') {
    text = phase[1] === 'done' || phase[1] === 'dead' ? 'Done!' : `Done! Waiting for ${names[1]}…`;
  }
  return text ? (
    <div className="hud prompt">
      <span>{text}</span>
    </div>
  ) : null;
}

function Overlays() {
  const { gotcha, banner, ended } = useHud();
  return (
    <>
      {banner && !ended && (
        <div key={banner.at} className={`banner-pop flash ${banner.tone}`}>
          {banner.text}
        </div>
      )}
      {gotcha && (
        <div key={gotcha.at} className={`gotcha ${gotcha.onMe ? 'bad' : 'good'}`}>
          <span>GOTCHA!</span>
          <small>{gotcha.onMe ? 'you ran into their rig' : 'they ran into your rig'}</small>
        </div>
      )}
      {ended && (
        <div className={`banner-pop end ${ended.won === null ? '' : ended.won ? 'good' : 'bad'}`}>
          {ended.died === 'me' ? 'OVERRUN!' : ended.died === 'them' ? 'THEY FELL!' : ended.won === null ? 'DRAW' : ended.won ? 'YOU WIN' : 'YOU LOSE'}
        </div>
      )}
    </>
  );
}

/** Bottom-right, by the thumb: rig and peek (one each per stage) and sound. */
function ThumbControls({ feed }: { feed: MatchFeed }) {
  // The HUD fields re-render this at ≤ 10 Hz, so `canRig` (read from the feed) stays fresh.
  const { peekUsed, peeking, rigging, phase, set } = useHud();
  useHud((s) => s.tick);
  const [sound, setSound] = useState(soundEnabled());
  const canPeek = !peekUsed && (phase[0] === 'fight' || phase[0] === 'raid');
  const rigOk = canRig(feed);
  return (
    <div className="hud thumb" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className={`round rig ${rigging ? 'on' : ''}`}
        disabled={!rigOk && !rigging}
        onClick={() => set({ rigging: !rigging, peeking: false })}
        title="Rig one of your gates on their side (once per stage)"
      >
        😈
      </button>
      <button
        className={`round ${peeking ? 'on' : ''}`}
        disabled={!canPeek && !peeking}
        onClick={() => set({ peeking: !peeking, rigging: false })}
        title="Peek at one of your gates (once per stage)"
      >
        👁
      </button>
      <button
        className="round small"
        onClick={() => {
          setSoundEnabled(!sound);
          setSound(!sound);
        }}
        title={sound ? 'Sound on' : 'Sound off'}
      >
        {sound ? '🔊' : '🔈'}
      </button>
    </div>
  );
}

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
