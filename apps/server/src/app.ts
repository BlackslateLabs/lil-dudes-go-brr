// Matchmaking for live matches (MVP §3.4–3.5): room codes and a quick-match queue. Not in the
// trust path: the server holds no keys and never touches a match on-chain. It only tells two
// players which match id to use and who creates it (the creator calls create_match, the other
// join_match, then either delegates). State is in memory with short TTLs (one instance is enough
// for the hackathon; a restart only drops waiting players).
import { Hono } from 'hono';
import { cors } from 'hono/cors';

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
}

const isPubkey = (s: unknown): s is string => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isU64 = (s: unknown): s is string => typeof s === 'string' && /^\d{1,20}$/.test(s) && BigInt(s) < 2n ** 64n;
const isTier = (n: unknown): n is number => typeof n === 'number' && (STAKE_TIERS as readonly number[]).includes(n);

export function createApp(opts: ServerOptions = {}) {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? ((n: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % n);
  const rooms = new Map<string, Room>();
  const tickets = new Map<string, Ticket>();

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

  return app;
}
