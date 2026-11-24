// OfflineSource: the real rules (v5) through the bundled WASM. Run: pnpm --filter @lil-dudes/client test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../src/constants';
import { crateOfGate, stageDef } from '../src/layout';
import { MockSource, OfflineSource, simConstants, simRulesVersion } from '../src/index';
import type { MatchEvent, MatchView, PrivateView } from '../src/types';

/** Same match as `parity_match_digest` in crates/sim-wasm/src/lib.rs (PARITY_DIGEST): bot vs bot
 *  (since rules v6 an idle player never fires). Rules v7: side 1 is overrun on tick 671. */
const PARITY = { seed: 42n, botSeed: 7n, stake: 100_000_000, selfBot: true, digest: 445_834_651_989_838_914n, tick: 672 };

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
  assert.equal(simRulesVersion(), 7);
  const src = new OfflineSource(PARITY);
  playOut(src);
  assert.equal(src.view.tick, PARITY.tick);
  assert.equal(src.digest(), PARITY.digest, 'packages/sim-wasm/pkg is stale: run packages/sim-wasm/build.sh');
  const r = src.view.result!;
  assert.deepEqual([r.winner, r.died, r.gold, r.moved], [0, 1, [1018, 1068], PARITY.stake]);
  assert.equal(r.fee, Math.floor((r.moved * C.FEE_BPS) / 10_000));
  assert.deepEqual(src.view.sides.map((s) => s.phase), ['fight', 'dead']);
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
    // v5: the Rush is Fight 2 with its towers down, in place, RUSH_TICKS long.
    const rushed = s.rushTicks > 0;
    if (rushed) {
      assert.equal(s.stage, C.FINAL_STAGE);
      assert.ok(s.towers.every((t) => t.hp === 0), 'the Rush starts when every tower is down');
    } else {
      assert.equal(s.rushGold, 0);
    }
    if (s.phase === 'rush' || s.phase === 'done') assert.equal(s.stage, C.FINAL_STAGE);
    if (s.phase === 'done') assert.ok(s.rushTicks === C.RUSH_TICKS && s.cohorts.length === 0 && s.enemies.length === 0);
    if (s.phase === 'plant' || s.phase === 'fight' || s.phase === 'transit') assert.equal(s.rushTicks, 0);
    assert.ok(s.rushTicks <= C.RUSH_TICKS);
    assert.ok(s.rushGold <= s.gold);
    assert.ok(s.champMeter >= 0 && s.champMeter <= C.CHAMP_TICKS);
    // FIRST: only for a cleared fight, never both lanes.
    s.first.forEach((f, k) => f && assert.ok(s.breachTick[k]! > 0));
    s.gates.forEach((g, slot) => {
      assert.equal(g.slot, slot);
      assert.equal(g.y, st.rows[st.gates[slot]!.row]);
      const crate = crateOfGate(st, slot);
      assert.equal(g.locked, g.big && crate >= 0 && s.crates[crate]!.hp > 0);
      if (!g.moving) assert.equal(g.x, st.gates[slot]!.x);
      if (g.revealed?.kind === 'mul') assert.ok(g.revealed.value >= 2 && g.revealed.value <= 10);
      if (g.revealed?.kind === 'div') assert.ok(g.revealed.value === 2 || g.revealed.value === 3);
      if (g.revealed?.kind === 'add' || g.revealed?.kind === 'sub') assert.ok(g.revealed.value > 0 && C.PM_BY_ROW.includes(g.revealed.value));
      if (g.timing) {
        assert.equal(g.revealed, null, 'the timing gate never flips');
        assert.equal(g.value?.kind, 'mul');
        assert.ok(g.value!.value >= 1 && g.value!.value <= C.TIMING_MAX);
      } else {
        assert.deepEqual(g.value, g.revealed);
      }
    });
    if (s.phase === 'plant' || s.phase === 'transit') {
      assert.equal(s.cohorts.length + s.enemies.length, 0, 'no units in plant / transit');
      assert.ok(s.gates.every((g) => !g.revealed));
    }
    for (const t of s.towers) assert.ok(t.hp >= 0 && t.hp <= t.maxHp && t.y === C.TOWER_Y);
  }
}

