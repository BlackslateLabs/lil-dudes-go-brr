// Checks 1 + 2 + extra (a). A and B are burners with 0 SOL, each with its own TEE token.
// 1: Secret (private, no members) is unreadable by A, B, the authority and token-less clients,
//    while prove_read (program) publishes a value derived from it. Peek (member A) readable by A only.
// 2: B tries every read path for A's plant_rig txs: getTransaction, getSignaturesForAddress,
//    getBlock, onLogs (program / all / Secret mention), accountSubscribe, programSubscribe,
//    signatureSubscribe. Every payload B receives is searched for the secret bytes.
// a: A (0 SOL) is the fee payer of its own ER txs.
// Usage: tsx scripts/privacy.ts [--id=N]
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { base, burner, decodeBoard, pda, program, PROGRAM_ID, runId, save, send, sleep, teeAs, TEE_URL, wallet } from "./lib.ts";

const id = runId();
const auth = wallet();
const A = burner("a");
const B = burner("b");
const zero = Keypair.generate();
const secret = pda("secret", id);
const peek = pda("peek", id);
const board = pda("board", id);

const balances = Object.fromEntries(
  await Promise.all([A, B, zero].map(async (k, i) => [["A", "B", "zero"][i], await base.getBalance(k.publicKey)])),
);
console.log("base balances (lamports)", balances);

const tA = await teeAs(A);
const tB = await teeAs(B);
const tAuth = await teeAs(auth);
const tZero = await teeAs(zero);
const anon = new Connection(TEE_URL, "confirmed");

// Distinctive salts so leaks are greppable in any encoding.
const mkSalt = (tag: string) => Buffer.concat([Buffer.from(tag), randomBytes(16 - tag.length)]);
const salts = { p1: mkSalt("LDGBR1"), p2: mkSalt("LDGBR2"), p3: mkSalt("LDGBR3") };
const needles = (s: Buffer, cell: number) => {
  const ixData = Buffer.concat([Buffer.from(program.coder.instruction.encode("plantRig", { _id: new BN(id), cell, salt: [...s] }))]);
  const ixData2 = Buffer.from(program.coder.instruction.encode("plantRigBoard", { _id: new BN(id), cell, salt: [...s] }));
  return [s.toString("hex"), s.toString("base64").slice(0, 16), bs58.encode(s), bs58.encode(ixData), ixData.toString("base64"), bs58.encode(ixData2), ixData2.toString("base64"), s.subarray(0, 6).toString("latin1")];
};

// ---------------------------------------------------------------- B's listeners (check 2)
const seenByB: { via: string; payload: string }[] = [];
const record = (via: string) => (x: unknown) => seenByB.push({ via, payload: JSON.stringify(x, (_k, v) => (v instanceof Uint8Array || Buffer.isBuffer(v) ? Buffer.from(v).toString("base64") : v)) });
const subs: Array<() => Promise<void>> = [];
const sB = tB.conn;
let id1 = sB.onLogs(PROGRAM_ID, record("B onLogs(program)"), "confirmed"); subs.push(() => sB.removeOnLogsListener(id1));
let id2 = sB.onLogs("all", record("B onLogs(all)"), "confirmed"); subs.push(() => sB.removeOnLogsListener(id2));
let id3 = sB.onLogs(secret, record("B onLogs(Secret)"), "confirmed"); subs.push(() => sB.removeOnLogsListener(id3));
let id4 = sB.onAccountChange(secret, record("B accountSubscribe(Secret)"), { commitment: "confirmed" }); subs.push(() => sB.removeAccountChangeListener(id4));
let id5 = sB.onAccountChange(peek, record("B accountSubscribe(Peek)"), { commitment: "confirmed" }); subs.push(() => sB.removeAccountChangeListener(id5));
let id6 = sB.onProgramAccountChange(PROGRAM_ID, record("B programSubscribe"), { commitment: "confirmed" }); subs.push(() => sB.removeProgramAccountChangeListener(id6));
let id7 = sB.onAccountChange(board, record("B accountSubscribe(Board)"), { commitment: "confirmed" }); subs.push(() => sB.removeAccountChangeListener(id7));
// A's own listener as a control (is the channel alive at all?)
const seenByA: string[] = [];
let ida = tA.conn.onLogs(PROGRAM_ID, (l) => seenByA.push(JSON.stringify(l)), "confirmed");
await sleep(1500);

