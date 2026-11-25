// Accounts (staked play): the player's own Solana wallet is the account, through Wallet Standard
// (Phantom, Solflare, Backpack, MetaMask when it registers a Solana wallet). The fast in-match key
// (the "game key", a burner) is DERIVED from that wallet, so it is the same on every device and
// survives clearing site data:
//
//   1. The wallet signs GAME_KEY_MESSAGE once (solana:signMessage, no transaction, no fee).
//   2. game key seed = sha256(signature); Keypair.fromSeed(seed). Ed25519 signatures are
//      deterministic, so the same wallet always gives the same game key. The signature never
//      leaves the browser.
//   3. First time only: the wallet signs linkMessage(...) (with a server nonce) and the game key
//      signs the same text; the server checks both and stores wallet ↔ game key.
//   4. After that, account calls are signed silently by the game key (authHeader).
//
// Caveat (TECH §9, README Limits): a site that gets a wallet to sign GAME_KEY_MESSAGE can rebuild
// that game key. The message says so, and it only ever holds devnet play money.
//
// Never change GAME_KEY_MESSAGE: every player's game key comes from its exact bytes (a new version
// would hand everyone a new, empty key).
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { Keypair, PublicKey, SystemProgram, Transaction, type Connection } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { baseConnection } from './lobby';
import { ServerError, type HistoryEntry, type PlayerStats } from './server';
import { BASE_FEE, RENT_EXEMPT_MIN, withdraw } from './wallet';

export { PublicKey };

/** The text every player's wallet signs to make its game key. Never change it (see top). */
export const GAME_KEY_MESSAGE =
  'Lil Dudes Go Brr: create my game key (v1)\n\n' +
  'Only sign this on the Lil Dudes Go Brr site. It is not a transaction and costs nothing.\n' +
  'Anyone who gets this signature can use your game key, so never sign it anywhere else.';

/** The Solana cluster the game plays on (Wallet Standard chain id). */
export const GAME_CHAIN = 'solana:devnet';

/** The first-time link proof, signed by the wallet and by the game key (same text). */
export function linkMessage(p: { wallet: string; burner: string; nonce: string; issuedAt: number }): string {
  return (
    'Lil Dudes Go Brr: link my game key\n\n' +
    `Wallet: ${p.wallet}\n` +
    `Game key: ${p.burner}\n` +
    `Nonce: ${p.nonce}\n` +
    `Issued: ${new Date(p.issuedAt).toISOString()}\n\n` +
    'This only links your game key to your wallet. It is not a transaction and costs nothing.'
  );
}

/** A guest (browser-only) game key agrees to fold its history into an account. */
export function mergeMessage(guest: string, wallet: string): string {
  return `Lil Dudes Go Brr: merge guest key ${guest} into account ${wallet}`;
}

const enc = new TextEncoder();

/** Signs `text` with a keypair (ed25519, detached); base58 signature. */
export function signText(kp: Keypair, text: string): string {
  return bs58.encode(nacl.sign.detached(enc.encode(text), kp.secretKey));
}

/** Checks a base58 ed25519 signature of `text` by `pubkey` (base58). Never throws. */
export function verifyText(pubkey: string, text: string, signature: string): boolean {
  try {
    const pk = bs58.decode(pubkey);
    const sig = bs58.decode(signature);
    if (pk.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(enc.encode(text), sig, pk);
  } catch {
    return false;
  }
}

/** A keypair as text (base58 secret key) for the browser's cache, and back (null if unreadable). */
export const keyToText = (kp: Keypair): string => bs58.encode(kp.secretKey);
export function keyFromText(s: string | null | undefined): Keypair | null {
  if (!s) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(s));
  } catch {
    return null;
  }
}

/** A Solana address, or null (base58, 32 bytes). Profile's withdraw field uses it. */
export function parseAddress(s: string): PublicKey | null {
  try {
    const t = s.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t) || bs58.decode(t).length !== 32) return null;
    return new PublicKey(t);
  } catch {
    return null;
  }
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The game key from the wallet's signature of GAME_KEY_MESSAGE (pure; deriveBurner uses it). */
export async function burnerFromSignature(signature: Uint8Array): Promise<Keypair> {
  if (signature.length !== 64) throw new Error('game key: expected a 64-byte ed25519 signature');
  return Keypair.fromSeed(await sha256(signature));
}

// ---- Wallet Standard ------------------------------------------------------------------------

