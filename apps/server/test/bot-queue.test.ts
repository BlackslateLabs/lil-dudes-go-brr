import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app';
import type { BotService } from '../src/bot';

const A = '4oarhNvGuppu2VKsYy3aSvYPSFTwovcY58t1B3a8aA4Z';
const B = 'HJZnaPcLHcVBeqtUH5hcDYrq16Z8J4oBahKfz3hZH1br';
const BOT = 'FdZLtcw7CMAHk2bsnqesxcYj3Ybjgux3GcqtDy63rfbB';

function setup(cap = 1) {
  let t = 1_000_000;
  const played: { id: bigint; opponent: string }[] = [];
  const bot: BotService = {
    address: BOT,
    stats: { active: 0, started: 0, finished: 0, cancelled: 0, failed: 0 },
    available: () => played.length < cap,
    play: (id, opponent) => void played.push({ id, opponent }),
  };
  const app = createApp({ now: () => t, bot });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await res.json()) as Record<string, unknown>;
  };
  return { call, played, tick: (ms: number) => (t += ms) };
}

test('a free ticket alone for 5 s gets the bot (human joins, bot creates)', async () => {
  const { call, tick, played } = setup();
  const a = await call('POST', '/queue', { player: A, stake: 0 });
  tick(4_000);
  assert.equal((await call('GET', `/queue/${a.ticket}`)).state, 'waiting');
  tick(1_500);
  const m = await call('GET', `/queue/${a.ticket}`);
  assert.deepEqual([m.state, m.role, m.opponent, m.bot, m.stake], ['matched', 'join', BOT, true, 0]);
  assert.equal(played.length, 1);
  assert.equal(played[0]!.id.toString(), m.id);
  assert.equal(played[0]!.opponent, A);
  // Polling again doesn't start a second bot match.
  await call('GET', `/queue/${a.ticket}`);
  assert.equal(played.length, 1);
});

test('the bot never takes a staked ticket, and a human pairs first', async () => {
  const { call, tick, played } = setup();
  const s = await call('POST', '/queue', { player: A, stake: 50_000_000 });
  tick(30_000);
  assert.equal((await call('GET', `/queue/${s.ticket}`)).state, 'waiting');
  await call('DELETE', `/queue/${s.ticket}`);
  const a = await call('POST', '/queue', { player: A, stake: 0 });
  tick(2_000);
  const b = await call('POST', '/queue', { player: B, stake: 0 });
  assert.deepEqual([b.state, b.opponent, b.bot], ['matched', A, undefined]);
  tick(10_000);
  const am = await call('GET', `/queue/${a.ticket}`);
  assert.deepEqual([am.role, am.opponent], ['create', B]);
  assert.equal(played.length, 0);
});

test('the bot is busy at its cap: the ticket keeps waiting', async () => {
  const { call, tick, played } = setup(1);
  const a = await call('POST', '/queue', { player: A, stake: 0 });
  tick(6_000);
  await call('GET', `/queue/${a.ticket}`);
  const b = await call('POST', '/queue', { player: B, stake: 0 });
  tick(6_000);
  assert.equal((await call('GET', `/queue/${b.ticket}`)).state, 'waiting');
  assert.equal(played.length, 1);
});
