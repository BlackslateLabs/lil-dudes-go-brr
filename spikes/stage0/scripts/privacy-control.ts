// Positive controls for check 2: what DOES a reader see for (a) a tx touching only public
// accounts and (b) a tx touching a private account the reader is a member of (TX_MESSAGE/TX_LOGS).
// Usage: tsx scripts/privacy-control.ts [--id=N]
import { BN } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { burner, pda, program, runId, save, send, sleep, teeAs, TEE_URL } from "./lib.ts";

const id = runId();
const A = burner("a");
const B = burner("b");
const tA = await teeAs(A);
const tB = await teeAs(B);
const anon = new Connection(TEE_URL, "confirmed");
const heartbeat = await send(tB.conn, [await program.methods.advance(new BN(id), 0).accountsPartial({ board: pda("board", id), log: pda("log", id) }).instruction()], [B]);
const peekVal = new BN("987654321987");
const peekSig = await send(tA.conn, [await program.methods.writePeek(new BN(id), peekVal).accountsPartial({ player: A.publicKey, peek: pda("peek", id) }).instruction()], [A]);
await sleep(2500);
const view = async (conn: Connection, sig: string) => {
  const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!t) return null;
  const m = t.transaction.message;
  return { keys: m.staticAccountKeys.length, ixs: m.compiledInstructions.length, ixDataLen: m.compiledInstructions.map((i) => i.data.length), logs: t.meta?.logMessages?.length ?? 0, firstLog: t.meta?.logMessages?.[0] };
};
const peekIxB58 = (await program.methods.writePeek(new BN(id), peekVal).accountsPartial({ player: A.publicKey, peek: pda("peek", id) }).instruction()).data;
const out = {
  heartbeatPublicOnly: { B: await view(tB.conn, heartbeat), A: await view(tA.conn, heartbeat), noToken: await view(anon, heartbeat) },
  peekMemberA: { A: await view(tA.conn, peekSig), B: await view(tB.conn, peekSig), noToken: await view(anon, peekSig) },
  peekIxDataLen: peekIxB58.length,
  sigs: { heartbeat, peekSig },
};
console.log(JSON.stringify(out, null, 1));
save(`privacy-control-${id}.json`, out);
process.exit(0);