type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> };
type DisconnectFeature = { disconnect(): Promise<void> };
type SignMessageFeature = {
  signMessage(...inputs: { account: WalletAccount; message: Uint8Array }[]): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
};
type SignAndSendFeature = {
  signAndSendTransaction(
    ...inputs: { account: WalletAccount; chain: string; transaction: Uint8Array; options?: { commitment?: string; skipPreflight?: boolean } }[]
  ): Promise<readonly { signature: Uint8Array }[]>;
};
type SignTransactionFeature = {
  signTransaction(...inputs: { account: WalletAccount; chain?: string; transaction: Uint8Array }[]): Promise<readonly { signedTransaction: Uint8Array }[]>;
};

const feature = <T>(w: Wallet, name: string): T | null => ((w.features as Record<string, unknown>)[name] as T | undefined) ?? null;

/** A wallet the game can use: it connects, signs messages and signs (or signs and sends) a tx. */
export interface GameWallet {
  name: string;
  /** data: URL of the wallet's icon. */
  icon: string;
  wallet: Wallet;
}

const usable = (w: Wallet) =>
  !!feature(w, 'standard:connect') &&
  !!feature(w, 'solana:signMessage') &&
  (!!feature(w, 'solana:signAndSendTransaction') || !!feature(w, 'solana:signTransaction')) &&
  w.chains.some((c) => c.startsWith('solana:'));

/** The Solana wallets installed in this browser that the game can use. */
export function listWallets(): GameWallet[] {
  return getWallets()
    .get()
    .filter(usable)
    .map((wallet) => ({ name: wallet.name, icon: wallet.icon, wallet }));
}

/** Calls `cb` when a wallet registers or unregisters (extensions load late). Returns an unsubscribe. */
export function onWalletsChange(cb: (wallets: GameWallet[]) => void): () => void {
  const api = getWallets();
  const offs = [api.on('register', () => cb(listWallets())), api.on('unregister', () => cb(listWallets()))];
  return () => offs.forEach((off) => off());
}

/** A connected wallet: the account (address) the player picked. */
export interface ConnectedWallet {
  name: string;
  icon: string;
  /** The wallet's address (base58): the account id. */
  address: string;
  account: WalletAccount;
  wallet: Wallet;
}

/** Opens the wallet's connect prompt (or reconnects silently with `silent`). Throws if refused. */
export async function connectWallet(w: GameWallet, opts: { silent?: boolean } = {}): Promise<ConnectedWallet> {
  const connect = feature<ConnectFeature>(w.wallet, 'standard:connect');
  if (!connect) throw new Error(`${w.name} can't connect`);
  const { accounts } = await connect.connect(opts.silent ? { silent: true } : undefined);
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0];
  if (!account) throw new Error(`${w.name} shared no Solana account`);
  return { name: w.name, icon: w.icon, address: account.address, account, wallet: w.wallet };
}

/** Disconnects (where the wallet supports it). The game key in memory should be dropped too. */
export async function disconnectWallet(c: ConnectedWallet): Promise<void> {
  await feature<DisconnectFeature>(c.wallet, 'standard:disconnect')
    ?.disconnect()
    .catch(() => undefined);
}

/** Has the wallet sign `text` (a popup); returns the raw signature, checked against the account. */
async function walletSign(c: ConnectedWallet, text: string): Promise<Uint8Array> {
  const sm = feature<SignMessageFeature>(c.wallet, 'solana:signMessage');
  if (!sm) throw new Error(`${c.name} can't sign messages`);
  const message = enc.encode(text);
  const [out] = await sm.signMessage({ account: c.account, message });
  if (!out) throw new Error(`${c.name} returned no signature`);
  // Some wallets prefix what they sign; the game only accepts the exact text.
  if (out.signedMessage && hex(out.signedMessage) !== hex(message)) throw new Error(`${c.name} changed the message it signed`);
  if (!nacl.sign.detached.verify(message, out.signature, bs58.decode(c.address))) throw new Error(`${c.name} returned a signature that doesn't match its address`);
  return out.signature;
}

/** The player's game key: one wallet popup (signs GAME_KEY_MESSAGE). Same wallet → same key. */
export async function deriveBurner(c: ConnectedWallet): Promise<Keypair> {
  return burnerFromSignature(await walletSign(c, GAME_KEY_MESSAGE));
}

// ---- Server: link, profile, auth --------------------------------------------------------------

/** The Authorization scheme for account calls signed by the game key. */
const AUTH = 'LDGB';

/** What the game key signs for one request: method, path (no query), time, body hash. */
export async function authText(method: string, path: string, ts: number, body: string): Promise<string> {
  return `LDGB auth v1\n${method.toUpperCase()} ${path}\n${ts}\n${hex(await sha256(enc.encode(body)))}`;
}