// ---------------------------------------------------------------- extra (a): 0-SOL fee payer
const extraA: Record<string, unknown> = {};
const plantIx = (who: Keypair, s: Buffer, cell: number, withBoard: boolean) =>
  withBoard
    ? program.methods.plantRigBoard(new BN(id), cell, [...s]).accountsPartial({ player: who.publicKey, secret, board }).instruction()
    : program.methods.plantRig(new BN(id), cell, [...s]).accountsPartial({ player: who.publicKey, secret }).instruction();

const sigs: Record<string, string> = {};
try {
  sigs.p1 = await send(tA.conn, [await plantIx(A, salts.p1, 7, false)], [A]);
  extraA.burnerFeePayer = { ok: true, sig: sigs.p1, baseLamports: balances.A };
} catch (e) {
  extraA.burnerFeePayer = { ok: false, error: String(e).slice(0, 600) };
  // fallback: authority pays, A co-signs as the player
  sigs.p1 = await send(tA.conn, [await plantIx(A, salts.p1, 7, false)], [auth, A]);
}
try {
  const s = await send(tZero.conn, [await program.methods.advance(new BN(id), 0).accountsPartial({ board, log: pda("log", id) }).instruction()], [zero]);
  extraA.neverSeenKeypairHeartbeat = { ok: true, sig: s };
} catch (e) {
  extraA.neverSeenKeypairHeartbeat = { ok: false, error: String(e).slice(0, 600) };
}
console.log("extra a", extraA);

sigs.p2 = await send(tA.conn, [await plantIx(A, salts.p2, 4, true)], [A]);
sigs.proveRead = await send(tB.conn, [await program.methods.proveRead(new BN(id)).accountsPartial({ secret, board }).instruction()], [B]);
sigs.peek = await send(tA.conn, [await program.methods.writePeek(new BN(id), new BN("1234567890123")).accountsPartial({ player: A.publicKey, peek }).instruction()], [A]);
await sleep(3000);

// ---------------------------------------------------------------- check 1: account reads
const tryRead = async (conn: Connection, pk: PublicKey) => {
  try {
    const info = await conn.getAccountInfo(pk, "confirmed");
    return info ? { visible: true, owner: info.owner.toBase58(), len: info.data.length, b64: info.data.toString("base64") } : { visible: false, result: null };
  } catch (e) {
    return { visible: false, error: String(e).slice(0, 200) };
  }
};
const readers = { A: tA.conn, B: tB.conn, authority: tAuth.conn, zero: tZero.conn, noToken: anon };
const check1: Record<string, Record<string, unknown>> = {};
for (const [name, conn] of Object.entries(readers)) {
  check1[name] = {};
  for (const [acc, pk] of Object.entries({ secret, peek, board })) {
    const r = await tryRead(conn, pk);
    check1[name][acc] = acc === "board" || !r.visible ? r : { ...r, b64: `${String(r.b64).slice(0, 24)}…` };
  }
}
const boardB = await tB.conn.getAccountInfo(board);
const echo = boardB ? decodeBoard(boardB.data).secretEcho : null;
const expectedValue = salts.p2.readBigUInt64LE(0); // p2 was the last plant before prove_read
const proveRead = { echoSeenByB: echo?.toString(), expected: (expectedValue ^ 0x5a5a5a5a5a5a5a5an).toString(), match: echo === (expectedValue ^ 0x5a5a5a5a5a5a5a5an) };
console.log("check1 secret visible to:", Object.entries(check1).filter(([, v]) => (v.secret as { visible: boolean }).visible).map(([k]) => k), "peek visible to:", Object.entries(check1).filter(([, v]) => (v.peek as { visible: boolean }).visible).map(([k]) => k), "prove_read", proveRead);

// more read paths for B
const extraReads: Record<string, unknown> = {};
const attempt = async (name: string, f: () => Promise<unknown>) => {
  try {
    const v = await f();
    extraReads[name] = v;
    seenByB.push({ via: name, payload: JSON.stringify(v, (_k, x) => (Buffer.isBuffer(x) || x instanceof Uint8Array ? Buffer.from(x).toString("base64") : x)) });
  } catch (e) {
    extraReads[name] = { error: String(e).slice(0, 300) };
  }
};
await attempt("B getMultipleAccounts", async () => (await tB.conn.getMultipleAccountsInfo([secret, peek, board])).map((x) => (x ? { len: x.data.length, data: x.data } : null)));
await attempt("B getProgramAccounts", async () => (await tB.conn.getProgramAccounts(PROGRAM_ID)).map((x) => ({ pubkey: x.pubkey.toBase58(), len: x.account.data.length, data: x.account.data })));

