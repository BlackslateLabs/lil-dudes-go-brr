import { useEffect } from 'react';
import * as client from '@lil-dudes/client';
import { FINAL_STAGE, LANE_LENGTH, RAID_TICKS, TICKS_PER_SEC, type LanePhase, type LaneView, type Side } from '@lil-dudes/client';
import { haptic, setBattleDuck, sfx } from '../feel/sound';
import { HUD_RESET, useHud } from '../hud';
import { useApp, type ScoreParts } from '../store';
import type { MatchFeed } from './feed';

/** After the last end stamp (TIME!, OVERRUN!, THEY FELL!), hold this long before the result. */
const END_HOLD_MS = 2400;
/** An enemy this close to my cannon line (fraction of the lane) is a danger. */
const DANGER_Y = LANE_LENGTH * 0.25;
/** The danger cue repeats at most this often. */
const DANGER_COOLDOWN_MS = 2000;

/**
 * Length of the post-breach clock. v5 calls it the Rush (`RUSH_TICKS` = 70, 3.5 s); until the v5
 * client exports that, it is the v4 town hall raid (`RAID_TICKS`, 8 s).
 */
export const RUSH_LEN: number = (client as unknown as { RUSH_TICKS?: number }).RUSH_TICKS ?? RAID_TICKS;

/** Ticks since this lane's breach: v5 `rushTicks` when present, else the v4 `raidTicks`. */
export function rushClock(lane: LaneView): number {
  return 'rushTicks' in lane ? Number((lane as { rushTicks: unknown }).rushTicks) || 0 : lane.raidTicks;
}

/** The lane is in its post-breach phase (v4 'raid', v5 'rush'). */
export function isBreach(phase: LanePhase | string): boolean {
  return phase === 'raid' || phase === 'rush';
}

const emptyParts = (): ScoreParts => ({ damage: 0, towers: 0, first: 0, rush: 0 });

