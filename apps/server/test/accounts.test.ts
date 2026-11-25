// Accounts: link (two signatures + a single-use nonce), game-key auth, names, guest merges,
// relinking, and persistence through a Store (in memory here; db.test.ts runs against Neon).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { authHeader, burnerFromSignature, GAME_KEY_MESSAGE, linkMessage, mergeMessage, signText } from '@lil-dudes/client';
import { Accounts } from '../src/accounts';
import { createApp } from '../src/app';
import { History, type HistoryRecord } from '../src/history';
import { memoryStore } from '../src/store';

const T0 = 1_800_000_000_000;

function setup(store = memoryStore()) {
  let t = T0;
  const now = () => t;
  const history = new History(null, (r) => store.saveMatch(r));
  const accounts = new Accounts(store, now);
  const app = createApp({ now, history, accounts });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const signed = async (key: Keypair, path: string, body: unknown, ts = t) => {
    const raw = JSON.stringify(body);
    return call('POST', path, raw, { authorization: await authHeader(key, 'POST', path, raw, ts) });
  };
  return { call, signed, history, accounts, store, tick: (ms: number) => (t += ms), now };
}

/** A player: their wallet, and the game key derived from it the way the web does. */
async function player() {
  const wallet = Keypair.generate();
  const burner = await burnerFromSignature(bs58.decode(signText(wallet, GAME_KEY_MESSAGE)));
  return { wallet, burner, w: wallet.publicKey.toBase58(), b: burner.publicKey.toBase58() };
}

async function link(s: ReturnType<typeof setup>, p: Awaited<ReturnType<typeof player>>, opts: { name?: string; burner?: Keypair } = {}) {
  const burner = opts.burner ?? p.burner;
  const { nonce } = (await s.call('GET', '/auth/nonce')).body as { nonce: string };
  const msg = { wallet: p.w, burner: burner.publicKey.toBase58(), nonce, issuedAt: s.now() };
  const text = linkMessage(msg);
  return s.call('POST', '/account/link', { ...msg, walletSignature: signText(p.wallet, text), burnerSignature: signText(burner, text), name: opts.name });
}

const rec = (id: string, a: string, b: string, scores: [number, number], endedAt: number): HistoryRecord => ({
  matchId: id,
  players: [a, b],
  names: ['A', 'B'],
  stakes: [50_000_000, 50_000_000],
  scores,
  winner: scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1,
  died: null,
  payout: { paid: [0, 0], net: scores[0] > scores[1] ? [10, -10] : [-10, 10], moved: 10, fee: 0, why: '' },
  bot: false,
  endedAt,
});

test('link: both signatures and a fresh nonce make an account; the profile reads back', async () => {
  const s = setup();
  const p = await player();
  const r = await link(s, p, { name: '  Lil   Suparno ' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.wallet, r.body.burner, r.body.name], [p.w, p.b, 'Lil Suparno']);
  const got = await s.call('GET', `/account/${p.w}`);
  assert.deepEqual([got.status, got.body.burner], [200, p.b]);
  assert.equal((await s.call('GET', `/account/${Keypair.generate().publicKey.toBase58()}`)).status, 404);
  // Written through to the store.
  assert.equal(s.store.accounts.get(p.w)?.burner, p.b);
  // Same pair again: fine, still one account.
  assert.equal((await link(s, p)).status, 201);
  assert.equal(s.accounts.size, 1);
});

test('link refuses a reused nonce, a wrong wallet or game-key signature, a stale time and a taken key', async () => {
  const s = setup();
  const p = await player();
  const { nonce } = (await s.call('GET', '/auth/nonce')).body as { nonce: string };
  const msg = { wallet: p.w, burner: p.b, nonce, issuedAt: s.now() };
  const text = linkMessage(msg);
  const stranger = Keypair.generate();
  // Wrong wallet signature (the nonce is spent even so).
  const bad = await s.call('POST', '/account/link', { ...msg, walletSignature: signText(stranger, text), burnerSignature: signText(p.burner, text) });
  assert.equal(bad.status, 401);
  const again = await s.call('POST', '/account/link', { ...msg, walletSignature: signText(p.wallet, text), burnerSignature: signText(p.burner, text) });
  assert.deepEqual([again.status, again.body.error], [401, 'unknown or expired nonce, ask for a new one']);
  // Someone else's game key: the game key signature fails.
  const n2 = ((await s.call('GET', '/auth/nonce')).body as { nonce: string }).nonce;
  const m2 = { wallet: p.w, burner: p.b, nonce: n2, issuedAt: s.now() };
  const t2 = linkMessage(m2);
  assert.equal((await s.call('POST', '/account/link', { ...m2, walletSignature: signText(p.wallet, t2), burnerSignature: signText(stranger, t2) })).status, 401);
  // A nonce that expired.
  const n3 = ((await s.call('GET', '/auth/nonce')).body as { nonce: string }).nonce;
  s.tick(6 * 60_000);
  const m3 = { wallet: p.w, burner: p.b, nonce: n3, issuedAt: s.now() };
  const t3 = linkMessage(m3);
  assert.equal((await s.call('POST', '/account/link', { ...m3, walletSignature: signText(p.wallet, t3), burnerSignature: signText(p.burner, t3) })).status, 401);
  // Junk.
  assert.equal((await s.call('POST', '/account/link', { wallet: 'x' })).status, 400);
  // A game key already linked to another wallet.
  assert.equal((await link(s, p)).status, 201);
  const q = await player();
  assert.equal((await link(s, q, { burner: p.burner })).status, 409);
});

