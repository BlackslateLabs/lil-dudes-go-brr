import { Connection, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import { pda, PROGRAM_ID } from "./lib.ts";
const er = new Connection("https://devnet-as.magicblock.app", "confirmed");
const { id } = JSON.parse(fs.readFileSync("out/vrf-as.json", "utf8"));
for (const k of ["board", "secret"] as const) {
  const sigs = await er.getSignaturesForAddress(pda(k, id), { limit: 50 });
  console.log(k, sigs.map((s) => ({ sig: s.signature.slice(0, 10), err: s.err })));
}
const sigs = await er.getSignaturesForAddress(pda("board", id), { limit: 50 });
for (const s of sigs.filter((x) => x.err).slice(0, 2)) {
  const t = await er.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  console.log("FAILED", s.signature, t?.meta?.logMessages);
}
// Is the request still sitting in the devnet-as queue copy?
const q = (await er.getAccountInfo(new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc")))!.data;
console.log("our program in devnet-as queue:", q.indexOf(PROGRAM_ID.toBuffer()) >= 0, "board in queue:", q.indexOf(pda("board", id).toBuffer()) >= 0);
// What does a request item look like? Dump bytes around our program id.
const at = q.indexOf(PROGRAM_ID.toBuffer());
if (at >= 0) console.log("context hex:", q.subarray(Math.max(0, at - 80), at + 120).toString("hex"));
process.exit(0);
