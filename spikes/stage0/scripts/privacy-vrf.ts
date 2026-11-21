// Check 2c: can the opponent read the VRF callback (whose instruction data carries the seed)?
// B lists the public Board's signatures and fetches every tx with its own token; we look for
// CallbackSeed txs and whether their instruction data / logs are visible.
// Usage: tsx scripts/privacy-vrf.ts [--id=N]
import { Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { burner, pda, runId, save, teeAs, TEE_URL, wallet } from "./lib.ts";
const id = runId();
const tB = await teeAs(burner("b"));
const tAuth = await teeAs(wallet());
const anon = new Connection(TEE_URL, "confirmed");
const out: Record<string, unknown> = { id };
for (const [who, c] of Object.entries({ B: tB.conn, authority: tAuth.conn, noToken: anon })) {
  const sigs = await c.getSignaturesForAddress(pda("board", id), { limit: 1000 });
  let callbacks = 0, withIxData = 0, redacted = 0, sampleIxDataLen: number[] = [];
  const kinds: Record<string, number> = {};
  for (const s of sigs) {
    const t = await c.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (!t) continue;
    const logs = t.meta?.logMessages ?? [];
    const ixName = logs.find((l) => l.startsWith("Program log: Instruction: "))?.slice(26) ?? (logs.length === 0 ? "(redacted)" : "(other)");
    kinds[ixName] = (kinds[ixName] ?? 0) + 1;
    if (logs.length === 0) redacted++;
    if (ixName === "CallbackSeed") {
      callbacks++;
      const ixs = t.transaction.message.compiledInstructions;
      const data = ixs.map((i) => i.data.length);
      if (data.some((d) => d >= 32)) withIxData++;
      sampleIxDataLen = data;
    }
  }
  out[who] = { signaturesListed: sigs.length, kinds, callbacksVisible: callbacks, callbacksWithIxData: withIxData, redacted, sampleIxDataLen, errs: sigs.filter((s) => s.err).length };
}
console.log(JSON.stringify(out, null, 1));
save(`privacy-vrf-${id}.json`, out);
process.exit(0);
