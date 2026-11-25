// Calls to apps/server: room codes (with a lifecycle), the quick-match queue and its stats,
// resume (/me), the faucet and the match history. The server only pairs players and hands out
// match ids; every on-chain step is the players' own (lobby.ts).
import type { PublicKey } from '@solana/web3.js';

/** waiting (seat free) → joined (two players) → playing → ended; a rematch goes back to waiting. */
export type RoomState = 'waiting' | 'joined' | 'playing' | 'ended';

export interface Room {
  code: string;
  id: bigint;
  stake: number;
  /** Set by servers with the room lifecycle (all current ones). */
  state?: RoomState;
  players?: number;
  creator?: string | null;
  joiner?: string | null;
}

type RoomJson = { code: string; id: string; stake: number; state?: RoomState; players?: number; creator?: string | null; joiner?: string | null };
const roomOf = (r: RoomJson): Room => ({ code: r.code, id: BigInt(r.id), stake: r.stake, state: r.state, players: r.players, creator: r.creator, joiner: r.joiner });
const roomPath = (code: string) => `/rooms/${encodeURIComponent(code.trim().toUpperCase())}`;

export interface QuickMatch {
  id: bigint;
  /** 'create': call createMatch with this id; 'join': wait for it, then joinMatch. */
  role: 'create' | 'join';
  opponent: string;
  stake: number;
  /** The server's own bot (free matches only, after ~5 s with nobody else in the queue). */
  bot: boolean;
}

/**
 * A failed server call. `status` is the HTTP status, or 0 when the server could not be reached at
 * all (down, offline, CORS): the UI tells "server down" from "room not found" (404) by it.
 */
export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ServerError';
  }
}

async function call<T>(server: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${server.replace(/\/$/, '')}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ServerError(`${method} ${path}: server unreachable`, 0);
  }
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; retryAfterSec?: number };
  if (!res.ok) throw new ServerError(`${method} ${path}: ${json.error ?? res.status}`, res.status, json.retryAfterSec);
  return json;
}

/**
 * The creator registers its (already created) match and gets a 6-character code to share. With
 * `player` the seat is recorded (`role` 'join' for the joiner of a Quick Match pair registering the
 * same id: both get the same code, for a rematch). Same id again → the same room.
 */
export async function createRoom(server: string, id: bigint, stake: number, opts: { player?: PublicKey; role?: 'create' | 'join' } = {}): Promise<Room> {
  return roomOf(await call<RoomJson>(server, 'POST', '/rooms', { id: id.toString(), stake, player: opts.player?.toBase58(), role: opts.role }));
}

/** The joiner looks a code up (then takeSeat, then joinMatch with the id). ServerError 404 = no
 *  such room, 410 = expired or cancelled (the message says which). */
export async function findRoom(server: string, code: string): Promise<Room> {
  return roomOf(await call<RoomJson>(server, 'GET', roomPath(code)));
}

/** Takes the room's second seat before joining on-chain. ServerError 409 = full, 400 = own room. */
export async function takeSeat(server: string, code: string, player: PublicKey): Promise<Room> {
  return roomOf(await call<RoomJson>(server, 'POST', `${roomPath(code)}/join`, { player: player.toBase58() }));
}

/** Moves the room on (playing / ended); either player, forward only. Best effort. */
export async function setRoomState(server: string, code: string, player: PublicKey, state: RoomState): Promise<void> {
  await call(server, 'POST', `${roomPath(code)}/state`, { player: player.toBase58(), state }).catch(() => undefined);
}

/** Queues `player` for a stake tier and resolves once paired (poll every `pollMs`). Abort to leave the queue. */
export async function quickMatch(server: string, player: PublicKey, stake: number, opts: { signal?: AbortSignal; pollMs?: number } = {}): Promise<QuickMatch> {
  type T = { ticket: string; state: 'waiting' | 'matched'; id?: string; role?: 'create' | 'join'; opponent?: string; stake: number; bot?: boolean };
  let t = await call<T>(server, 'POST', '/queue', { player: player.toBase58(), stake }, opts.signal);
  try {
    while (t.state !== 'matched') {
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 1_000));
      if (opts.signal?.aborted) throw new Error('left the queue');
      t = await call<T>(server, 'GET', `/queue/${t.ticket}`, undefined, opts.signal);
    }
  } catch (e) {
    await call(server, 'DELETE', `/queue/${t.ticket}`).catch(() => undefined);
    throw e;
  }
  return { id: BigInt(t.id!), role: t.role!, opponent: t.opponent!, stake: t.stake, bot: !!t.bot };
}

