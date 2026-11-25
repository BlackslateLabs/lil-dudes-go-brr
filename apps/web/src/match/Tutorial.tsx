import { useEffect, useState } from 'react';
import { CHAMP_TICKS, FINAL_STAGE, LANE_WIDTH } from '@lil-dudes/client';
import { isTutorialMatch, setTutorialDone, useApp } from '../store';
import type { MatchFeed } from './feed';
import '../screens/flow.css';

type StepId = 'fire' | 'aim' | 'gates' | 'tower' | 'champ' | 'defend' | 'breach';

const COPY: Record<StepId, string> = {
  fire: 'Hold the screen to fire',
  aim: 'Keep holding and drag to aim',
  gates: 'Gates multiply your dudes',
  tower: 'Break the tower',
  champ: 'Your cannon is glowing! Let go to launch your Champion',
  defend: "Don't let them reach you",
  breach: 'BREACH! Keep holding!',
};

/** Shown in this order; `champ`, `defend` and `breach` cut in when their moment comes. */
const ORDER: StepId[] = ['fire', 'aim', 'gates', 'tower', 'champ', 'defend', 'breach'];
const QUEUE: StepId[] = ['fire', 'aim', 'gates', 'tower'];
/** Cut-ins, most urgent first. */
const CUT_INS: StepId[] = ['breach', 'defend', 'champ'];
/** The green tick stays this long before the next bubble. */
const TICK_MS = 900;
/** Cut-in bubbles tick themselves off after this long if nothing else does. */
const DEFEND_MS = 4000;
const BREACH_MS = 2400;
/** Finger travel that counts as a drag. */
const DRAG_PX = 12;
/** The "same lane" cut-in above the race bar stays up this long (once, as the first fight starts). */
const RACE_MS = 4800;

interface Bubble {
  id: StepId;
  ticked: boolean;
}

/**
 * First-match tutorial (SPEC v5 §8): one bubble at a time above the cannon, each ticked off when
 * done. Only in the first bot match on this device (or "How to play"), never in `?autoplay=1`.
 * Sets `ldgb.tutorialDone` when the match ends.
 */
export function Tutorial({ feed }: { feed: MatchFeed }) {
  const [on] = useState(isTutorialMatch);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [doneCount, setDoneCount] = useState(0);
  const [raceUp, setRaceUp] = useState(false);

  useEffect(() => {
    if (!on) return;
    const me = feed.mySide;
    const done = new Set<StepId>();
    const cut = new Set<StepId>(); // cut-ins whose moment has come
    let shown: Bubble | null = null;
    let ended = false;
    let advanceTimer: ReturnType<typeof setTimeout> | undefined;
    let selfTickTimer: ReturnType<typeof setTimeout> | undefined;
    let startAim: number | null = null;
    let botMatch: boolean | null = null;
    let raceShown = false;
    let raceTimer: ReturnType<typeof setTimeout> | undefined;

    const show = (b: Bubble | null) => {
      shown = b;
      setBubble(b);
    };

    const next = () => {
      clearTimeout(advanceTimer);
      clearTimeout(selfTickTimer);
      if (ended) return show(null);
      const id = CUT_INS.find((s) => cut.has(s) && !done.has(s)) ?? QUEUE.find((s) => !done.has(s));
      // Queue steps wait their turn; once the queue is through, only cut-ins remain.
      show(id ? { id, ticked: false } : null);
      if (id === 'defend') selfTickTimer = setTimeout(() => complete('defend'), DEFEND_MS);
      if (id === 'breach') selfTickTimer = setTimeout(() => complete('breach'), BREACH_MS);
    };

    const complete = (id: StepId) => {
      if (done.has(id)) return;
      done.add(id);
      setDoneCount(done.size);
      if (shown?.id === id && !shown.ticked) {
        show({ id, ticked: true });
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(next, TICK_MS);
      }
    };

    const cutIn = (id: StepId) => {
      if (cut.has(id) || done.has(id)) return;
      cut.add(id);
      // Interrupt whatever is up (an untouched queue bubble comes back afterwards).
      next();
    };

    const offEvents = feed.onEvent((e) => {
      if (e.type === 'end') {
        ended = true;
        setTutorialDone();
        useApp.getState().setTutorialAgain(false);
        next();
        return;
      }
      if (!('side' in e) || e.side !== me) return;
      if (e.type === 'volley') complete(e.champion ? 'champ' : 'fire');
      else if (e.type === 'gate' || e.type === 'reveal') complete('gates');
      else if (e.type === 'towerDown') complete('tower');
      else if (e.type === 'wave') cutIn('defend');
      else if (e.type === 'clash' && shown?.id === 'defend') complete('defend');
    });

    const offView = feed.onView((v) => {
      if (botMatch === null) {
        // The tutorial is for bot matches only.
        botMatch = v.sides[feed.theirSide].isBot;
        if (!botMatch) {
          ended = true;
          return show(null);
        }
        next();
      }
      const lane = v.sides[me];
      // Right after the countdown: the Bot plays this exact lane too (points at the race bar).
      if (!raceShown && lane.phase === 'fight') {
        raceShown = true;
        setRaceUp(true);
        raceTimer = setTimeout(() => setRaceUp(false), RACE_MS);
      }
      if (startAim === null) startAim = lane.aimX;
      else if (Math.abs(lane.aimX - startAim) > LANE_WIDTH * 0.04) complete('aim');
      if (lane.phase === 'rush' && lane.stage === FINAL_STAGE) cutIn('breach');
      if (lane.phase === 'fight' && lane.champMeter >= CHAMP_TICKS && !lane.champPending) cutIn('champ');
    });

    // A finger drag anywhere counts as "aimed" right away (the source's aim lags a little).
    let downX: number | null = null;
    const onDown = (e: PointerEvent) => {
      downX = e.clientX;
    };
    const onMove = (e: PointerEvent) => {
      if (downX !== null && Math.abs(e.clientX - downX) > DRAG_PX) complete('aim');
    };
    const onUp = () => {
      downX = null;
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      offEvents();
      offView();
      clearTimeout(advanceTimer);
      clearTimeout(selfTickTimer);
      clearTimeout(raceTimer);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [on, feed]);

  if (!on) return null;
  return (
    <>
      {raceUp && (
        <div className="tut-race" role="status">
          <div className="tut-bubble">
            <span>
              The Bot is playing this exact lane right now. <b>Beat it to the towers!</b>
            </span>
          </div>
        </div>
      )}
      {bubble && <Bubbles bubble={bubble} doneCount={doneCount} />}
    </>
  );
}

function Bubbles({ bubble, doneCount }: { bubble: Bubble; doneCount: number }) {
  return (
    <div className="tut" aria-live="polite">
      <div key={bubble.id} className={`tut-bubble ${bubble.ticked ? 'ticked' : ''} ${bubble.id === 'breach' ? 'hot' : ''}`}>
        <i className="tut-check" aria-hidden />
        <span>{COPY[bubble.id]}</span>
      </div>
      <div className="tut-dots" aria-label={`${doneCount} of ${ORDER.length} done`}>
        {ORDER.map((s, i) => (
          <i key={s} className={i < doneCount ? 'on' : ''} />
        ))}
      </div>
    </div>
  );
}
