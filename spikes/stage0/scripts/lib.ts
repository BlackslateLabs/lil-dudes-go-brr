// Shared helpers for the Stage 0 spike scripts (throwaway). Devnet + devnet-tee only.
import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from "@solana/web3.js";
import { getAuthToken, permissionPdaFromAccount, PERMISSION_PROGRAM_ID, MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";
import nacl from "tweetnacl";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(ROOT, "out");
export const KEYS = path.join(ROOT, "keys");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(KEYS, { recursive: true });

export const BASE_URL = process.env.BASE_URL ?? "https://rpc.magicblock.app/devnet";
export const TEE_URL = process.env.TEE_URL ?? "https://devnet-tee.magicblock.app";
export const TEE_WS = TEE_URL.replace(/^http/, "ws");
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const EPHEMERAL_VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
export const ER_VRF_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const DELEGATION_PROGRAM = new PublicKey("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
export { PERMISSION_PROGRAM_ID, MAGIC_PROGRAM_ID, permissionPdaFromAccount };

export const KIND = { board: 0, secret: 1, peek: 2, log: 3, bench: 4 } as const;
export type Kind = keyof typeof KIND;
const SEED: Record<Kind | "vault", string> = {
  board: "board", secret: "secret", peek: "peek", log: "log", bench: "bench", vault: "vault",
};

const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "target/idl/stage0.json"), "utf8"));
export const PROGRAM_ID = new PublicKey(idl.address);

export const base = new Connection(BASE_URL, "confirmed");

/** The default Solana CLI wallet (deploy wallet). Loaded for signing only, never printed. */
export function wallet(): Keypair {
  const p = path.join(os.homedir(), ".config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

/** A burner keypair persisted under keys/ (gitignored). */
export function burner(name: string): Keypair {
  const p = path.join(KEYS, `${name}.json`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

export const program = new Program(idl as anchor.Idl, { connection: base } as anchor.Provider);

export function pda(kind: Kind | "vault", id: BN | number): PublicKey {
  const idb = new BN(id).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync([Buffer.from(SEED[kind]), idb], PROGRAM_ID)[0];
}

/** TEE connection authenticated as `kp` (its own token). */
export async function teeAs(kp: Keypair): Promise<{ conn: Connection; token: string; url: string }> {
  const { token } = await getAuthToken(TEE_URL, kp.publicKey, async (msg) => nacl.sign.detached(msg, kp.secretKey));
  const url = `${TEE_URL}?token=${token}`;
  const conn = new Connection(url, { commitment: "confirmed", wsEndpoint: `${TEE_WS}?token=${token}` });
  return { conn, token, url };
}

export async function send(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  opts: { cu?: number; commitment?: Commitment; skipPreflight?: boolean } = {},
): Promise<string> {
  const tx = new Transaction();
  if (opts.cu) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu }));
  tx.add(...ixs);
  tx.feePayer = signers[0].publicKey;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: opts.skipPreflight ?? true });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, opts.commitment ?? "confirmed");
  if (res.value.err) {
    const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}\n${(t?.meta?.logMessages ?? []).join("\n")}`);
  }
  return sig;
}

export async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 60_000, everyMs = 500): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v as T;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting for ${what}`);
    await sleep(everyMs);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Board account layout (zero-copy, after the 8-byte discriminator). */
export function decodeBoard(data: Buffer) {
  const d = data.subarray(8);
  const u64 = (o: number) => Number(d.readBigUInt64LE(o));
  return {
    id: u64(0),
    authority: new PublicKey(d.subarray(8, 40)),
    recipient: new PublicKey(d.subarray(40, 72)),
    finished: d[72],
    settled: d[73],
    startSlot: u64(80),
    lastSlot: u64(88),
    crankCalls: u64(96),
    otherCalls: u64(104),
    stepsTotal: u64(112),
    maxSteps: u64(120),
    plants: u64(128),
    vrfReqSlot: u64(136),
    vrfCbSlot: u64(144),
    vrfCbCount: u64(152),
    secretEcho: d.readBigUInt64LE(160),
    // codec.rs header: tick u32 first; side 0 hp right after the 38-byte header.
    simTick: d.readUInt32LE(168),
    hp: [d.readUInt32LE(168 + 38), d.readUInt32LE(168 + 38 + 607)],
    resultTag: d[168 + 19],
  };
}

export function decodeLog(data: Buffer) {
  const d = data.subarray(8);
  const n = d.readUInt32LE(0);
  const firstSlot = Number(d.readBigUInt64LE(8));
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) deltas.push(d.readUInt16LE(16 + 2 * i));
  return { n, firstSlot, deltas };
}

export function stats(xs: number[]) {
  if (xs.length === 0) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n: s.length, min: r(s[0]), p50: r(q(0.5)), p90: r(q(0.9)), p99: r(q(0.99)), max: r(s[s.length - 1]), mean: r(mean), sd: r(sd) };
}

export function save(name: string, obj: unknown) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  console.log(`→ ${path.relative(ROOT, p)}`);
}

export function runId(): number {
  const a = process.argv.find((x) => x.startsWith("--id="));
  if (a) return Number(a.slice(5));
  const p = path.join(OUT, "run.json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")).id;
  throw new Error("no run id: run setup.ts first or pass --id=N");
}

export async function ownerOf(conn: Connection, pk: PublicKey): Promise<string | null> {
  const info = await conn.getAccountInfo(pk, "confirmed");
  return info ? info.owner.toBase58() : null;
}
