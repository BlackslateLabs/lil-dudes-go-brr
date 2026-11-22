import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp, TOPUP_POLICY } from '../src/app';
import type { Faucet } from '../src/faucet';
import { loadSponsorKey } from '../src/faucet';

const SPONSOR = 'FdZLtcw7CMAHk2bsnqesxcYj3Ybjgux3GcqtDy63rfbB';
const A = '4oarhNvGuppu2VKsYy3aSvYPSFTwovcY58t1B3a8aA4Z';
const B = 'HJZnaPcLHcVBeqtUH5hcDYrq16Z8J4oBahKfz3hZH1br';
const C = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const D = '7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2';

function fakeFaucet(start: Record<string, number> = {}) {
  const balances = new Map(Object.entries(start));
  const sent: { to: string; lamports: number }[] = [];
  let fail = false;
  const faucet: Faucet = {
    address: SPONSOR,
    balance: async (pk) => balances.get(pk) ?? 0,
    send: async (pk, lamports) => {
      await new Promise((r) => setTimeout(r, 5));
      if (fail) throw new Error('rpc down');
      balances.set(pk, (balances.get(pk) ?? 0) + lamports);
      sent.push({ to: pk, lamports });
      return `sig${sent.length}`;
    },
  };
  return { faucet, sent, balances, setFail: (f: boolean) => (fail = f) };
}

function setup(start?: Record<string, number>, topup?: Partial<typeof TOPUP_POLICY>) {
  let t = 5_000_000;
  const f = fakeFaucet(start);
  const app = createApp({ now: () => t, faucet: f.faucet, trustProxy: true, topup });
  const call = async (body: unknown, ip = '1.1.1.1') => {
    const res = await app.request('/topup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `${ip}, 10.0.0.1` }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, retryAfter: res.headers.get('retry-after') };
  };
  return { ...f, app, call, tick: (ms: number) => (t += ms) };
}

test('topup fills a burner to stake + reserve, then no-ops while it has enough', async () => {
  const { call, sent } = setup({ [A]: 1_000_000 });
  const r = await call({ burner: A, stake: 50_000_000 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.sent, r.body.target, r.body.signature], [84_000_000, 85_000_000, 'sig1']);
  // Enough already: nothing sent, the burner's limit is not used.
  const again = await call({ burner: A, stake: 50_000_000 });
  assert.deepEqual([again.status, again.body.sent], [200, 0]);
  assert.equal(sent.length, 1);
  // Free tier: just the reserve. Capped at maxBalance for the top tier.
  assert.equal((await call({ burner: B }, '2.2.2.2')).body.target, TOPUP_POLICY.reserve);
  assert.equal((await call({ burner: C, stake: 250_000_000 }, '3.3.3.3')).body.target, 285_000_000);
});

test('topup limits: per burner, per IP, hourly budget; refuses bad input and the sponsor', async () => {
  const { call, tick, balances, app } = setup({}, { ipMax: 2, hourlyLamports: 200_000_000 });
  assert.equal((await call({ burner: 'nope' })).status, 400);
  assert.equal((await call({ burner: A, stake: 7 })).status, 400);
  assert.equal((await call({ burner: SPONSOR })).status, 400);
  assert.equal((await call({ burner: A })).status, 200);
  // A spent its balance (played a match): a second top-up within 10 min is refused.
  balances.set(A, 0);
  const again = await call({ burner: A }, '9.9.9.9');
  assert.equal(again.status, 429);
  assert.match(String(again.body.error), /recently/);
  assert.ok(Number(again.retryAfter) > 500 && Number(again.retryAfter) <= 600);
  // The same IP may top up 2 burners per window.
  assert.equal((await call({ burner: B })).status, 200);
  const ipCapped = await call({ burner: C });
  assert.equal(ipCapped.status, 429);
  assert.match(String(ipCapped.body.error), /this address/);
  // After the window both reset.
  tick(10 * 60_000 + 1);
  assert.equal((await call({ burner: A })).status, 200);
  // Hourly budget: 3 × 35M spent; a 250M-tier top-up (285M) does not fit 200M.
  const big = await call({ burner: D, stake: 250_000_000 }, '4.4.4.4');
  assert.equal(big.status, 429);
  assert.match(String(big.body.error), /budget/);
  // No faucet configured → 503.
  const off = createApp({});
  assert.equal((await off.request('/topup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 503);
  assert.equal(((await (await app.request('/faucet')).json()) as { enabled: boolean }).enabled, true);
});

test('topup: concurrent requests for one burner send once; a failed send refunds the budget', async () => {
  const { call, sent, setFail } = setup();
  const [r1, r2] = await Promise.all([call({ burner: A }), call({ burner: A }, '5.5.5.5')]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(sent.length, 1);
  setFail(true);
  const failed = await call({ burner: B }, '6.6.6.6');
  assert.equal(failed.status, 502);
  assert.match(String(failed.body.error), /rpc down/);
});

test('sponsor key loads from the env and never echoes a bad one', () => {
  assert.equal(loadSponsorKey({}), null);
  const key = Array.from({ length: 64 }, (_, i) => (i * 7) % 256);
  assert.throws(() => loadSponsorKey({ SPONSOR_SECRET_KEY: '[1,2,3]' }), (e: Error) => !e.message.includes('1,2,3'));
  assert.throws(() => loadSponsorKey({ SPONSOR_SECRET_KEY: JSON.stringify(key) }), /malformed/);
});
