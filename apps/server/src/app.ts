// Matchmaking for live matches (MVP §3.4–3.5): room codes and a quick-match queue. Not in the
// trust path: the server holds no keys and never touches a match on-chain. It only tells two
// players which match id to use and who creates it (the creator calls create_match, the other
// join_match, then either delegates). State is in memory with short TTLs (one instance is enough
// for the hackathon; a restart only drops waiting players).
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import type { Faucet } from './faucet';
import { Budget, RateLimit } from './limits';

/** Stake tiers in lamports (programs/lil_dudes STAKE_TIERS). */
export const STAKE_TIERS = [0, 50_000_000, 100_000_000, 250_000_000] as const;
const ROOM_TTL_MS = 15 * 60_000;
/** A queued player who stops polling for this long is dropped. */
const TICKET_TTL_MS = 30_000;
/** Room codes: 6 characters, no 0/O/1/I/L lookalikes. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

type Role = 'create' | 'join';

interface Room {
  code: string;
  id: string;
  stake: number;
  createdAt: number;
}

interface Ticket {
  ticket: string;
  player: string;
  stake: number;
  seenAt: number;
  match?: { id: string; role: Role; opponent: string; matchedAt: number };
}

export interface ServerOptions {
  now?: () => number;
  random?: (n: number) => number;
  /** The burner faucet (POST /topup); off when not given. */
  faucet?: Faucet | null;
  /** Take the client IP from X-Forwarded-For (behind Render/Fly's proxy). Default false. */
  trustProxy?: boolean;
  /** Override the faucet policy (tests, env). */
  topup?: Partial<TopupPolicy>;
}

/** MVP §4 "Faucet abuse": a burner is topped up to `stake + reserve` (≤ maxBalance), once per
 *  `burnerEveryMs`; an IP gets `ipMax` top-ups per `ipWindowMs`; all top-ups together spend at
 *  most `hourlyLamports` per hour. */
export interface TopupPolicy {
  /** Lamports on top of the stake: create rent (~0.0153) + delegation deposits (~0.012, back at
   *  undelegation) + fees. The joiner needs less; one number keeps it simple. */
  reserve: number;
  maxBalance: number;
  burnerEveryMs: number;
  ipMax: number;
  ipWindowMs: number;
  hourlyLamports: number;
}

export const TOPUP_POLICY: TopupPolicy = {
  reserve: 35_000_000,
  maxBalance: 300_000_000,
  burnerEveryMs: 10 * 60_000,
  ipMax: 3,
  ipWindowMs: 10 * 60_000,
  hourlyLamports: 3_000_000_000,
};

/** The caller's IP: X-Forwarded-For's first hop when behind a trusted proxy, else the socket. */
export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

const isPubkey = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isU64 = (s: unknown): s is string => typeof s === 'string' && /^\d{1,20}$/.test(s) && BigInt(s) < 2n ** 64n;
const isTier = (n: unknown): n is number => typeof n === 'number' && (STAKE_TIERS as readonly number[]).includes(n);

