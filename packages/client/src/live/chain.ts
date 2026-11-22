// Chain plumbing for live matches: program constants, PDAs, account decoders, TEE auth and
// instruction building from the committed IDL (src/idl/lil_dudes.json, copied from `anchor build`).
// Only @solana/web3.js 1.x, tweetnacl and bs58: no Anchor or MagicBlock TS SDK in the bundle.
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Commitment,
  type Keypair,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import idl from '../idl/lil_dudes.json' with { type: 'json' };
import { decodePublic, PUBLIC_LEN, type PublicState } from '../codec';
import { opFromByte } from '../layout';
import type { GateOp, PrivateView } from '../types';

export const PROGRAM_ID = new PublicKey(idl.address);
export const BASE_RPC = 'https://rpc.magicblock.app/devnet';
export const TEE_RPC = 'https://devnet-tee.magicblock.app';
export const TEE_VALIDATOR = new PublicKey('MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo');
export const DELEGATION_PROGRAM = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
export const PERMISSION_PROGRAM = new PublicKey('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
/** Fees go to the deploy wallet on devnet (programs/lil_dudes/src/state.rs TREASURY). */
export const TREASURY = new PublicKey('FdZLtcw7CMAHk2bsnqesxcYj3Ybjgux3GcqtDy63rfbB');

/** Stake tiers in lamports (MVP §2). */
export const STAKE_TIERS = [0, 50_000_000, 100_000_000, 250_000_000] as const;

/** `Match.status` (state.rs). */
export const Status = {
  OPEN: 0,
  JOINED: 1,
  READY: 2,
  SEEDED: 3,
  PLAYING: 4,
  FINISHED: 5,
  SETTLED: 6,
} as const;
export const Flags = { SALT0: 1, SALT1: 2, SEED_REQUESTED: 4, ABORTED: 8 } as const;

const enc = new TextEncoder();
const dec = new TextDecoder();
const u64le = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};

// --- PDAs ---------------------------------------------------------------------------------------

const pda = (seeds: Uint8Array[], program = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, program)[0];

export interface MatchAccounts {
  id: bigint;
  game: PublicKey;
  secrets: PublicKey;
  peeks: [PublicKey, PublicKey];
  vault: PublicKey;
}

export function matchAccounts(id: bigint): MatchAccounts {
  const idb = u64le(id);
  return {
    id,
    game: pda([enc.encode('match'), idb]),
    secrets: pda([enc.encode('secrets'), idb]),
    peeks: [pda([enc.encode('peek'), idb, Uint8Array.of(0)]), pda([enc.encode('peek'), idb, Uint8Array.of(1)])],
    vault: pda([enc.encode('vault'), idb]),
  };
}

export const permissionPda = (account: PublicKey) => pda([enc.encode('permission:'), account.toBytes()], PERMISSION_PROGRAM);
const bufferPda = (account: PublicKey) => pda([enc.encode('buffer'), account.toBytes()]);
const recordPda = (account: PublicKey) => pda([enc.encode('delegation'), account.toBytes()], DELEGATION_PROGRAM);
const metadataPda = (account: PublicKey) => pda([enc.encode('delegation-metadata'), account.toBytes()], DELEGATION_PROGRAM);

/** A random u64 match id (the PDA seed). */
export function newMatchId(): bigint {
  const w = new Uint32Array(2);
  crypto.getRandomValues(w);
  return (BigInt(w[0]!) << 32n) | BigInt(w[1]!);
}

// --- instructions from the IDL ------------------------------------------------------------------

interface IdlAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
  address?: string;
  pda?: { seeds: { kind: string; value?: number[] }[] };
}
interface IdlIx {
  name: string;
  discriminator: number[];
  accounts: IdlAccount[];
}
const IXS = new Map<string, IdlIx>((idl.instructions as IdlIx[]).map((ix) => [ix.name, ix]));