/** A quick-match ticket as the server reports it (POST /queue, GET /queue/:ticket). */
export interface QueueTicket {
  ticket: string;
  state: 'waiting' | 'matched';
  stake: number;
  /** Set once matched (see QuickMatch). */
  match?: QuickMatch;
}

type TicketJson = { ticket: string; state: 'waiting' | 'matched'; id?: string; role?: 'create' | 'join'; opponent?: string; stake: number; bot?: boolean };
const ticketOf = (t: TicketJson): QueueTicket => ({
  ticket: t.ticket,
  state: t.state,
  stake: t.stake,
  match: t.state === 'matched' ? { id: BigInt(t.id!), role: t.role!, opponent: t.opponent!, stake: t.stake, bot: !!t.bot } : undefined,
});

/** Step by step quick match (the waiting screen drives its own polling, retries and re-queues):
 *  join the queue at `stake` lamports. Joining again with the same player returns the same ticket. */
export async function joinQueue(server: string, player: PublicKey, stake: number, signal?: AbortSignal): Promise<QueueTicket> {
  return ticketOf(await call<TicketJson>(server, 'POST', '/queue', { player: player.toBase58(), stake }, signal));
}

/** Polls a ticket (keeps it alive; a ticket not polled for 30 s is dropped: ServerError 404). */
export async function pollQueue(server: string, ticket: string, signal?: AbortSignal): Promise<QueueTicket> {
  return ticketOf(await call<TicketJson>(server, 'GET', `/queue/${encodeURIComponent(ticket)}`, undefined, signal));
}

/** Leaves the queue (best effort). */
export async function leaveQueue(server: string, ticket: string): Promise<void> {
  await call(server, 'DELETE', `/queue/${encodeURIComponent(ticket)}`).catch(() => undefined);
}

/** The creator cancels its room (best effort; refused once someone joined). */
export async function closeRoom(server: string, code: string, player?: PublicKey): Promise<void> {
  const q = player ? `?player=${player.toBase58()}` : '';
  await call(server, 'DELETE', `${roomPath(code)}${q}`).catch(() => undefined);
}

/**
 * Rematch in the same room: the previous match's creator opens a new match `id` on-chain, then
 * points the room's code at it. The other player polls `findRoom(code)` until the id changes.
 * Refused (409) if the room has moved on from `prev` already.
 */
export async function nextRoomMatch(server: string, code: string, prev: bigint, id: bigint, player?: PublicKey): Promise<Room> {
  return roomOf(await call<RoomJson>(server, 'POST', `${roomPath(code)}/next`, { prev: prev.toString(), id: id.toString(), player: player?.toBase58() }));
}

/** Queue liquidity (GET /queue/stats). */
export interface QueueStats {
  /** Players seen in the last ~30 s (queue, rooms, resume polls). */
  online: number;
  /** Waiting players per exact stake (lamports), lowest stake first. */
  waiting: { stake: number; players: number }[];
  /** Others waiting at the asked stake (null if none asked). */
  here: number | null;
  /** The nearest other stakes with someone waiting (≤ 3). */
  near: { stake: number; players: number }[];
  rooms: { waiting: number };
}

/** Who's waiting where. `stake` adds `here` and `near`; `player` leaves the caller out. */
export async function queueStats(server: string, opts: { stake?: number; player?: PublicKey } = {}, signal?: AbortSignal): Promise<QueueStats> {
  const q = new URLSearchParams();
  if (opts.stake !== undefined) q.set('stake', String(opts.stake));
  if (opts.player) q.set('player', opts.player.toBase58());
  return call<QueueStats>(server, 'GET', `/queue/stats${q.toString() ? `?${q}` : ''}`, undefined, signal);
}

/** What the server knows of a player right now (GET /me/:player): resume after a reload. */
export interface Resume {
  ticket: QueueTicket | null;
  room: Room | null;
  match: { id: bigint; role: 'create' | 'join'; stake: number; opponent: string | null; bot: boolean; code: string | null } | null;
}

