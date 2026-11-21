// OfflineSource: the real rules through the bundled WASM. Run: pnpm --filter @lil-dudes/client test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../src/constants';
import { MockSource, OfflineSource, simConstants, simRulesVersion } from '../src/index';
import type { MatchEvent, MatchView } from '../src/types';

/** Same match as `parity_match_digest` in crates/sim-wasm/src/lib.rs. */
const PARITY = { seed: 42n, botSeed: 7n, stake: 100_000_000, digest: 10953466201141477252n, tick: 1385 };

function playOut(src: OfflineSource, onTick?: (view: MatchView) => void) {
  let guard = 0;
  while (!src.view.result) {
    assert.ok(guard++ <= C.MATCH_TICKS, 'match did not end');
    onTick?.(src.view);
    src.step();
  }
}

test('TS constants equal the Rust constants in the WASM build', () => {
  const rust = simConstants();
  const ts = C as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(rust)) {
    assert.deepEqual(ts[name], value, `constants.ts ${name} != crates/sim ${name}`);
  }
  const tsOnly = new Set(['TICK_MS', 'cellOf']); // derived in TS
  for (const name of Object.keys(ts)) {
    if (!tsOnly.has(name)) assert.ok(name in rust, `constants.ts ${name} has no Rust counterpart`);
  }
});

test('bundled WASM is built from the current sim (parity digest)', () => {
  assert.equal(simRulesVersion(), 1);
  const src = new OfflineSource(PARITY);
  playOut(src);
  assert.equal(src.view.tick, PARITY.tick);
  assert.equal(src.digest(), PARITY.digest, 'packages/sim-wasm/pkg is stale: run packages/sim-wasm/build.sh');
  src.dispose();
});

test('a full match plays out with the real rules, the bot and every event type', () => {
  const src = new OfflineSource({ seed: 5n, botSeed: 6n, stake: 50_000_000 });
  const seen = new Map<MatchEvent['type'], number>();
  const rigPhases = new Set<number>(); // phases where my rig on cell 4 took
  const rigAllowed = new Set<number>(); // phases where their cell 4 is not gold
  let peeked = false;
  let ends = 0;
  let last: MatchView | null = null;
  src.subscribe((view, priv, events) => {
    for (const e of events) seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
    ends += events.filter((e) => e.type === 'end').length;
    if (priv.myRig === 4) rigPhases.add(view.phase);
    if (view.status === 'plant' && !view.sides[1].gates[4]!.gold) rigAllowed.add(view.phase);
    if (priv.myPeek) peeked = true;
    if (last) assert.ok(view.tick === last.tick + 1, 'one tick per step');
    for (const s of view.sides) {
      assert.ok(s.cohorts.length <= C.COHORT_CAP);
      assert.ok(s.hp >= 0 && s.hp <= C.HP_MAX);
      assert.equal(s.gates.length, C.CELLS);
      if (view.status === 'plant') assert.ok(s.gates.every((g) => g.gold || g.hint === 'none'));
    }
    assert.equal(view.sides[1].isBot, true);
    assert.equal(view.sides[0].isBot, false);
    last = view;
  });
  // A simple player: sweep the columns, rig cell 4 in every plant, peek cell 0 when allowed.
  playOut(src, (view) => {
    if (view.tick % 40 === 0) src.setAim(((view.tick / 40) % C.COLS) * C.COL_WIDTH + C.COL_WIDTH / 2);
    if (view.status === 'plant') src.rig(4);
    if (view.status === 'playing') src.peek(0);
  });
  const r = src.view.result!;
  assert.equal(ends, 1);
  assert.equal(src.view.status, 'ended');
  assert.ok(src.view.tick <= C.MATCH_TICKS);
  assert.equal(r.ko, src.view.sides.some((s) => s.hp === 0));
  if (r.winner === null) assert.equal(r.moved, 0);
  else assert.ok(r.moved >= 25_000_000 && r.moved <= 50_000_000 && r.fee === Math.floor((r.moved * 500) / 10_000));
  assert.deepEqual([...rigPhases].sort(), [...rigAllowed].sort());
  assert.ok(peeked);
  for (const type of ['plant', 'volley', 'reveal', 'gate', 'clash', 'hit', 'end'] as const) {
    assert.ok((seen.get(type) ?? 0) > 0, `no ${type} events`);
  }
});

test('same seeds and inputs give the same match through the TS layer', () => {
  const run = () => {
    const src = new OfflineSource({ seed: 11n, botSeed: 12n });
    playOut(src, (view) => {
      if (view.tick % 25 === 0) src.setAim((view.tick * 37) % C.LANE_WIDTH);
    });
    return { digest: src.digest(), view: JSON.stringify(src.view) };
  };
  assert.deepEqual(run(), run());
});

test('invalid inputs are ignored safely', () => {
  const src = new OfflineSource({ seed: 1n, botSeed: 1n });
  for (const cell of [256, -1, 9, 2.5, Number.NaN, Infinity]) {
    src.rig(cell);
    src.peek(cell);
  }
  src.setAim(1e12);
  src.step();
  src.setAim(Number.NaN);
  src.step();
  assert.equal(src.view.sides[0].aimX, C.LANE_WIDTH - 1);
  assert.equal(src.view.sides[0].rigUsed, false);
});

test('start() ticks on a timer and stops at the end', async () => {
  const src = new OfflineSource({ seed: 3n, botSeed: 4n, speed: 1000 });
  const ended = new Promise<MatchView>((resolve) =>
    src.subscribe((view) => {
      if (view.result) resolve(view);
    }),
  );
  src.start();
  const view = await ended;
  assert.ok(view.result);
  const tick = src.view.tick;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(src.view.tick, tick, 'stopped');
});

test('MockSource still works', () => {
  const src = new MockSource({ startTick: C.SURGE_TICK });
  let guard = 0;
  let end = false;
  src.subscribe((_v, _p, events) => {
    end ||= events.some((e) => e.type === 'end');
  });
  while (!end && guard++ < C.MATCH_TICKS) src.step();
  assert.ok(end);
});
