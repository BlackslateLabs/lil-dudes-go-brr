// Diagnose check 4: request tx logs, ER queue state, callbacks seen on the Board.
import { Connection, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import { burner, decodeBoard, ER_VRF_QUEUE, pda, runId, teeAs, TEE_URL, wallet, base } from "./lib.ts";
const id = runId();
const v = JSON.parse(fs.readFileSync(`out/vrf-${id}.json`, "utf8"));
const tAuth = await teeAs(wallet());
const tA = await teeAs(burner("a"));
const anon = new Connection(TEE_URL, "confirmed");
for (const [name, c] of Object.entries({ A: tA.conn, auth: tAuth.conn, anon })) {
  const t = await c.getTransaction(v.rows[0].sig, { maxSupportedTransactionVersion: 0 });
  console.log(name, "request tx:", t ? { keys: t.transaction.message.staticAccountKeys.length, logs: t.meta?.logMessages } : null);
}
for (const [name, c] of Object.entries({ tee: tAuth.conn, base })) {
  const q = await c.getAccountInfo(ER_VRF_QUEUE);
  console.log(name, "queue:", q ? { owner: q.owner.toBase58(), len: q.data.length, lamports: q.lamports } : null);
}
const b = decodeBoard((await tAuth.conn.getAccountInfo(pda("board", id)))!.data);
console.log("board vrf:", { req: b.vrfReqSlot, cb: b.vrfCbSlot, count: b.vrfCbCount });
const ident = PublicKey.findProgramAddressSync([Buffer.from("identity")], new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz"));
const sigs = await tAuth.conn.getSignaturesForAddress(ER_VRF_QUEUE, { limit: 20 });
console.log("queue sigs (auth view):", sigs.slice(0, 8).map((s) => ({ slot: s.slot, err: s.err, t: s.blockTime })));
process.exit(0);
