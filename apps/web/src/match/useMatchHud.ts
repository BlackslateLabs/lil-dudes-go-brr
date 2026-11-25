import { useEffect } from 'react';
import { FINAL_STAGE, LANE_LENGTH, opBad, RUSH_TICKS, STAGES, TICKS_PER_SEC, stageDef, type LanePhase, type LaneView, type Side } from '@lil-dudes/client';
import { haptic, setBattleDuck, sfx } from '../feel/sound';
import { HUD_RESET, useHud, type RaceTrack } from '../hud';
import { useApp, type ScoreParts } from '../store';
import type { MatchFeed } from './feed';

/** After the last end stamp (TIME!, OVERRUN!, THEY FELL!), hold this long before the result. */
const END_HOLD_MS = 2400;
/** An enemy this close to my cannon line (fraction of the lane) is a danger. */
const DANGER_Y = LANE_LENGTH * 0.25;
/** The danger cue repeats at most this often. */
const DANGER_COOLDOWN_MS = 2000;
/** One ENEMY CHAMPION! stamp per wave (a wave from two towers brings two at once). */
const FOE_CHAMP_COOLDOWN_MS = 1500;

/** Length of the post-breach clock: the Rush (`RUSH_TICKS` = 70, 3.5 s). */
export const RUSH_LEN: number = RUSH_TICKS;

/** Ticks since this lane's breach. */
export function rushClock(lane: LaneView): number {
  return lane.rushTicks;
}

/** The lane is in its post-breach phase (the Rush). */
export function isBreach(phase: LanePhase | string): boolean {
  return phase === 'rush';
}

const emptyParts = (): ScoreParts => ({ damage: 0, towers: 0, first: 0, rush: 0 });

/** One side's race track from its public lane state (both sides play `layout`). */
export function raceTrack(lane: LaneView, layout: number): RaceTrack {
  const towers: number[] = [];
  const down: number[] = [];
  const over = lane.phase === 'rush' || lane.phase === 'done';
  let got = 0;
  for (let s = 0; s < STAGES; s++) {
    const n = stageDef(layout, s).towers.length;
    towers.push(n);
    let d = 0;
    if (over || s < lane.stage) d = n;
    else if (s === lane.stage && lane.phase !== 'transit') {
      for (const t of lane.towers) {
        if (t.hp <= 0) d++;
        else if (t.maxHp > 0) got += 1 - t.hp / t.maxHp;
      }
    }
    down.push(d);
    got += d;
  }
  const hall = lane.phase === 'done' ? 2 : lane.phase === 'rush' ? 1 : 0;
  got += hall === 2 ? 1 : hall === 1 ? 0.5 : 0;
  const total = towers.reduce((a, b) => a + b, 0) + 1;
  return { towers, down, hall, dead: lane.phase === 'dead', fill: Math.min(1, got / total) };
}

/** How many fights a side has cleared (all of a stage's towers down; the breach clears the last). */
function cleared(lane: LaneView): number {
  if (lane.phase === 'rush' || lane.phase === 'done') return STAGES;
  const all = lane.towers.length > 0 && lane.towers.every((t) => t.hp <= 0) && lane.phase !== 'transit';
  return lane.stage + (all ? 1 : 0);
}

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
    // Fights cleared per side (indexed by Side), for the race toasts; null until the first view.
    let clearedBy: [number, number] | null = null;
    // Enemy giants ("enemy Champions", SPEC_V5 §16) already called out, by cohort id.
    const foeChamps = new Set<number>();
    let lastFoeChamp = -Infinity;

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

      // An enemy Champion (a giant cohort) just left a tower in my lane: stamp it once.
      for (const c of a.enemies) {
        if (!c.giant || foeChamps.has(c.id)) continue;
        foeChamps.add(c.id);
        if (alive && now - lastFoeChamp >= FOE_CHAMP_COOLDOWN_MS && s.breachAt === null) {
          lastFoeChamp = now;
          banner('ENEMY CHAMPION!', 'bad');
          sfx.danger();
          haptic('big');
        }
      }

      // The race: a toast when a side clears a fight before the other.
      const ca = cleared(a);
      const cb = cleared(b);
      if (clearedBy && v.status !== 'ended') {
        if (ca > clearedBy[me] && ca > cb && a.phase !== 'dead') {
          hud.set({ toast: { text: `You cleared Fight ${ca} first!`, tone: 'good', at: now } });
        } else if (cb > clearedBy[them] && cb > ca && b.phase !== 'dead') {
          hud.set({ toast: { text: `${b.name} cleared Fight ${cb}!`, tone: 'bad', at: now } });
        }
      }
      clearedBy = me === 0 ? [ca, cb] : [cb, ca];

      if (now - lastHud < 100 && v.status !== 'ended') return;
      lastHud = now;
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
        race: [raceTrack(a, v.layout), raceTrack(b, v.layout)],
        peekUsed: a.peekUsed,
        hallCount: hall,
      });
    });

    const offEvents = feed.onEvent((e, v) => {
      const mine = 'side' in e && e.side === me;
      switch (e.type) {
        case 'volley':
          if (mine) sfx.shot();
          if (mine && e.champion) {
            banner('CHAMPION!', 'gold');
            sfx.champLaunch();
            haptic('big');
          }
          break;
        case 'reveal':
          if (mine) sfx.gate(!opBad(e.op));
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
          // The Rush count (2 per dude into the hall).
          parts[e.side].rush += e.gold;
          if (mine) {
            sfx.loot();
            hall += e.count;
          }
          break;
        case 'first':
          parts[e.side].first += e.gold;
          if (mine) banner('FIRST! +' + e.gold, 'gold');
          break;
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
            opponentIsBot: v.sides[them].isBot,
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