/** Builds `name` with Borsh `args`; accounts by IDL name from `keys`, else the IDL's fixed address. */
export function ix(name: string, args: Uint8Array, keys: Record<string, PublicKey>): TransactionInstruction {
  const def = IXS.get(name);
  if (!def) throw new Error(`no instruction ${name} in the IDL`);
  const data = new Uint8Array(8 + args.length);
  data.set(def.discriminator, 0);
  data.set(args, 8);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(data),
    keys: def.accounts.map((a) => {
      const pubkey = keys[a.name] ?? (a.address ? new PublicKey(a.address) : undefined);
      if (!pubkey) throw new Error(`${name}: no key for account ${a.name}`);
      return { pubkey, isSigner: !!a.signer, isWritable: !!a.writable };
    }),
  });
}

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export function name16(name: string): Uint8Array {
  const out = new Uint8Array(16);
  const bytes = enc.encode(name);
  let n = Math.min(bytes.length, 16);
  // Don't cut a UTF-8 sequence in half.
  while (n > 0 && n < bytes.length && (bytes[n]! & 0xc0) === 0x80) n--;
  out.set(bytes.subarray(0, n));
  return out;
}

export const ixs = {
  createMatch(a: MatchAccounts, player: PublicKey, pick: bigint, burner: PublicKey, name: string) {
    return ix('create_match', cat(u64le(a.id), u64le(pick), burner.toBytes(), name16(name)), {
      player, game: a.game, secrets: a.secrets, peek0: a.peeks[0], peek1: a.peeks[1], vault: a.vault,
    });
  },
  joinMatch(a: MatchAccounts, player: PublicKey, creator: PublicKey, pick: bigint, burner: PublicKey, name: string) {
    return ix('join_match', cat(u64le(a.id), u64le(pick), burner.toBytes(), name16(name)), {
      player, game: a.game, peek1: a.peeks[1], vault: a.vault, creator,
    });
  },
  delegateMatch(a: MatchAccounts, payer: PublicKey, validator = TEE_VALIDATOR) {
    const keys: Record<string, PublicKey> = { payer, validator };
    const named: [string, PublicKey][] = [['game', a.game], ['secrets', a.secrets], ['peek0', a.peeks[0]], ['peek1', a.peeks[1]]];
    for (const [n, k] of named) {
      keys[n] = k;
      keys[`buffer_${n}`] = bufferPda(k);
      keys[`delegation_record_${n}`] = recordPda(k);
      keys[`delegation_metadata_${n}`] = metadataPda(k);
    }
    return ix('delegate_match', u64le(a.id), keys);
  },
  cancelMatch(a: MatchAccounts, signer: PublicKey, creator: PublicKey, opponent: PublicKey) {
    return ix('cancel_match', u64le(a.id), {
      signer, game: a.game, secrets: a.secrets, peek0: a.peeks[0], peek1: a.peeks[1], vault: a.vault, creator, opponent,
    });
  },
  settle(a: MatchAccounts, players: [PublicKey, PublicKey], treasury = TREASURY) {
    return ix('settle', u64le(a.id), { game: a.game, vault: a.vault, player0: players[0], player1: players[1], treasury });
  },
  closeMatch(a: MatchAccounts, creator: PublicKey) {
    return ix('close_match', u64le(a.id), {
      game: a.game, secrets: a.secrets, peek0: a.peeks[0], peek1: a.peeks[1], vault: a.vault, creator,
    });
  },
  initPermissions(a: MatchAccounts, payer: PublicKey) {
    return ix('init_permissions', new Uint8Array(), {
      payer, game: a.game, secrets: a.secrets, peek0: a.peeks[0], peek1: a.peeks[1],
      secrets_permission: permissionPda(a.secrets), peek0_permission: permissionPda(a.peeks[0]), peek1_permission: permissionPda(a.peeks[1]),
    });
  },
  requestSeed(a: MatchAccounts, payer: PublicKey, salt: Uint8Array) {
    return ix('request_seed', salt, { payer, game: a.game, secrets: a.secrets, program_identity: pda([enc.encode('identity')]) });
  },
  start(a: MatchAccounts, payer: PublicKey) {
    return ix('start', new Uint8Array(), { payer, game: a.game, secrets: a.secrets });
  },
  advance(a: MatchAccounts) {
    return ix('advance', new Uint8Array(), { game: a.game, secrets: a.secrets });
  },
  setAim(a: MatchAccounts, player: PublicKey, x: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, x, true);
    return ix('set_aim', b, { player, game: a.game });
  },
  /** Rig gate `slot` of the opponent's current stage (rules v3; the IDL still calls the arg `cell`). */
  plantRig(a: MatchAccounts, player: PublicKey, side: 0 | 1, slot: number) {
    return ix('plant_rig', Uint8Array.of(slot), { player, game: a.game, secrets: a.secrets, peek: a.peeks[side] });
  },
  /** Peek my gate `slot` of my current stage. */
  peekCell(a: MatchAccounts, player: PublicKey, side: 0 | 1, slot: number) {
    return ix('peek_cell', Uint8Array.of(slot), { player, game: a.game, secrets: a.secrets, peek: a.peeks[side] });
  },
  finish(a: MatchAccounts, payer: PublicKey) {
    return ix('finish', new Uint8Array(), { payer, game: a.game, secrets: a.secrets, peek0: a.peeks[0], peek1: a.peeks[1] });
  },
};

