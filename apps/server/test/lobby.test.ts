import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createApp, ROOM_IDLE_MS, type ServerOptions } from '../src/app';
import { History, type HistoryRecord } from '../src/history';
import type { ReadResult } from '../src/record';

const A = '4oarhNvGuppu2VKsYy3aSvYPSFTwovcY58t1B3a8aA4Z';
const B = 'HJZnaPcLHcVBeqtUH5hcDYrq16Z8J4oBahKfz3hZH1br';
const C = 'FdZLtcw7CMAHk2bsnqesxcYj3Ybjgux3GcqtDy63rfbB';

function setup(extra: Partial<ServerOptions> = {}) {
  let t = 1_000_000;
  const app = createApp({ now: () => t, ...extra });
  const call = async (method: string, p: string, body?: unknown) => {
    const res = await app.request(p, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { call, tick: (ms: number) => (t += ms), now: () => t };
}

test('room lifecycle: waiting → joined → playing → ended; two seats; clear errors', async () => {
  const { call } = setup();
  const made = await call('POST', '/rooms', { id: '42', stake: 100_000_000, player: A });
  assert.deepEqual([made.status, made.body.state, made.body.players, made.body.creator], [201, 'waiting', 1, A]);
  const code = made.body.code as string;
  // The joiner sees the creator's stake before confirming.
  const seen = await call('GET', `/rooms/${code}`);
  assert.deepEqual([seen.body.stake, seen.body.state], [100_000_000, 'waiting']);
  assert.equal((await call('POST', `/rooms/${code}/join`, { player: A })).status, 400); // own room
  assert.equal((await call('POST', `/rooms/${code}/join`, { player: 'x' })).status, 400);
  const joined = await call('POST', `/rooms/${code}/join`, { player: B });
  assert.deepEqual([joined.status, joined.body.state, joined.body.players, joined.body.joiner], [200, 'joined', 2, B]);
  // Joining again is fine for the same player; a third player gets "full".
  assert.equal((await call('POST', `/rooms/${code}/join`, { player: B })).status, 200);
  const full = await call('POST', `/rooms/${code}/join`, { player: C });
  assert.deepEqual([full.status, full.body.error], [409, 'room is full']);
  // The creator can't cancel a room with a match in it.
  assert.equal((await call('DELETE', `/rooms/${code}?player=${A}`)).status, 409);
  // State moves forward only, and only for its players.
  assert.equal((await call('POST', `/rooms/${code}/state`, { player: C, state: 'playing' })).status, 403);
  assert.equal((await call('POST', `/rooms/${code}/state`, { player: B, state: 'nope' })).status, 400);
  assert.equal((await call('POST', `/rooms/${code}/state`, { player: B, state: 'playing' })).body.state, 'playing');
  assert.equal((await call('POST', `/rooms/${code}/state`, { player: A, state: 'joined' })).body.state, 'playing');
  assert.equal((await call('POST', `/rooms/${code}/state`, { player: A, state: 'ended' })).body.state, 'ended');
  // Rematch: only the creator, back to waiting with the same seats (C still can't take B's).
  assert.equal((await call('POST', `/rooms/${code}/next`, { prev: '42', id: '43', player: B })).status, 403);
  const next = await call('POST', `/rooms/${code}/next`, { prev: '42', id: '43', player: A });
  assert.deepEqual([next.body.id, next.body.state, next.body.joiner], ['43', 'waiting', B]);
  assert.equal((await call('POST', `/rooms/${code}/join`, { player: C })).status, 409);
  assert.equal((await call('POST', `/rooms/${code}/join`, { player: B })).body.state, 'joined');
});

test('room cancel: creator only, before a join; the code then answers 410 cancelled', async () => {
  const { call, tick } = setup();
  const code = (await call('POST', '/rooms', { id: '7', stake: 0, player: A })).body.code as string;
  assert.equal((await call('DELETE', `/rooms/${code}?player=${B}`)).status, 403);
  assert.equal((await call('DELETE', `/rooms/${code}`)).status, 403);
  assert.equal((await call('DELETE', `/rooms/${code}?player=${A}`)).body.ok, true);
  const g = await call('GET', `/rooms/${code}`);
  assert.deepEqual([g.status, g.body.error], [410, 'room cancelled by its host']);
  assert.equal((await call('POST', `/rooms/${code}/join`, { player: B })).status, 410);
  // Deleting again is a no-op; tombstones go after 2 h.
  assert.equal((await call('DELETE', `/rooms/${code}?player=${A}`)).status, 200);
  tick(2 * 60 * 60_000 + 1);
  assert.equal((await call('GET', `/rooms/${code}`)).status, 404);
  // A room is kept alive by polling: idle only counts from the last touch.
  const k = (await call('POST', '/rooms', { id: '8', stake: 0, player: A })).body.code as string;
  for (let i = 0; i < 3; i++) {
    tick(ROOM_IDLE_MS - 60_000);
    assert.equal((await call('GET', `/rooms/${k}`)).status, 200);
  }
});

test('Quick Match pair registers its match as a room in either order (for the rematch)', async () => {
  const { call } = setup();
  const b = await call('POST', '/rooms', { id: '900', stake: 50_000_000, player: B, role: 'join' });
  assert.deepEqual([b.body.state, b.body.joiner, b.body.creator], ['joined', B, null]);
  const a = await call('POST', '/rooms', { id: '900', stake: 50_000_000, player: A, role: 'create' });
  assert.deepEqual([a.body.code, a.body.creator, a.body.players], [b.body.code, A, 2]);
  // A stranger can't take a seat by registering the same id.
  const c = await call('POST', '/rooms', { id: '900', stake: 50_000_000, player: C, role: 'join' });
  assert.deepEqual([c.body.creator, c.body.joiner], [A, B]);
});

test('queue stats: waiting per stake, who you could pair with, online count; the bot never counts', async () => {
  const bot = { address: C, available: () => false, play: () => undefined, stats: { active: 0, started: 0, finished: 0, cancelled: 0, failed: 0 } };
  const { call, tick } = setup({ bot });
  // A staked ticket and a free one (they never pair with each other).
  await call('POST', '/queue', { player: A, stake: 100_000_000 });
  await call('POST', '/queue', { player: B, stake: 0 });
  let s = await call('GET', '/queue/stats?stake=70000000');
  assert.deepEqual(s.body.waiting, [
    { stake: 0, players: 1 },
    { stake: 100_000_000, players: 1 },
  ]);
  // Any staked ticket is pairable for a staked pick; `near` only points across to the free pool.
  assert.equal(s.body.here, 1);
  assert.deepEqual(
    s.body.near.map((x: { stake: number }) => x.stake),
    [0],
  );
  assert.equal(s.body.online, 2);
  // Free counts the free pool only.
  assert.equal((await call('GET', '/queue/stats?stake=0')).body.here, 1);
  // The caller is left out.
  s = await call('GET', `/queue/stats?stake=100000000&player=${A}`);
  assert.equal(s.body.here, 0);
  assert.equal(s.body.waiting.length, 1);
  // A room counts its creator online; the bot polling /me does not.
  await call('POST', '/rooms', { id: '5', stake: 0, player: C });
  await call('GET', `/me/${C}`);
  assert.equal((await call('GET', '/queue/stats')).body.online, 2);
  assert.equal((await call('GET', '/queue/stats')).body.rooms.waiting, 1);
  tick(31_000);
  s = await call('GET', '/queue/stats');
  assert.deepEqual([s.body.online, s.body.waiting.length], [0, 0]);
});

test('GET /me: the live ticket, room and match of a player (resume after a reload)', async () => {
  const { call } = setup();
  assert.deepEqual((await call('GET', `/me/${A}`)).body, { player: A, ticket: null, room: null, match: null });
  assert.equal((await call('GET', '/me/nope')).status, 400);
  const t = await call('POST', '/queue', { player: A, stake: 100_000_000 });
  let me = await call('GET', `/me/${A}`);
  assert.deepEqual([me.body.ticket.ticket, me.body.ticket.state, me.body.match], [t.body.ticket, 'waiting', null]);
  await call('POST', '/queue', { player: B, stake: 100_000_000 });
  me = await call('GET', `/me/${A}`);
  assert.deepEqual([me.body.match.role, me.body.match.opponent, me.body.match.stake], ['create', B, 100_000_000]);
  // A room: waiting (no match yet), then joined (the match).
  const code = (await call('POST', '/rooms', { id: '77', stake: 0, player: C })).body.code as string;
  me = await call('GET', `/me/${C}`);
  assert.deepEqual([me.body.room.code, me.body.match], [code, null]);
  const D = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
  await call('POST', `/rooms/${code}/join`, { player: D });
  me = await call('GET', `/me/${D}`);
  assert.deepEqual([me.body.match.id, me.body.match.role, me.body.match.code, me.body.match.opponent], ['77', 'join', code, C]);
});

const rec = (id: string, over: Partial<HistoryRecord> = {}): HistoryRecord => ({
  matchId: id,
  players: [A, B],
  names: ['Lil Bean', 'Lil Pip'],
  stakes: [100_000_000, 100_000_000],
  scores: [600, 400],
  winner: 0,
  died: null,
  payout: { paid: [138_000_000, 60_000_000], net: [38_000_000, -40_000_000], moved: 40_000_000, fee: 2_000_000, why: 'A won on score' },
  bot: false,
  endedAt: 0,
  ...over,
});

test('history: report reads the chain (pending / aborted / recorded), settle adds the signature, paging and stats', async () => {
  const chain = new Map<string, ReadResult>([
    ['1', 'pending'],
    ['2', 'aborted'],
  ]);
  let reads = 0;
  let settled = 0;
  const { call, tick, now } = setup({
    reader: async (id) => {
      reads++;
      const r = chain.get(id.toString());
      return r === undefined ? null : r === 'pending' || r === 'aborted' || r === null ? r : { ...r, endedAt: now() };
    },
    settle: async () => {
      settled++;
      return { state: 'sent', signature: 'SIG' };
    },
  });
  assert.equal((await call('POST', '/history/report', { id: 'x' })).status, 400);
  assert.equal((await call('POST', '/history/report', { id: '9' })).status, 404);
  assert.equal((await call('POST', '/history/report', { id: '1' })).status, 409);
  const ab = await call('POST', '/history/report', { id: '2' });
  assert.deepEqual([ab.status, ab.body.recorded], [200, false]);
  chain.set('1', rec('1'));
  const ok = await call('POST', '/history/report', { id: '1' });
  assert.deepEqual([ok.status, ok.body.record.scores], [201, [600, 400]]);
  // Reporting again doesn't read the chain again.
  const before = reads;
  assert.equal((await call('POST', '/history/report', { id: '1' })).status, 200);
  assert.equal(reads, before);
  // A server settle records the match with its signature.
  tick(1000);
  chain.set('3', rec('3', { winner: 1, died: 0, scores: [100, 300], payout: { paid: [0, 190_000_000], net: [-100_000_000, 90_000_000], moved: 100_000_000, fee: 10_000_000, why: 'A died' } }));
  await call('POST', '/settle', { id: '3' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(settled, 1);
  tick(1000);
  chain.set('4', rec('4', { winner: null, scores: [500, 500], payout: { paid: [100_000_000, 100_000_000], net: [0, 0], moved: 0, fee: 0, why: 'Draw' } }));
  await call('POST', '/history/report', { id: '4' });

  const page1 = await call('GET', `/history/${A}?limit=2`);
  assert.deepEqual(
    page1.body.entries.map((e: { matchId: string; outcome: string }) => [e.matchId, e.outcome]),
    [
      ['4', 'draw'],
      ['3', 'lost'],
    ],
  );
  assert.equal(page1.body.entries[1].settleSig, 'SIG');
  assert.equal(page1.body.entries[1].opponentName, 'Lil Pip');
  const page2 = await call('GET', `/history/${A}?limit=2&before=${page1.body.next}`);
  assert.deepEqual([page2.body.entries.map((e: { matchId: string }) => e.matchId), page2.body.next], [['1'], null]);
  assert.deepEqual((await call('GET', `/stats/${A}`)).body, { played: 3, won: 1, lost: 1, draw: 1, net: -62_000_000, staked: 3, best: 600 });
  assert.deepEqual((await call('GET', `/stats/${B}`)).body, { played: 3, won: 1, lost: 1, draw: 1, net: 50_000_000, staked: 3, best: 500 });
  assert.equal((await call('GET', '/stats/nope')).status, 400);
  assert.equal((await call('GET', `/history/${C}`)).body.entries.length, 0);
});

test('history: no reader → 503; the JSON-lines file survives a restart (and a torn last line)', async () => {
  const { call } = setup();
  assert.equal((await call('POST', '/history/report', { id: '1' })).status, 503);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ldgb-hist-'));
  const file = path.join(dir, 'sub', 'history.jsonl');
  const h = new History(file);
  h.record(rec('1', { endedAt: 5 }));
  h.record(rec('2', { endedAt: 6, bot: true, players: [C, A] }));
  h.record({ ...rec('1', { endedAt: 5 }), settleSig: 'S1' });
  assert.equal(h.record({ ...rec('1', { endedAt: 5 }), settleSig: 'S1' }), false);
  fs.appendFileSync(file, '{"matchId":"3","play');
  const again = new History(file);
  assert.equal(again.size, 2);
  assert.equal(again.get('1')?.settleSig, 'S1');
  const mine = again.page(A).entries;
  assert.deepEqual(
    mine.map((e) => [e.matchId, e.opponentName]),
    [
      ['2', 'Bot'],
      ['1', 'Lil Pip'],
    ],
  );
  assert.ok(!fs.readFileSync(file, 'utf8').includes('secret'));
  fs.rmSync(dir, { recursive: true, force: true });
});