/** `Authorization` value for an account call: the game key signs method + path + time + body. */
export async function authHeader(burner: Keypair, method: string, path: string, body: string, ts = Date.now()): Promise<string> {
  return `${AUTH} ${burner.publicKey.toBase58()}:${ts}:${signText(burner, await authText(method, path, ts, body))}`;
}

/** Checks an authHeader (server side). `skewMs`: how far its time may be from now. */
export async function verifyAuthHeader(
  header: string | undefined | null,
  method: string,
  path: string,
  body: string,
  now = Date.now(),
  skewMs = 120_000,
): Promise<{ ok: true; burner: string; ts: number; signature: string } | { ok: false; error: string }> {
  const m = header?.match(/^LDGB ([1-9A-HJ-NP-Za-km-z]{32,44}):(\d{10,16}):([1-9A-HJ-NP-Za-km-z]{60,100})$/);
  if (!m) return { ok: false, error: 'missing or malformed Authorization' };
  const [, burner, tsRaw, signature] = m as unknown as [string, string, string, string];
  const ts = Number(tsRaw);
  if (Math.abs(now - ts) > skewMs) return { ok: false, error: 'Authorization expired (check the device clock)' };
  if (!verifyText(burner, await authText(method, path, ts, body), signature)) return { ok: false, error: 'bad signature' };
  return { ok: true, burner, ts, signature };
}

/** An account as the server knows it (GET /account/:wallet). Lamports in stats. */
export interface AccountProfile {
  wallet: string;
  /** The account's game key. */
  burner: string;
  name: string | null;
  createdAt: number;
  lastSeen: number;
  /** Guest keys merged in (their history counts as the account's). */
  guests: string[];
  stats: PlayerStats;
}

