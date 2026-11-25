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

test('room codes map to match ids and expire when idle', async () => {
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
  assert.deepEqual([found.status, found.body.id, found.body.stake, found.body.state], [200, '18446744073709551615', 50_000_000, 'waiting']);
  // Idle expiry (~30 min without anyone touching it): the code then answers 410, not 404.
  tick(29 * 60_000);
  assert.equal((await call('GET', `/rooms/${code}`)).status, 200);
  tick(31 * 60_000);
  const gone = await call('GET', `/rooms/${code}`);
  assert.deepEqual([gone.status, gone.body.error], [410, 'room expired']);
  assert.equal((await call('GET', '/rooms/ZZZZZZ')).status, 404);
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

test('any stake in [STAKE_MIN, STAKE_MAX] queues and pairs only at exactly that stake', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/queue', { player: A, stake: 9_999_999 })).status, 400);
  assert.equal((await call('POST', '/queue', { player: A, stake: 5_000_000_001 })).status, 400);
  assert.equal((await call('POST', '/queue', { player: A, stake: 12_345_678.5 })).status, 400);
  const a = await call('POST', '/queue', { player: A, stake: 70_000_000 });
  assert.equal(a.status, 201);
  const b = await call('POST', '/queue', { player: B, stake: 70_000_001 });
  assert.equal(b.body.state, 'waiting');
  // A changes the amount (its DELETE was lost): the waiting ticket is replaced, then pairs with B.
  const a2 = await call('POST', '/queue', { player: A, stake: 70_000_001 });
  assert.notEqual(a2.body.ticket, a.body.ticket);
  assert.equal(a2.body.state, 'matched');
  assert.equal(a2.body.role, 'join');
  assert.equal((await call('GET', `/queue/${a.body.ticket}`)).status, 404);
  const made = await call('POST', '/rooms', { id: '7', stake: 70_000_000 });
  assert.deepEqual([made.status, made.body.stake], [201, 70_000_000]);
});

test('rematch in the same room: the code moves from the old match to the new one', async () => {
  const { call, tick } = setup();
  const code = (await call('POST', '/rooms', { id: '100', stake: 50_000_000 })).body.code as string;
  // Either player can look the code up by the match id (idempotent POST).
  assert.equal((await call('POST', '/rooms', { id: '100', stake: 50_000_000 })).body.code, code);
  assert.equal((await call('POST', `/rooms/${code}/next`, { prev: '1', id: '101' })).status, 409);
  assert.equal((await call('POST', `/rooms/ZZZZZZ/next`, { prev: '100', id: '101' })).status, 404);
  assert.equal((await call('POST', `/rooms/${code}/next`, { prev: 'x', id: '101' })).status, 400);
  tick(25 * 60_000);
  const moved = await call('POST', `/rooms/${code}/next`, { prev: '100', id: '101' });
  assert.deepEqual([moved.status, moved.body.id, moved.body.stake], [200, '101', 50_000_000]);
  // Repeating it is a no-op.
  assert.equal((await call('POST', `/rooms/${code}/next`, { prev: '100', id: '101' })).status, 200);
  tick(25 * 60_000);
  assert.equal((await call('GET', `/rooms/${code}`)).body.id, '101');
});
