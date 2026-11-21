// Check 4: ER VRF (#[vrf], DEFAULT_EPHEMERAL_QUEUE) requested from the TEE; the callback writes
// the seed into the private Secret and the slot into the public Board. Measures request→callback
// latency client-side (ws on Board) and on-chain (callback slot − request slot).
// Usage: tsx scripts/vrf.ts [--id=N] [--n=10] [--payer=a|auth]
import { BN } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { burner, decodeBoard, ER_VRF_QUEUE, pda, program, runId, save, send, sleep, stats, teeAs, TEE_WS, wallet } from "./lib.ts";

const arg = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const id = runId();
const n = Number(arg("n", "10"));
const payer = arg("payer", "a") === "a" ? burner("a") : wallet();
const tP = await teeAs(payer);
const board = pda("board", id);
const VRF_PROGRAM = new (await import("@solana/web3.js")).PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const SLOT_HASHES = new (await import("@solana/web3.js")).PublicKey("SysvarS1otHashes111111111111111111111111111");

let lastCount = decodeBoard((await tP.conn.getAccountInfo(board))!.data).vrfCbCount;
const cbTimes: { t: number; count: number; req: number; cb: number }[] = [];
const ws = new WebSocket(`${TEE_WS}?token=${tP.token}`);
await new Promise<void>((r) => { ws.onopen = () => r(); });
ws.onmessage = (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.method !== "accountNotification") return;
  const b = decodeBoard(Buffer.from(m.params.result.value.data[0], "base64"));
  if (b.vrfCbCount > lastCount) { lastCount = b.vrfCbCount; cbTimes.push({ t: performance.now(), count: b.vrfCbCount, req: b.vrfReqSlot, cb: b.vrfCbSlot }); }
};
ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "accountSubscribe", params: [board.toBase58(), { encoding: "base64", commitment: "processed" }] }));
await sleep(800);

const rows: Record<string, unknown>[] = [];
for (let i = 0; i < n; i++) {
  const ix = await program.methods.requestSeed(new BN(id), i & 0xff)
    .accountsPartial({ payer: payer.publicKey, secret: pda("secret", id), board, oracleQueue: ER_VRF_QUEUE, vrfProgram: VRF_PROGRAM, slotHashes: SLOT_HASHES, systemProgram: SystemProgram.programId })
    .instruction();
  const before = cbTimes.length;
  const tSend = performance.now();
  let sig: string, err: string | null = null;
  try { sig = await send(tP.conn, [ix], [payer]); } catch (e) { err = String(e).slice(0, 500); rows.push({ i, err }); console.log(err); break; }
  const tConf = performance.now();
  const t0 = Date.now();
  while (cbTimes.length === before && Date.now() - t0 < 15_000) await sleep(5);
  const cb = cbTimes[before];
  const row = cb
    ? { i, sig, sendToConfirmMs: Math.round(tConf - tSend), sendToCallbackMs: Math.round(cb.t - tSend), confirmToCallbackMs: Math.round(cb.t - tConf), slots: cb.cb - cb.req }
    : { i, sig, sendToConfirmMs: Math.round(tConf - tSend), callback: "none within 15 s" };
  rows.push(row);
  console.log(JSON.stringify(row));
  await sleep(1000);
}
ws.close();
const ok = rows.filter((r) => typeof r.sendToCallbackMs === "number");
const result = {
  id, payer: payer.publicKey.toBase58(), payerIsZeroSolBurner: arg("payer", "a") === "a", requested: rows.length, callbacks: ok.length,
  sendToCallbackMs: stats(ok.map((r) => r.sendToCallbackMs as number)),
  confirmToCallbackMs: stats(ok.map((r) => r.confirmToCallbackMs as number)),
  callbackSlotsAfterRequest: stats(ok.map((r) => r.slots as number)),
  rows,
};
console.log(JSON.stringify({ ...result, rows: undefined }, null, 1));
save(`vrf-${id}.json`, result);
process.exit(0);
