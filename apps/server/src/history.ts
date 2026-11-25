// Match history for the profile page: one record per finished live match, indexed by player.
// Records are built by the server from the Match account on the base layer (never from what a
// client claims), so a report can't be faked: the client only says "match N is over". Public data
// only (addresses, names, stake, scores, payout, signatures); never a key.
//
// In memory, plus an optional append-only JSON-lines file (`HISTORY_FILE`): one line per write,
// loaded on start (a later line for the same match wins, so adding the settle signature is just
// another line; a torn last line from a crash is skipped). With a database (store.ts,
// DATABASE_URL) it is seeded from the `matches` table on start and writes through to it.
import fs from 'node:fs';
import path from 'node:path';

export interface HistoryRecord {
  matchId: string;
  /** Player A (creator) and B (joiner) wallets. */
  players: [string, string];
  names: [string, string];
  /** Matched stake per player, lamports (equal: the program refunds the excess of a higher pick). */
  stakes: [number, number];
  /** Final scores (gold). */
  scores: [number, number];
  /** Side that won, or null (draw). */
  winner: 0 | 1 | null;
  /** Side that died (an enemy reached its cannon), or null. */
  died: 0 | 1 | null;
  /** What each side got back from the vault and its net change (lamports), and the fee. */
  payout: { paid: [number, number]; net: [number, number]; moved: number; fee: number; why: string };
  /** One side was the server's bot. */
  bot: boolean;
  endedAt: number;
  settleSig?: string;
}

/** One record from a player's side (GET /history/:player). */
export interface PlayerRecord extends HistoryRecord {
  side: 0 | 1;
  outcome: 'won' | 'lost' | 'draw';
  /** This player's net, lamports. */
  net: number;
  opponent: string;
  opponentName: string;
}

export interface PlayerStats {
  played: number;
  won: number;
  lost: number;
  draw: number;
  /** Lamports won minus lost over all staked matches (after fees). */
  net: number;
  staked: number;
  best: number;
}

const isRecord = (r: unknown): r is HistoryRecord => {
  const x = r as HistoryRecord;
  return !!x && typeof x.matchId === 'string' && Array.isArray(x.players) && x.players.length === 2 && typeof x.endedAt === 'number';
};

export class History {
  private byId = new Map<string, HistoryRecord>();
  private byPlayer = new Map<string, Set<string>>();
  /** Writes in flight to the database (flush() waits for them; tests). */
  private pending = new Set<Promise<void>>();

  /**
   * @param file     optional JSON-lines file (HISTORY_FILE).
   * @param persist  optional write-through (the database, store.ts): called with each changed
   *                 record. A failed write is logged, not thrown: the record stays in memory and
   *                 is written again the next time it changes.
   */
  constructor(
    private readonly file: string | null = null,
    private readonly persist: ((r: HistoryRecord) => Promise<void>) | null = null,
  ) {
    if (file) this.load(file);
  }

  /** Loads records from the database on start (no write-back). */
  seed(records: Iterable<HistoryRecord>): void {
    for (const r of records) if (isRecord(r)) this.index(r);
  }

  /** Waits for the database writes in flight. */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private load(file: string) {
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as unknown;
        if (isRecord(r)) this.index(r);
      } catch {
        /* a torn line (crash mid-write): skip */
      }
    }
  }

  private index(r: HistoryRecord) {
    const old = this.byId.get(r.matchId);
    // A later line wins, but never loses a settle signature it had.
    this.byId.set(r.matchId, { ...r, settleSig: r.settleSig ?? old?.settleSig });
    for (const p of r.players) {
      let set = this.byPlayer.get(p);
      if (!set) this.byPlayer.set(p, (set = new Set()));
      set.add(r.matchId);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  has(matchId: string): boolean {
    return this.byId.has(matchId);
  }

  get(matchId: string): HistoryRecord | undefined {
    return this.byId.get(matchId);
  }

  /** Adds (or updates) a match. Returns true if anything changed. */
  record(r: HistoryRecord): boolean {
    const old = this.byId.get(r.matchId);
    if (old && JSON.stringify(old) === JSON.stringify({ ...r, settleSig: r.settleSig ?? old.settleSig })) return false;
    this.index(r);
    if (this.file) {
      fs.mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(this.byId.get(r.matchId))}\n`);
    }
    if (this.persist) {
      const p: Promise<void> = this.persist(this.byId.get(r.matchId)!)
        .catch((e: unknown) => console.error(`history: saving match ${r.matchId} failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => this.pending.delete(p));
      this.pending.add(p);
    }
    return true;
  }

  /** A player's matches, newest first; `before` = an `endedAt` cursor from the previous page. */
  page(player: string, limit = 20, before?: number): { entries: PlayerRecord[]; next: number | null } {
    return this.pageMany([player], limit, before);
  }

  /** An account's matches over all its keys (game key + merged guest keys), newest first. */
  pageMany(players: readonly string[], limit = 20, before?: number): { entries: PlayerRecord[]; next: number | null } {
    const all = [...this.idsOf(players)]
      .map((id) => this.byId.get(id)!)
      .sort((a, b) => b.endedAt - a.endedAt || b.matchId.localeCompare(a.matchId))
      .filter((r) => before === undefined || r.endedAt < before);
    const entries = all.slice(0, limit).map((r) => view(r, players));
    return { entries, next: all.length > limit ? entries[entries.length - 1]!.endedAt : null };
  }

  stats(player: string): PlayerStats {
    return this.statsMany([player]);
  }

  /** Stats over all of an account's keys. */
  statsMany(players: readonly string[]): PlayerStats {
    const s: PlayerStats = { played: 0, won: 0, lost: 0, draw: 0, net: 0, staked: 0, best: 0 };
    for (const id of this.idsOf(players)) {
      const r = view(this.byId.get(id)!, players);
      s.played++;
      s[r.outcome]++;
      s.net += r.net;
      if (r.stakes[r.side] > 0) s.staked++;
      s.best = Math.max(s.best, r.scores[r.side]);
    }
    return s;
  }

  private idsOf(players: readonly string[]): Set<string> {
    const ids = new Set<string>();
    for (const p of players) for (const id of this.byPlayer.get(p) ?? []) ids.add(id);
    return ids;
  }
}

function view(r: HistoryRecord, players: readonly string[]): PlayerRecord {
  const side: 0 | 1 = players.includes(r.players[0]) ? 0 : 1;
  const player = r.players[side];
  const other = (1 - side) as 0 | 1;
  return {
    ...r,
    side,
    outcome: r.winner === null ? 'draw' : r.winner === side ? 'won' : 'lost',
    net: r.payout.net[side],
    opponent: r.players[other],
    opponentName: r.bot && r.players[other] !== player ? 'Bot' : r.names[other],
  };
}
