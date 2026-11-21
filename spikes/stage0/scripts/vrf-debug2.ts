import { ER_VRF_QUEUE, teeAs, wallet, PROGRAM_ID } from "./lib.ts";
const tAuth = await teeAs(wallet());
const sigs = await tAuth.conn.getSignaturesForAddress(ER_VRF_QUEUE, { limit: 50 });
for (const s of sigs.slice(0, 4)) {
  const t = await tAuth.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  const m = t?.transaction.message;
  console.log(s.signature.slice(0, 12), s.slot, s.err, m ? { keys: m.staticAccountKeys.map((k, i) => `${k.toBase58().slice(0, 8)}${m.isAccountWritable(i) ? "(w)" : ""}${m.isAccountSigner(i) ? "(s)" : ""}`), mentionsUs: m.staticAccountKeys.some((k) => k.equals(PROGRAM_ID)), logs: t?.meta?.logMessages?.slice(0, 12) } : null);
}
process.exit(0);
