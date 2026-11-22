// The live feed's event reconstruction (live/events.ts) vs the sim's own events, through whole
// offline matches decoded from the on-chain byte layout; and the v3 Peek account decoder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePublic, type PublicState } from '../src/codec';
import { decodePeek, PEEK_LEN, peekPrivateView } from '../src/live/chain';
import { diffEvents } from '../src/live/events';
import { OfflineSource } from '../src/index';
import type { MatchEvent, Side } from '../src/types';

const opKey = (op: { kind: string; value: number }) => `${op.kind}${op.value}`;

/** Events that must match one for one (always). */
function exactKey(e: MatchEvent, prev: PublicState): string | null {
  switch (e.type) {
    case 'volley':
      return `volley:${e.side}:${e.cohortId}:${e.x}:${e.count}`;
    case 'wave':
      // A merged wave (into an existing enemy cohort) is approximate in the feed.
      return prev.sides[e.side].enemies.some((x) => x.id === e.cohortId) ? null : `wave:${e.side}:${e.tower}:${e.cohortId}:${e.count}`;
    case 'stage':
      return `stage:${e.side}:${e.stage}:${e.phase}`;
    case 'death':
      return `death:${e.side}`;
    case 'end':
      return `end:${JSON.stringify(e.result)}`;
    case 'towerDown':
      return `towerDown:${e.side}:${e.tower}:${e.gold}`;
    default:
      return null;
  }
}

/** Events that must match one for one unless the lane changed stage in that tick. */
function laneKey(e: MatchEvent): string | null {
  switch (e.type) {
    case 'reveal':
      return `reveal:${e.side}:${e.stage}:${e.slot}:${opKey(e.op)}`;
    case 'gotcha':
      return `gotcha:${e.side}:${e.stage}:${e.slot}:${e.riggedBy}`;
    case 'gate':
      return `gate:${e.side}:${e.slot}:${e.cohortId}:${e.before}:${e.after}`;
    case 'crate':
      return `crate:${e.side}:${e.index}:${e.hp}:${e.broken}`;
    default:
      return null;
  }
}

/** Summed per lane (or tower): the feed reports one event per snapshot. */
function sums(events: MatchEvent[]) {
  const out: Record<string, number> = {};
  const add = (k: string, n: number) => (out[k] = (out[k] ?? 0) + n);
  for (const e of events) {
    if (e.type === 'towerHit') add(`towerHit:${e.side}:${e.tower}`, e.damage);
    if (e.type === 'loot') add(`loot:${e.side}`, e.gold);
    if (e.type === 'clash') add(`clash:${e.side}`, e.killed);
  }
  return out;
}

const sorted = (xs: (string | null)[]) => xs.filter((x): x is string => x !== null).sort();

