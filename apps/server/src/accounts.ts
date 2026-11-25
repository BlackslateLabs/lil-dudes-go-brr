// Accounts: the player's own wallet ↔ its game key (a burner derived from the wallet's signature,
// see packages/client src/live/account.ts). The server never sees a secret: linking needs a
// signature by the wallet AND by the game key over the same text (with a single-use nonce), and
// later account calls are signed by the game key (Authorization: LDGB …). Profiles and history are
// public data. In memory for reads, written through to the database when there is one (store.ts).
import { type Context, type Hono } from 'hono';
import { linkMessage, mergeMessage, verifyAuthHeader, verifyText } from '@lil-dudes/client';
import type { History, PlayerStats } from './history';
import { RateLimit } from './limits';
import type { AccountRow, GuestLink, Store } from './store';

/** A failed account operation with the HTTP status to answer. */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 503,
  ) {
    super(message);
  }
}

export class Accounts {
  private byWallet = new Map<string, AccountRow>();
  /** Main game key → wallet. */
  private walletOfBurner = new Map<string, string>();
  /** Merged guest key → wallet, and wallet → its guest keys. */
  private walletOfGuest = new Map<string, string>();
  private guestsOf = new Map<string, Set<string>>();

  constructor(
    private readonly store: Store | null = null,
    private readonly now: () => number = Date.now,
  ) {}

  /** Loads what the database has (on start). */
  seed(accounts: Iterable<AccountRow>, guests: Iterable<GuestLink>): void {
    for (const a of accounts) this.put(a);
    for (const g of guests) this.putGuest(g);
  }

  get size(): number {
    return this.byWallet.size;
  }

  get(wallet: string): AccountRow | undefined {
    return this.byWallet.get(wallet);
  }

  /** The account whose MAIN game key this is. */
  byBurner(burner: string): AccountRow | undefined {
    const w = this.walletOfBurner.get(burner);
    return w ? this.byWallet.get(w) : undefined;
  }

  guests(wallet: string): string[] {
    return [...(this.guestsOf.get(wallet) ?? [])];
  }

  /** Every key whose matches count as the account's (game key first). */
  keysOf(wallet: string): string[] {
    const a = this.byWallet.get(wallet);
    return a ? [a.burner, ...this.guests(wallet)] : [];
  }

  /**
   * Links `burner` as `wallet`'s game key (both signatures already checked). Same pair again =
   * refresh. A new game key for a known wallet replaces the old one, which becomes a merged guest
   * key (its history stays the account's). A key that belongs to another account is refused.
   */
  async link(wallet: string, burner: string, name?: string | null): Promise<AccountRow> {
    if (wallet === burner) throw new AccountError('the game key must not be the wallet itself', 400);
    const owner = this.walletOfBurner.get(burner) ?? this.walletOfGuest.get(burner);
    if (owner && owner !== wallet) throw new AccountError('this game key belongs to another account', 409);
    const t = this.now();
    const old = this.byWallet.get(wallet);
    const row: AccountRow = { wallet, burner, name: name ?? old?.name ?? null, createdAt: old?.createdAt ?? t, lastSeen: t };
    const retired = old && old.burner !== burner ? old.burner : null;
    await this.save(async (s) => {
      await s.saveAccount(row);
      if (retired) await s.saveGuest({ guest: retired, wallet, linkedAt: t });
    });
    if (old && retired) this.walletOfBurner.delete(old.burner);
    this.put(row);
    if (retired) this.putGuest({ guest: retired, wallet, linkedAt: t });
    return row;
  }

  async setName(wallet: string, name: string): Promise<AccountRow> {
    const old = this.byWallet.get(wallet);
    if (!old) throw new AccountError('no such account', 404);
    const row = { ...old, name, lastSeen: this.now() };
    await this.save((s) => s.saveAccount(row));
    this.put(row);
    return row;
  }

  /** Folds a guest key's history into the account (the guest's signature already checked). */
  async mergeGuest(wallet: string, guest: string): Promise<void> {
    const a = this.byWallet.get(wallet);
    if (!a) throw new AccountError('no such account', 404);
    if (guest === a.burner) return;
    if (this.walletOfBurner.has(guest)) throw new AccountError("that key is another account's game key", 409);
    const owner = this.walletOfGuest.get(guest);
    if (owner === wallet) return;
    if (owner) throw new AccountError('that guest key was already merged into another account', 409);
    const g = { guest, wallet, linkedAt: this.now() };
    await this.save((s) => s.saveGuest(g));
    this.putGuest(g);
  }

