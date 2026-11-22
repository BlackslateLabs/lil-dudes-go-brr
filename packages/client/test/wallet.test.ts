// Money edges: withdraw rent rules, "Settle now" decisions (against a fake connection).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair, PublicKey, type Connection } from '@solana/web3.js';
import { chain, CODEC_VERSION, planWithdraw, RENT_EXEMPT_MIN as R, settleNow } from '../src/index';

test('planWithdraw: all, partial, rent dust, new destinations, fee', () => {
  const fee = 5_000;
  assert.deepEqual(planWithdraw(100_000_000, 'all', 0), { ok: true, amount: 100_000_000 - fee, leaves: 0, fee });
  assert.deepEqual(planWithdraw(100_000_000, 50_000_000, 5), { ok: true, amount: 50_000_000, leaves: 50_000_000 - fee, fee });
  // Leaving 1..R-1 lamports would strand a non-rent-exempt account: refused, with the max that works.
  const dust = planWithdraw(10_000_000, 10_000_000 - fee - 100, 5);
  assert.equal(dust.ok, false);
  if (!dust.ok) {
    assert.match(dust.reason, /rent-exempt/);
    assert.deepEqual([dust.max, dust.all], [10_000_000 - fee - R, 10_000_000 - fee]);
    assert.equal(planWithdraw(10_000_000, dust.max!, 5).ok, true);
  }
  // Exactly the minimum left is fine.
  assert.equal(planWithdraw(10_000_000, 10_000_000 - fee - R, 5).ok, true);
  // A fresh destination needs ≥ the minimum; an existing one takes anything.
  assert.equal(planWithdraw(10_000_000, R - 1, 0).ok, false);
  assert.equal(planWithdraw(5 * R, R - 1, 1).ok, true);
  // Too much, nothing, nonsense.
  assert.equal(planWithdraw(1_000_000, 2_000_000, 1).ok, false);
  assert.equal(planWithdraw(4_000, 'all', 1).ok, false);
  assert.equal(planWithdraw(1_000_000, -5, 1).ok, false);
  assert.equal(planWithdraw(1_000_000, 1.5, 1).ok, false);
});

/** A fake base-layer connection holding one Match (+ its vault) and a payer balance. */
function fakeBase(o: { status: number; stake: number; vault: number; onBase?: boolean; payer?: PublicKey; payerBalance?: number }) {
  const id = 77n;
  const a = chain.matchAccounts(id);
  const data = new Uint8Array(chain.MATCH_LEN);
  const dv = new DataView(data.buffer);
  dv.setBigUint64(8, id, true);
  dv.setBigUint64(16, BigInt(o.stake), true);
  data[280] = o.status;
  data[chain.STATE_OFFSET] = CODEC_VERSION;
  const sent: string[] = [];
  const conn = {
    rpcEndpoint: 'http://fake',
    getAccountInfo: async (pk: PublicKey) =>
      pk.equals(a.game) ? { data, owner: o.onBase === false ? chain.DELEGATION_PROGRAM : chain.PROGRAM_ID, lamports: 1, executable: false } : null,
    getBalance: async (pk: PublicKey) => (pk.equals(a.vault) ? o.vault : o.payer && pk.equals(o.payer) ? (o.payerBalance ?? 0) : 0),
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }),
    sendRawTransaction: async () => {
      sent.push('settle');
      o.vault = 0;
      return 'SETTLESIG';
    },
    confirmTransaction: async () => ({ value: { err: null } }),
    getSignaturesForAddress: async () => [],
  } as unknown as Connection;
  return { conn, id, sent };
}

test('settleNow: waits for base, reports settled, pays with the burner or through the server', async () => {
  const S = 50_000_000;
  const payer = Keypair.generate();
  // Still undelegating.
  assert.deepEqual(await settleNow(fakeBase({ status: 5, stake: S, vault: 2 * S, onBase: false }).conn, payer, 77n), { state: 'not-on-base' });
  // Already paid by the action.
  assert.equal((await settleNow(fakeBase({ status: 5, stake: S, vault: 0 }).conn, payer, 77n)).state, 'settled');
  assert.deepEqual(await settleNow(fakeBase({ status: 5, stake: 0, vault: 0 }).conn, payer, 77n), { state: 'settled', by: 'free' });
  // Action late, burner can pay the fee: it sends `settle` itself.
  const f = fakeBase({ status: 5, stake: S, vault: 2 * S, payer: payer.publicKey, payerBalance: 1_000_000 });
  assert.deepEqual(await settleNow(f.conn, payer, 77n), { state: 'sent', signature: 'SETTLESIG', via: 'payer' });
  assert.equal(f.sent.length, 1);
  // Burner has 0 SOL: the server's sponsor sends it.
  const g = fakeBase({ status: 5, stake: S, vault: 2 * S, payer: payer.publicKey, payerBalance: 0 });
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push(`${url} ${init.body}`);
    return new Response(JSON.stringify({ signature: 'SERVERSIG' }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    assert.deepEqual(await settleNow(g.conn, payer, 77n, 'http://srv/'), { state: 'sent', signature: 'SERVERSIG', via: 'server' });
    assert.deepEqual(calls, ['http://srv/settle {"id":"77"}']);
    await assert.rejects(settleNow(g.conn, payer, 77n), /no SOL for the fee/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
