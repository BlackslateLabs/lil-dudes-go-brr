// Isolates check 4: request on a run whose Secret is public vs private, payer = authority, and
// looks for our pending request inside the ER queue account right after the request lands.
// Usage: tsx scripts/vrf-probe.ts --ids=PUBLIC_ID,PRIVATE_ID
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { decodeBoard, ER_VRF_QUEUE, pda, program, PROGRAM_ID, save, send, sleep, teeAs, wallet, burner } from "./lib.ts";
const ids = process.argv.find((x) => x.startsWith("--ids="))!.slice(6).split(",").map(Number);
const auth = wallet();
const tAuth = await teeAs(auth);
const VRF = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const SH = new PublicKey("SysvarS1otHashes111111111111111111111111111");
const out: Record<string, unknown>[] = [];
for (const id of ids) {
  for (const payerName of ["auth", "a"]) {
    const payer = payerName === "auth" ? auth : burner("a");
    const conn = payerName === "auth" ? tAuth.conn : (await teeAs(payer)).conn;
    const board = pda("board", id);
    const c0 = decodeBoard((await tAuth.conn.getAccountInfo(board))!.data).vrfCbCount;
    const ix = await program.methods.requestSeed(new BN(id), 7).accountsPartial({ payer: payer.publicKey, secret: pda("secret", id), board, oracleQueue: ER_VRF_QUEUE, vrfProgram: VRF, slotHashes: SH, systemProgram: SystemProgram.programId }).instruction();
    const t0 = performance.now();
    const sig = await send(conn, [ix], [payer]);
    const tConf = performance.now();
    const q = (await tAuth.conn.getAccountInfo(ER_VRF_QUEUE))!.data;
    const inQueue = { program: q.indexOf(PROGRAM_ID.toBuffer()) >= 0, board: q.indexOf(board.toBuffer()) >= 0 };
    let cbMs: number | null = null;
    for (let i = 0; i < 200; i++) {
      const b = decodeBoard((await tAuth.conn.getAccountInfo(board, "processed"))!.data);
      if (b.vrfCbCount > c0) { cbMs = Math.round(performance.now() - t0); break; }
      await sleep(100);
    }
    const q2 = (await tAuth.conn.getAccountInfo(ER_VRF_QUEUE))!.data;
    const row = { id, payer: payerName, sig, confirmMs: Math.round(tConf - t0), inQueueRightAfter: inQueue, stillInQueueAfterWait: q2.indexOf(board.toBuffer()) >= 0, callbackMs: cbMs };
    console.log(JSON.stringify(row));
    out.push(row);
  }
}
save(`vrf-probe.json`, out);
process.exit(0);
