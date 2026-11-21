// Reclaims rent: for a run, delegates any not-yet-delegated Peek/Log to the run's validator,
// finishes without the action (commit + undelegate), and closes everything; or undelegates and
// closes the Bench. Usage: tsx scripts/teardown.ts --id=N [--er=tee|as] [--bench]
import { BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { base, DELEGATION_PROGRAM, KIND, MAGIC_PROGRAM_ID, pda, program, PROGRAM_ID, send, teeAs, TEE_VALIDATOR, wallet, waitFor } from "./lib.ts";
const arg = (k: string, d?: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const id = Number(arg("id"));
const isAs = arg("er", "tee") === "as";
const validator = isAs ? new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57") : TEE_VALIDATOR;
const auth = wallet();
const er = isAs ? new Connection("https://devnet-as.magicblock.app", "confirmed") : (await teeAs(auth)).conn;
const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");
const b0 = await base.getBalance(auth.publicKey);
if (process.argv.includes("--bench")) {
  await send(er, [await program.methods.undelegateBench(new BN(id)).accountsPartial({ payer: auth.publicKey, bench: pda("bench", id), magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT }).instruction()], [auth]);
  await waitFor("bench undelegated", async () => (await base.getAccountInfo(pda("bench", id)))?.owner.equals(PROGRAM_ID), 120_000, 500);
  await send(base, [await program.methods.closeBench(new BN(id)).accountsPartial({ authority: auth.publicKey, bench: pda("bench", id) }).instruction()], [auth], { skipPreflight: false });
} else {
  for (const k of ["board", "secret", "peek", "log"] as const) {
    const info = await base.getAccountInfo(pda(k, id));
    if (info && info.owner.equals(PROGRAM_ID)) {
      await send(base, [await program.methods.delegate(KIND[k], new BN(id)).accountsPartial({ pda: pda(k, id), payer: auth.publicKey, ownerProgram: PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM, systemProgram: SystemProgram.programId }).remainingAccounts([{ pubkey: validator, isSigner: false, isWritable: false }]).instruction()], [auth], { skipPreflight: false });
      await waitFor(`${k} on ER`, async () => (await er.getAccountInfo(pda(k, id)))?.owner.equals(PROGRAM_ID), 60_000, 300);
    }
  }
  await send(er, [await program.methods.finish(new BN(id), false).accountsPartial({ payer: auth.publicKey, board: pda("board", id), secret: pda("secret", id), peek: pda("peek", id), log: pda("log", id), magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT }).instruction()], [auth]);
  for (const k of ["board", "secret", "peek", "log"] as const) await waitFor(`${k} undelegated`, async () => (await base.getAccountInfo(pda(k, id)))?.owner.equals(PROGRAM_ID), 120_000, 500);
  await send(base, [await program.methods.closeAll(new BN(id)).accountsPartial({ authority: auth.publicKey, board: pda("board", id), secret: pda("secret", id), peek: pda("peek", id), log: pda("log", id), vault: pda("vault", id), systemProgram: SystemProgram.programId }).instruction()], [auth], { skipPreflight: false });
}
console.log({ id, er: isAs ? "devnet-as" : "tee", bench: process.argv.includes("--bench"), reclaimedLamports: (await base.getBalance(auth.publicKey)) - b0 });
process.exit(0);
