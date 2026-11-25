// Persistence for accounts and match history: Neon Postgres via DATABASE_URL. The server keeps
// everything in memory for reads (the hackathon's volume is tiny) and writes through to the store,
// so a restart (or a free instance waking up) loads it all back. Without DATABASE_URL there is no
// store: memory (plus the optional HISTORY_FILE) as before.
import postgres from 'postgres';
import type { HistoryRecord } from './history';

export interface AccountRow {
  /** The player's own wallet (base58): the account id. */
  wallet: string;
  /** The account's game key (burner, derived from the wallet's signature). */
  burner: string;
  name: string | null;
  createdAt: number;
  lastSeen: number;
}

/** A guest (browser-only) game key, or an account's previous game key, merged into an account. */
export interface GuestLink {
  guest: string;
  wallet: string;
  linkedAt: number;
}

export interface Store {
  /** Creates the tables if missing (idempotent). */
  migrate(): Promise<void>;
  load(): Promise<{ accounts: AccountRow[]; guests: GuestLink[]; matches: HistoryRecord[] }>;
  saveAccount(a: AccountRow): Promise<void>;
  saveGuest(g: GuestLink): Promise<void>;
  saveMatch(r: HistoryRecord): Promise<void>;
  /** Removes an account and its guest links (tests and the smoke check only). */
  deleteAccount(wallet: string): Promise<void>;
  /** Removes one match (the smoke check only). */
  deleteMatch(matchId: string): Promise<void>;
  close(): Promise<void>;
}

/** Neon (or any) Postgres. The pooled connection string works: no prepared statements. */
export function pgStore(url: string): Store {
  const sql = postgres(url, { ssl: 'require', max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => undefined });
  return {
    async migrate() {
      await sql`create table if not exists accounts (
        wallet text primary key,
        burner text not null unique,
        name text,
        created_at bigint not null,
        last_seen bigint not null
      )`;
      await sql`create table if not exists guest_links (
        guest text primary key,
        wallet text not null references accounts(wallet) on delete cascade,
        linked_at bigint not null
      )`;
      await sql`create index if not exists guest_links_wallet on guest_links (wallet)`;
      await sql`create table if not exists matches (
        match_id text primary key,
        player_a text not null,
        player_b text not null,
        ended_at bigint not null,
        settle_sig text,
        record jsonb not null
      )`;
      await sql`create index if not exists matches_a on matches (player_a, ended_at desc)`;
      await sql`create index if not exists matches_b on matches (player_b, ended_at desc)`;
    },

    async load() {
      const [accounts, guests, matches] = await Promise.all([
        sql<{ wallet: string; burner: string; name: string | null; created_at: string; last_seen: string }[]>`select * from accounts`,
        sql<{ guest: string; wallet: string; linked_at: string }[]>`select * from guest_links`,
        sql<{ record: HistoryRecord; settle_sig: string | null }[]>`select record, settle_sig from matches order by ended_at`,
      ]);
      return {
        accounts: accounts.map((a) => ({ wallet: a.wallet, burner: a.burner, name: a.name, createdAt: Number(a.created_at), lastSeen: Number(a.last_seen) })),
        guests: guests.map((g) => ({ guest: g.guest, wallet: g.wallet, linkedAt: Number(g.linked_at) })),
        matches: matches.map((m) => ({ ...m.record, settleSig: m.record.settleSig ?? m.settle_sig ?? undefined })),
      };
    },

    async saveAccount(a) {
      await sql`insert into accounts (wallet, burner, name, created_at, last_seen)
        values (${a.wallet}, ${a.burner}, ${a.name}, ${a.createdAt}, ${a.lastSeen})
        on conflict (wallet) do update set burner = excluded.burner, name = excluded.name, last_seen = excluded.last_seen`;
    },

    async saveGuest(g) {
      await sql`insert into guest_links (guest, wallet, linked_at) values (${g.guest}, ${g.wallet}, ${g.linkedAt})
        on conflict (guest) do nothing`;
    },

    async saveMatch(r) {
      await sql`insert into matches (match_id, player_a, player_b, ended_at, settle_sig, record)
        values (${r.matchId}, ${r.players[0]}, ${r.players[1]}, ${r.endedAt}, ${r.settleSig ?? null}, ${sql.json(r as unknown as postgres.JSONValue)})
        on conflict (match_id) do update set
          record = excluded.record,
          ended_at = excluded.ended_at,
          settle_sig = coalesce(excluded.settle_sig, matches.settle_sig)`;
    },

    async deleteAccount(wallet) {
      await sql`delete from accounts where wallet = ${wallet}`;
    },

    async deleteMatch(matchId) {
      await sql`delete from matches where match_id = ${matchId}`;
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/** An in-memory Store (tests): same contract as pgStore, no database. */
export function memoryStore(): Store & { accounts: Map<string, AccountRow>; guests: Map<string, GuestLink>; matches: Map<string, HistoryRecord> } {
  const accounts = new Map<string, AccountRow>();
  const guests = new Map<string, GuestLink>();
  const matches = new Map<string, HistoryRecord>();
  return {
    accounts,
    guests,
    matches,
    async migrate() {},
    async load() {
      return { accounts: [...accounts.values()], guests: [...guests.values()], matches: [...matches.values()] };
    },
    async saveAccount(a) {
      for (const [w, x] of accounts) if (w !== a.wallet && x.burner === a.burner) throw new Error('duplicate key value violates unique constraint "accounts_burner_key"');
      const old = accounts.get(a.wallet);
      accounts.set(a.wallet, { ...a, createdAt: old?.createdAt ?? a.createdAt });
    },
    async saveGuest(g) {
      if (!accounts.has(g.wallet)) throw new Error('guest_links: no such account');
      if (!guests.has(g.guest)) guests.set(g.guest, g);
    },
    async saveMatch(r) {
      const old = matches.get(r.matchId);
      matches.set(r.matchId, { ...r, settleSig: r.settleSig ?? old?.settleSig });
    },
    async deleteAccount(wallet) {
      accounts.delete(wallet);
      for (const [k, g] of guests) if (g.wallet === wallet) guests.delete(k);
    },
    async deleteMatch(matchId) {
      matches.delete(matchId);
    },
    async close() {},
  };
}