/** Drives the HUD store, sound and the end-of-match hand-off from a feed. For the real match only. */
export function useMatchHud(feed: MatchFeed) {
  useEffect(() => {
    const hud = useHud.getState();
    hud.set({ ...HUD_RESET });
    setBattleDuck(false);
    const me = feed.mySide;
    const them = feed.theirSide;
    let lastHud = 0;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let lastDanger = -Infinity;
    // Score parts per side (indexed by Side), tallied from events for the result ceremony.
    const parts: [ScoreParts, ScoreParts] = [emptyParts(), emptyParts()];
    let hall = 0;
    const banner = (text: string, tone: 'good' | 'bad' | 'gold') => hud.set({ banner: { text, tone, at: performance.now() } });

    /** TIME!: the Rush clock ran out (or the 3:00 cap). Once per match. */
    const stampTime = () => {
      if (useHud.getState().timeAt !== null) return;
      hud.set({ timeAt: performance.now(), countdown: 0 });
      sfx.countdown(0);
    };

    const offView = feed.onView((v) => {
      const now = performance.now();
      const a = v.sides[me];
      const b = v.sides[them];
      const s = useHud.getState();

      // End sequence (checked every tick so the countdown stays on the clock).
      if (a.phase === 'dead' && s.overrunAt === null) {
        hud.set({ overrunAt: now, danger: false });
        haptic('big');
        setBattleDuck(true);
      }
      if (isBreach(a.phase) && s.breachAt === null) {
        hud.set({ breachAt: now, peeking: false, banner: null });
        sfx.breach();
        haptic('big');
        setBattleDuck(true);
      }
      if (s.breachAt !== null || isBreach(a.phase)) {
        const left = RUSH_LEN - rushClock(a);
        if (left <= 0 || a.phase === 'done') stampTime();
        else if (s.timeAt === null && a.phase !== 'dead') {
          const secs = Math.ceil(left / TICKS_PER_SEC);
          const n = secs <= 3 ? secs : 0;
          if (n !== s.countdown) {
            hud.set({ countdown: n });
            if (n > 0) sfx.countdown(n);
          }
        }
      }

      // Danger: an enemy in the last quarter of my lane.
      const alive = a.phase !== 'dead' && a.phase !== 'done' && v.status !== 'ended';
      const danger = alive && a.enemies.some((c) => c.y <= DANGER_Y);
      if (danger !== s.danger) {
        hud.set({ danger });
        if (danger && now - lastDanger >= DANGER_COOLDOWN_MS) {
          lastDanger = now;
          sfx.danger();
        }
      }

      if (now - lastHud < 100 && v.status !== 'ended') return;
      lastHud = now;
      let hp = 0;
      let maxHp = 0;
      for (const t of b.towers) {
        hp += t.hp;
        maxHp += t.maxHp;
      }
      hud.set({
        tick: v.tick,
        status: v.status,
        stake: v.stake,
        names: [a.name, b.name],
        gold: [a.gold, b.gold],
        stage: [a.stage, b.stage],
        phase: [a.phase, b.phase],
        myPhaseTick: a.phaseTick,
        raidTicks: rushClock(a),
        theirTowers: maxHp > 0 ? hp / maxHp : 0,
        peekUsed: a.peekUsed,
        hallCount: hall,
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
          parts[e.side].damage += e.gold;
          if (mine) sfx.hit(false);
          break;
        case 'crate':
          if (mine) sfx.crate(e.broken);
          break;
        case 'towerDown':
          parts[e.side].towers += e.gold;
          if (mine) {
            sfx.towerDown();
            // The last Fight 2 tower is the BREACH! stamp instead.
            if (!v.sides[me].towers.every((t) => t.hp <= 0) || v.sides[me].stage < FINAL_STAGE) banner('TOWER DOWN', 'gold');
          }
          break;
        case 'loot':
          // v4 raid loot; v5's Rush count (2 per dude) arrives the same way.
          parts[e.side].rush += e.gold;
          if (mine) {
            sfx.loot();
            hall += e.count;
          }
          break;
        // TODO(v5 FIRST): when the client emits the FIRST bonus (an event like
        // `{ type: 'first', side, gold }`, or a `first` field on the lane), add it here:
        //   parts[e.side].first += e.gold;
        case 'stage':
          if (mine && e.phase === 'plant') {
            hud.set({ peeking: false });
            banner(`FIGHT ${e.stage + 1}`, 'good');
            sfx.fight();
          }
          if (!mine && e.phase === 'done' && useHud.getState().breachAt === null) banner(`${v.sides[them].name} finished`, 'bad');
          break;
        case 'death':
          sfx.ko();
          break;
        case 'end': {
          const now = performance.now();
          const won = e.result.winner === null ? null : e.result.winner === me;
          const died = e.result.died === null ? null : e.result.died === me ? 'me' : 'them';
          const s = useHud.getState();
          if (died === 'me' && s.overrunAt === null) {
            hud.set({ overrunAt: now });
            haptic('big');
          }
          // The 3:00 cap (nobody died, my Rush not over): stamp TIME! too.
          if (died === null) stampTime();
          setBattleDuck(true);
          hud.set({ ended: { won, died, at: now }, danger: false, hallCount: hall });
          if (won === true) sfx.win();
          else if (won === false) sfx.lose();
          if (import.meta.env.DEV) {
            for (const side of [0, 1] as Side[]) {
              const p = parts[side];
              const sum = p.damage + p.towers + p.first + p.rush;
              if (sum !== e.result.gold[side]) console.warn(`score parts of side ${side} sum to ${sum}, gold is ${e.result.gold[side]}`, p);
            }
          }
          useApp.getState().setLastMatch({
            result: e.result,
            mySide: me,
            names: [v.sides[me].name, v.sides[them].name],
            stake: v.stake,
            layoutName: v.layoutName,
            breakdown: [{ ...parts[0] }, { ...parts[1] }],
          });
          // Let the end sequence finish: hold after the latest stamp (TIME!, OVERRUN!, THEY FELL!).
          const fresh = useHud.getState();
          const last = Math.max(now, fresh.timeAt ?? 0, fresh.overrunAt ?? 0);
          endTimer = setTimeout(() => useApp.getState().go('result'), last + END_HOLD_MS - now);
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
