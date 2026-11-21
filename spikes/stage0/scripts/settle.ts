// Check 6: finish (commit + undelegate Board/Secret/Peek/Log) with or without the post-commit
// Magic Action `settle_action`, then verify on the base layer:
//   action:   the vault PDA is drained to the recipient by the action (nobody else signs anything)
//   fallback: the action is skipped, the vault is still full after undelegation, and a third
//             party calls the permissionless `settle`; a second settle fails; a direct
//             `settle_action` (no escrow signature) fails.
// Then closes the run's accounts to reclaim rent.
// Usage: tsx scripts/settle.ts --id=N --mode=action|fallback [--er=tee|as] [--no-close]
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "node:fs";
import { base, burner, KEYS, MAGIC_PROGRAM_ID, pda, program, PROGRAM_ID, save, send, sleep, teeAs, wallet, waitFor } from "./lib.ts";

const arg = (k: string, d?: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const id = Number(arg("id"));
const mode = arg("mode", "action") as "action" | "fallback";
const erName = arg("er", "tee");
const auth = wallet();
const er = erName === "tee" ? (await teeAs(auth)).conn : new Connection("https://devnet-as.magicblock.app", "confirmed");
const run = JSON.parse(fs.readFileSync(`out/run-${id}.json`, "utf8").toString().length ? fs.readFileSync(`out/run-${id}.json`, "utf8") : "{}");
const recipient = new PublicKey(run.recipient ?? auth.publicKey);
const board = pda("board", id), vault = pda("vault", id);
const MAGIC_CONTEXT = new PublicKey("MagicContext1111111111111111111111111111111");

const bal = async (pk: PublicKey) => base.getBalance(pk, "confirmed");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rawTx(sig: string): Promise<any> {
  const r = await fetch(base.rpcEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig, { encoding: "json", maxSupportedTransactionVersion: 1, commitment: "confirmed" }] }) });
  return (await r.json()).result;
}
const before = process.argv.includes("--resume") ? { vault: 10_000_000, recipient: 0, boardOwner: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh (recorded before the crash)" } : { vault: await bal(vault), recipient: await bal(recipient), boardOwner: (await base.getAccountInfo(board))?.owner.toBase58() };
console.log({ id, mode, erName, before });

const t0 = performance.now();
const resume = process.argv.includes("--resume");
const finishSig = resume ? "(resumed)" : await send(er, [await program.methods.finish(new BN(id), mode === "action").accountsPartial({ payer: auth.publicKey, board, secret: pda("secret", id), peek: pda("peek", id), log: pda("log", id), magicProgram: MAGIC_PROGRAM_ID, magicContext: MAGIC_CONTEXT }).instruction()], [auth]);
const tFinish = performance.now();
await waitFor("Board undelegated on base", async () => (await base.getAccountInfo(board, "confirmed"))?.owner.equals(PROGRAM_ID), 120_000, 400);
const tUndelegated = performance.now();
const result: Record<string, unknown> = { id, mode, er: erName, finishSig, before, finishConfirmMs: Math.round(tFinish - t0), finishToUndelegatedMs: Math.round(tUndelegated - tFinish) };

if (mode === "action") {
  let drained = false;
  for (let i = 0; i < 120 && !drained; i++) { drained = (await bal(vault)) === 0; if (!drained) await sleep(500); }
  const tDrained = performance.now();
  const after = { vault: await bal(vault), recipient: await bal(recipient) };
  const sigs = await base.getSignaturesForAddress(vault, { limit: 5 });
  // The action tx is a v1 transaction (web3.js 1.x cannot decode it): fetch it raw.
  const actionTx = sigs[0] ? await rawTx(sigs[0].signature) : null;
  Object.assign(result, {
    drainedByAction: drained, finishToDrainedMs: Math.round(tDrained - tFinish), after,
    recipientGain: after.recipient - before.recipient,
    actionTx: sigs[0]?.signature, actionTxVersion: actionTx?.version, actionLogs: (actionTx?.meta?.logMessages as string[] | undefined)?.filter((l) => l.includes("settled") || l.includes("invoke [1]") || l.includes("failed")),
    actionFeePayer: actionTx?.transaction?.message?.accountKeys?.[0],
  });
} else {
  await sleep(4000);
  const vaultAfterUndelegate = await bal(vault);
  // a third party with its own funds calls the permissionless settle
  const anyone = burner(`anyone-${id}`);
  await send(base, [SystemProgram.transfer({ fromPubkey: auth.publicKey, toPubkey: anyone.publicKey, lamports: 3_000_000 })], [auth]);
  const settleSig = await send(base, [await program.methods.settle(new BN(id)).accountsPartial({ board, vault, recipient, systemProgram: SystemProgram.programId }).instruction()], [anyone], { skipPreflight: false });
  const after = { vault: await bal(vault), recipient: await bal(recipient) };
  const again = await send(base, [await program.methods.settle(new BN(id)).accountsPartial({ board, vault, recipient, systemProgram: SystemProgram.programId }).instruction()], [anyone], { skipPreflight: false }).then(() => "UNEXPECTED: succeeded", (e) => String(e).split("\n")[0].slice(0, 160));
  const spoof = await send(base, [await program.methods.settleAction(new BN(id)).accountsPartial({ board, vault, recipient, systemProgram: SystemProgram.programId, sourceProgram: PROGRAM_ID, escrowAuth: anyone.publicKey, escrow: Keypair.generate().publicKey }).instruction()], [anyone], { skipPreflight: false }).then(() => "UNEXPECTED: succeeded", (e) => String(e).split("\n")[0].slice(0, 160));
  // send the anyone-burner's leftover back
  const left = await bal(anyone.publicKey);
  if (left > 5000) await send(base, [SystemProgram.transfer({ fromPubkey: anyone.publicKey, toPubkey: auth.publicKey, lamports: left - 5000 })], [anyone]);
  Object.assign(result, { vaultAfterUndelegate, actionSkipped: vaultAfterUndelegate === before.vault, settleSig, settledBy: anyone.publicKey.toBase58(), after, recipientGain: after.recipient - before.recipient, secondSettle: again, directSettleActionWithoutEscrow: spoof });
}

// committed state on base: Board finished flag + the sim state survived the round trip
const bInfo = (await base.getAccountInfo(board))!;
result.boardOnBase = { owner: bInfo.owner.toBase58(), finished: bInfo.data[8 + 72], settled: bInfo.data[8 + 73], len: bInfo.data.length };
result.secretOnBaseOwner = (await base.getAccountInfo(pda("secret", id)))?.owner.toBase58();

if (!process.argv.includes("--no-close")) {
  const authBefore = await bal(auth.publicKey);
  for (const k of ["peek", "log", "secret"] as const) await waitFor(`${k} undelegated`, async () => (await base.getAccountInfo(pda(k, id)))?.owner.equals(PROGRAM_ID), 120_000, 500);
  const closeSig = await send(base, [await program.methods.closeAll(new BN(id)).accountsPartial({ authority: auth.publicKey, board, secret: pda("secret", id), peek: pda("peek", id), log: pda("log", id), vault, systemProgram: SystemProgram.programId }).instruction()], [auth], { skipPreflight: false });
  result.close = { closeSig, reclaimedLamports: (await bal(auth.publicKey)) - authBefore };
}
// recipient keys are throwaway; return their SOL to the deploy wallet
const rk = `${KEYS}/recipient-${id}.json`;
if (fs.existsSync(rk)) {
  const r = burner(`recipient-${id}`);
  const left = await bal(r.publicKey);
  if (left > 5000) result.recipientRefund = await send(base, [SystemProgram.transfer({ fromPubkey: r.publicKey, toPubkey: auth.publicKey, lamports: left - 5000 })], [r]).then(() => left - 5000);
}
console.log(JSON.stringify(result, null, 1));
save(`settle-${mode}-${id}.json`, result);
process.exit(0);
