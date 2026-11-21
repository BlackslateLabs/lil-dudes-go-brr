// The live feed's event reconstruction (live/events.ts) vs the sim's own events, through whole
// offline matches decoded from the on-chain byte layout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodePublic } from '../src/codec';
import { diffEvents } from '../src/live/events';
import { OfflineSource } from '../src/index';
import type { MatchEvent } from '../src/types';

const NO_GOTCHA = [null, null] as const;
const key = (e: MatchEvent) => {
  switch (e.type) {
    case 'volley':
      return `volley:${e.side}:${e.cohortId}:${e.x}:${e.count}`;
    case 'reveal':
      return `reveal:${e.side}:${e.cell}:${e.op.kind}${e.op.value}:${e.gold}`;
    case 'gate':
      return `gate:${e.side}:${e.cell}:${e.cohortId}:${e.before}:${e.after}`;
    case 'hit':
      return `hit:${e.side}`;
    case 'plant':
    case 'redeal':
      return `${e.type}:${e.phase}`;
    default:
      return e.type;
  }
};

test('diffEvents reconstructs the sim events of whole matches', () => {
  let exact = 0;
  let clashTicks = 0;
  for (const seed of [3n, 11n, 2026n]) {
    const src = new OfflineSource({ seed, botSeed: seed * 7n });
    let prev = { state: decodePublic(src.publicBytes()), gotcha: [...NO_GOTCHA] as [null, null] };
    let got: MatchEvent[] = [];
    src.subscribe((_v, _p, events) => (got = events));
    while (!src.view.result) {
      src.step();
      const next = { state: decodePublic(src.publicBytes()), gotcha: [...NO_GOTCHA] as [null, null] };
      const derived = diffEvents(prev, next);
      prev = next;
      const want = got.filter((e) => e.type !== 'clash' && e.type !== 'gotcha').map(key).sort();
      const have = derived.filter((e) => e.type !== 'clash').map(key).sort();
      // Hits: one derived per cannon (summed); the sim has one per cohort.
      const dedupe = (xs: string[]) => [...new Set(xs)];
      assert.deepEqual(dedupe(have), dedupe(want), `seed ${seed} tick ${next.state.tick}`);
      const simClash = got.filter((e) => e.type === 'clash');
      const ourClash = derived.filter((e) => e.type === 'clash');
      if (simClash.length > 0) {
        clashTicks++;
        assert.equal(ourClash.length, 1, `seed ${seed} tick ${next.state.tick}: one clash event`);
        const killed = simClash.reduce((a, e) => a + (e.type === 'clash' ? e.killedA : 0), 0);
        assert.equal(ourClash[0]!.type === 'clash' && ourClash[0]!.killedA, killed, `clash losses, tick ${next.state.tick}`);
      } else {
        assert.equal(ourClash.length, 0, `seed ${seed} tick ${next.state.tick}: phantom clash`);
      }
      exact++;
    }
    src.dispose();
  }
  assert.ok(exact > 1000 && clashTicks > 10, `${exact} ticks, ${clashTicks} with clashes`);
});