// --- account decoders (byte offsets of state.rs, after the 8-byte discriminator) ----------------

// Rules v3 Match (programs/lil_dudes/src/state.rs): the v2.1 fields in the same order; only the
// published history (30 → 24 bytes) and the codec state (1,046 → 1,470) changed length. The
// zero-copy struct must have no padding, so `_pad` shrinks to 2 bytes: 1,784 bytes + 8.
/** Codec history length (verify.ts HISTORY_LEN). */
const HISTORY_BYTES = 24;
const OFF = {
  id: 8, stake: 16, picks: 24, createdAt: 40, joinedAt: 48, readySlot: 56, seedReqSlot: 64, startSlot: 72, seed: 80,
  players: 88, burners: 152, treasury: 216, names: 248, status: 280, flags: 281, gotcha: 288, history: 296, state: 322,
} as const;
/** Offset of the codec public state in the Match account data. */
export const STATE_OFFSET = OFF.state;
export const MATCH_LEN = STATE_OFFSET + PUBLIC_LEN;

export interface MatchHeader {
  id: bigint;
  stake: number;
  picks: [number, number];
  createdAt: number;
  joinedAt: number;
  readySlot: number;
  startSlot: number;
  /** Published at finish (0n before). */
  seed: bigint;
  players: [PublicKey, PublicKey];
  burners: [PublicKey, PublicKey];
  treasury: PublicKey;
  names: [string, string];
  status: number;
  flags: number;
  /** Last rig sprung in each side's lane: the tick it fired, the gate slot, who planted it. */
  gotcha: [{ tick: number; slot: number; riggedBy: number } | null, { tick: number; slot: number; riggedBy: number } | null];
  /** Published at finish: codec history bytes (see verify.ts decodeHistory). */
  history: Uint8Array;
}

export interface MatchAccount {
  header: MatchHeader;
  state: PublicState;
}

export function decodeMatch(data: Uint8Array): MatchAccount {
  if (data.length < MATCH_LEN) throw new Error(`Match account: ${data.length} bytes`);
  const dv = new DataView(data.buffer, data.byteOffset, data.length);
  const u64 = (at: number) => dv.getBigUint64(at, true);
  const key = (at: number) => new PublicKey(data.subarray(at, at + 32));
  const name = (at: number) => dec.decode(data.subarray(at, at + 16)).replace(/\0+$/, '');
  const gotcha = (s: number) => {
    const at = OFF.gotcha + 4 * s;
    const tick = dv.getUint16(at, true);
    return tick === 0xffff ? null : { tick, slot: data[at + 2]!, riggedBy: data[at + 3]! };
  };
  return {
    header: {
      id: u64(OFF.id),
      stake: Number(u64(OFF.stake)),
      picks: [Number(u64(OFF.picks)), Number(u64(OFF.picks + 8))],
      createdAt: Number(dv.getBigInt64(OFF.createdAt, true)),
      joinedAt: Number(dv.getBigInt64(OFF.joinedAt, true)),
      readySlot: Number(u64(OFF.readySlot)),
      startSlot: Number(u64(OFF.startSlot)),
      seed: u64(OFF.seed),
      players: [key(OFF.players), key(OFF.players + 32)],
      burners: [key(OFF.burners), key(OFF.burners + 32)],
      treasury: key(OFF.treasury),
      names: [name(OFF.names), name(OFF.names + 16)],
      status: data[OFF.status]!,
      flags: data[OFF.flags]!,
      gotcha: [gotcha(0), gotcha(1)],
      history: data.slice(OFF.history, OFF.history + HISTORY_BYTES),
    },
    state: decodePublic(data, OFF.state),
  };
}