export function createApp(opts: ServerOptions = {}) {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? ((n: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % n);
  const rooms = new Map<string, Room>();
  const tickets = new Map<string, Ticket>();
  const policy: TopupPolicy = { ...TOPUP_POLICY, ...opts.topup };
  const faucet = opts.faucet ?? null;
  const perBurner = new RateLimit(policy.burnerEveryMs, 1, now);
  const perIp = new RateLimit(policy.ipWindowMs, policy.ipMax, now);
  const budget = new Budget(60 * 60_000, policy.hourlyLamports, now);
  const topping = new Set<string>();

  const token = (len: number, alphabet = CODE_ALPHABET) => Array.from({ length: len }, () => alphabet[random(alphabet.length)]).join('');
  const matchId = () => {
    const w = crypto.getRandomValues(new Uint32Array(2));
    return ((BigInt(w[0]!) << 32n) | BigInt(w[1]!)).toString();
  };
  const sweep = () => {
    const t = now();
    for (const [code, r] of rooms) if (t - r.createdAt > ROOM_TTL_MS) rooms.delete(code);
    for (const [id, k] of tickets) if (t - k.seenAt > TICKET_TTL_MS) tickets.delete(id);
  };
  const ticketView = (k: Ticket) =>
    k.match ? { ticket: k.ticket, state: 'matched' as const, stake: k.stake, ...k.match } : { ticket: k.ticket, state: 'waiting' as const, stake: k.stake };

  const app = new Hono();
  app.use('*', cors());
  app.get('/health', (c) => c.json({ ok: true, service: 'lil-dudes-server', rooms: rooms.size, queued: tickets.size }));

  // --- room codes --------------------------------------------------------------------------
  // The creator makes the match on-chain first, then registers its id here and shares the code.
  app.post('/rooms', async (c) => {
    sweep();
    const body = (await c.req.json().catch(() => null)) as { id?: unknown; stake?: unknown } | null;
    if (!body || !isU64(body.id) || !isTier(body.stake)) return c.json({ error: 'need { id: u64 string, stake: tier }' }, 400);
    for (const r of rooms.values()) if (r.id === body.id) return c.json(r);
    let code = token(6);
    while (rooms.has(code)) code = token(6);
    const room: Room = { code, id: body.id, stake: body.stake, createdAt: now() };
    rooms.set(code, room);
    return c.json(room, 201);
  });

  app.get('/rooms/:code', (c) => {
    sweep();
    const room = rooms.get(c.req.param('code').toUpperCase());
    return room ? c.json(room) : c.json({ error: 'no such room' }, 404);
  });

  app.delete('/rooms/:code', (c) => {
    rooms.delete(c.req.param('code').toUpperCase());
    return c.json({ ok: true });
  });

  // --- quick match -------------------------------------------------------------------------
  // Join the queue for a stake tier; poll the ticket. Two waiting players on the same tier are
  // paired at once: the earlier one creates the match (role 'create'), the other joins.
  app.post('/queue', async (c) => {
    sweep();
    const body = (await c.req.json().catch(() => null)) as { player?: unknown; stake?: unknown } | null;
    if (!body || !isPubkey(body.player) || !isTier(body.stake)) return c.json({ error: 'need { player: pubkey, stake: tier }' }, 400);
    const player = body.player;
    for (const k of tickets.values()) {
      if (k.player === player) {
        k.seenAt = now();
        return c.json(ticketView(k));
      }
    }
    const mine: Ticket = { ticket: token(16, CODE_ALPHABET.toLowerCase() + '0123456789'), player, stake: body.stake, seenAt: now() };
    const waiting = [...tickets.values()].find((k) => !k.match && k.stake === mine.stake && k.player !== player);
    if (waiting) {
      const id = matchId();
      const t = now();
      waiting.match = { id, role: 'create', opponent: player, matchedAt: t };
      mine.match = { id, role: 'join', opponent: waiting.player, matchedAt: t };
    }
    tickets.set(mine.ticket, mine);
    return c.json(ticketView(mine), 201);
  });

  app.get('/queue/:ticket', (c) => {
    sweep();
    const k = tickets.get(c.req.param('ticket'));
    if (!k) return c.json({ error: 'no such ticket (expired?)' }, 404);
    k.seenAt = now();
    return c.json(ticketView(k));
  });

  app.delete('/queue/:ticket', (c) => {
    tickets.delete(c.req.param('ticket'));
    return c.json({ ok: true });
  });

  // --- faucet (MVP §3.9 Top up, §4) -----------------------------------------------------------
  // Tops a burner up to stake + reserve (devnet SOL from the sponsor wallet). Already enough → no-op.
  app.get('/faucet', async (c) => {
    if (!faucet) return c.json({ enabled: false });
    const balance = await faucet.balance(faucet.address).catch(() => null);
    return c.json({ enabled: true, address: faucet.address, balance, policy, spentLastHour: budget.used() });
  });

  app.post('/topup', async (c) => {
    if (!faucet) return c.json({ error: 'faucet not configured' }, 503);
    const body = (await c.req.json().catch(() => null)) as { burner?: unknown; stake?: unknown } | null;
    const stake = body?.stake ?? 0;
    if (!body || !isPubkey(body.burner) || !isTier(stake)) return c.json({ error: 'need { burner: pubkey, stake?: tier }' }, 400);
    const burner = body.burner;
    if (burner === faucet.address) return c.json({ error: 'not the sponsor' }, 400);
    const target = Math.min(policy.maxBalance, stake + policy.reserve);
    if (topping.has(burner)) return c.json({ error: 'a top-up for this burner is in flight' }, 409);
    topping.add(burner);
    try {
      const balance = await faucet.balance(burner);
      if (balance >= target) return c.json({ sent: 0, balance, target });
      const amount = target - balance;
      const ip = clientIp(c, opts.trustProxy ?? false);
      const b = perBurner.check(burner);
      const i = perIp.check(ip);
      if (!b.ok || !i.ok) {
        const retryAfterSec = Math.ceil(Math.max(b.retryMs, i.retryMs) / 1000);
        c.header('Retry-After', String(retryAfterSec));
        return c.json({ error: b.ok ? 'too many top-ups from this address, try later' : 'this burner was topped up recently', retryAfterSec, balance, target }, 429);
      }
      if (!budget.allows(amount)) return c.json({ error: 'faucet budget used up for this hour, try later', balance, target }, 429);
      perBurner.hit(burner);
      perIp.hit(ip);
      budget.spend(amount);
      const signature = await faucet.send(burner, amount).catch((e: unknown) => {
        budget.spend(-amount);
        throw e;
      });
      return c.json({ sent: amount, signature, balance: target, target });
    } catch (e) {
      return c.json({ error: `top-up failed: ${String(e instanceof Error ? e.message : e).slice(0, 120)}` }, 502);
    } finally {
      topping.delete(burner);
    }
  });

  return app;
}
