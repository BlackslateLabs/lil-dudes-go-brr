// Result-screen data (MatchReveal): payout + why, GOTCHAs and `sprung`, same shape offline/live.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../src/constants';
import { OfflineSource, payoutOf, resultFor } from '../src/index';
import type { MatchResult } from '../src/types';

const S = 1_000_000_000; // 1 SOL, as in the SPEC §8 table

const res = (winner: 0 | 1 | null, died: 0 | 1 | null, gold: [number, number]): MatchResult => {
  const r = resultFor(S, [died === 0, died === 1], gold);
  return { winner, died, gold, moved: r.moved, fee: r.fee };
};

test('resultFor follows the SPEC §8 table', () => {
  assert.deepEqual(resultFor(S, [false, true], [300, 900]), { winner: 0, ko: true, moved: S, fee: S / 20 });
  assert.deepEqual(resultFor(S, [false, false], [900, 600]), { winner: 0, ko: false, moved: 200_000_000, fee: 10_000_000 });
  assert.deepEqual(resultFor(S, [false, false], [650, 700]), { winner: 1, ko: false, moved: 37_037_037, fee: 1_851_851 });
  assert.deepEqual(resultFor(S, [false, false], [500, 500]), { winner: null, ko: false, moved: 0, fee: 0 });
  assert.deepEqual(resultFor(S, [false, false], [0, 0]), { winner: null, ko: false, moved: 0, fee: 0 });
  assert.deepEqual(resultFor(S, [true, true], [900, 0]), { winner: null, ko: true, moved: 0, fee: 0 });
  // share_a = floor(2S·ga/(ga+gb)); the winner gains share_w − S, floored for the loser.
  for (const [a, b] of [[7, 3], [3, 7], [1, 0], [999_999, 1_000_000], [123, 4567]] as [number, number][]) {
    for (const stake of [1, 3, 50_000_000, 100_000_000, 250_000_000]) {
      const r = resultFor(stake, [false, false], [a, b]);
      const [gw, gl] = a > b ? [a, b] : [b, a];
      assert.equal(r.winner, a > b ? 0 : 1);
      assert.equal(r.moved, Math.floor((stake * (gw - gl)) / (gw + gl)));
      const shareA = Math.floor((2 * stake * a) / (a + b));
      if (a > b) assert.equal(r.moved, shareA - stake);
      assert.ok(r.moved <= stake && r.fee <= r.moved);
    }
  }
});

test('payoutOf: death, gold, draws, abort, free, and conservation', () => {
  const death = payoutOf(S, res(0, 1, [300, 900]), { names: ['Lil A', 'Lil B'] });
  assert.deepEqual([death.kind, death.winner, death.died, death.sharePm, death.paid, death.net], ['death', 0, 1, 1000, [2 * S - S / 20, 0], [S - S / 20, -S]]);
  assert.equal(death.why, 'Lil B died: Lil A wins → takes the whole stake, minus a 5% fee.');

  const gold = payoutOf(S, res(0, null, [900, 600]), { names: ['Lil A', 'Lil B'] });
  assert.deepEqual([gold.kind, gold.goldPm, gold.moved, gold.fee, gold.sharePm], ['gold', [600, 400], 200_000_000, 10_000_000, 200]);
  assert.deepEqual(gold.paid, [S + 190_000_000, S - 200_000_000]);
  assert.equal(gold.why, "Lil A won on gold, 900 to 600 (60.0% of the pot) → takes 20.0% of Lil B's stake, minus a 5% fee.");

  const close = payoutOf(S, res(1, null, [650, 700]));
  assert.deepEqual([close.moved, close.fee], [37_037_037, 1_851_851]);

  const draw = payoutOf(S, res(null, null, [500, 500]));
  assert.deepEqual([draw.kind, draw.paid], ['draw', [S, S]]);
  assert.match(draw.why, /equal gold \(500 each\), both stakes refunded/);
  assert.match(payoutOf(S, res(null, null, [0, 0])).why, /no gold/);
  const both = payoutOf(S, { winner: null, died: null, gold: [10, 0], moved: 0, fee: 0 }, { dead: [true, true] });
  assert.ok(both.bothDied && both.kind === 'draw' && /Both players died/.test(both.why));

  const abort = payoutOf(S, null, { aborted: true });
  assert.deepEqual([abort.kind, abort.paid, abort.net], ['aborted', [S, S], [0, 0]]);

  const free = payoutOf(0, { winner: 0, died: null, gold: [30, 10], moved: 0, fee: 0 });
  assert.ok(free.free && free.why.includes('free match') && free.moved === 0);
  assert.equal(free.sharePm, 500);

  for (const p of [death, gold, close, draw, both, abort]) assert.equal(p.paid[0] + p.paid[1] + p.fee, 2 * S);
});

test('OfflineSource.reveal(): values, rigs/peeks, every GOTCHA is a sprung rig, payout = the sim', () => {
  const stake = 100_000_000;
  let sprungSeen = 0;
  let deaths = 0;
  let goldWins = 0;
  for (let seed = 1n; seed <= 16n; seed++) {
    const src = new OfflineSource({ seed, botSeed: seed * 7n, stake, selfBot: true });
    const gotchaEvents: { side: number; stage: number; slot: number; riggedBy: number }[] = [];
    src.subscribe((_v, _p, events) => {
      for (const e of events) if (e.type === 'gotcha') gotchaEvents.push(e);
    });
    while (!src.view.result) src.step();
    const r = src.reveal();
    const v = src.view;
    assert.equal(r.values.length, C.STAGES);
    assert.equal(r.history.length, C.STAGES);
    assert.equal(r.layoutName, v.layoutName);
    assert.deepEqual(r.result, v.result);
    assert.deepEqual(r.gold, [v.sides[0].gold, v.sides[1].gold]);
    assert.equal(r.finalTick, v.tick);
    assert.equal(r.gotchas!.length, gotchaEvents.length);
    for (const g of r.gotchas!) {
      // A GOTCHA is the opponent's rig naming that stage and slot of the victim's lane.
      assert.equal(g.riggedBy, g.side === 0 ? 1 : 0);
      const log = r.history.find((h) => h.rigs[g.riggedBy]?.stage === g.stage && h.rigs[g.riggedBy]?.slot === g.slot);
      assert.ok(log, `no rig for ${JSON.stringify(g)}`);
      assert.ok(log.sprung[g.riggedBy]);
      sprungSeen++;
    }
    // A rig that never sprang stays false.
    for (const h of r.history) {
      for (const s of [0, 1] as const) {
        const rig = h.rigs[s];
        if (h.sprung[s]) assert.ok(rig);
        else assert.ok(!rig || !r.gotchas!.some((g) => g.riggedBy === s && g.stage === rig.stage && g.slot === rig.slot));
      }
    }
    const p = r.payout!;
    assert.equal(p.paid[0] + p.paid[1] + p.fee, 2 * stake, 'conservation');
    assert.deepEqual([p.winner, p.moved, p.fee], [r.result!.winner, r.result!.moved, r.result!.fee], 'payoutOf == the sim');
    if (p.kind === 'death') deaths++;
    if (p.kind === 'gold') goldWins++;
    assert.deepEqual([r.txs, r.settlement], [[], { state: 'offline' }]);
    src.dispose();
  }
  assert.ok(sprungSeen > 0, 'no rig sprang in 16 bot matches');
  assert.ok(deaths + goldWins > 0, 'no decided match in 16');
});