// ---------------------------------------------------------------- check 2: tx data / logs
await sleep(2000);
sigs.p3 = await send(tA.conn, [await plantIx(A, salts.p3, 2, true)], [A]); // while B's listeners are up
await sleep(4000);

for (const [who, conn] of Object.entries({ B: tB.conn, noToken: anon, A: tA.conn, authority: tAuth.conn })) {
  for (const target of ["secret", "board", "program", "A"] as const) {
    const pk = { secret, board, program: PROGRAM_ID, A: A.publicKey }[target];
    await attempt(`${who} getSignaturesForAddress(${target})`, async () => (await conn.getSignaturesForAddress(pk, { limit: 50 })).map((s) => s.signature));
  }
  for (const [k, sig] of Object.entries(sigs)) {
    await attempt(`${who} getTransaction(${k})`, async () => {
      const t = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      return t ? { slot: t.slot, msg: t.transaction.message, logs: t.meta?.logMessages, err: t.meta?.err } : null;
    });
  }
}
const slot = (extraReads["A getTransaction(p3)"] as { slot?: number } | undefined)?.slot ?? (await tB.conn.getSlot());
await attempt("B getBlock(p3 slot)", async () => {
  const b = await tB.conn.getBlock(slot, { maxSupportedTransactionVersion: 0, transactionDetails: "full", rewards: false });
  return b ? { txs: b.transactions.length, body: b.transactions } : null;
});
await attempt("B getSignatureStatuses", async () => (await tB.conn.getSignatureStatuses(Object.values(sigs))).value);

for (const u of subs) await u().catch(() => {});
await tA.conn.removeOnLogsListener(ida).catch(() => {});

// Search everything B (or the token-less client) received for the secret bytes.
const leaks: { via: string; needle: string; salt: string }[] = [];
for (const [k, s] of Object.entries(salts)) {
  const cell = { p1: 7, p2: 4, p3: 2 }[k as "p1"]!;
  for (const n of needles(s, cell)) {
    for (const e of seenByB) {
      if (!e.via.startsWith("A ") && !e.via.startsWith("authority ") && e.payload.includes(n)) leaks.push({ via: e.via, needle: n.slice(0, 20), salt: k });
    }
  }
}
// Controls: does A (signer) / the authority get their own tx back?
const controlSeen = Object.fromEntries(
  Object.entries(extraReads)
    .filter(([k]) => k.includes("getTransaction"))
    .map(([k, v]) => [k, v === null ? "null" : (v as { error?: string }).error ? `error: ${(v as { error: string }).error.slice(0, 80)}` : "returned"]),
);
const sigLists = Object.fromEntries(Object.entries(extraReads).filter(([k]) => k.includes("getSignaturesForAddress")).map(([k, v]) => [k, Array.isArray(v) ? `${v.length} sigs; ours: ${Object.entries(sigs).filter(([, s]) => (v as string[]).includes(s)).map(([n]) => n).join(",") || "none"}` : (v as { error: string }).error?.slice(0, 80)]));
const subCounts: Record<string, number> = {};
for (const e of seenByB) if (e.via.startsWith("B ") && !e.via.includes("get")) subCounts[e.via] = (subCounts[e.via] ?? 0) + 1;

const result = {
  id, sigs, salts: Object.fromEntries(Object.entries(salts).map(([k, v]) => [k, v.toString("hex")])), extraA, check1, proveRead,
  check2: { leaks, subscriptionNotificationsToB: subCounts, aOwnOnLogsCount: seenByA.length, getTransaction: controlSeen, getSignaturesForAddress: sigLists, block: extraReads["B getBlock(p3 slot)"] ? "returned" : extraReads["B getBlock(p3 slot)"], gpaB: extraReads["B getProgramAccounts"], multiB: extraReads["B getMultipleAccounts"] },
};
save(`privacy-${id}.raw.json`, { ...result, seenByB, extraReads });
save(`privacy-${id}.json`, { ...result, check2: { ...result.check2, gpaB: Array.isArray(result.check2.gpaB) ? (result.check2.gpaB as { pubkey: string; len: number }[]).map((x) => `${x.pubkey} (${x.len} B)`) : result.check2.gpaB, multiB: Array.isArray(result.check2.multiB) ? (result.check2.multiB as unknown[]).map((x) => (x ? "visible" : "null")) : result.check2.multiB } });
console.log(JSON.stringify({ leaks, subCounts, controlSeen, sigLists }, null, 1));
process.exit(0);
