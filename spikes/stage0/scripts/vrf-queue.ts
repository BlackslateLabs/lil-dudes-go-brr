// Which validator holds the ER VRF queue? (delegation record on base) and how full is it on the TEE?
import { Connection, PublicKey } from "@solana/web3.js";
import { base, DELEGATION_PROGRAM, ER_VRF_QUEUE, teeAs, wallet, save } from "./lib.ts";
const [rec] = PublicKey.findProgramAddressSync([Buffer.from("delegation"), ER_VRF_QUEUE.toBuffer()], DELEGATION_PROGRAM);
const info = await base.getAccountInfo(rec);
// DelegationRecord: 8 disc | authority (validator) 32 | owner 32 | delegation_slot u64 | lamports u64 | commit_frequency_ms u64
const validator = info ? new PublicKey(info.data.subarray(8, 40)).toBase58() : null;
const owner = info ? new PublicKey(info.data.subarray(40, 72)).toBase58() : null;
const tee = (await teeAs(wallet())).conn;
const q = (await tee.getAccountInfo(ER_VRF_QUEUE))!.data;
const ers: Record<string, string> = { "devnet-as": "https://devnet-as.magicblock.app", "devnet-eu": "https://devnet-eu.magicblock.app", "devnet-us": "https://devnet-us.magicblock.app" };
const elsewhere: Record<string, unknown> = {};
for (const [k, u] of Object.entries(ers)) {
  const c = new Connection(u, "confirmed");
  const a = await c.getAccountInfo(ER_VRF_QUEUE).catch((e) => String(e));
  const sigs = await c.getSignaturesForAddress(ER_VRF_QUEUE, { limit: 5 }).catch(() => []);
  elsewhere[k] = typeof a === "string" ? a : a ? { len: a.data.length, recentSigs: sigs.length, newestSlotAgo: sigs[0] ? (await c.getSlot()) - sigs[0].slot : null, errs: sigs.map((s) => s.err ? "err" : "ok") } : null;
}
const teeSigs = await tee.getSignaturesForAddress(ER_VRF_QUEUE, { limit: 100 });
const out = { queue: ER_VRF_QUEUE.toBase58(), delegatedTo: validator, ownerProgram: owner, teeQueueLen: q.length, teeQueueNonZeroBytes: q.filter((b) => b !== 0).length, teeRecentQueueTxs: teeSigs.length, teeQueueTxErrs: teeSigs.filter((s) => s.err).length, elsewhere };
console.log(JSON.stringify(out, null, 1));
save("vrf-queue.json", out);
process.exit(0);
