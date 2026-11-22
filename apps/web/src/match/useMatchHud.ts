import { useEffect } from 'react';
import { sfx } from '../feel/sound';
import { HUD_RESET, useHud } from '../hud';
import { useApp } from '../store';
import type { MatchFeed } from './feed';

const RESULT_DELAY_MS = 2200;
const STAGE_NAMES = ['FIGHT 1', 'FIGHT 2', 'RAID!'];

/** Drives the HUD store, sound and the end-of-match hand-off from a feed. For the real match only. */
export function useMatchHud(feed: MatchFeed) {
  useEffect(() => {
    const hud = useHud.getState();
    hud.set({ ...HUD_RESET });
    const me = feed.mySide;
    const them = feed.theirSide;
    let lastHud = 0;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const banner = (text: string, tone: 'good' | 'bad' | 'gold') => hud.set({ banner: { text, tone, at: performance.now() } });

    const offView = feed.onView((v) => {
      const now = performance.now();
      if (now - lastHud < 100 && v.status !== 'ended') return;
      lastHud = now;
      const a = v.sides[me];
      const b = v.sides[them];
      hud.set({
        tick: v.tick,
        status: v.status,
        stake: v.stake,
        names: [a.name, b.name],
        gold: [a.gold, b.gold],
        stage: [a.stage, b.stage],
        phase: [a.phase, b.phase],
        myPhaseTick: a.phaseTick,
        rigUsed: a.rigUsed,
        peekUsed: a.peekUsed,
      });
    });

    const offEvents = feed.onEvent((e, v) => {
      const mine = 'side' in e && e.side === me;
      switch (e.type) {
        case 'volley':
          if (mine) sfx.shot();
          break;
        case 'reveal':
          if (mine) sfx.gate(e.op.kind === 'mul');
          break;
        case 'clash':
          if (mine) sfx.clash();
          break;
        case 'wave':
          if (mine) sfx.wave();
          break;
        case 'towerHit':
          if (mine) sfx.hit(false);
          break;
        case 'towerDown':
          if (mine) {
            sfx.ko();
            banner('TOWER DOWN', 'gold');
          }
          break;
        case 'loot':
          if (mine) sfx.loot();
          break;
        case 'gotcha':
          sfx.gotcha();
          hud.set({ gotcha: { onMe: mine, at: performance.now() } });
          break;
        case 'stage':
          if (mine && (e.phase === 'plant' || e.phase === 'raid')) {
            hud.set({ peeking: false });
            if (e.phase === 'plant') banner(STAGE_NAMES[e.stage] ?? 'STAGE', e.stage === 2 ? 'gold' : 'good');
            if (e.phase === 'raid') banner('RAID!', 'gold');
          }
          if (!mine && e.phase === 'done') banner(`${v.sides[them].name} finished`, 'bad');
          break;
        case 'death':
          sfx.ko();
          break;
        case 'end': {
          const won = e.result.winner === null ? null : e.result.winner === me;
          const died = e.result.died === null ? null : e.result.died === me ? 'me' : 'them';
          hud.set({ ended: { won, died } });
          useApp.getState().setLastMatch({
            result: e.result,
            mySide: me,
            names: [v.sides[me].name, v.sides[them].name],
            stake: v.stake,
            layoutName: v.layoutName,
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
