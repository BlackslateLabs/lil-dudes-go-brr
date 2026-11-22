import { useEffect } from 'react';
import type { MatchView, Side } from '@lil-dudes/client';
import { sfx } from '../feel/sound';
import { HUD_RESET, useHud } from '../hud';
import { useApp } from '../store';
import type { MatchFeed } from './feed';

const RESULT_DELAY_MS = 2200;

/** Drives the HUD store, sound and the end-of-match hand-off from a feed. For the real match only. */
export function useMatchHud(feed: MatchFeed) {
  useEffect(() => {
    const hud = useHud.getState();
    hud.set({ ...HUD_RESET });
    const me = feed.mySide;
    const them = (1 - me) as Side;
    let lastHud = 0;
    let endTimer: ReturnType<typeof setTimeout> | undefined;

    const total = (v: MatchView, s: Side) => v.sides[s].cohorts.reduce((n, c) => n + c.count, 0);

    const offView = feed.onView((v) => {
      const now = performance.now();
      if (now - lastHud < 100 && v.status !== 'ended') return;
      lastHud = now;
      hud.set({
        tick: v.tick,
        status: v.status,
        phase: v.phase,
        surge: v.surge,
        stake: v.stake,
        names: [v.sides[me].name, v.sides[them].name],
        totals: [total(v, me), total(v, them)],
        rigUsed: v.sides[me].rigUsed,
        peekUsed: v.sides[me].peekUsed,
      });
    });

    const offEvents = feed.onEvent((e, v) => {
      switch (e.type) {
        case 'volley':
          if (e.side === me) sfx.shot();
          break;
        case 'reveal':
          sfx.gate(e.gold ? e.op.kind === 'mul' : e.op.kind === 'mul' || e.op.kind === 'add');
          break;
        case 'clash':
          sfx.clash();
          break;
        case 'hit':
          sfx.hit(e.side === me);
          break;
        case 'gotcha':
          sfx.gotcha();
          hud.set({ gotcha: { onMe: e.side === me, at: performance.now() } });
          break;
        case 'redeal':
          hud.set({ peeking: false });
          break;
        case 'surge':
          hud.set({ surgeAt: performance.now() });
          break;
        case 'end': {
          if (e.result.ko) sfx.ko();
          const won = e.result.winner === null ? null : e.result.winner === me;
          hud.set({ ended: { ko: e.result.ko, won } });
          useApp.getState().setLastMatch({
            result: e.result,
            mySide: me,
            hp: [v.sides[me].hp, v.sides[them].hp],
            names: [v.sides[me].name, v.sides[them].name],
            stake: v.stake,
          });
          endTimer = setTimeout(() => useApp.getState().go('result'), RESULT_DELAY_MS);
          break;
        }
      }
    });

    return () => {
      offView();
      offEvents();
      if (endTimer) clearTimeout(endTimer);
    };
  }, [feed]);
}