async function call<T>(server: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  const text = body === undefined ? undefined : JSON.stringify(body);
  try {
    res = await fetch(`${server.replace(/\/$/, '')}${path}`, {
      method,
      headers: { ...(text === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: text,
    });
  } catch {
    throw new ServerError(`${method} ${path}: server unreachable`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; retryAfterSec?: number };
  if (!res.ok) throw new ServerError(`${method} ${path}: ${json.error ?? res.status}`, res.status, json.retryAfterSec);
  return json;
}

/** A signed account call (POST, JSON body, game-key Authorization). */
async function signedPost<T>(server: string, burner: Keypair, path: string, body: unknown): Promise<T> {
  const text = JSON.stringify(body);
  let res: Response;
  try {
    res = await fetch(`${server.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: await authHeader(burner, 'POST', path, text) },
      body: text,
    });
  } catch {
    throw new ServerError(`POST ${path}: server unreachable`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; retryAfterSec?: number };
  if (!res.ok) throw new ServerError(`POST ${path}: ${json.error ?? res.status}`, res.status, json.retryAfterSec);
  return json;
}

/** The account for `wallet`, or null if it was never linked. */
export async function accountProfile(server: string, wallet: string): Promise<AccountProfile | null> {
  try {
    return await call<AccountProfile>(server, 'GET', `/account/${wallet}`);
  } catch (e) {
    if (e instanceof ServerError && e.status === 404) return null;
    throw e;
  }
}

/** The account's matches (its game key and merged guest keys), newest first; `next` → `before`. */
export async function accountHistory(server: string, wallet: string, opts: { limit?: number; before?: number } = {}): Promise<{ entries: HistoryEntry[]; next: number | null }> {
  const q = new URLSearchParams();
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.before !== undefined) q.set('before', String(opts.before));
  return call(server, 'GET', `/account/${wallet}/history${q.toString() ? `?${q}` : ''}`);
}

/**
 * First-time link (one more wallet popup): the wallet and the game key both sign linkMessage with
 * a fresh server nonce; the server stores wallet ↔ game key. Safe to call again (same pair = no-op;
 * a new game key for the same wallet replaces the old one, which becomes a merged guest key).
 */
export async function linkAccount(server: string, c: ConnectedWallet, burner: Keypair, opts: { name?: string } = {}): Promise<AccountProfile> {
  const { nonce } = await call<{ nonce: string }>(server, 'GET', '/auth/nonce');
  const issuedAt = Date.now();
  const p = { wallet: c.address, burner: burner.publicKey.toBase58(), nonce, issuedAt };
  const text = linkMessage(p);
  const walletSignature = bs58.encode(await walletSign(c, text));
  return call<AccountProfile>(server, 'POST', '/account/link', { ...p, walletSignature, burnerSignature: signText(burner, text), name: opts.name });
}

/**
 * Connect flow in one call: derive the game key (one popup), then link it if the server doesn't
 * know this pair yet (one more popup, first time only). Returns the key and the profile.
 */
export async function signIn(server: string, c: ConnectedWallet, opts: { name?: string } = {}): Promise<{ burner: Keypair; profile: AccountProfile; linked: boolean }> {
  const burner = await deriveBurner(c);
  const known = await accountProfile(server, c.address);
  if (known && known.burner === burner.publicKey.toBase58()) return { burner, profile: known, linked: false };
  return { burner, profile: await linkAccount(server, c, burner, opts), linked: true };
}

/** Sets the account's display name (1–16 letters, digits, spaces, _ or -). Signed by the game key. */
export async function setAccountName(server: string, burner: Keypair, name: string): Promise<AccountProfile> {
  return signedPost<AccountProfile>(server, burner, '/account/name', { name });
}

// ---- Money ------------------------------------------------------------------------------------

/** "Add SOL from wallet": an unsigned devnet transfer wallet → game key, for the wallet to sign. */
export async function depositTx(base: Connection, from: PublicKey, burner: PublicKey, lamports: number): Promise<{ tx: Transaction; blockhash: string; lastValidBlockHeight: number }> {
  if (!Number.isSafeInteger(lamports) || lamports <= 0) throw new Error('deposit: amount must be a positive number of lamports');
  const { blockhash, lastValidBlockHeight } = await base.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: from, blockhash, lastValidBlockHeight }).add(SystemProgram.transfer({ fromPubkey: from, toPubkey: burner, lamports }));
  return { tx, blockhash, lastValidBlockHeight };
}

/** Sends `lamports` from the connected wallet to the game key (one wallet popup). Returns the signature. */
export async function depositFromWallet(c: ConnectedWallet, burner: PublicKey, lamports: number, base: Connection = baseConnection()): Promise<string> {
  const { tx, blockhash, lastValidBlockHeight } = await depositTx(base, new PublicKey(c.address), burner, lamports);
  const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const sas = feature<SignAndSendFeature>(c.wallet, 'solana:signAndSendTransaction');
  let signature: string;
  if (sas) {
    const [out] = await sas.signAndSendTransaction({ account: c.account, chain: GAME_CHAIN, transaction: bytes, options: { commitment: 'confirmed' } });
    if (!out) throw new Error(`${c.name} didn't send the transfer`);
    signature = bs58.encode(out.signature);
  } else {
    const st = feature<SignTransactionFeature>(c.wallet, 'solana:signTransaction');
    if (!st) throw new Error(`${c.name} can't sign transactions`);
    const [out] = await st.signTransaction({ account: c.account, chain: GAME_CHAIN, transaction: bytes });
    if (!out) throw new Error(`${c.name} didn't sign the transfer`);
    signature = await base.sendRawTransaction(out.signedTransaction, { skipPreflight: false });
  }
  const res = await base.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value.err) throw new Error(`deposit ${signature} failed: ${JSON.stringify(res.value.err)}`);
  return signature;
}

/** Withdraw from the game key to the connected wallet (no address to type). */
export function withdrawToWallet(base: Connection, burner: Keypair, wallet: ConnectedWallet | string, amount: number | 'all' = 'all') {
  return withdraw(base, burner, new PublicKey(typeof wallet === 'string' ? wallet : wallet.address), amount);
}

/**
 * Connecting on a device that played as a guest: moves the guest key's balance (minus the fee) to
 * the account's game key (silent: the guest key signs) and merges its history into the account.
 */
export async function migrateGuest(
  server: string,
  guest: Keypair,
  accountBurner: Keypair,
  wallet: string,
  base: Connection = baseConnection(),
): Promise<{ moved: number; signature?: string; merged: boolean }> {
  if (guest.publicKey.equals(accountBurner.publicKey)) return { moved: 0, merged: false };
  let moved = 0;
  let signature: string | undefined;
  const balance = await base.getBalance(guest.publicKey, 'confirmed');
  // Dust below the fee plus a new account's rent minimum can't move; it stays behind.
  if (balance > BASE_FEE + RENT_EXEMPT_MIN) {
    const r = await withdraw(base, guest, accountBurner.publicKey, 'all');
    moved = r.amount;
    signature = r.signature;
  }
  await signedPost(server, accountBurner, '/account/merge-guest', {
    wallet,
    guest: guest.publicKey.toBase58(),
    guestSignature: signText(guest, mergeMessage(guest.publicKey.toBase58(), wallet)),
  });
  return { moved, signature, merged: true };
}
