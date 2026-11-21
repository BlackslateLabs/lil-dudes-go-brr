// Check 4 isolation: MagicBlock's own live ER-VRF demo program (roll-dice-delegated,
// nkPMzRtKV4feTsDfst5P6sH8Rzf4VNe3p9Y1MzMiAme) delegated to devnet-as vs the TEE.
// If it also never calls back on the TEE, the TEE's VRF oracle is the problem, not our program.
// Usage: tsx scripts/vrf-compare.ts [--n=5]
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "node:fs";
import { base, burner, DELEGATION_PROGRAM, ER_VRF_QUEUE, save, send, sleep, stats, teeAs, wallet, waitFor } from "./lib.ts";

const n = Number(process.argv.find((x) => x.startsWith("--n="))?.slice(4) ?? 5);
const idl = JSON.parse(fs.readFileSync(new URL("./ext/random_dice_delegated.json", import.meta.url), "utf8"));
const dice = new Program(idl as anchor.Idl, { connection: base } as anchor.Provider);
const auth = wallet();
const targets = [
  { name: "devnet-as", validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"), url: "https://devnet-as.magicblock.app" },
  { name: "tee", validator: new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"), url: "tee" },
];
const out: Record<string, unknown> = {};
for (const t of targets) {
  const user = burner(`dice-${t.name}`);
  const player = PublicKey.findProgramAddressSync([Buffer.from("playerd2"), user.publicKey.toBuffer()], dice.programId)[0];
  if ((await base.getBalance(user.publicKey)) < 5_000_000) {
    await send(base, [SystemProgram.transfer({ fromPubkey: auth.publicKey, toPubkey: user.publicKey, lamports: 10_000_000 })], [auth]);
  }
  const er: Connection = t.url === "tee" ? (await teeAs(user)).conn : new Connection(t.url, "confirmed");
  const info = await base.getAccountInfo(player);
  if (!info) await send(base, [await dice.methods.initialize().accountsPartial({ payer: user.publicKey, player, systemProgram: SystemProgram.programId }).instruction()], [user]);
  if (!info || !info.owner.equals(DELEGATION_PROGRAM)) {
    await send(base, [await dice.methods.delegate().accountsPartial({ user: user.publicKey, player }).remainingAccounts([{ pubkey: t.validator, isSigner: false, isWritable: false }]).instruction()], [user]);
  }
  await waitFor(`dice player on ${t.name}`, async () => (await er.getAccountInfo(player))?.owner.equals(dice.programId), 60_000, 300);
  const rollnum = async () => (await er.getAccountInfo(player, "processed"))!.data[9];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r0 = await rollnum();
    const t0 = performance.now();
    const sig = await send(er, [await dice.methods.rollDiceDelegated(i + 1).accountsPartial({ payer: user.publicKey, player, oracleQueue: ER_VRF_QUEUE }).instruction()], [user]);
    const tConf = performance.now();
    let cb: number | null = null;
    for (let k = 0; k < 150; k++) {
      if ((await rollnum()) !== r0) { cb = Math.round(performance.now() - t0); break; }
      await sleep(100);
    }
    rows.push({ i, sig, confirmMs: Math.round(tConf - t0), sendToCallbackMs: cb });
    console.log(t.name, JSON.stringify(rows[rows.length - 1]));
  }
  out[t.name] = { player: player.toBase58(), rows, callbacks: rows.filter((r) => r.sendToCallbackMs != null).length, sendToCallbackMs: stats(rows.filter((r) => r.sendToCallbackMs != null).map((r) => r.sendToCallbackMs as number)) };
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { ...(v as object), rows: undefined }])), null, 1));
save("vrf-compare.json", out);
process.exit(0);
