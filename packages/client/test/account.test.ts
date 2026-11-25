// Accounts: the game key derivation, link text, signatures and the request auth.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import {
  authHeader, burnerFromSignature, GAME_KEY_MESSAGE, linkMessage, mergeMessage, parseAddress, signText, verifyAuthHeader, verifyText,
} from '../src/index';

const enc = new TextEncoder();

test('the game key is the same every time for the same wallet, and differs between wallets', async () => {
  const wallet = Keypair.generate();
  const sig1 = nacl.sign.detached(enc.encode(GAME_KEY_MESSAGE), wallet.secretKey);
  const sig2 = nacl.sign.detached(enc.encode(GAME_KEY_MESSAGE), wallet.secretKey);
  const a = await burnerFromSignature(sig1);
  const b = await burnerFromSignature(sig2);
  assert.equal(a.publicKey.toBase58(), b.publicKey.toBase58());
  const other = await burnerFromSignature(nacl.sign.detached(enc.encode(GAME_KEY_MESSAGE), Keypair.generate().secretKey));
  assert.notEqual(a.publicKey.toBase58(), other.publicKey.toBase58());
  assert.notEqual(a.publicKey.toBase58(), wallet.publicKey.toBase58());
  await assert.rejects(burnerFromSignature(new Uint8Array(10)));
});

test('the game key message never changes (every player key depends on its bytes)', () => {
  assert.equal(
    GAME_KEY_MESSAGE,
    'Lil Dudes Go Brr: create my game key (v1)\n\nOnly sign this on the Lil Dudes Go Brr site. It is not a transaction and costs nothing.\nAnyone who gets this signature can use your game key, so never sign it anywhere else.',
  );
});

test('link and merge texts carry every field; signatures verify and tampering fails', () => {
  const w = Keypair.generate();
  const g = Keypair.generate();
  const p = { wallet: w.publicKey.toBase58(), burner: g.publicKey.toBase58(), nonce: 'ab'.repeat(16), issuedAt: 1_800_000_000_000 };
  const text = linkMessage(p);
  for (const v of [p.wallet, p.burner, p.nonce, new Date(p.issuedAt).toISOString()]) assert.ok(text.includes(v));
  const sig = signText(w, text);
  assert.equal(verifyText(p.wallet, text, sig), true);
  assert.equal(verifyText(p.burner, text, sig), false);
  assert.equal(verifyText(p.wallet, `${text}!`, sig), false);
  assert.equal(verifyText('nope', text, sig), false);
  assert.equal(verifyText(p.wallet, text, 'nope'), false);
  assert.ok(mergeMessage(p.burner, p.wallet).includes(p.burner) && mergeMessage(p.burner, p.wallet).includes(p.wallet));
});

test('authHeader verifies for the same request only, within the time window', async () => {
  const k = Keypair.generate();
  const t = 1_800_000_000_000;
  const body = JSON.stringify({ name: 'Suparno' });
  const h = await authHeader(k, 'POST', '/account/name', body, t);
  const ok = await verifyAuthHeader(h, 'POST', '/account/name', body, t + 1000);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.burner, k.publicKey.toBase58());
  assert.equal((await verifyAuthHeader(h, 'POST', '/account/name', '{"name":"Kai"}', t)).ok, false);
  assert.equal((await verifyAuthHeader(h, 'POST', '/account/merge-guest', body, t)).ok, false);
  assert.equal((await verifyAuthHeader(h, 'POST', '/account/name', body, t + 10 * 60_000)).ok, false);
  assert.equal((await verifyAuthHeader('Bearer x', 'POST', '/account/name', body, t)).ok, false);
  assert.equal((await verifyAuthHeader(undefined, 'POST', '/account/name', body, t)).ok, false);
});

test('parseAddress takes 32-byte base58 addresses only', () => {
  const k = Keypair.generate().publicKey.toBase58();
  assert.equal(parseAddress(` ${k} `)?.toBase58(), k);
  assert.equal(parseAddress('hello'), null);
  assert.equal(parseAddress('0OIl'.repeat(10)), null);
  assert.equal(parseAddress(''), null);
});