test('whole bot-vs-bot matches: every event type, invariants, rush gold = loot', () => {
  const seen = new Map<string, number>();
  for (const seed of [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]) {
    const src = new OfflineSource({ seed, botSeed: seed * 31n, stake: 50_000_000, selfBot: true });
    const loot: [number, number] = [0, 0];
    const first: [number, number] = [0, 0];
    let ends = 0;
    let last: MatchView | null = null;
    src.subscribe((view, _priv, events) => {
      for (const e of events) {
        seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
        if (e.type === 'volley' && e.champion) seen.set('champion volley', (seen.get('champion volley') ?? 0) + 1);
        if (e.type === 'loot') loot[e.side] += e.gold;
        if (e.type === 'first') first[e.side] += e.gold;
        if (e.type === 'end') ends++;
      }
      if (last) assert.equal(view.tick, last.tick + 1, 'one tick per step');
      checkView(view);
      assert.ok(view.sides.every((s) => s.isBot));
      // FIRST in the view = FIRST events so far.
      view.sides.forEach((s, i) => assert.equal(s.first.filter(Boolean).length * C.FIRST_BONUS, first[i]));
      last = view;
    });
    playOut(src);
    const v = src.view;
    const r = v.result!;
    assert.equal(ends, 1);
    assert.equal(v.status, 'ended');
    assert.ok(v.tick <= C.MATCH_TICKS);
    assert.deepEqual(r.gold, [v.sides[0].gold, v.sides[1].gold]);
    assert.deepEqual([v.sides[0].rushGold, v.sides[1].rushGold], loot);
    const dead = v.sides.map((s) => s.phase === 'dead');
    assert.equal(r.died, dead[0] !== dead[1] ? (dead[0] ? 0 : 1) : null);
    if (r.winner === null) assert.equal(r.moved, 0);
    else assert.equal(r.fee, Math.floor((r.moved * C.FEE_BPS) / 10_000));
    src.dispose();
  }
  for (const type of ['volley', 'champion volley', 'reveal', 'gate', 'crate', 'wave', 'clash', 'towerHit', 'towerDown', 'loot', 'first', 'rushEnd', 'stage', 'end']) {
    assert.ok((seen.get(type) ?? 0) > 0, `no ${type} events`);
  }
});

test('a player scouts in their fight (private view by stage and slot; never the timing gate)', () => {
  const src = new OfflineSource({ seed: 9n, botSeed: 10n });
  let priv: PrivateView = { myPeek: null };
  src.subscribe((_v, p) => (priv = p));
  const st = stageDef(src.view.layout, 0);
  const timing = st.gates.findIndex((g) => g.timing);
  const slot = st.gates.findIndex((g) => !g.timing);
  assert.ok(timing >= 0 && slot >= 0);
  // A Scout in the plant is refused (and not used up).
  src.peek(slot);
  src.step();
  assert.equal(src.view.sides[0].peekUsed, false);
  while (src.view.sides[0].phase === 'plant') src.step();
  assert.equal(src.view.sides[0].phase, 'fight');
  src.peek(timing);
  src.step();
  assert.equal(src.view.sides[0].peekUsed, false, 'the timing gate is public');
  src.peek(slot);
  src.step();
  assert.equal(src.view.sides[0].peekUsed, true);
  const peek = (priv as PrivateView).myPeek;
  assert.deepEqual(src.priv.myPeek, peek);
  assert.equal(peek?.stage, 0);
  assert.equal(peek?.slot, slot);
  // The scouted value is the dealt one, and the history logs it.
  assert.deepEqual(peek?.op, src.reveal().values[0]![slot]);
  assert.deepEqual(src.reveal().history[0]!.peeks[0], { slot, op: peek!.op });
  src.dispose();
});

test('the trigger: no volleys until held; held volleys charge the Champion', () => {
  const src = new OfflineSource({ seed: 21n, botSeed: 22n });
  let mine = 0;
  src.subscribe((_v, _p, events) => {
    mine += events.filter((e) => e.type === 'volley' && e.side === 0).length;
  });
  for (let i = 0; i < C.PLANT_TICKS + 40; i++) src.step();
  assert.equal(mine, 0, 'no trigger, no volleys');
  assert.equal(src.view.sides[0].champMeter, 0, 'and no charge');
  src.setFiring(true);
  for (let i = 0; i < 40; i++) src.step();
  assert.ok(mine >= 4, `${mine} volleys while held`);
  assert.equal(src.view.sides[0].champMeter, mine * C.FIRE_TICKS);
  src.dispose();
});

