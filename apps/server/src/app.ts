// Matchmaking for live matches (MVP §3.4–3.5): room codes (with a lifecycle) and a quick-match
// queue at an exact stake, queue stats, resume after a reload (/me), and the match history. Not in
// the trust path: the server never decides an outcome. It tells two players which match id to use
// and who creates it (the creator calls create_match, the other join_match, then either
// delegates); history is read back from the Match account on the base layer, never taken from a
// client. Matchmaking state is in memory with short TTLs (one instance is enough for the
// hackathon; a restart only drops waiting players); history can persist to a file.
import { Hono, type Context } from 'hono';
import { baseConnection, settleNow } from '@lil-dudes/client';
import { Accounts, accountRoutes } from './accounts';
import type { BotService } from './bot';
import type { Faucet } from './faucet';
import { guard } from './guard';
import { History } from './history';
import { Budget, RateLimit } from './limits';
import type { MatchReader } from './record';

/** Stake tiers in lamports (programs/lil_dudes STAKE_TIERS). */
export const STAKE_TIERS = [0, 50_000_000, 100_000_000, 250_000_000] as const;
/** Any stake in [STAKE_MIN, STAKE_MAX] lamports is accepted too (the web's "stake any amount").
 *  The server only pairs equal stakes; the program decides what it takes (today only the tiers:
 *  the web checks that before signing). */
export const STAKE_MIN = 10_000_000;
export const STAKE_MAX = 5_000_000_000;
/** A room nobody touched (polled, joined, moved on) for this long expires. The on-chain sweeper
 *  refunds an abandoned OPEN match after 20 min on its own. */
export const ROOM_IDLE_MS = 30 * 60_000;
/** An expired / cancelled code answers 410 (not 404) for this long. */
const TOMBSTONE_MS = 2 * 60 * 60_000;
/** "Online" = a live ticket, a room or a /me poll seen within this long. */
export const ONLINE_MS = 30_000;
/** A queued player who stops polling for this long is dropped. */
const TICKET_TTL_MS = 30_000;
/** Room codes: 6 characters, no 0/O/1/I/L lookalikes. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

type Role = 'create' | 'join';

/** waiting: the creator opened the match, seat free · joined: a second player took the seat ·
 *  playing: the match is on the rollup · ended: over (a rematch moves it back to waiting). */
export type RoomState = 'waiting' | 'joined' | 'playing' | 'ended';
const RANK: Record<RoomState, number> = { waiting: 0, joined: 1, playing: 2, ended: 3 };

interface Room {
  code: string;
  id: string;
  stake: number;
  createdAt: number;
  seenAt: number;
  state: RoomState;
  /** The two seats (wallets); a room never has more than two players. */
  creator?: string;
  joiner?: string;
}

interface Ticket {
  ticket: string;
  player: string;
  stake: number;
  seenAt: number;
  createdAt: number;
  match?: { id: string; role: Role; opponent: string; matchedAt: number; bot?: boolean };
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
  /** The online bot: takes a FREE queue ticket nobody matched within `botAfterMs`. */
  bot?: BotService | null;
  botAfterMs?: number;
  /** For /health (the sweeper runs on its own timer, see sweeper.ts). */
  sweeperStats?: () => unknown;
  /** POST /settle: "Settle now" for a burner with no SOL (the sponsor pays the fee). */
  settle?: (id: bigint) => Promise<{ state: string; signature?: string }>;
  /** Allowed web origins (CORS_ORIGINS); default local dev origins; '*' = any. */
  origins?: string[] | '*';
  /** Requests per IP per minute over all routes (default 240). */
  perMinute?: number;
  /** Match history (default: in memory only). */
  history?: History;
  /** Accounts (wallet ↔ game key; default: in memory only). */
  accounts?: Accounts;
  /** For /health: is the database connected (DATABASE_URL)? */
  database?: () => boolean;
  /** Reads a finished match from the base layer for the history (default: none: reports get 503). */
  reader?: MatchReader | null;
}

/** MVP §4 "Faucet abuse": a burner is topped up to `stake + reserve` (≤ maxBalance), once per
 *  `burnerEveryMs`; an IP gets `ipMax` top-ups per `ipWindowMs`; all top-ups together spend at
 *  most `hourlyLamports` per hour. */
