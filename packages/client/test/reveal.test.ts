// Result-screen data (MatchReveal): payout + why, Scouts, same shape offline/live (rules v5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../src/constants';
import { OfflineSource, payoutOf, resultFor, sliceBps } from '../src/index';
import type { MatchResult } from '../src/types';

const S = 1_000_000_000; // 1 SOL

const res = (winner: 0 | 1 | null, died: 0 | 1 | null, gold: [number, number]): MatchResult => {
  const r = resultFor(S, [died === 0, died === 1], gold);
  return { winner, died, gold, moved: r.moved, fee: r.fee };
};

test('resultFor follows the SPEC_V5 §7 table (2 × margin of the loser\'s stake)', () => {
  const T = 100_000_000; // the table's S = 0.1 SOL
  const nets = (w: number, l: number) => {
    const r = resultFor(T, [false, false], [l, w]);
    return [T + r.moved - r.fee, T - r.moved, r.fee];
  };
  assert.deepEqual(nets(401, 399), [100_475_000, 99_500_000, 25_000]);
  assert.deepEqual(nets(520, 480), [107_600_000, 92_000_000, 400_000]);
  assert.deepEqual(nets(600, 400), [138_000_000, 60_000_000, 2_000_000]);
  assert.deepEqual(nets(700, 300), [176_000_000, 20_000_000, 4_000_000]);
  assert.deepEqual(nets(750, 250), [195_000_000, 0, 5_000_000]);
  assert.deepEqual(nets(900, 100), [195_000_000, 0, 5_000_000]);
  assert.deepEqual(resultFor(S, [false, true], [300, 900]), { winner: 0, ko: true, moved: S, fee: S / 20 });
  assert.deepEqual(resultFor(S, [false, false], [500, 500]), { winner: null, ko: false, moved: 0, fee: 0 });
  assert.deepEqual(resultFor(S, [false, false], [0, 0]), { winner: null, ko: false, moved: 0, fee: 0 });
  assert.deepEqual(resultFor(S, [true, true], [900, 0]), { winner: null, ko: true, moved: 0, fee: 0 });
  for (const [a, b] of [[7, 3], [3, 7], [1, 0], [999_999, 1_000_000], [123, 4567]] as [number, number][]) {
    for (const stake of [1, 3, 50_000_000, 100_000_000, 250_000_000]) {
      const r = resultFor(stake, [false, false], [a, b]);
      const [gw, gl] = a > b ? [a, b] : [b, a];
      assert.equal(r.winner, a > b ? 0 : 1);
      assert.equal(sliceBps(gw, gl), Math.min(10_000, Math.floor((20_000 * (gw - gl)) / (gw + gl))));
      assert.equal(r.moved, Math.floor((stake * sliceBps(gw, gl)) / 10_000));
      assert.ok(r.moved <= stake && r.fee <= r.moved);
    }
  }
});

test('payoutOf: death, gold, draws, abort, free, and conservation', () => {
  const death = payoutOf(S, res(0, 1, [300, 900]), { names: ['Lil A', 'Lil B'] });
  assert.deepEqual([death.kind, death.winner, death.died, death.sharePm, death.paid, death.net], ['death', 0, 1, 1000, [2 * S - S / 20, 0], [S - S / 20, -S]]);
  assert.equal(death.why, 'Lil B died: Lil A wins → takes the whole stake, minus a 5% fee.');

  const gold = payoutOf(S, res(0, null, [900, 600]), { names: ['Lil A', 'Lil B'] });
  assert.deepEqual([gold.kind, gold.goldPm, gold.moved, gold.fee, gold.sharePm], ['gold', [600, 400], 400_000_000, 20_000_000, 400]);
  assert.deepEqual(gold.paid, [S + 380_000_000, S - 400_000_000]);
  assert.equal(gold.why, "Lil A won on score, 900 to 600 → takes 40.0% of Lil B's stake, minus a 5% fee.");

  const close = payoutOf(S, res(1, null, [650, 700]));
  assert.deepEqual([close.moved, close.fee], [74_000_000, 3_700_000]);

  const draw = payoutOf(S, res(null, null, [500, 500]));
  assert.deepEqual([draw.kind, draw.paid], ['draw', [S, S]]);
  assert.match(draw.why, /equal scores \(500 each\), both stakes refunded/);
  assert.match(payoutOf(S, res(null, null, [0, 0])).why, /no score/);
  const both = payoutOf(S, { winner: null, died: null, gold: [10, 0], moved: 0, fee: 0 }, { dead: [true, true] });
  assert.ok(both.bothDied && both.kind === 'draw' && /Both players died/.test(both.why));

  const abort = payoutOf(S, null, { aborted: true });
  assert.deepEqual([abort.kind, abort.paid, abort.net], ['aborted', [S, S], [0, 0]]);

  const free = payoutOf(0, { winner: 0, died: null, gold: [30, 10], moved: 0, fee: 0 });
  assert.ok(free.free && free.why.includes('free match') && free.moved === 0);
  assert.equal(free.sharePm, 1000, '30 vs 10: the winner would take all (w ≥ 3l)');

  for (const p of [death, gold, close, draw, both, abort]) assert.equal(p.paid[0] + p.paid[1] + p.fee, 2 * S);
});

test('OfflineSource.reveal(): values, Scouts, payout = the sim', () => {
  const stake = 100_000_000;
  let scouts = 0;
  let deaths = 0;
  let goldWins = 0;
  for (let seed = 1n; seed <= 16n; seed++) {
    const src = new OfflineSource({ seed, botSeed: seed * 7n, stake, selfBot: true });
    while (!src.view.result) src.step();
    const r = src.reveal();
    const v = src.view;
    assert.equal(r.values.length, C.STAGES);
    assert.equal(r.history.length, C.STAGES);
    assert.equal(r.layoutName, v.layoutName);
    assert.deepEqual(r.result, v.result);
    assert.deepEqual(r.gold, [v.sides[0].gold, v.sides[1].gold]);
    assert.equal(r.finalTick, v.tick);
    for (const h of r.history) {
      for (const pk of h.peeks) {
        if (!pk) continue;
        scouts++;
        assert.deepEqual(pk.op, r.values[h.stage]![pk.slot], 'a Scout shows the dealt value');
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
  assert.ok(scouts > 16, `${scouts} Scouts in 16 bot matches`);
  assert.ok(deaths + goldWins > 0, 'no decided match in 16');
});
