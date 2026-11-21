// Check 2c (cont.): v1's FAILED callbacks (callback ran out of CU, the oracle retried): what can B
// read? If the ix data (discriminator + 32 random bytes) is visible, a failed-then-retried callback
// would leak the seed. Usage: tsx scripts/privacy-vrf3.ts
import { PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import { burner, teeAs } from "./lib.ts";
const tB = await teeAs(burner("b"));
const v1Board = new PublicKey("GfC93kzxFMVjDZooptPCGoXGaL8yzmCigA6PAMHFVk39");
const sigs = await tB.conn.getSignaturesForAddress(v1Board, { limit: 20 });
const rows = [];
for (const s of sigs.slice(0, 20)) {
  const t = await tB.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
  if (!t || !t.meta?.logMessages?.some((l) => l.includes("CallbackSeed"))) continue;
  const ixs = t.transaction.message.compiledInstructions;
  const data = ixs.map((i) => Buffer.from(i.data));
  rows.push({ sig: s.signature.slice(0, 12), err: !!s.err, ixDataLens: data.map((d) => d.length), randomnessVisible: data.some((d) => d.length >= 40), sample: data.find((d) => d.length >= 40)?.subarray(0, 12).toString("hex") });
}
// do retries reuse the same randomness? compare the 32-byte payloads
const payloads = new Set<string>();
for (const s of sigs) {
  const t = await tB.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
  const d = t?.transaction.message.compiledInstructions.map((i) => Buffer.from(i.data)).find((x) => x.length >= 40);
  if (d) payloads.add(d.toString("hex"));
}
const out = { visibleFailedCallbacksToB: rows.length, rows: rows.slice(0, 4), distinctPayloadsInLast20: payloads.size };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync("out/privacy-vrf3.json", JSON.stringify(out, null, 1));
process.exit(0);
