// Undelegates the two roll-dice demo players used in vrf-compare.ts and sweeps the burners' SOL
// back to the deploy wallet. (The demo program has no close ix: ~0.001 SOL of player rent stays.)
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import fs from "node:fs";
import { base, burner, DELEGATION_PROGRAM, MAGIC_PROGRAM_ID, send, teeAs, wallet, waitFor } from "./lib.ts";
const idl = JSON.parse(fs.readFileSync(new URL("./ext/random_dice_delegated.json", import.meta.url), "utf8"));
const dice = new Program(idl as anchor.Idl, { connection: base } as anchor.Provider);
const auth = wallet();
for (const name of ["devnet-as", "tee"]) {
  const user = burner(`dice-${name}`);
  const player = PublicKey.findProgramAddressSync([Buffer.from("playerd2"), user.publicKey.toBuffer()], dice.programId)[0];
  const er = name === "tee" ? (await teeAs(user)).conn : new Connection("https://devnet-as.magicblock.app", "confirmed");
  if ((await base.getAccountInfo(player))?.owner.equals(DELEGATION_PROGRAM)) {
    await send(er, [await dice.methods.undelegate().accountsPartial({ payer: user.publicKey, user: player, magicProgram: MAGIC_PROGRAM_ID, magicContext: new PublicKey("MagicContext1111111111111111111111111111111") }).instruction()], [user]);
    await waitFor("dice undelegated", async () => (await base.getAccountInfo(player))?.owner.equals(dice.programId), 90_000, 500);
  }
  const left = await base.getBalance(user.publicKey);
  if (left > 5000) await send(base, [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: auth.publicKey, lamports: left - 5000 })], [user]);
  console.log(name, { swept: left - 5000 });
}
process.exit(0);
