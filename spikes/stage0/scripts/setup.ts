// Creates one run: base accounts + vault, delegates Board/Secret/Peek/Log/Bench to the TEE,
// then creates the ephemeral permissions (Secret: private, no members; Peek: private, member A).
// Usage: tsx scripts/setup.ts [--id=N] [--vault=LAMPORTS]
import { BN } from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import { TX_LOGS_FLAG, TX_MESSAGE_FLAG, TX_BALANCES_FLAG, ACCOUNT_SIGNATURES_FLAG } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  base, burner, DELEGATION_PROGRAM, EPHEMERAL_VAULT, KIND, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID, PROGRAM_ID,
  pda, permissionPdaFromAccount, program, save, send, teeAs, TEE_VALIDATOR, waitFor, wallet, type Kind,
} from "./lib.ts";

const arg = (k: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3);
const id = Number(arg("id") ?? Math.floor(Date.now() / 1000) % 1_000_000_000);
const vaultLamports = Number(arg("vault") ?? 10_000_000);
const kinds: Kind[] = (arg("kinds") ?? "board,secret,peek,log,bench").split(",") as Kind[];

const auth = wallet();
const A = burner("a");
const B = burner("b");
const recipient = burner(`recipient-${id}`);
console.log({ id, program: PROGRAM_ID.toBase58(), authority: auth.publicKey.toBase58(), A: A.publicKey.toBase58(), B: B.publicKey.toBase58(), recipient: recipient.publicKey.toBase58() });

const t0 = Date.now();
const timings: Record<string, number> = {};
const lap = (k: string) => { timings[k] = Date.now() - t0; };

// 1. base: init + bench
const initIx = await program.methods
  .init(new BN(id), new BN(vaultLamports), A.publicKey, recipient.publicKey)
  .accountsPartial({ payer: auth.publicKey, board: pda("board", id), secret: pda("secret", id), peek: pda("peek", id), log: pda("log", id), vault: pda("vault", id), systemProgram: SystemProgram.programId })
  .instruction();
const ixs = [initIx];
if (kinds.includes("bench")) {
  ixs.push(await program.methods.initBench(new BN(id)).accountsPartial({ payer: auth.publicKey, bench: pda("bench", id), systemProgram: SystemProgram.programId }).instruction());
}
const initSig = await send(base, ixs, [auth], { skipPreflight: false });
lap("init");
console.log("init", initSig);

// 2. base: delegate each PDA to the TEE validator
const delegateSigs: Record<string, string> = {};
for (const k of kinds) {
  const ix = await program.methods
    .delegate(KIND[k], new BN(id))
    .accountsPartial({ pda: pda(k, id), payer: auth.publicKey, ownerProgram: PROGRAM_ID, delegationProgram: DELEGATION_PROGRAM, systemProgram: SystemProgram.programId })
    .remainingAccounts([{ pubkey: TEE_VALIDATOR, isSigner: false, isWritable: false }])
    .instruction();
  delegateSigs[k] = await send(base, [ix], [auth], { skipPreflight: false });
}
lap("delegate");
console.log("delegated", delegateSigs);

// 3. ER: wait until the TEE sees them, then create the ephemeral permissions
const { conn: teeAuth } = await teeAs(auth);
for (const k of kinds) {
  await waitFor(`${k} on TEE`, async () => {
    const info = await teeAuth.getAccountInfo(pda(k, id));
    return info && info.owner.equals(PROGRAM_ID);
  }, 60_000, 300);
}
lap("visible_on_tee");

const permIx = (k: Kind, members: { flags: number; pubkey: import("@solana/web3.js").PublicKey }[] | null) =>
  program.methods
    .initPermission(KIND[k], new BN(id), members)
    .accountsPartial({
      permissionedAccount: pda(k, id),
      permission: permissionPdaFromAccount(pda(k, id)),
      authority: auth.publicKey,
      permissionProgram: PERMISSION_PROGRAM_ID,
      ephemeralVault: EPHEMERAL_VAULT,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
const readFlags = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG | ACCOUNT_SIGNATURES_FLAG;
const noPerms = process.argv.includes("--no-perms");
const permSig = noPerms ? null : await send(teeAuth, [await permIx("secret", []), await permIx("peek", [{ flags: readFlags, pubkey: A.publicKey }])], [auth]);
lap("permissions");
console.log("permissions", permSig);

const run = {
  id, program: PROGRAM_ID.toBase58(), created: new Date().toISOString(), vaultLamports,
  authority: auth.publicKey.toBase58(), A: A.publicKey.toBase58(), B: B.publicKey.toBase58(), recipient: recipient.publicKey.toBase58(),
  accounts: Object.fromEntries((["board", "secret", "peek", "log", "bench", "vault"] as const).map((k) => [k, pda(k, id).toBase58()])),
  permissions: { secret: permissionPdaFromAccount(pda("secret", id)).toBase58(), peek: permissionPdaFromAccount(pda("peek", id)).toBase58() },
  sigs: { init: initSig, delegate: delegateSigs, permissions: permSig },
  timingsMs: timings,
};
if (!process.argv.includes("--no-default")) save("run.json", run);
save(`run-${id}.json`, run);
