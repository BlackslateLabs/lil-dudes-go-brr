// Extra b: compute units of `advance`-style work with the REAL crates/sim at worst case
// (40 cohorts per side, all 1,600 clash pairs in reach every tick, nobody dies) on the TEE.
// Simulated (nothing persists). Logs "Program consumption: N units remaining" around each phase.
// Usage: tsx scripts/bench.ts [--id=N]
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { pda, program, runId, save, teeAs, wallet } from "./lib.ts";

const id = runId();
const auth = wallet();
const { conn } = await teeAs(auth);

async function sim(n: number, withBot: boolean, cu = 1_400_000) {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: cu }),
    await program.methods.bench(new BN(id), n, withBot).accountsPartial({ bench: pda("bench", id) }).instruction(),
  );
  tx.feePayer = auth.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(auth);
  const r = await conn.simulateTransaction(tx);
  const logs = r.value.logs ?? [];
  const rem = logs.filter((l) => l.includes("units remaining")).map((l) => Number(/consumption: (\d+) units remaining/.exec(l)?.[1]));
  const ok = r.value.err == null;
  return {
    n, withBot, ok, err: r.value.err, total: r.value.unitsConsumed,
    decode: rem.length === 4 ? rem[0] - rem[1] : null,
    steps: rem.length === 4 ? rem[1] - rem[2] : null,
    encode: rem.length === 4 ? rem[2] - rem[3] : null,
    tail: logs.filter((l) => l.includes("bench n=") || l.includes("exceeded") || l.includes("failed")).map((l) => l.slice(0, 160)),
  };
}

const rows: Awaited<ReturnType<typeof sim>>[] = [];
for (const withBot of [false, true]) {
  for (const n of [0, 1, 2, 5, 10, 20, 40, 56]) {
    const r = await sim(n, withBot);
    rows.push(r);
    console.log(JSON.stringify(r));
  }
}
// per-tick cost from the worst-case slope (n = 1..40, before any cohort can reach a cannon)
const slope = (wb: boolean) => {
  const a = rows.find((r) => r.withBot === wb && r.n === 1)!; // n=40 overflows at worst case
  const b = rows.find((r) => r.withBot === wb && r.n === 20)!;
  return ((b.steps ?? 0) - (a.steps ?? 0)) / 19;
};
const overhead = (wb: boolean) => rows.find((r) => r.withBot === wb && r.n === 0)!.total ?? 0;
const summary = Object.fromEntries([false, true].map((wb) => {
  const per = slope(wb);
  const ov = overhead(wb);
  return [wb ? "withBot" : "noBot", {
    perTickWorstCU: Math.round(per),
    overheadCU_n0: ov,
    ticksUnder200k: Math.floor((200_000 - ov) / per),
    ticksUnder1_4M: Math.floor((1_400_000 - ov) / per),
    cu40Ticks: rows.find((r) => r.withBot === wb && r.n === 40)!.total,
  }];
}));
// confirm the default limit (no SetComputeUnitLimit → 200k for one instruction)
const at200k = [];
for (const n of [5, 10, 15, 20]) at200k.push(await sim(n, true, 200_000));
console.log(JSON.stringify(summary, null, 1));
save(`bench-${id}.json`, { id, rows, summary, at200k: at200k.map((r) => ({ n: r.n, ok: r.ok, total: r.total })) });
process.exit(0);
