import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app';

const A = '4oarhNvGuppu2VKsYy3aSvYPSFTwovcY58t1B3a8aA4Z';
const B = 'HJZnaPcLHcVBeqtUH5hcDYrq16Z8J4oBahKfz3hZH1br';
const C = 'FdZLtcw7CMAHk2bsnqesxcYj3Ybjgux3GcqtDy63rfbB';

function setup() {
  let t = 1_000_000;
  const app = createApp({ now: () => t });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { call, tick: (ms: number) => (t += ms) };
}

test('room codes map to match ids and expire', async () => {
  const { call, tick } = setup();
  assert.equal((await call('POST', '/rooms', { id: 'x', stake: 0 })).status, 400);
  assert.equal((await call('POST', '/rooms', { id: '42', stake: 7 })).status, 400);
  const made = await call('POST', '/rooms', { id: '18446744073709551615', stake: 50_000_000 });
  assert.equal(made.status, 201);
  const code = made.body.code as string;
  assert.match(code, /^[A-Z2-9]{6}$/);
  // Same id again → the same room.
  assert.equal((await call('POST', '/rooms', { id: '18446744073709551615', stake: 50_000_000 })).body.code, code);
  const found = await call('GET', `/rooms/${code.toLowerCase()}`);
  assert.deepEqual([found.status, found.body.id, found.body.stake], [200, '18446744073709551615', 50_000_000]);
  tick(16 * 60_000);
  assert.equal((await call('GET', `/rooms/${code}`)).status, 404);
});

test('quick match pairs two players on the same tier, earlier one creates', async () => {
  const { call, tick } = setup();
  assert.equal((await call('POST', '/queue', { player: 'nope', stake: 0 })).status, 400);
  const a = await call('POST', '/queue', { player: A, stake: 100_000_000 });
  assert.equal(a.body.state, 'waiting');
  // Another tier does not pair with A.
  const c = await call('POST', '/queue', { player: C, stake: 0 });
  assert.equal(c.body.state, 'waiting');
  // Re-posting returns the same ticket.
  assert.equal((await call('POST', '/queue', { player: A, stake: 100_000_000 })).body.ticket, a.body.ticket);
  const b = await call('POST', '/queue', { player: B, stake: 100_000_000 });
  assert.equal(b.body.state, 'matched');
  assert.equal(b.body.role, 'join');
  assert.equal(b.body.opponent, A);
  const aPoll = await call('GET', `/queue/${a.body.ticket}`);
  assert.equal(aPoll.body.state, 'matched');
  assert.equal(aPoll.body.role, 'create');
  assert.equal(aPoll.body.id, b.body.id);
  assert.match(aPoll.body.id as string, /^\d+$/);
  // A waiting player who stops polling is dropped.
  tick(31_000);
  assert.equal((await call('GET', `/queue/${c.body.ticket}`)).status, 404);
  // Cancel.
  const d = await call('POST', '/queue', { player: C, stake: 0 });
  await call('DELETE', `/queue/${d.body.ticket}`);
  assert.equal((await call('GET', `/queue/${d.body.ticket}`)).status, 404);
});
