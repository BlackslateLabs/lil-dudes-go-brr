// Diagnose a stuck live match: read it on the TEE and simulate `advance` with logs.
//   tsx scripts/diag-stuck.ts <game pubkey>
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { decodeMatch, ixs, matchAccounts, teeConnection, teeToken } from '../src/live/chain';
const game = new PublicKey(process.argv[2]!);
const kp = Keypair.generate();
const tee = teeConnection(await teeToken(kp));
const info = await tee.getAccountInfo(game);
if (!info) throw new Error('no account on the TEE');
const m = decodeMatch(info.data);
console.log('status', m.header.status, 'id', m.header.id?.toString?.() ?? Object.keys(m.header));
const id = (m.header as { id: bigint }).id;
const acc = matchAccounts(id);
console.log('pda matches', acc.game.equals(game), 'slot', await tee.getSlot());
for (const cu of [200_000, 1_400_000]) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ixs.advance(acc));
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await tee.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sim = await tee.simulateTransaction(tx);
  console.log('CU limit', cu, 'err', JSON.stringify(sim.value.err), 'used', sim.value.unitsConsumed);
  console.log((sim.value.logs ?? []).slice(-8).join('\n'));
}
