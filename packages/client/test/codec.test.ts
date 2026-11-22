// The TS decoder of the on-chain public state vs the Rust codec (through the WASM build), and the
// Verify data (deals + history) of whole matches.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codec_version } from '@lil-dudes/sim-wasm';
import * as C from '../src/constants';
import { CODEC_VERSION, decodePublic, matchResultOf, PUBLIC_LEN, toMatchView } from '../src/codec';
import { stageDef } from '../src/layout';
import { decodeHistory, dealsFor, HISTORY_LEN, trueOp } from '../src/verify';
import { OfflineSource } from '../src/index';

test('codec constants match the WASM build', () => {
  new OfflineSource().dispose(); // loads the WASM
  assert.equal(codec_version(), CODEC_VERSION);
  assert.equal(PUBLIC_LEN, 1474);
  assert.equal(HISTORY_LEN, 16);
});

test('decodePublic(publicBytes) == the WASM view at every tick of whole matches', () => {
  for (const seed of [1n, 42n, 77n, 1234n]) {
    const src = new OfflineSource({ seed, botSeed: seed + 1n, stake: 100_000_000, mySide: seed === 42n ? 1 : 0, selfBot: true, tutorial: seed === 77n });
    const names: [string, string] = [src.view.sides[0].name, src.view.sides[1].name];
    let ticks = 0;
    for (;;) {
      const bytes = src.publicBytes();
      assert.equal(bytes.length, PUBLIC_LEN);
      const p = decodePublic(bytes);
      assert.equal(p.tutorial, seed === 77n);
      assert.deepEqual(toMatchView(p, src.matchId, names), src.view, `seed ${seed} tick ${src.view.tick}`);
      assert.deepEqual(matchResultOf(p), src.view.result);
      if (src.view.result) break;
      src.step();
      ticks++;
    }
    assert.ok(ticks > 500, `seed ${seed}: ${ticks} ticks`);
    src.dispose();
  }
});

test('decodePublic refuses short buffers and other codec versions', () => {
  const src = new OfflineSource({ seed: 3n });
  const bytes = src.publicBytes();
  assert.throws(() => decodePublic(bytes.subarray(0, 100)));
  const bad = bytes.slice();
  bad[0] = 99;
  assert.throws(() => decodePublic(bad));
  // With an offset (the Match account header precedes the state).
  const padded = new Uint8Array(PUBLIC_LEN + 40);
  padded.set(bytes, 40);
  assert.deepEqual(decodePublic(padded, 40), decodePublic(bytes));
  src.dispose();
});

test('dealsFor + history: every revealed gate re-derives from the seed and the rigs', () => {
  let checked = 0;
  let rigs = 0;
  for (const seed of [5n, 1234n, 99n, 2026n, 7n, 31n, 64n, 500n]) {
    const src = new OfflineSource({ seed, botSeed: 9n, selfBot: true });
    const deals = dealsFor(seed);
    assert.equal(deals.layout, Number(seed % BigInt(C.LAYOUTS.length)));
    assert.equal(deals.layoutName, C.LAYOUTS[deals.layout]!.name);
    assert.equal(deals.values.length, C.STAGES);
    deals.values.forEach((ops, stage) => {
      const st = stageDef(deals.layout, stage);
      assert.equal(ops.length, st.gates.length);
      ops.forEach((op, slot) => {
        assert.equal(op.kind, 'mul');
        const odds = st.gates[slot]!.big ? C.BIG_ODDS : C.NORMAL_ODDS;
        assert.ok(odds.some(([k]) => k === op.value), `stage ${stage} slot ${slot}: ×${op.value}`);
      });
    });
    // Every gate revealed during the match shows the dealt value, or ÷2 where the opponent rigged it.
    src.subscribe((_v, _p, events) => {
      for (const e of events) {
        if (e.type !== 'reveal') continue;
        const history = decodeHistory(src.history());
        assert.deepEqual(e.op, trueOp({ values: deals.values, history }, e.side, e.stage, e.slot), `seed ${seed} ${JSON.stringify(e)}`);
        checked++;
      }
    });
    while (!src.view.result) src.step();
    const h = decodeHistory(src.history());
    assert.equal(h.length, C.STAGES);
    // The bots rig 1-3 s into each fight (refused when the target gate is already revealed).
    for (const log of h) {
      rigs += log.rigs.filter(Boolean).length;
      // v4: a rig names the rigger's own stage, and a slot of it.
      for (const r of log.rigs) if (r) assert.ok(r.stage === log.stage && r.slot < stageDef(deals.layout, r.stage).gates.length);
    }
    src.dispose();
  }
  assert.ok(checked > 80, `${checked} reveals checked`);
  assert.ok(rigs >= 16, `${rigs} rigs in 8 bot matches`);
});