test('letting go with a full meter releases the Champion', () => {
  const src = new OfflineSource({ seed: 21n, botSeed: 22n });
  const volleys: { champion: boolean; count: number }[] = [];
  src.subscribe((_v, _p, events) => {
    for (const e of events) if (e.type === 'volley' && e.side === 0) volleys.push({ champion: e.champion, count: e.count });
  });
  src.setFiring(true);
  let guard = 0;
  while (!src.canChampion() && !src.view.result) {
    src.setAim(src.view.sides[0].enemies[0]?.x ?? C.LANE_WIDTH / 2);
    src.step();
    assert.ok(guard++ < C.MATCH_TICKS);
  }
  if (src.view.result) return src.dispose();
  src.setFiring(false);
  src.step();
  assert.deepEqual(volleys.find((v) => v.champion), { champion: true, count: C.CHAMP_COUNT });
  assert.equal(src.view.sides[0].champMeter, 0);
  src.dispose();
});

test('the Champion: charged by shooting, called once, rides the next volley', () => {
  const src = new OfflineSource({ seed: 21n, botSeed: 22n });
  const volleys: { champion: boolean; count: number }[] = [];
  src.subscribe((_v, _p, events) => {
    for (const e of events) if (e.type === 'volley' && e.side === 0) volleys.push({ champion: e.champion, count: e.count });
  });
  assert.equal(src.canChampion(), false, 'empty meter in the plant');
  src.champion();
  src.step();
  assert.equal(src.view.sides[0].champPending, false);
  // Keep the lane alive while the meter fills (it charges per volley, so hold the trigger).
  src.setFiring(true);
  let guard = 0;
  while (!src.canChampion() && !src.view.result) {
    src.setAim(src.view.sides[0].enemies[0]?.x ?? C.LANE_WIDTH / 2);
    src.step();
    assert.ok(guard++ < C.MATCH_TICKS);
  }
  if (src.view.result) return src.dispose(); // the bot won before the meter filled (rare)
  assert.equal(src.view.sides[0].champMeter, C.CHAMP_TICKS);
  src.champion();
  src.step();
  const me = src.view.sides[0];
  assert.ok(me.champPending || volleys.some((v) => v.champion), 'called');
  assert.ok(me.champMeter <= 1, 'the meter emptied');
  assert.equal(src.canChampion(), false, 'not twice');
  for (let i = 0; i < C.FIRE_TICKS && !volleys.some((v) => v.champion); i++) src.step();
  const champ = volleys.find((v) => v.champion);
  assert.deepEqual(champ, { champion: true, count: C.CHAMP_COUNT });
  assert.ok(src.view.sides[0].cohorts.some((c) => c.champion) || src.view.result);
  src.dispose();
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
  for (const slot of [256, -1, 8, 2.5, Number.NaN, Infinity]) src.peek(slot);
  src.champion();
  src.setAim(1e12);
  src.step();
  src.setAim(Number.NaN);
  src.step();
  assert.equal(src.view.sides[0].aimX, C.LANE_WIDTH - 1);
  assert.equal(src.view.sides[0].peekUsed, false);
  assert.equal(src.view.sides[0].champPending, false);
});

test('selfBot: the bot plays my side too, my inputs are ignored', () => {
  const src = new OfflineSource({ seed: 3n, botSeed: 4n, selfBot: true, mySide: 1 });
  assert.deepEqual(src.view.sides.map((s) => s.isBot), [true, true]);
  src.setAim(0);
  let champ = false;
  let scouted = false;
  src.subscribe((v, _p, events) => {
    champ ||= events.some((e) => e.type === 'volley' && e.side === 1 && e.champion);
    scouted ||= v.sides[1].peekUsed;
  });
  // The meter needs CHAMP_TICKS of fight time (it carries over a short Fight 1).
  while (!champ && !src.view.result) src.step();
  assert.ok(scouted, 'the bot scouts at the start of its fight');
  assert.ok(champ || src.view.result, 'the bot calls the Champion when charged');
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
  src.champion();
  assert.equal(src.canChampion(), false, 'the mock takes no input');
  playOut(src);
  assert.ok(end);
  assert.ok(new MockSource().view.sides.every((s) => s.isBot));
});
