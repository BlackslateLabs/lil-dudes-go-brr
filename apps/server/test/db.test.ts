// Live smoke test against the real database (Neon): skipped unless DATABASE_URL is set.
//   cd apps/server && pnpm exec tsx --env-file-if-exists=.env --test test/db.test.ts
// Migrates, links a throwaway account, reads it back, then deletes every row it made. Never
// prints the URL.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import { Accounts } from '../src/accounts';
import { History, type HistoryRecord } from '../src/history';
import { pgStore } from '../src/store';

const url = process.env.DATABASE_URL?.trim();

test('database: migrate, link, history, read back, clean up', { skip: !url && 'DATABASE_URL not set' }, async () => {
  const store = pgStore(url!);
  const wallet = Keypair.generate().publicKey.toBase58();
  const burner = Keypair.generate().publicKey.toBase58();
  const fresh = Keypair.generate().publicKey.toBase58();
  const matchId = `smoke-${Date.now()}`;
  try {
    await store.migrate();
    await store.migrate(); // idempotent
    const accounts = new Accounts(store);
    await accounts.link(wallet, burner, 'Smoke test');
    // Relink: the old key becomes a guest link.
    await accounts.link(wallet, fresh);
    const history = new History(null, (r) => store.saveMatch(r));
    const r: HistoryRecord = {
      matchId,
      players: [fresh, Keypair.generate().publicKey.toBase58()],
      names: ['Smoke', 'Test'],
      stakes: [0, 0],
      scores: [1, 2],
      winner: 1,
      died: null,
      payout: { paid: [0, 0], net: [0, 0], moved: 0, fee: 0, why: 'smoke' },
      bot: false,
      endedAt: Date.now(),
    };
    history.record(r);
    history.record({ ...r, settleSig: 'sig-smoke' });
    await history.flush();
    const data = await store.load();
    const a = data.accounts.find((x) => x.wallet === wallet);
    assert.deepEqual([a?.burner, a?.name], [fresh, 'Smoke test']);
    assert.equal(data.guests.find((g) => g.guest === burner)?.wallet, wallet);
    const m = data.matches.find((x) => x.matchId === matchId);
    assert.deepEqual([m?.scores, m?.settleSig], [[1, 2], 'sig-smoke']);
  } finally {
    await store.deleteAccount(wallet).catch(() => undefined);
    await store.deleteMatch(matchId).catch(() => undefined);
    await store.close();
  }
});