export interface TopupPolicy {
  /** Lamports on top of the stake: create rent (~0.0153, back at close) + delegation + commit
   *  (~0.012, a real cost) + fees. The joiner needs less; one number keeps it simple. */
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
/** A tier, or any whole number of lamports in [STAKE_MIN, STAKE_MAX]. */
const isStake = (n: unknown): n is number => isTier(n) || (Number.isSafeInteger(n) && (n as number) >= STAKE_MIN && (n as number) <= STAKE_MAX);
const isCode = (s: string) => new RegExp(`^[${CODE_ALPHABET}]{6}$`).test(s);
const isTicket = (s: string) => /^[a-z0-9]{16}$/.test(s);
const isRoomState = (s: unknown): s is RoomState => typeof s === 'string' && s in RANK;

export function createApp(opts: ServerOptions = {}) {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? ((n: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % n);
  const rooms = new Map<string, Room>();
  /** Codes that expired or were cancelled: code → [when, why]. */
  const gone = new Map<string, [number, 'expired' | 'cancelled']>();
  const tickets = new Map<string, Ticket>();
  /** Last time each player was seen (queue, rooms, /me): the online count. */
  const presence = new Map<string, number>();
  const history = opts.history ?? new History(null);
  const accounts = opts.accounts ?? new Accounts(null, now);
  const reader = opts.reader ?? null;
  const reportLimit = new RateLimit(60_000, 30, now);
  const writeLimit = new RateLimit(60_000, 60, now);
  const policy: TopupPolicy = { ...TOPUP_POLICY, ...opts.topup };
  const faucet = opts.faucet ?? null;
  const perBurner = new RateLimit(policy.burnerEveryMs, 1, now);
  const perIp = new RateLimit(policy.ipWindowMs, policy.ipMax, now);
  const budget = new Budget(60 * 60_000, policy.hourlyLamports, now);
  const topping = new Set<string>();
  const settleLimit = new RateLimit(10 * 60_000, 10, now);
  const settle =
    opts.settle ??
    (faucet?.keypair
      ? async (id: bigint) => {
          const r = await settleNow(faucet.connection ?? baseConnection(), faucet.keypair!, id);
          return 'signature' in r ? { state: r.state, signature: r.signature } : { state: r.state };
        }
      : null);
  const bot = opts.bot ?? null;
  const botAfterMs = opts.botAfterMs ?? 5_000;
  /** MVP §3.5: nobody on the free tier after ~5 s → the server's bot joins (never staked). */
  const maybeBot = (k: Ticket) => {
    if (!bot || k.match || k.stake !== 0 || now() - k.createdAt < botAfterMs || !bot.available()) return;
    const id = matchId();
    // The bot creates (and pays the rent); the human only joins.
    k.match = { id, role: 'join', opponent: bot.address, matchedAt: now(), bot: true };
    bot.play(BigInt(id), k.player);
  };

  const token = (len: number, alphabet = CODE_ALPHABET) => Array.from({ length: len }, () => alphabet[random(alphabet.length)]).join('');
  const matchId = () => {
    const w = crypto.getRandomValues(new Uint32Array(2));
    return ((BigInt(w[0]!) << 32n) | BigInt(w[1]!)).toString();
  };
  /** The matchmaking sweeper (runs on every request; in memory only): idle rooms expire (their
   *  codes answer 410 for a while), stale tickets and presence go. */
  const sweep = () => {
    const t = now();
    for (const [code, r] of rooms) {
      if (t - r.seenAt > ROOM_IDLE_MS) {
        rooms.delete(code);
        gone.set(code, [t, 'expired']);
      }
    }
    for (const [code, [at]] of gone) if (t - at > TOMBSTONE_MS) gone.delete(code);
    for (const [id, k] of tickets) if (t - k.seenAt > TICKET_TTL_MS) tickets.delete(id);
    for (const [p, at] of presence) if (t - at > ONLINE_MS) presence.delete(p);
  };
  const touch = (player: string | undefined) => {
    if (player && player !== bot?.address) presence.set(player, now());
  };
  const online = () => {
    const t = now();
    let n = 0;
    for (const at of presence.values()) if (t - at <= ONLINE_MS) n++;
    return n;
  };
  const roomView = (r: Room) => ({
    code: r.code,
    id: r.id,
    stake: r.stake,
    state: r.state,
    players: (r.creator ? 1 : 0) + (r.joiner ? 1 : 0),
    creator: r.creator ?? null,
    joiner: r.joiner ?? null,
    createdAt: r.createdAt,
  });
  /** The room for `code` (and marks it seen), or the error response: 400 bad code, 410 expired
   *  or cancelled, 404 never existed. */
  const roomOr = (c: Context, raw: string): Room | Response => {
    const code = raw.toUpperCase();
    if (!isCode(code)) return c.json({ error: 'a room code is 6 letters/digits' }, 400);
    const room = rooms.get(code);
    if (room) {
      room.seenAt = now();
      return room;
    }
    const g = gone.get(code);
    if (g) return c.json({ error: g[1] === 'cancelled' ? 'room cancelled by its host' : 'room expired', state: g[1] }, 410);
    return c.json({ error: 'no such room' }, 404);
  };
  const ip = (c: Context) => clientIp(c, opts.trustProxy ?? false);
  const limited = (c: Context, l: RateLimit) => {
    const r = l.take(ip(c));
    if (r.ok) return null;
    c.header('Retry-After', String(Math.ceil(r.retryMs / 1000)));
    return c.json({ error: 'too many requests, try later', retryAfterSec: Math.ceil(r.retryMs / 1000) }, 429);
  };
  const ticketView = (k: Ticket) =>
    k.match ? { ticket: k.ticket, state: 'matched' as const, stake: k.stake, ...k.match } : { ticket: k.ticket, state: 'waiting' as const, stake: k.stake };

  const app = new Hono();
  for (const m of guard({ origins: opts.origins, now, perMinute: opts.perMinute, ipOf: (c) => clientIp(c, opts.trustProxy ?? false) })) app.use('*', m);
  app.notFound((c) => c.json({ error: 'no such route' }, 404));
  // Never leak a stack trace or an internal message shape.
  app.onError((e, c) => {
    console.error('[server]', String(e).split('\n')[0]);
    return c.json({ error: 'internal error' }, 500);
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'lil-dudes-server',
      rooms: rooms.size,
      queued: tickets.size,
      online: online(),
      history: history.size,
      accounts: accounts.size,
      database: opts.database?.() ?? false,
      faucet: !!faucet,
      bot: bot ? { address: bot.address, ...bot.stats } : null,
      sweeper: opts.sweeperStats?.() ?? null,
    }),
  );

  // --- room codes --------------------------------------------------------------------------
  // The creator makes the match on-chain first, then registers its id here and shares the code.
  // `player` + `role` record the seats: a Quick Match pair registers its match too (both sides,
  // either order) so a rematch can reuse the code. Same id again → the same room.
  app.post('/rooms', async (c) => {
    sweep();
    const body = (await c.req.json().catch(() => null)) as { id?: unknown; stake?: unknown; player?: unknown; role?: unknown } | null;
    if (!body || !isU64(body.id) || !isStake(body.stake)) return c.json({ error: 'need { id: u64 string, stake: lamports, player?: pubkey, role?: create|join }' }, 400);
    if (body.player !== undefined && !isPubkey(body.player)) return c.json({ error: 'bad player' }, 400);
    const role = body.role === 'join' ? 'join' : 'create';
    const player = body.player as string | undefined;
    touch(player);
    for (const r of rooms.values()) {
      if (r.id !== body.id) continue;
      r.seenAt = now();
      // Fill the caller's seat if it is free (a Quick Match pair registering in either order).
      if (player && role === 'create' && !r.creator && r.joiner !== player) r.creator = player;
      if (player && role === 'join' && !r.joiner && r.creator !== player) {
        r.joiner = player;
        if (r.state === 'waiting') r.state = 'joined';
      }
      return c.json(roomView(r));
    }
    let code = token(6);
    while (rooms.has(code) || gone.has(code)) code = token(6);
    const t = now();
    const room: Room = { code, id: body.id, stake: body.stake, createdAt: t, seenAt: t, state: 'waiting' };
    if (player && role === 'create') room.creator = player;
    if (player && role === 'join') {
      room.joiner = player;
      room.state = 'joined';
    }
    rooms.set(code, room);
    return c.json(roomView(room), 201);
  });

  app.get('/rooms/:code', (c) => {
    sweep();
    const r = roomOr(c, c.req.param('code'));
    return r instanceof Response ? r : c.json(roomView(r));
  });

  // Take the second seat (before join_match on-chain). At most two players: anyone else gets 409.
  app.post('/rooms/:code/join', async (c) => {
    sweep();
    const hit = limited(c, writeLimit);
    if (hit) return hit;
    const body = (await c.req.json().catch(() => null)) as { player?: unknown } | null;
    if (!body || !isPubkey(body.player)) return c.json({ error: 'need { player: pubkey }' }, 400);
    const r = roomOr(c, c.req.param('code'));
    if (r instanceof Response) return r;
    const player = body.player;
    touch(player);
    if (r.creator === player) return c.json({ error: 'that is your own room' }, 400);
    if ((r.joiner && r.joiner !== player) || (!r.joiner && r.state !== 'waiting')) return c.json({ error: 'room is full', state: r.state }, 409);
    r.joiner = player;
    if (r.state === 'waiting') r.state = 'joined';
    return c.json(roomView(r));
  });

  // Either player moves the room on (joined → playing → ended); never backwards (a rematch does).
  app.post('/rooms/:code/state', async (c) => {
    sweep();
    const body = (await c.req.json().catch(() => null)) as { player?: unknown; state?: unknown } | null;
    if (!body || !isPubkey(body.player) || !isRoomState(body.state)) return c.json({ error: 'need { player: pubkey, state: joined|playing|ended }' }, 400);
    const r = roomOr(c, c.req.param('code'));
    if (r instanceof Response) return r;
    if (body.player !== r.creator && body.player !== r.joiner) return c.json({ error: 'not a player of this room' }, 403);
    touch(body.player);
    if (RANK[body.state] > RANK[r.state]) r.state = body.state;
    return c.json(roomView(r));
  });

  // Rematch in the same room: the previous match's creator opened match `id` on-chain and points
  // the code at it (back to `waiting`, the same two seats: only the previous opponent can join).
  // The other player polls GET /rooms/:code until the id changes. Only from the match the room
  // holds now (`prev`), so a stale tab can't hijack it.
  app.post('/rooms/:code/next', async (c) => {
    sweep();
    const body = (await c.req.json().catch(() => null)) as { prev?: unknown; id?: unknown; player?: unknown } | null;
    if (!body || !isU64(body.prev) || !isU64(body.id)) return c.json({ error: 'need { prev: u64 string, id: u64 string, player?: pubkey }' }, 400);
    if (body.player !== undefined && !isPubkey(body.player)) return c.json({ error: 'bad player' }, 400);
    const r = roomOr(c, c.req.param('code'));
    if (r instanceof Response) return r;
    if (r.id === body.id) return c.json(roomView(r));
    if (r.id !== body.prev) return c.json({ error: 'the room moved on to another match' }, 409);
    if (r.creator && body.player !== undefined && body.player !== r.creator) return c.json({ error: 'only the room’s creator starts the rematch' }, 403);
    touch(body.player as string | undefined);
    r.id = body.id;
    r.state = 'waiting';
    r.createdAt = now();
    return c.json(roomView(r));
  });

  // The creator cancels (`?player=`): only before anyone joined, or after the end.
  app.delete('/rooms/:code', (c) => {
    sweep();
    const r = roomOr(c, c.req.param('code'));
    if (r instanceof Response) return r.status === 410 ? c.json({ ok: true }) : r;
    const player = c.req.query('player');
    if (r.creator && player !== r.creator) return c.json({ error: 'only the room’s creator can cancel it' }, 403);
    if (r.state === 'joined' || r.state === 'playing') return c.json({ error: 'a match is in progress in this room', state: r.state }, 409);
    rooms.delete(r.code);
    gone.set(r.code, [now(), 'cancelled']);
    return c.json({ ok: true });
  });

  // --- quick match -------------------------------------------------------------------------
  // Join the queue at a stake; poll the ticket. Two waiting players at exactly the same stake are
  // paired at once: the earlier one creates the match (role 'create'), the other joins.
  app.post('/queue', async (c) => {
    sweep();
    const body = (await c.req.json().catch(() => null)) as { player?: unknown; stake?: unknown } | null;
    if (!body || !isPubkey(body.player) || !isStake(body.stake)) return c.json({ error: 'need { player: pubkey, stake: lamports }' }, 400);
    const player = body.player;
    touch(player);
    for (const k of tickets.values()) {
      if (k.player !== player) continue;
      // Same player, same stake (or already matched): the same ticket. A waiting ticket at another
      // stake is replaced (the player changed the amount and its DELETE was lost).
      if (k.stake === body.stake || k.match) {
        k.seenAt = now();
        return c.json(ticketView(k));
      }
      tickets.delete(k.ticket);
    }
    const mine: Ticket = { ticket: token(16, CODE_ALPHABET.toLowerCase() + '0123456789'), player, stake: body.stake, seenAt: now(), createdAt: now() };
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

  // Queue liquidity: players waiting per exact stake, how many are online, and (with `?stake=`)
  // the nearest other stakes that have someone waiting. `?player=` leaves the caller out.
  app.get('/queue/stats', (c) => {
    sweep();
    const stake = c.req.query('stake');
    const me = c.req.query('player');
    const want = stake !== undefined && /^\d{1,13}$/.test(stake) ? Number(stake) : null;
    const per = new Map<number, number>();
    for (const k of tickets.values()) if (!k.match && k.player !== me) per.set(k.stake, (per.get(k.stake) ?? 0) + 1);
    const waiting = [...per].map(([s, players]) => ({ stake: s, players })).sort((a, b) => a.stake - b.stake);
    const dist = (s: number) => (want === null ? 0 : Math.abs(Math.log((s + 1e6) / (want + 1e6))));
    const near = want === null ? [] : waiting.filter((w) => w.stake !== want).sort((a, b) => dist(a.stake) - dist(b.stake) || a.stake - b.stake).slice(0, 3);
    return c.json({
      online: online(),
      waiting,
      here: want === null ? null : (per.get(want) ?? 0),
      near,
      rooms: { waiting: [...rooms.values()].filter((r) => r.state === 'waiting').length },
    });
  });

  app.get('/queue/:ticket', (c) => {
    sweep();
    const id = c.req.param('ticket');
    if (!isTicket(id)) return c.json({ error: 'bad ticket' }, 400);
    const k = tickets.get(id);
    if (!k) return c.json({ error: 'no such ticket (expired?)' }, 404);
    k.seenAt = now();
    touch(k.player);
    maybeBot(k);
    return c.json(ticketView(k));
  });

  app.delete('/queue/:ticket', (c) => {
    tickets.delete(c.req.param('ticket'));
    return c.json({ ok: true });
  });

  // --- resume (a reloaded tab, or one back from the background) ---------------------------------
  // The player's live ticket, room and match, if any, so the app reopens the right screen. A player
  // waiting in the queue is not in a room's match (a stale room only shows as `room`).
  app.get('/me/:player', (c) => {
    sweep();
    const player = c.req.param('player');
    if (!isPubkey(player)) return c.json({ error: 'bad player' }, 400);
    touch(player);
    const k = [...tickets.values()].find((x) => x.player === player) ?? null;
    if (k) k.seenAt = now();
    const room =
      [...rooms.values()].filter((r) => (r.creator === player || r.joiner === player) && r.state !== 'ended').sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    if (room) room.seenAt = now();
    const match = k?.match
      ? { id: k.match.id, role: k.match.role, stake: k.stake, opponent: k.match.opponent, bot: !!k.match.bot, code: null as string | null }
      : room && room.state !== 'waiting' && !k
        ? {
            id: room.id,
            role: room.creator === player ? ('create' as const) : ('join' as const),
            stake: room.stake,
            opponent: (room.creator === player ? room.joiner : room.creator) ?? null,
            bot: false,
            code: room.code,
          }
        : null;
    return c.json({ player, ticket: k ? ticketView(k) : null, room: room ? roomView(room) : null, match });
  });

  // --- history (the profile page) ------------------------------------------------------------
  // A client says "match N is over"; the server reads the Match account on the base layer and
  // records what it says (never what the client claims). Also recorded after POST /settle.
  const recordMatch = async (id: string, settleSig?: string) => {
    const known = history.get(id);
    if (known) {
      if (settleSig && !known.settleSig) history.record({ ...known, settleSig });
      return { status: 200 as const, body: { recorded: true, record: history.get(id) } };
    }
    if (!reader) return { status: 503 as const, body: { error: 'history needs the base-layer reader (off on this server)' } };
    const r = await reader(BigInt(id));
    if (r === null) return { status: 404 as const, body: { error: 'no such match (closed already?)' } };
    if (r === 'pending') return { status: 409 as const, body: { error: 'not finished on the base layer yet, retry in a few seconds' } };
    if (r === 'aborted') return { status: 200 as const, body: { recorded: false, reason: 'aborted (never started, refunded)' } };
    history.record({ ...r, settleSig: settleSig ?? r.settleSig });
    for (const room of rooms.values()) if (room.id === id) room.state = 'ended';
    return { status: 201 as const, body: { recorded: true, record: history.get(id) } };
  };

  app.post('/history/report', async (c) => {
    const hit = limited(c, reportLimit);
    if (hit) return hit;
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || !isU64(body.id)) return c.json({ error: 'need { id: u64 string }' }, 400);
    try {
      const r = await recordMatch(body.id);
      return c.json(r.body, r.status);
    } catch (e) {
      return c.json({ error: `could not read the match: ${String(e instanceof Error ? e.message : e).split('\n')[0]!.slice(0, 120)}` }, 502);
    }
  });

  app.get('/history/:player', (c) => {
    const player = c.req.param('player');
    if (!isPubkey(player)) return c.json({ error: 'bad player' }, 400);
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
    const beforeRaw = c.req.query('before');
    const before = beforeRaw !== undefined && /^\d{1,15}$/.test(beforeRaw) ? Number(beforeRaw) : undefined;
    return c.json(history.page(player, limit, before));
  });

  app.get('/stats/:player', (c) => {
    const player = c.req.param('player');
    if (!isPubkey(player)) return c.json({ error: 'bad player' }, 400);
    return c.json(history.stats(player));
  });

  // --- accounts (wallet ↔ game key, accounts.ts) -----------------------------------------------
  accountRoutes(app, { accounts, history, now, ipOf: (c) => clientIp(c, opts.trustProxy ?? false) });

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
    if (!body || !isPubkey(body.burner) || !isStake(stake)) return c.json({ error: 'need { burner: pubkey, stake?: lamports }' }, 400);
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

  // --- settle now (MVP §3.7) ---------------------------------------------------------------
  // The permissionless `settle`, sponsor-paid, for a player whose burner can't pay the fee.
  app.post('/settle', async (c) => {
    if (!settle) return c.json({ error: 'settling via the server is off (no sponsor)' }, 503);
    const body = (await c.req.json().catch(() => null)) as { id?: unknown } | null;
    if (!body || !isU64(body.id)) return c.json({ error: 'need { id: u64 string }' }, 400);
    const r = settleLimit.take(clientIp(c, opts.trustProxy ?? false));
    if (!r.ok) return c.json({ error: 'too many settle requests, try later', retryAfterSec: Math.ceil(r.retryMs / 1000) }, 429);
    try {
      const res = await settle(BigInt(body.id));
      // Into the history (best effort: the match is on the base layer now).
      if (res.signature) void recordMatch(body.id, res.signature).catch(() => undefined);
      return c.json(res);
    } catch (e) {
      return c.json({ error: `settle failed: ${String(e instanceof Error ? e.message : e).split('\n')[0]!.slice(0, 120)}` }, 502);
    }
  });

  return app;
}