test('game-key auth: name changes need a fresh, linked, correctly signed request', async () => {
  const s = setup();
  const p = await player();
  await link(s, p);
  const ok = await s.signed(p.burner, '/account/name', { name: 'Kai fan' });
  assert.deepEqual([ok.status, ok.body.name], [200, 'Kai fan']);
  assert.equal(s.store.accounts.get(p.w)?.name, 'Kai fan');
  // Bad names.
  assert.equal((await s.signed(p.burner, '/account/name', { name: 'x'.repeat(17) })).status, 400);
  assert.equal((await s.signed(p.burner, '/account/name', { name: '<script>' })).status, 400);
  // Not linked.
  assert.equal((await s.signed(Keypair.generate(), '/account/name', { name: 'Nobody' })).status, 403);
  // No header / old / replayed.
  assert.equal((await s.call('POST', '/account/name', { name: 'Nope' })).status, 401);
  assert.equal((await s.signed(p.burner, '/account/name', { name: 'Old' }, T0 - 5 * 60_000)).status, 401);
  const raw = JSON.stringify({ name: 'Twice' });
  const h = await authHeader(p.burner, 'POST', '/account/name', raw, s.now());
  assert.equal((await s.call('POST', '/account/name', raw, { authorization: h })).status, 200);
  assert.equal((await s.call('POST', '/account/name', raw, { authorization: h })).status, 401);
});

test("merge-guest folds a guest key's matches into the account's history and stats", async () => {
  const s = setup();
  const p = await player();
  const guest = Keypair.generate();
  const g = guest.publicKey.toBase58();
  const opp = Keypair.generate().publicKey.toBase58();
  await link(s, p);
  s.history.record(rec('1', g, opp, [300, 100], T0 - 3000));
  s.history.record(rec('2', opp, p.b, [500, 200], T0 - 2000));
  const before = await s.call('GET', `/account/${p.w}`);
  assert.equal((before.body.stats as { played: number }).played, 1);
  const body = { wallet: p.w, guest: g, guestSignature: signText(guest, mergeMessage(g, p.w)) };
  // The guest must sign; the account's game key must sign the request.
  assert.equal((await s.signed(p.burner, '/account/merge-guest', { ...body, guestSignature: signText(Keypair.generate(), mergeMessage(g, p.w)) })).status, 401);
  assert.equal((await s.signed(Keypair.generate(), '/account/merge-guest', body)).status, 403);
  const merged = await s.signed(p.burner, '/account/merge-guest', body);
  assert.equal(merged.status, 200);
  assert.deepEqual(merged.body.guests, [g]);
  const stats = merged.body.stats as { played: number; won: number; lost: number };
  assert.deepEqual([stats.played, stats.won, stats.lost], [2, 1, 1]);
  const h = await s.call('GET', `/account/${p.w}/history?limit=10`);
  const entries = h.body.entries as { matchId: string; outcome: string }[];
  assert.deepEqual(entries.map((e) => [e.matchId, e.outcome]), [['2', 'lost'], ['1', 'won']]);
  // Another account can't take the same guest key.
  const q = await player();
  await link(s, q);
  const steal = await s.signed(q.burner, '/account/merge-guest', { wallet: q.w, guest: g, guestSignature: signText(guest, mergeMessage(g, q.w)) });
  assert.equal(steal.status, 409);
  // The store has it, and the matches.
  await s.history.flush();
  assert.equal(s.store.guests.get(g)?.wallet, p.w);
  assert.equal(s.store.matches.size, 2);
});

test('a new game key for the same wallet replaces the old one, which keeps counting as the account', async () => {
  const s = setup();
  const p = await player();
  await link(s, p);
  const opp = Keypair.generate().publicKey.toBase58();
  s.history.record(rec('7', p.b, opp, [900, 100], T0 - 1000));
  const fresh = Keypair.generate();
  const r = await link(s, p, { burner: fresh });
  assert.equal(r.status, 201);
  assert.equal(r.body.burner, fresh.publicKey.toBase58());
  assert.deepEqual(r.body.guests, [p.b]);
  assert.equal((r.body.stats as { played: number }).played, 1);
  // The old key no longer signs for the account.
  assert.equal((await s.signed(p.burner, '/account/name', { name: 'Old key' })).status, 403);
  assert.equal((await s.signed(fresh, '/account/name', { name: 'New key' })).status, 200);
});

test('a restart loads accounts, guest links and history back from the store', async () => {
  const store = memoryStore();
  const s1 = setup(store);
  const p = await player();
  await link(s1, p, { name: 'Returning' });
  s1.history.record(rec('9', p.b, Keypair.generate().publicKey.toBase58(), [10, 20], T0));
  await s1.history.flush();
  const data = await store.load();
  const accounts = new Accounts(store);
  accounts.seed(data.accounts, data.guests);
  const history = new History(null, (r) => store.saveMatch(r));
  history.seed(data.matches);
  const app = createApp({ history, accounts });
  const res = await app.request(`/account/${p.w}`);
  const body = (await res.json()) as { name: string; stats: { played: number; lost: number } };
  assert.deepEqual([res.status, body.name, body.stats.played, body.stats.lost], [200, 'Returning', 1, 1]);
});

test('a database outage answers 503 and changes nothing', async () => {
  const store = memoryStore();
  store.saveAccount = async () => {
    throw new Error('connection refused');
  };
  const s = setup(store);
  const p = await player();
  const r = await link(s, p);
  assert.equal(r.status, 503);
  assert.equal(s.accounts.size, 0);
});
