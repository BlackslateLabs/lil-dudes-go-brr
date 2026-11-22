// OfflineSource: the real rules (v4) through the bundled WASM. Run: pnpm --filter @lil-dudes/client test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../src/constants';
import { crateOfGate, stageDef } from '../src/layout';
import { can_rig_bytes } from '@lil-dudes/sim-wasm';
import { MockSource, OfflineSource, simConstants, simRulesVersion } from '../src/index';
import type { MatchEvent, MatchView, PrivateView } from '../src/types';

/** Same match as `parity_match_digest` in crates/sim-wasm/src/lib.rs: bot on side 1, idle side 0
 *  (it dies at tick 209). */
const PARITY = { seed: 42n, botSeed: 7n, stake: 100_000_000, digest: 18_369_198_370_544_550_614n, tick: 209 };

function playOut(src: { view: MatchView; step(): void }, onTick?: (view: MatchView) => void) {
  let guard = 0;
  while (!src.view.result) {
    assert.ok(guard++ <= C.MATCH_TICKS, 'match did not end');
    onTick?.(src.view);
    src.step();
  }
}

const camel = (k: string) => k.replace(/_(.)/g, (_, c: string) => c.toUpperCase());
const camelKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(camelKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [camel(k), camelKeys(x)])) : v;

test('TS constants and layouts equal the Rust ones in the WASM build', () => {
  const rust = simConstants();
  const ts = C as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(rust)) {
    // The layout data uses camelCase keys in TS (x_min → xMin).
    assert.deepEqual(ts[name], name === 'LAYOUTS' ? camelKeys(value) : value, `constants.ts ${name} != crates/sim ${name}`);
  }
  const tsOnly = new Set(['TICK_MS']); // derived in TS
  for (const name of Object.keys(ts)) {
    if (!tsOnly.has(name)) assert.ok(name in rust, `constants.ts ${name} has no Rust counterpart`);
  }
});

test('bundled WASM is built from the current sim (parity digest)', () => {
  assert.equal(simRulesVersion(), 4);
  const src = new OfflineSource(PARITY);
  playOut(src);
  assert.equal(src.view.tick, PARITY.tick);
  assert.equal(src.digest(), PARITY.digest, 'packages/sim-wasm/pkg is stale: run packages/sim-wasm/build.sh');
  const r = src.view.result!;
  assert.deepEqual([r.winner, r.died, r.moved], [1, 0, PARITY.stake]);
  assert.equal(r.fee, Math.floor((PARITY.stake * C.FEE_BPS) / 10_000));
  assert.equal(src.view.sides[0].phase, 'dead');
  src.dispose();
});

/** Checks one view against the layout and the rules' invariants. */
function checkView(view: MatchView) {
  const layout = C.LAYOUTS[view.layout]!;
  assert.equal(view.layoutName, layout.name);
  for (const s of view.sides) {
    const st = stageDef(view.layout, s.stage);
    assert.ok(s.stage >= 0 && s.stage < C.STAGES);
    assert.ok(s.cohorts.length <= C.COHORT_CAP && s.enemies.length <= C.ENEMY_CAP);
    assert.equal(s.gates.length, st.gates.length);
    assert.equal(s.towers.length, st.towers.length);
    assert.equal(s.crates.length, st.crates.length);
    // v4: the town hall raid is Fight 2 with its towers down, in place.
    const raided = s.raidTicks > 0;
    if (raided) {
      assert.equal(s.stage, C.FINAL_STAGE);
      assert.ok(s.towers.every((t) => t.hp === 0), 'the raid starts when every tower is down');
    } else {
      assert.equal(s.raidGold, 0);
    }
    if (s.phase === 'raid' || s.phase === 'done') assert.equal(s.stage, C.FINAL_STAGE);
    if (s.phase === 'done') assert.ok(s.raidTicks >= C.RAID_TICKS && s.cohorts.length === 0 && s.enemies.length === 0);
    if (s.phase === 'plant' || s.phase === 'fight' || s.phase === 'transit') assert.equal(s.raidTicks, 0);
    assert.ok(s.raidGold <= s.gold);
    s.gates.forEach((g, slot) => {
      assert.equal(g.slot, slot);
      assert.equal(g.y, st.rows[st.gates[slot]!.row]);
      const crate = crateOfGate(st, slot);
      assert.equal(g.locked, g.big && crate >= 0 && s.crates[crate]!.hp > 0);
      if (!g.moving) assert.equal(g.x, st.gates[slot]!.x);
      if (g.revealed?.kind === 'mul') assert.ok(g.revealed.value >= 2 && g.revealed.value <= 10);
      if (g.revealed?.kind === 'div') assert.equal(g.revealed.value, 2);
    });
    if (s.phase === 'plant' || s.phase === 'transit') {
      assert.equal(s.cohorts.length + s.enemies.length, 0, 'no units in plant / transit');
      assert.ok(s.gates.every((g) => !g.revealed));
    }
    for (const t of s.towers) assert.ok(t.hp >= 0 && t.hp <= t.maxHp && t.y === C.TOWER_Y);
  }
}

