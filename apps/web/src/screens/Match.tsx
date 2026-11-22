import { useRef, useState, type PointerEvent } from 'react';
import {
  LANE_WIDTH,
  MATCH_TICKS,
  MockSource,
  PLANT_STARTS,
  PLANT_TICKS,
  TICKS_PER_SEC,
} from '@lil-dudes/client';
import { Arena } from '../arena/Arena';
import { setSoundEnabled, soundEnabled } from '../feel/sound';
import { useHud } from '../hud';
import { useFeed } from '../match/useFeed';
import { useMatchHud } from '../match/useMatchHud';

/** Finger travel (fraction of screen width) that sweeps the cannon across the whole lane. */
const DRAG_SPAN = 0.7;

/** Match screen. Driven by Kai's MockSource until OfflineSource (WASM) lands; then a one-line swap. */
export function Match() {
  const feed = useFeed(() => {
    // `?tick=2100` starts the mock at that tick (e.g. Surge), for testing.
    const t = Number(new URLSearchParams(window.location.search).get('tick'));
    return new MockSource({ startTick: Number.isFinite(t) && t > 0 ? t : 0 });
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
    const dir = feed.mySide === 0 ? 1 : -1; // side 1 sees the lane mirrored
    feed.nudgeAim((dxPx / (width * DRAG_SPAN)) * LANE_WIDTH * dir);
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
      <Prompts />
      <Overlays />
      <ThumbControls />
    </div>
  );
}

function TopBar() {
  const { names, totals, tick, status, phase, stake } = useHud();
  const left = Math.max(0, Math.ceil((MATCH_TICKS - tick) / TICKS_PER_SEC));
  return (
    <div className="hud topbar">
      <div className="who me">
        <b>{names[0]}</b>
        <span className="pill">{totals[0]}</span>
      </div>
      <div className="centre">
        <div className="timer">{status === 'ended' ? '0:00' : formatTime(left)}</div>
        <div className="meta">
          <span>{stake > 0 ? `${stake / 1e9} SOL` : 'FREE'}</span>
          <span className="pips">
            {[0, 1, 2].map((i) => (
              <i key={i} className={i < phase ? 'done' : i === phase ? 'on' : ''} />
            ))}
          </span>
        </div>
      </div>
      <div className="who them">
        <span className="pill">{totals[1]}</span>
        <b>{names[1]}</b>
      </div>
    </div>
  );
}

/** One-line prompts just above your cannon (TECH §5). */
function Prompts() {
  const { status, phase, tick, rigUsed, peeking } = useHud();
  let text: string | null = null;
  if (status === 'plant') {
    const end = (PLANT_STARTS[phase as 0 | 1 | 2] ?? 0) + PLANT_TICKS;
    const secs = Math.max(1, Math.ceil((end - tick) / TICKS_PER_SEC));
    text = rigUsed ? `Rig set! Fire in ${secs}…` : `Tap one of their gates to rig it · ${secs}`;
  } else if (peeking) {
    text = 'Tap one of your ? gates to peek';
  }
  return text ? <div className="hud prompt">{text}</div> : null;
}

function Overlays() {
  const { gotcha, surgeAt, ended } = useHud();
  return (
    <>
      {gotcha && (
        <div key={gotcha.at} className={`gotcha ${gotcha.onMe ? 'bad' : 'good'}`}>
          <span>GOTCHA!</span>
          <small>{gotcha.onMe ? 'you ran into their rig' : 'they ran into your rig'}</small>
        </div>
      )}
      {surgeAt && !ended && (
        <div key={surgeAt} className="banner-pop surge">
          SURGE!
        </div>
      )}
      {ended && (
        <div className={`banner-pop end ${ended.won === null ? '' : ended.won ? 'good' : 'bad'}`}>
          {ended.ko ? 'K.O.!' : 'TIME!'}
        </div>
      )}
    </>
  );
}

/** Bottom-right, by the thumb: peek (one per phase) and sound. */
function ThumbControls() {
  const { peekUsed, peeking, status, set } = useHud();
  const [sound, setSound] = useState(soundEnabled());
  const canPeek = !peekUsed && status === 'playing';
  return (
    <div className="hud thumb" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className={`round ${peeking ? 'on' : ''}`}
        disabled={!canPeek && !peeking}
        onClick={() => set({ peeking: !peeking })}
        title="Peek at one of your gates (once per phase)"
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
