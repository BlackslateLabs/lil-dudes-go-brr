// Matchmaking calls to apps/server (room codes + quick-match queue). The server only pairs
// players and hands out match ids; every on-chain step is the players' own (lobby.ts).
import type { PublicKey } from '@solana/web3.js';

export interface Room {
  code: string;
  id: bigint;
  stake: number;
}

export interface QuickMatch {
  id: bigint;
  /** 'create': call createMatch with this id; 'join': wait for it, then joinMatch. */
  role: 'create' | 'join';
  opponent: string;
  stake: number;
}

async function call<T>(server: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${server.replace(/\/$/, '')}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error ?? res.status}`);
  return json;
}

/** The creator registers its (already created) match and gets a 6-character code to share. */
export async function createRoom(server: string, id: bigint, stake: number): Promise<Room> {
  const r = await call<{ code: string; id: string; stake: number }>(server, 'POST', '/rooms', { id: id.toString(), stake });
  return { code: r.code, id: BigInt(r.id), stake: r.stake };
}

/** The joiner looks a code up (then joinMatch with the id). */
export async function findRoom(server: string, code: string): Promise<Room> {
  const r = await call<{ code: string; id: string; stake: number }>(server, 'GET', `/rooms/${encodeURIComponent(code.trim().toUpperCase())}`);
  return { code: r.code, id: BigInt(r.id), stake: r.stake };
}

/** Queues `player` for a stake tier and resolves once paired (poll every `pollMs`). Abort to leave the queue. */
export async function quickMatch(server: string, player: PublicKey, stake: number, opts: { signal?: AbortSignal; pollMs?: number } = {}): Promise<QuickMatch> {
  type T = { ticket: string; state: 'waiting' | 'matched'; id?: string; role?: 'create' | 'join'; opponent?: string; stake: number };
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
  return { id: BigInt(t.id!), role: t.role!, opponent: t.opponent!, stake: t.stake };
}