export async function resumeInfo(server: string, player: PublicKey, signal?: AbortSignal): Promise<Resume> {
  type M = { id: string; role: 'create' | 'join'; stake: number; opponent: string | null; bot: boolean; code: string | null };
  const r = await call<{ ticket: TicketJson | null; room: RoomJson | null; match: M | null }>(server, 'GET', `/me/${player.toBase58()}`, undefined, signal);
  return { ticket: r.ticket ? ticketOf(r.ticket) : null, room: r.room ? roomOf(r.room) : null, match: r.match ? { ...r.match, id: BigInt(r.match.id) } : null };
}

/** Tells the server match `id` is over; it reads the result from the base layer into the
 *  history. 'pending' = not back on the base layer yet (retry in a few seconds). */
export async function reportMatch(server: string, id: bigint): Promise<'recorded' | 'pending' | 'skipped'> {
  try {
    const r = await call<{ recorded?: boolean }>(server, 'POST', '/history/report', { id: id.toString() });
    return r.recorded ? 'recorded' : 'skipped';
  } catch (e) {
    if (e instanceof ServerError && e.status === 409) return 'pending';
    throw e;
  }
}

/** One finished match from a player's side (GET /history/:player). Lamports throughout. */
export interface HistoryEntry {
  matchId: string;
  players: [string, string];
  names: [string, string];
  stakes: [number, number];
  scores: [number, number];
  winner: 0 | 1 | null;
  died: 0 | 1 | null;
  payout: { paid: [number, number]; net: [number, number]; moved: number; fee: number; why: string };
  bot: boolean;
  endedAt: number;
  settleSig?: string;
  side: 0 | 1;
  outcome: 'won' | 'lost' | 'draw';
  net: number;
  opponent: string;
  opponentName: string;
}

/** A page of a player's matches, newest first; pass `next` as `before` for the next page. */
export async function matchHistory(server: string, player: PublicKey | string, opts: { limit?: number; before?: number } = {}): Promise<{ entries: HistoryEntry[]; next: number | null }> {
  const q = new URLSearchParams();
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.before !== undefined) q.set('before', String(opts.before));
  const pk = typeof player === 'string' ? player : player.toBase58();
  return call(server, 'GET', `/history/${pk}${q.toString() ? `?${q}` : ''}`);
}

export interface PlayerStats {
  played: number;
  won: number;
  lost: number;
  draw: number;
  /** Lamports, after fees. */
  net: number;
  staked: number;
  best: number;
}

export async function playerStats(server: string, player: PublicKey | string): Promise<PlayerStats> {
  return call(server, 'GET', `/stats/${typeof player === 'string' ? player : player.toBase58()}`);
}

/** GET /health: is the server up, and is the faucet / online bot on? */
export async function serverHealth(server: string, signal?: AbortSignal): Promise<{ ok: boolean; faucet: boolean; bot: boolean }> {
  const h = await call<{ ok?: boolean; faucet?: boolean; bot?: unknown }>(server, 'GET', '/health', undefined, signal);
  return { ok: !!h.ok, faucet: !!h.faucet, bot: !!h.bot };
}

export interface TopUp {
  /** Lamports sent now (0 = the burner already had enough). */
  sent: number;
  signature?: string;
  /** The burner's balance after the top-up, and the target (stake + reserve, ≤ 0.3 SOL). */
  balance: number;
  target: number;
}

/**
 * Wallet sheet "Top up" / before a staked match (MVP §3.9): the server's sponsor wallet tops the
 * burner up to `stake` + ~0.035 SOL (rent + fees). Devnet only. Limits: once per 10 min per
 * burner, a few per IP; a 429 error says when to retry ("…retry in N s").
 */
export async function topUp(server: string, burner: PublicKey, stake = 0): Promise<TopUp> {
  const res = await fetch(`${server.replace(/\/$/, '')}/topup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ burner: burner.toBase58(), stake }),
  }).catch(() => {
    throw new ServerError('top-up: server unreachable', 0);
  });
  const json = (await res.json().catch(() => ({}))) as TopUp & { error?: string; retryAfterSec?: number };
  if (!res.ok) throw new ServerError(`top-up: ${json.error ?? res.status}${json.retryAfterSec ? ` (retry in ${json.retryAfterSec} s)` : ''}`, res.status, json.retryAfterSec);
  return json;
}
