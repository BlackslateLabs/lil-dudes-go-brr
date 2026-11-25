import { useEffect, useState } from 'react';
import { isTutorialMatch, setTutorialDone, useApp } from '../store';
import type { MatchFeed } from './feed';
import '../screens/flow.css';

/** The "same lane" cut-in above the race bar stays up this long (once, as the first fight starts). */
const RACE_MS = 4800;

/**
 * First bot match on this device (or "How to play"): one cut-in as the first fight starts saying
 * the Bot plays this exact lane, pointing at the race bar. The step-by-step to-do bubbles are gone
 * (they got in the way); the match's own "Hold to fire!" prompt teaches the rest. Sets
 * `ldgb.tutorialDone` when the match ends.
 */
export function Tutorial({ feed }: { feed: MatchFeed }) {
  const [on] = useState(isTutorialMatch);
  const [raceUp, setRaceUp] = useState(false);

  useEffect(() => {
    if (!on) return;
    let botMatch: boolean | null = null;
    let raceShown = false;
    let raceTimer: ReturnType<typeof setTimeout> | undefined;

    const offEvents = feed.onEvent((e) => {
      if (e.type !== 'end') return;
      setTutorialDone();
      useApp.getState().setTutorialAgain(false);
    });

    const offView = feed.onView((v) => {
      // Only against the bot.
      if (botMatch === null) botMatch = v.sides[feed.theirSide].isBot;
      if (!botMatch || raceShown) return;
      if (v.sides[feed.mySide].phase === 'fight') {
        raceShown = true;
        setRaceUp(true);
        raceTimer = setTimeout(() => setRaceUp(false), RACE_MS);
      }
    });

    return () => {
      offEvents();
      offView();
      clearTimeout(raceTimer);
    };
  }, [on, feed]);

  if (!on || !raceUp) return null;
  return (
    <div className="tut-race" role="status">
      <div className="tut-bubble">
        <span>
          The Bot is playing this exact lane right now. <b>Beat it to the towers!</b>
        </span>
      </div>
    </div>
  );
}
