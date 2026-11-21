// Check 2c (cont.): look for our successful callbacks via the VRF queue's signature list (B's token).
import fs from "node:fs";
import { burner, ER_VRF_QUEUE, PROGRAM_ID, runId, teeAs } from "./lib.ts";
const id = runId();
const tB = await teeAs(burner("b"));
const v = JSON.parse(fs.readFileSync(`out/vrf-${id}.json`, "utf8"));
const sigs = await tB.conn.getSignaturesForAddress(ER_VRF_QUEUE, { limit: 200 });
let ours = 0, oursVisibleIx = 0, total = 0;
for (const s of sigs) {
  const t = await tB.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!t) continue;
  total++;
  if (t.transaction.message.staticAccountKeys.some((k) => k.equals(PROGRAM_ID))) { ours++; if (t.transaction.message.compiledInstructions.some((i) => i.data.length >= 32)) oursVisibleIx++; }
}
// and the request sigs B might learn: are THEY readable to B?
const req = await tB.conn.getTransaction(v.rows[0].sig, { maxSupportedTransactionVersion: 0 });
const out = { queueSigsListedToB: sigs.length, fetched: total, mentioningOurProgram: ours, oursWithIxData: oursVisibleIx, requestTxToB: req ? { keys: req.transaction.message.staticAccountKeys.length, logs: req.meta?.logMessages?.length } : null };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`out/privacy-vrf2-${id}.json`, JSON.stringify(out, null, 1));
process.exit(0);
