// Result-screen data (MatchReveal): payout + why, GOTCHAs and `sprung`, same shape offline/live.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../src/constants';
import { OfflineSource, payoutOf } from '../src/index';

const S = 100_000_000;

test('payoutOf follows SPEC §7 (KO, timer, draw, abort, free)', () => {
  const ko = payoutOf(S, { winner: 0, ko: true, moved: S, fee: S / 20 }, [900, 0]);
  assert.deepEqual([ko.kind, ko.winner, ko.sharePm, ko.paid, ko.net], ['ko', 0, 1000, [2 * S - S / 20, 0], [S - S / 20, -S]]);
  assert.match(ko.why, /won by KO → takes the whole stake, minus a 5% fee/);
  // SPEC §7 "Clear win": 60% vs 40% → 60% of the stake moves, 5% of that is the fee.
  const hp: [number, number] = [880, 1320];
  const timer = payoutOf(S, { winner: 1, ko: false, moved: 60_000_000, fee: 3_000_000 }, hp, false, ['Lil A', 'Lil B']);
  assert.deepEqual([timer.kind, timer.leadPm, timer.sharePm, timer.paid, timer.net], ['timer', 200, 600, [40_000_000, 157_000_000], [-60_000_000, 57_000_000]]);
  assert.equal(timer.why, 'Lil B won on the timer by 20.0% HP → takes 60.0% of the stake, minus a 5% fee.');
  assert.equal(timer.paid[0] + timer.paid[1] + timer.fee, 2 * S);
  const draw = payoutOf(S, { winner: null, ko: false, moved: 0, fee: 0 }, [700, 700]);
  assert.deepEqual([draw.kind, draw.paid], ['draw', [S, S]]);
  const abort = payoutOf(S, null, [C.HP_MAX, C.HP_MAX], true);
  assert.deepEqual([abort.kind, abort.paid, abort.net], ['aborted', [S, S], [0, 0]]);
  const free = payoutOf(0, { winner: 0, ko: true, moved: 0, fee: 0 }, [10, 0]);
  assert.ok(free.free && free.why.includes('free match'));
});

test('OfflineSource.reveal(): deals, rigs/peeks, GOTCHAs with sprung, payout', () => {
  // Bots on both sides rig every phase; play many seeds until some rigs spring.
  let sprungSeen = 0;
  for (let seed = 1n; seed <= 12n; seed++) {
    const src = new OfflineSource({ seed, botSeed: seed * 7n, stake: S });
    const gotchaEvents: { side: number; cell: number; riggedBy: number }[] = [];
    src.subscribe((_v, _p, events) => {
      for (const e of events) if (e.type === 'gotcha') gotchaEvents.push(e);
    });
    while (!src.view.result) src.step();
    const r = src.reveal();
    assert.equal(r.deals.length, C.PHASES);
    assert.equal(r.history.length, C.PHASES);
    assert.deepEqual(r.result, src.view.result);
    assert.deepEqual(r.hp, [src.view.sides[0].hp, src.view.sides[1].hp]);
    assert.equal(r.gotchas!.length, gotchaEvents.length);
    for (const g of r.gotchas!) {
      // A GOTCHA is the opponent's rig of that phase, on the cell it rigged.
      assert.equal(g.riggedBy, g.side === 0 ? 1 : 0);
      assert.equal(r.history[g.phase]!.rigs[g.riggedBy], g.cell);
      assert.ok(r.history[g.phase]!.sprung[g.riggedBy]);
      sprungSeen++;
    }
    // A rig that never sprang stays false.
    for (const h of r.history) {
      for (const s of [0, 1] as const) {
        if (h.sprung[s]) assert.notEqual(h.rigs[s], null);
        else assert.ok(!r.gotchas!.some((g) => g.phase === h.phase && g.riggedBy === s));
      }
    }
    const p = r.payout!;
    assert.equal(p.paid[0] + p.paid[1] + p.fee, 2 * S);
    assert.equal(p.moved, r.result!.moved);
    assert.deepEqual([r.txs, r.settlement], [[], { state: 'offline' }]);
    src.dispose();
  }
  assert.ok(sprungSeen > 0, 'no rig sprang in 12 bot matches');
});
