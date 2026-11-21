// Check 2b: are FAILED txs that touch the private Secret redacted too? (v1 showed failed VRF
// callbacks touching Secret with full logs.) A sends plant_rig txs that fail (a) at the CU meter,
// (b) at an account constraint; B / no-token / A then try to read them and B listens on onLogs.
// Usage: tsx scripts/privacy-fail.ts [--id=N]
import { BN } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { burner, pda, program, PROGRAM_ID, runId, save, sleep, teeAs, TEE_URL } from "./lib.ts";
const id = runId();
const A = burner("a"), B = burner("b");
const tA = await teeAs(A), tB = await teeAs(B);
const anon = new Connection(TEE_URL, "confirmed");
const secret = pda("secret", id);
const seenB: string[] = [];
const sub = tB.conn.onLogs(PROGRAM_ID, (l) => seenB.push(JSON.stringify(l)), "confirmed");
const subAll = tB.conn.onLogs("all", (l) => { const s = JSON.stringify(l); if (s.includes(PROGRAM_ID.toBase58())) seenB.push(s); }, "confirmed");
await sleep(1000);
const sendRaw = async (tx: Transaction) => {
  tx.feePayer = A.publicKey;
  tx.recentBlockhash = (await tA.conn.getLatestBlockhash()).blockhash;
  tx.sign(A);
  const sig = await tA.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await sleep(2500);
  return sig;
};
const salt = Buffer.concat([Buffer.from("LDGFAIL"), randomBytes(9)]);
const ix = await program.methods.plantRig(new BN(id), 5, [...salt]).accountsPartial({ player: A.publicKey, secret }).instruction();
const sigCu = await sendRaw(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600 }), ix));
// constraint failure: right Secret account, wrong id arg (seeds check fails after Secret is loaded)
const ixBad = await program.methods.plantRig(new BN(id + 1), 6, [...salt]).accountsPartial({ player: A.publicKey, secret }).instruction();
const sigSeeds = await sendRaw(new Transaction().add(ixBad));
await sleep(2000);
const needles = [salt.toString("hex"), bs58.encode(ix.data), ix.data.toString("base64"), bs58.encode(ixBad.data), ixBad.data.toString("base64"), "LDGFAIL"];
const view = async (c: Connection, sig: string) => {
  const t = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0 }).catch((e) => ({ error: String(e) }));
  const s = JSON.stringify(t, (_k, v) => (v instanceof Uint8Array || Buffer.isBuffer(v) ? Buffer.from(v).toString("base64") : v));
  // @ts-expect-error loose shape
  const keys = t?.transaction?.message?.staticAccountKeys?.length ?? null;
  // @ts-expect-error loose shape
  return { found: !!t && !("error" in t), err: t?.meta?.err ?? null, keys, logs: t?.meta?.logMessages?.length ?? null, leaks: needles.filter((n) => s.includes(n)).length, ixDataSeen: s.includes(bs58.encode(ix.data)) || s.includes(bs58.encode(ixBad.data)) };
};
const out: Record<string, unknown> = { id, sigs: { sigCu, sigSeeds } };
for (const [name, sig] of Object.entries({ cuFail: sigCu, constraintFail: sigSeeds })) {
  out[name] = { A: await view(tA.conn, sig), B: await view(tB.conn, sig), noToken: await view(anon, sig) };
}
await tB.conn.removeOnLogsListener(sub); await tB.conn.removeOnLogsListener(subAll);
out.bOnLogs = { notifications: seenB.length, leaks: seenB.filter((s) => needles.some((n) => s.includes(n))).length };
console.log(JSON.stringify(out, null, 1));
save(`privacy-fail-${id}.json`, out);
process.exit(0);