test('diffEvents reconstructs the sim events of whole matches', () => {
  let ticks = 0;
  const seen = new Set<string>();
  // Side 0 aims at an unbroken crate if its stage has one, else at the nearest enemy.
  const crateHunter = (src: OfflineSource) => {
    const me = src.view.sides[0];
    const crate = me.crates.find((c) => c.hp > 0);
    const foe = me.enemies.reduce<{ x: number; y: number } | null>((a, e) => (!a || e.y < a.y ? e : a), null);
    src.setAim(foe && foe.y < 4000 ? foe.x : (crate?.x ?? 1500));
  };
  const runs: { seed: bigint; botSeed: bigint; selfBot?: boolean; drive?: (src: OfflineSource) => void }[] = [
    { seed: 3n, botSeed: 21n, selfBot: true },
    { seed: 11n, botSeed: 77n, selfBot: true },
    { seed: 2026n, botSeed: 5n, selfBot: true },
    { seed: 8n, botSeed: 1n, selfBot: true },
    { seed: 42n, botSeed: 7n }, // idle side 0 dies
    { seed: 1n, botSeed: 2n, drive: crateHunter },
    { seed: 2n, botSeed: 3n, drive: crateHunter },
  ];
  for (const opts of runs) {
    const src = new OfflineSource(opts);
    let prev = decodePublic(src.publicBytes());
    let got: MatchEvent[] = [];
    src.subscribe((_v, _p, events) => (got = events));
    while (!src.view.result) {
      opts.drive?.(src);
      src.step();
      const next = decodePublic(src.publicBytes());
      const derived = diffEvents(prev, next);
      const at = `seed ${opts.seed} tick ${next.tick}`;
      assert.deepEqual(sorted(derived.map((e) => exactKey(e, prev))), sorted(got.map((e) => exactKey(e, prev))), at);
      const moved = new Set(([0, 1] as Side[]).filter((s) => prev.sides[s].stage !== next.sides[s].stage || prev.sides[s].phase !== next.sides[s].phase));
      const lane = (es: MatchEvent[]) => sorted(es.filter((e) => 'side' in e && !moved.has(e.side)).map(laneKey));
      assert.deepEqual(lane(derived), lane(got), at);
      // Sums: tower damage and loot always; clash unless a wave merged into a cohort that clashed.
      const merged = new Set(got.filter((e) => e.type === 'wave' && prev.sides[e.side].enemies.some((x) => x.id === e.cohortId)).map((e) => (e as { side: Side }).side));
      const want = sums(got);
      const have = sums(derived);
      for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) {
        if (k.startsWith('clash:') && merged.has(Number(k.slice(6)) as Side)) continue;
        assert.equal(have[k] ?? 0, want[k] ?? 0, `${at}: ${k}`);
      }
      for (const e of got) seen.add(e.type);
      prev = next;
      ticks++;
    }
    src.dispose();
  }
  assert.ok(ticks > 3000, `${ticks} ticks`);
  for (const type of ['volley', 'reveal', 'gate', 'gotcha', 'crate', 'wave', 'clash', 'towerHit', 'towerDown', 'loot', 'stage', 'death', 'end']) {
    assert.ok(seen.has(type), `no ${type} events to compare`);
  }
});

test('diffEvents across multi-tick gaps: no duplicates of exact events, the end once', () => {
  const src = new OfflineSource({ seed: 5n, botSeed: 6n, selfBot: true });
  let prev = decodePublic(src.publicBytes());
  const volleys = new Set<number>();
  let ends = 0;
  let k = 0;
  while (!src.view.result) {
    src.step();
    if (++k % 3 !== 0 && !src.view.result) continue;
    const next = decodePublic(src.publicBytes());
    for (const e of diffEvents(prev, next)) {
      if (e.type === 'volley') {
        assert.ok(!volleys.has(e.cohortId));
        volleys.add(e.cohortId);
      }
      if (e.type === 'end') ends++;
    }
    prev = next;
  }
  assert.equal(ends, 1);
  assert.ok(volleys.size > 100);
  src.dispose();
});

test('decodePeek reads the v3 Peek account and peekPrivateView keeps only my current stage', () => {
  const data = new Uint8Array(PEEK_LEN);
  const set = (i: number, v: number) => (data[8 + i] = v);
  set(40, 1); // side
  for (const i of [41, 42, 44]) set(i, 255);
  assert.deepEqual(decodePeek(data), { side: 1, stage: null, rig: null, peek: null });
  assert.deepEqual(peekPrivateView(decodePeek(data), 0), { myRig: null, myPeek: null });
  // Rigged in my stage 1: the opponent's stage 2, slot 3; peeked my slot 4 in stage 1: ÷2.
  set(41, 1);
  set(42, 2);
  set(43, 3);
  set(44, 1);
  set(45, 4);
  set(46, 0x82);
  const acc = decodePeek(data);
  assert.deepEqual(acc, { side: 1, stage: 1, rig: { stage: 2, slot: 3 }, peek: { stage: 1, slot: 4, op: { kind: 'div', value: 2 } } });
  assert.deepEqual(peekPrivateView(acc, 1), { myRig: { stage: 2, slot: 3 }, myPeek: { stage: 1, slot: 4, op: { kind: 'div', value: 2 } } });
  assert.deepEqual(peekPrivateView(acc, 2), { myRig: null, myPeek: null }, 'stale entries');
  // A Peek left over from an earlier stage (the program can't write it on a stage change).
  set(41, 0);
  assert.deepEqual(peekPrivateView(decodePeek(data), 1), { myRig: null, myPeek: null }, 'Peek.stage != my stage');
  set(41, 1);
  set(46, 6);
  assert.deepEqual(decodePeek(data).peek?.op, { kind: 'mul', value: 6 });
  assert.throws(() => decodePeek(data.subarray(0, 40)));
});