/** One player's private Peek account (rules v3): the rig they planted and the peek they made,
 *  each tagged with the stage it belongs to (an entry from an earlier stage is stale). */
export interface PeekAccount {
  side: number;
  /** The owner's stage the rig was planted in (null = never written). */
  stage: number | null;
  /** The opponent gate rigged in `stage`: the victim's stage and slot. */
  rig: { stage: number; slot: number } | null;
  /** The owner's peek: in its stage `stage`, gate `slot`, true value `op` (`div` = rigged). */
  peek: { stage: number; slot: number; op: GateOp } | null;
}

export const PEEK_LEN = 8 + 48;
const NONE = 255;

/** Peek account v3: after the discriminator, `id u64, owner Pubkey, side u8`, then `stage`
 *  (255 = never written), `rig_stage` (255 = none), `rig_slot`, `peek_stage` (255 = none),
 *  `peek_slot`, `peek_op` (k = ×k, 0x80 | k = ÷k), `_pad`. */
export function decodePeek(data: Uint8Array): PeekAccount {
  if (data.length < PEEK_LEN) throw new Error(`Peek account: ${data.length} bytes`);
  const b = (i: number) => data[8 + i]!;
  const stage = b(41);
  const op = opFromByte(b(46));
  return {
    side: b(40),
    stage: stage === NONE ? null : stage,
    rig: stage === NONE || b(42) === NONE ? null : { stage: b(42), slot: b(43) },
    peek: b(44) === NONE || !op ? null : { stage: b(44), slot: b(45), op },
  };
}

/** The PrivateView for a player now in their stage `myStage`: only this stage's rig and peek. */
export function peekPrivateView(p: PeekAccount | null, myStage: number): PrivateView {
  return {
    myRig: p?.rig && p.stage === myStage ? { ...p.rig } : null,
    myPeek: p?.peek && p.peek.stage === myStage ? { stage: p.peek.stage, slot: p.peek.slot, op: p.peek.op } : null,
  };
}

// --- TEE auth + sending ------------------------------------------------------------------------

/** A TEE session token for `kp` (challenge → sign → login; TECH §6). Tokens last ~30 days. */
export async function teeToken(kp: Keypair, rpc = TEE_RPC): Promise<string> {
  const q = new URLSearchParams({ pubkey: kp.publicKey.toBase58() });
  const ch = (await (await fetch(`${rpc}/auth/challenge?${q}`)).json()) as { challenge?: string; error?: string };
  if (!ch.challenge) throw new Error(`TEE challenge failed: ${ch.error ?? 'no challenge'}`);
  const signature = bs58.encode(nacl.sign.detached(enc.encode(ch.challenge), kp.secretKey));
  const res = await fetch(`${rpc}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey: kp.publicKey.toBase58(), challenge: ch.challenge, signature }),
  });
  const body = (await res.json()) as { token?: string; error?: string };
  if (res.status !== 200 || !body.token) throw new Error(`TEE login failed: ${body.error ?? res.status}`);
  return body.token;
}

export function teeConnection(token: string, rpc = TEE_RPC): Connection {
  return new Connection(`${rpc}?token=${token}`, { commitment: 'confirmed', wsEndpoint: `${rpc.replace(/^http/, 'ws')}?token=${token}` });
}

export interface SendOptions {
  cu?: number;
  /** Wait for confirmation (default true). Off = fire and forget (set_aim). */
  confirm?: boolean;
  commitment?: Commitment;
  skipPreflight?: boolean;
}

/** Signs and sends one tx; throws with the program logs if it fails. */
export async function send(conn: Connection, instructions: TransactionInstruction[], signers: Keypair[], opts: SendOptions = {}): Promise<string> {
  const tx = new Transaction();
  if (opts.cu) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu }));
  tx.add(...instructions);
  tx.feePayer = signers[0]!.publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: opts.skipPreflight ?? true });
  if (opts.confirm === false) return sig;
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, opts.commitment ?? 'confirmed');
  if (res.value.err) {
    const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
    throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}\n${(t?.meta?.logMessages ?? []).join('\n')}`);
  }
  return sig;
}