  private async save(fn: (s: Store) => Promise<void>): Promise<void> {
    if (!this.store) return;
    try {
      await fn(this.store);
    } catch (e) {
      console.error(`accounts: database write failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new AccountError('account storage is unavailable right now, try again', 503);
    }
  }

  private put(a: AccountRow) {
    this.byWallet.set(a.wallet, a);
    this.walletOfBurner.set(a.burner, a.wallet);
  }

  private putGuest(g: GuestLink) {
    this.walletOfGuest.set(g.guest, g.wallet);
    let set = this.guestsOf.get(g.wallet);
    if (!set) this.guestsOf.set(g.wallet, (set = new Set()));
    set.add(g.guest);
  }
}

/** GET /account/:wallet. */
export interface ProfileJson {
  wallet: string;
  burner: string;
  name: string | null;
  createdAt: number;
  lastSeen: number;
  guests: string[];
  stats: PlayerStats;
}

const isPubkey = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isSig = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(s);
const isNonce = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);
/** A display name: 1–16 letters, digits, spaces, _ or - (spaces collapsed, trimmed). */
export const cleanName = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const n = s.trim().replace(/\s+/g, ' ');
  return /^[A-Za-z0-9 _-]{1,16}$/.test(n) ? n : null;
};

export interface AccountRouteDeps {
  accounts: Accounts;
  history: History;
  now: () => number;
  ipOf: (c: Context) => string;
  /** How long a link nonce stays valid (default 5 min). */
  nonceTtlMs?: number;
}

/** Mounts /auth/nonce and /account/* on the app. */
export function accountRoutes(app: Hono, d: AccountRouteDeps): void {
  const { accounts, history, now } = d;
  const nonceTtl = d.nonceTtlMs ?? 5 * 60_000;
  const nonces = new Map<string, number>();
  /** Game-key signatures already used (replay guard), until they'd be too old anyway. */
  const used = new Map<string, number>();
  const nonceLimit = new RateLimit(60_000, 30, now);
  const writeLimit = new RateLimit(60_000, 20, now);

  const limited = (c: Context, lim: RateLimit) => {
    const r = lim.take(d.ipOf(c));
    if (r.ok) return null;
    c.header('Retry-After', String(Math.ceil(r.retryMs / 1000)));
    return c.json({ error: 'too many requests, try later', retryAfterSec: Math.ceil(r.retryMs / 1000) }, 429);
  };

  const prune = () => {
    const t = now();
    for (const [n, exp] of nonces) if (exp < t) nonces.delete(n);
    for (const [s, exp] of used) if (exp < t) used.delete(s);
  };

  const profile = (a: AccountRow): ProfileJson => {
    const keys = accounts.keysOf(a.wallet);
    return { wallet: a.wallet, burner: a.burner, name: a.name, createdAt: a.createdAt, lastSeen: a.lastSeen, guests: accounts.guests(a.wallet), stats: history.statsMany(keys) };
  };

  const fail = (c: Context, e: unknown) => {
    if (e instanceof AccountError) return c.json({ error: e.message }, e.status);
    throw e;
  };

  /** Checks the game-key Authorization on a POST; returns its account, or an error response. */
  const authed = async (c: Context, raw: string): Promise<{ account: AccountRow } | { res: Response }> => {
    const v = await verifyAuthHeader(c.req.header('authorization'), 'POST', c.req.path, raw, now());
    if (!v.ok) return { res: c.json({ error: v.error }, 401) };
    if (used.has(v.signature)) return { res: c.json({ error: 'this request was already used' }, 401) };
    used.set(v.signature, now() + 5 * 60_000);
    const account = accounts.byBurner(v.burner);
    if (!account) return { res: c.json({ error: 'this game key is not linked to an account' }, 403) };
    return { account };
  };

  const body = (raw: string): Record<string, unknown> | null => {
    try {
      const j = JSON.parse(raw) as unknown;
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  // A single-use nonce for the first-time link proof.
  app.get('/auth/nonce', (c) => {
    const lim = limited(c, nonceLimit);
    if (lim) return lim;
    prune();
    const b = crypto.getRandomValues(new Uint8Array(16));
    const nonce = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    nonces.set(nonce, now() + nonceTtl);
    return c.json({ nonce, expiresAt: now() + nonceTtl });
  });

  // First-time link: the wallet and the game key both signed linkMessage(...).
  app.post('/account/link', async (c) => {
    const lim = limited(c, writeLimit);
    if (lim) return lim;
    const b = body(await c.req.text());
    const { wallet, burner, nonce, issuedAt, walletSignature, burnerSignature } = b ?? {};
    if (!isPubkey(wallet) || !isPubkey(burner) || !isNonce(nonce) || typeof issuedAt !== 'number' || !isSig(walletSignature) || !isSig(burnerSignature)) {
      return c.json({ error: 'need { wallet, burner, nonce, issuedAt, walletSignature, burnerSignature, name? }' }, 400);
    }
    const name = b?.name === undefined || b.name === null || b.name === '' ? null : cleanName(b.name);
    if (b?.name && !name) return c.json({ error: 'name: 1–16 letters, digits, spaces, _ or -' }, 400);
    prune();
    const exp = nonces.get(nonce);
    // Single use, whatever happens next.
    nonces.delete(nonce);
    if (exp === undefined) return c.json({ error: 'unknown or expired nonce, ask for a new one' }, 401);
    if (Math.abs(now() - issuedAt) > 10 * 60_000) return c.json({ error: 'issuedAt is too far from now (check the device clock)' }, 401);
    const text = linkMessage({ wallet, burner, nonce, issuedAt });
    if (!verifyText(wallet, text, walletSignature)) return c.json({ error: 'the wallet signature does not match' }, 401);
    if (!verifyText(burner, text, burnerSignature)) return c.json({ error: 'the game key signature does not match' }, 401);
    try {
      const a = await accounts.link(wallet, burner, name);
      return c.json(profile(a), 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post('/account/name', async (c) => {
    const lim = limited(c, writeLimit);
    if (lim) return lim;
    const raw = await c.req.text();
    const auth = await authed(c, raw);
    if ('res' in auth) return auth.res;
    const name = cleanName(body(raw)?.name);
    if (!name) return c.json({ error: 'name: 1–16 letters, digits, spaces, _ or -' }, 400);
    try {
      return c.json(profile(await accounts.setName(auth.account.wallet, name)));
    } catch (e) {
      return fail(c, e);
    }
  });

  // A guest key (this browser's old burner) folds its history into the account; it signs
  // mergeMessage(guest, wallet), the account's game key signs the request.
  app.post('/account/merge-guest', async (c) => {
    const lim = limited(c, writeLimit);
    if (lim) return lim;
    const raw = await c.req.text();
    const auth = await authed(c, raw);
    if ('res' in auth) return auth.res;
    const { wallet, guest, guestSignature } = body(raw) ?? {};
    if (!isPubkey(wallet) || !isPubkey(guest) || !isSig(guestSignature)) return c.json({ error: 'need { wallet, guest, guestSignature }' }, 400);
    if (wallet !== auth.account.wallet) return c.json({ error: "that isn't this game key's account" }, 403);
    if (!verifyText(guest, mergeMessage(guest, wallet), guestSignature)) return c.json({ error: 'the guest key signature does not match' }, 401);
    try {
      await accounts.mergeGuest(wallet, guest);
      return c.json(profile(accounts.get(wallet)!));
    } catch (e) {
      return fail(c, e);
    }
  });

  app.get('/account/:wallet', (c) => {
    const wallet = c.req.param('wallet');
    if (!isPubkey(wallet)) return c.json({ error: 'bad wallet' }, 400);
    const a = accounts.get(wallet);
    if (!a) return c.json({ error: 'no such account' }, 404);
    return c.json(profile(a));
  });

  app.get('/account/:wallet/history', (c) => {
    const wallet = c.req.param('wallet');
    if (!isPubkey(wallet)) return c.json({ error: 'bad wallet' }, 400);
    if (!accounts.get(wallet)) return c.json({ error: 'no such account' }, 404);
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
    const beforeRaw = c.req.query('before');
    const before = beforeRaw !== undefined && /^\d{1,15}$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
    return c.json(history.pageMany(accounts.keysOf(wallet), limit, before));
  });
}
