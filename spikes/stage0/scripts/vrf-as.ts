// Check 4 isolation: OUR program (scoped VRF request, 0.18 `create_request_randomness_ix_const`)
// delegated to the public devnet-as ER instead of the TEE.
// Usage: tsx scripts/vrf-as.ts [--n=3]
import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { base, decodeBoard, DELEGATION_PROGRAM, ER_VRF_QUEUE, KIND, pda, program, PROGRAM_ID, save, send, sleep, wallet, waitFor, burner } from "./lib.ts";
const n = Number(process.argv.find((x) => x.startsWith("--n="))?.slice(4) ?? 3);
const AS = new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57");
const er = new Connection("https://devnet-as.magicblock.app", "confirmed");
const auth = wallet();
const id = Math.floor(Date.now() / 1000) % 1_000_000_000;
await send(base, [await program.methods.init(new BN(id), new BN(0), burner("a").publicKey, auth.publicKey).accountsPartial({ payer: auth.publicKey, board: pda("board", id), secret: pda("secret", id), peek: pda("peek", id), log: pda("log", id), vault: pda("vault", id), systemProgram: SystemProgram.programId }).instruction()], [auth], { skipPreflight: false });
for (const k of ["board", "secret"] as const) {
  await send(base, [await program.methods.delegate(KIND[k], new BN(id)).accountsPartial({ pda: pda(k, id), payer: auth.publicKey, ownerProgram: PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM, systemProgram: SystemProgram.programId }).remainingAccounts([{ pubkey: AS, isSigner: false, isWritable: false }]).instruction()], [auth], { skipPreflight: false });
}
await waitFor("board on devnet-as", async () => (await er.getAccountInfo(pda("board", id)))?.owner.equals(PROGRAM_ID), 60_000, 300);
const VRF = new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz");
const SH = new PublicKey("SysvarS1otHashes111111111111111111111111111");
const rows = [];
for (let i = 0; i < n; i++) {
  const c0 = decodeBoard((await er.getAccountInfo(pda("board", id)))!.data).vrfCbCount;
  const t0 = performance.now();
  const sig = await send(er, [await program.methods.requestSeed(new BN(id), i).accountsPartial({ payer: auth.publicKey, secret: pda("secret", id), board: pda("board", id), oracleQueue: ER_VRF_QUEUE, vrfProgram: VRF, slotHashes: SH, systemProgram: SystemProgram.programId }).instruction()], [auth]);
  let cb: number | null = null;
  for (let k = 0; k < 150; k++) {
    if (decodeBoard((await er.getAccountInfo(pda("board", id), "processed"))!.data).vrfCbCount > c0) { cb = Math.round(performance.now() - t0); break; }
    await sleep(100);
  }
  const t = await er.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
  rows.push({ i, sig, sendToCallbackMs: cb, requestLogs: t?.meta?.logMessages?.filter((l) => l.includes("Vrf1") || l.includes("error") || l.includes("failed")).slice(0, 6) });
  console.log(JSON.stringify(rows[rows.length - 1]));
}
save("vrf-as.json", { id, rows });
process.exit(0);
