import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app';
import { planSweep, SWEEP, type BaseMatch, type Seen, type TeeMatch } from '../src/sweeper';

const S = 50_000_000;
const T0 = 1_800_000_000;
const base = (o: Partial<BaseMatch> & { id: bigint; status: number }): BaseMatch => ({ stake: S, vault: 0, createdAt: T0, joinedAt: T0, ...o });
const tee = (o: Partial<TeeMatch> & { id: bigint; status: number }): TeeMatch => ({ readySlot: 1_000, tick: 0, hasResult: false, ...o });
const kinds = (a: { kind: string; id: bigint }[]) => a.map((x) => `${x.kind}:${x.id}`).sort();

test('sweeper: base-layer refunds only after the on-chain timeouts', () => {
  const seen: Seen = new Map();
  const ms = 0;
  const list = [base({ id: 1n, status: 0 }), base({ id: 2n, status: 1 }), base({ id: 3n, status: 4 })];
  // 4 min after: nothing (PLAYING on base can't happen, but is ignored anyway).
  assert.deepEqual(planSweep(list, [], { ms, sec: T0 + 240, teeSlot: 0 }, seen), []);
  // 6 min: the never-delegated join; 21 min: the open room too.
  assert.deepEqual(kinds(planSweep(list, [], { ms, sec: T0 + 6 * 60, teeSlot: 0 }, seen)), ['cancel:2']);
  assert.deepEqual(kinds(planSweep(list, [], { ms, sec: T0 + 21 * 60, teeSlot: 0 }, seen)), ['cancel:1', 'cancel:2']);
});

test('sweeper: settle a late action after 30 s, close paid-out matches after 10 min', () => {
  const seen: Seen = new Map();
  const unpaid = base({ id: 4n, status: 5, vault: 2 * S });
  const paid = base({ id: 5n, status: 5, vault: 0 });
  const free = base({ id: 6n, status: 5, stake: 0 });
  const settled = base({ id: 7n, status: 6 });
  const all = [unpaid, paid, free, settled];
  const at = (ms: number) => kinds(planSweep(all, [], { ms, sec: T0, teeSlot: 0 }, seen));
  assert.deepEqual(at(0), []);
  assert.deepEqual(at(SWEEP.settleAfterMs), ['settle:4']);
  assert.deepEqual(at(SWEEP.closeAfterMs), ['close:5', 'close:6', 'close:7', 'settle:4']);
  // Once settled, 4 starts its own close timer.
  const now = SWEEP.closeAfterMs + 1;
  assert.deepEqual(kinds(planSweep([{ ...unpaid, vault: 0 }], [], { ms: now, sec: T0, teeSlot: 0 }, seen)), []);
  assert.deepEqual(kinds(planSweep([{ ...unpaid, vault: 0 }], [], { ms: now + SWEEP.closeAfterMs, sec: T0, teeSlot: 0 }, seen)), ['close:4']);
  // Timers of matches that are gone are forgotten.
  planSweep([], [], { ms: now, sec: T0, teeSlot: 0 }, seen);
  assert.equal(seen.size, 0);
});

test('sweeper: on the TEE abort never-started matches, finish over ones, nudge a dead crank', () => {
  const seen: Seen = new Map();
  const list = [
    tee({ id: 8n, status: 2 }), // READY since slot 1,000
    tee({ id: 9n, status: 3 }), // SEEDED
    tee({ id: 10n, status: 1, readySlot: 0 }), // JOINED on the TEE: strangers can't abort it
    tee({ id: 11n, status: 4, hasResult: true }),
    tee({ id: 12n, status: 4, tick: 900 }),
  ];
  const slot = (s: number, ms: number) => kinds(planSweep([], list, { ms, sec: T0, teeSlot: s }, seen));
  assert.deepEqual(slot(1_000 + 29_000, 0), []);
  assert.deepEqual(slot(1_000 + SWEEP.abortSlots, SWEEP.finishAfterMs), ['abort:8', 'abort:9', 'finish:11']);
  assert.deepEqual(slot(0, SWEEP.stuckMs), ['advance:12', 'finish:11']);
  // A moving tick resets the stuck timer.
  list[4] = tee({ id: 12n, status: 4, tick: 950 });
  assert.deepEqual(kinds(planSweep([], [list[4]!], { ms: SWEEP.stuckMs + 1, sec: T0, teeSlot: 0 }, seen)), []);
});

test('POST /settle: validates, rate-limits, reports', async () => {
  const calls: bigint[] = [];
  const app = createApp({ trustProxy: true, settle: async (id) => (calls.push(id), { state: 'sent', signature: 'SIG' }) });
  const post = (body: unknown) => app.request('/settle', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' }, body: JSON.stringify(body) });
  assert.equal((await post({ id: 'x' })).status, 400);
  const ok = await post({ id: '77' });
  assert.deepEqual([ok.status, await ok.json()], [200, { state: 'sent', signature: 'SIG' }]);
  for (let i = 0; i < 9; i++) await post({ id: '77' });
  assert.equal((await post({ id: '77' })).status, 429);
  assert.equal(calls.length, 10);
  assert.equal((await createApp({}).request('/settle', { method: 'POST', body: '{}' })).status, 503);
});