test('whole bot-vs-bot matches: every event type, invariants, raid gold = loot', () => {
  const seen = new Map<MatchEvent['type'], number>();
  for (const seed of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]) {
    const src = new OfflineSource({ seed, botSeed: seed * 31n, stake: 50_000_000, selfBot: true });
    const loot: [number, number] = [0, 0];
    let ends = 0;
    let last: MatchView | null = null;
    src.subscribe((view, _priv, events) => {
      for (const e of events) {
        seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
        if (e.type === 'loot') loot[e.side] += e.gold;
        if (e.type === 'end') ends++;
        if (e.type === 'gotcha') assert.notEqual(e.side, e.riggedBy);
      }
      if (last) assert.equal(view.tick, last.tick + 1, 'one tick per step');
      checkView(view);
      assert.ok(view.sides.every((s) => s.isBot));
      last = view;
    });
    playOut(src);
    const v = src.view;
    const r = v.result!;
    assert.equal(ends, 1);
    assert.equal(v.status, 'ended');
    assert.ok(v.tick <= C.MATCH_TICKS);
    assert.deepEqual(r.gold, [v.sides[0].gold, v.sides[1].gold]);
    assert.deepEqual([v.sides[0].raidGold, v.sides[1].raidGold], loot);
    const dead = v.sides.map((s) => s.phase === 'dead');
    assert.equal(r.died, dead[0] !== dead[1] ? (dead[0] ? 0 : 1) : null);
    if (r.winner === null) assert.equal(r.moved, 0);
    else assert.equal(r.fee, Math.floor((r.moved * C.FEE_BPS) / 10_000));
    src.dispose();
  }
  for (const type of ['volley', 'reveal', 'gate', 'gotcha', 'crate', 'wave', 'clash', 'towerHit', 'towerDown', 'loot', 'stage', 'end'] as const) {
    assert.ok((seen.get(type) ?? 0) > 0, `no ${type} events`);
  }
});

test('a player rigs from their own lane and peeks in their fight (private view by stage and slot)', () => {
  const src = new OfflineSource({ seed: 9n, botSeed: 10n });
  let priv: PrivateView = { myRig: null, myPeek: null };
  src.subscribe((_v, p) => (priv = p));
  // Tick 0 is my plant: my gate slot 1 traps the same slot of the opponent's stage 0.
  const gates = stageDef(src.view.layout, 0).gates.length;
  assert.ok(src.canRig(1));
  assert.equal(src.canRig(gates), false, 'no such gate in my stage');
  src.rig(1);
  src.step();
  assert.deepEqual(priv.myRig, { stage: 0, slot: 1 });
  assert.equal(src.view.sides[0].rigUsed, true);
  assert.equal(src.canRig(0), false, 'once per stage');
  assert.equal(priv.myPeek, null);
  // A peek in the plant is refused (and not used up).
  src.peek(0);
  src.step();
  assert.equal(src.view.sides[0].peekUsed, false);
  while (src.view.sides[0].phase === 'plant') src.step();
  assert.equal(src.view.sides[0].phase, 'fight');
  src.peek(0);
  src.step();
  assert.equal(src.view.sides[0].peekUsed, true);
  const peek = (priv as PrivateView).myPeek;
  assert.deepEqual(src.priv.myPeek, peek);
  assert.equal(peek?.stage, 0);
  assert.equal(peek?.slot, 0);
  // The peeked value is the dealt one.
  assert.deepEqual(peek?.op, src.reveal().values[0]![0]);
  src.dispose();
});

