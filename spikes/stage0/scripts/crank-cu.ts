// Real compute of crank-driven `advance` calls over a match: reads the crank txs' logs from the
// TEE (they only touch public accounts, so their logs are visible) and extracts
// "consumed N of M compute units" (M = the CU limit a cranked tx gets).
// Usage: tsx scripts/crank-cu.ts --id=N [--program=PUBKEY] [--max=3000]
import { PublicKey } from "@solana/web3.js";
import { pda, save, stats, teeAs, wallet } from "./lib.ts";
const arg = (k: string, d?: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const id = Number(arg("id"));
const programId = new PublicKey(arg("program", "9oXqBpV3cv2kkYgbq3VbQu5KgQjbTGuFJfGeLMqkZC7G")!);
const max = Number(arg("max", "3000"));
const board = PublicKey.findProgramAddressSync([Buffer.from("board"), Buffer.from(new BigUint64Array([BigInt(id)]).buffer)], programId)[0];
const { conn } = await teeAs(wallet());
let before: string | undefined;
const sigs: { signature: string; slot: number; err: unknown }[] = [];
while (sigs.length < max) {
  const page = await conn.getSignaturesForAddress(board, { limit: 1000, before });
  if (page.length === 0) break;
  sigs.push(...page);
  before = page[page.length - 1].signature;
}
const rows: { slot: number; cu: number; limit: number }[] = [];
const BATCH = 50;
for (let i = 0; i < sigs.length; i += BATCH) {
  const txs = await Promise.all(sigs.slice(i, i + BATCH).map((s) => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null)));
  for (const t of txs) {
    const line = t?.meta?.logMessages?.find((l) => l.startsWith(`Program ${programId.toBase58()} consumed`));
    const m = line && /consumed (\d+) of (\d+)/.exec(line);
    if (m && t?.meta?.logMessages?.some((l) => l.includes("Instruction: Advance"))) rows.push({ slot: t.slot, cu: Number(m[1]), limit: Number(m[2]) });
  }
}
rows.sort((a, b) => a.slot - b.slot);
const out = { id, board: board.toBase58(), signatures: sigs.length, advanceTxsWithLogs: rows.length, cuPerAdvance: stats(rows.map((r) => r.cu)), cuLimitSeen: [...new Set(rows.map((r) => r.limit))], over200k: rows.filter((r) => r.cu > 200_000).length, top5: [...rows].sort((a, b) => b.cu - a.cu).slice(0, 5) };
console.log(JSON.stringify(out, null, 1));
save(`crank-cu-${id}.json`, { ...out, series: rows.map((r) => r.cu) });
process.exit(0);