test('a rig in my fight lands on their copy of my stage; canRig follows the v4 rule', () => {
  const src = new OfflineSource({ seed: 21n, botSeed: 22n });
  let priv: PrivateView = { myRig: null, myPeek: null };
  src.subscribe((_v, p) => (priv = p));
  while (src.view.sides[0].phase !== 'fight') src.step();
  for (let i = 0; i < 10; i++) src.step();
  const [me, them] = src.view.sides;
  assert.equal(me.rigUsed, false);
  // The rule from public state: same stage, their copy of the gate still face-down.
  me.gates.forEach((g) => {
    const want = them.stage > me.stage ? false : them.stage < me.stage || !them.gates[g.slot]!.revealed;
    assert.equal(src.canRig(g.slot), want && them.phase !== 'done' && them.phase !== 'dead', `slot ${g.slot}`);
  });
  const slot = me.gates.find((g) => src.canRig(g.slot))!.slot;
  src.rig(slot);
  src.step();
  assert.deepEqual(priv.myRig, { stage: me.stage, slot });
  // The history logs it under my stage, naming the same stage of theirs.
  const r = src.reveal();
  assert.deepEqual(r.history[me.stage]!.rigs[0], { stage: me.stage, slot });
  src.dispose();
});

test('canRig (SimMatch.can_rig) == can_rig_bytes on the public bytes (what LiveSource asks)', () => {
  let yes = 0;
  let no = 0;
  for (const seed of [4n, 15n, 2026n]) {
    const src = new OfflineSource({ seed, botSeed: seed + 9n, selfBot: true, mySide: seed === 15n ? 1 : 0 });
    while (!src.view.result) {
      const bytes = src.publicBytes();
      for (let slot = 0; slot < C.GATES_MAX; slot++) {
        const ok = src.canRig(slot);
        assert.equal(ok, can_rig_bytes(bytes, src.mySide, slot), `seed ${seed} tick ${src.view.tick} slot ${slot}`);
        if (ok) yes++;
        else no++;
      }
      src.step();
    }
    src.dispose();
  }
  assert.ok(yes > 100 && no > 100, `${yes} yes, ${no} no`);
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
  for (const slot of [256, -1, 8, 2.5, Number.NaN, Infinity]) {
    src.rig(slot);
    src.peek(slot);
  }
  src.setAim(1e12);
  src.step();
  src.setAim(Number.NaN);
  src.step();
  assert.equal(src.view.sides[0].aimX, C.LANE_WIDTH - 1);
  assert.equal(src.view.sides[0].rigUsed, false);
});

test('selfBot: the bot plays my side too, my inputs are ignored', () => {
  const src = new OfflineSource({ seed: 3n, botSeed: 4n, selfBot: true, mySide: 1 });
  assert.deepEqual(src.view.sides.map((s) => s.isBot), [true, true]);
  src.setAim(0);
  for (let i = 0; i < 160; i++) src.step();
  assert.ok(src.view.sides[1].rigUsed, 'the bot rigs 1-3 s into its fight');
  src.dispose();
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

test('MockSource: a hands-off bot-vs-bot match, fast-forwarded', () => {
  const src = new MockSource({ startTick: 400 });
  assert.equal(src.view.tick, 400);
  let end = false;
  let first = true;
  src.subscribe((v, _p, events) => {
    if (first) assert.equal(events.length, 0, 'the fast-forward emits nothing');
    first = false;
    end ||= events.some((e) => e.type === 'end');
    checkView(v);
  });
  src.setAim(0);
  src.rig(0);
  assert.equal(src.canRig(0), false, 'the mock takes no input');
  playOut(src);
  assert.ok(end);
  assert.ok(new MockSource().view.sides.every((s) => s.isBot));
});
