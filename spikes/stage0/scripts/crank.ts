// Checks 3 + 5. Starts a real bot-vs-bot match on the Board (crates/sim, catch-up advance),
// schedules a crank calling `advance` every --interval ms for --iterations runs, and measures:
//  3: the on-chain interval between crank calls (CrankLog slot deltas → ms via the measured slot
//     rate), missed / failed calls (Board signatures with err), and how far the sim lags the clock.
//  5: accountSubscribe(Board) over the TEE websocket with a token (raw WebSocket, like a browser):
//     updates/s, inter-arrival jitter, for `processed` and `confirmed`.
// Usage: tsx scripts/crank.ts [--id=N] [--interval=50] [--iterations=3000] [--listen=160] [--no-start]
import { BN } from "@coral-xyz/anchor";
import { decodeBoard, decodeLog, MAGIC_PROGRAM_ID, pda, program, runId, save, send, sleep, stats, teeAs, TEE_URL, TEE_WS, wallet, burner } from "./lib.ts";

const arg = (k: string, d: string) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const id = runId();
const interval = Number(arg("interval", "50"));
const iterations = Number(arg("iterations", "3000"));
const listenS = Number(arg("listen", String(Math.ceil((interval * iterations) / 1000) + 15)));
const auth = wallet();
const A = burner("a");
const tAuth = await teeAs(auth);
const tA = await teeAs(A);
const board = pda("board", id);
const log = pda("log", id);

// ---- websocket listeners (A's token, raw WebSocket like a browser) ----
type Arrival = { t: number; slot: number; crankCalls: number; simTick: number; lastSlot: number; startSlot: number };
const arrivals: Record<string, Arrival[]> = { processed: [], confirmed: [] };
const sockets: WebSocket[] = [];
for (const commitment of ["processed", "confirmed"] as const) {
  const ws = new WebSocket(`${TEE_WS}?token=${tA.token}`);
  sockets.push(ws);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(e); });
  ws.onmessage = (ev) => {
    const t = performance.now();
    const msg = JSON.parse(String(ev.data));
    if (msg.method !== "accountNotification") return;
    const v = msg.params.result;
    const b = decodeBoard(Buffer.from(v.value.data[0], "base64"));
    arrivals[commitment].push({ t, slot: v.context.slot, crankCalls: b.crankCalls, simTick: b.simTick, lastSlot: b.lastSlot, startSlot: b.startSlot });
  };
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "accountSubscribe", params: [board.toBase58(), { encoding: "base64", commitment }] }));
}

// ---- slot clock sampler (ms per ER slot) ----
const slotSamples: { t: number; slot: number }[] = [];
let sampling = true;
(async () => {
  while (sampling) {
    const t0 = performance.now();
    const slot = await tAuth.conn.getSlot("processed").catch(() => null);
    const t1 = performance.now();
    if (slot != null) slotSamples.push({ t: (t0 + t1) / 2, slot });
    await sleep(1000);
  }
})();

const before = decodeBoard((await tAuth.conn.getAccountInfo(board))!.data);
const logBefore = decodeLog((await tAuth.conn.getAccountInfo(log))!.data);
let startSig: string | null = null;
if (!process.argv.includes("--no-start")) {
  startSig = await send(tAuth.conn, [await program.methods.start(new BN(id)).accountsPartial({ payer: auth.publicKey, board }).instruction()], [auth]);
}
const taskId = new BN(Math.floor(Math.random() * 2 ** 46)).add(new BN(id));
const tSchedule = performance.now();
const scheduleSig = await send(
  tAuth.conn,
  [await program.methods.scheduleCrank(new BN(id), taskId, new BN(interval), new BN(iterations)).accountsPartial({ magicProgram: MAGIC_PROGRAM_ID, payer: auth.publicKey, board, log }).instruction()],
  [auth],
);
console.log({ id, interval, iterations, listenS, taskId: taskId.toString(), startSig, scheduleSig });
const t0 = performance.now();
for (let s = 0; s < listenS; s += 10) {
  await sleep(10_000);
  const p = arrivals.processed;
  const last = p[p.length - 1];
  console.log(`t+${s + 10}s updates(processed)=${p.length} confirmed=${arrivals.confirmed.length} crankCalls=${last?.crankCalls} simTick=${last?.simTick}`);
}
sampling = false;
for (const ws of sockets) ws.close();

// ---- on-chain ground truth ----
const after = decodeBoard((await tAuth.conn.getAccountInfo(board))!.data);
const logAfter = decodeLog((await tAuth.conn.getAccountInfo(log))!.data);
const deltas = logAfter.deltas.slice(logBefore.n);
const slotMs = (() => {
  const a = slotSamples[0], b = slotSamples[slotSamples.length - 1];
  return (b.t - a.t) / (b.slot - a.slot);
})();
// failed crank txs: walk Board's signature list for the run window
let failed = 0, okTx = 0, before_: string | undefined;
for (let page = 0; page < 10; page++) {
  const sigs = await tAuth.conn.getSignaturesForAddress(board, { limit: 1000, before: before_ }).catch(() => []);
  if (sigs.length === 0) break;
  for (const s of sigs) {
    if (s.slot < after.startSlot - 5 && startSig) continue;
    if (s.err) failed++; else okTx++;
  }
  before_ = sigs[sigs.length - 1].signature;
  if (sigs[sigs.length - 1].slot < (startSig ? after.startSlot : logAfter.firstSlot)) break;
}

const interArrival = (xs: Arrival[]) => xs.slice(1).map((a, i) => a.t - xs[i].t);
const perSecond = (xs: Arrival[]) => {
  const bins = new Map<number, number>();
  for (const a of xs) bins.set(Math.floor((a.t - t0) / 1000), (bins.get(Math.floor((a.t - t0) / 1000)) ?? 0) + 1);
  const full = [...bins.entries()].filter(([s]) => s >= 2 && s < Math.floor((xs[xs.length - 1]?.t - t0) / 1000) - 1).map(([, n]) => n);
  return stats(full);
};
const updatesPerCall = (xs: Arrival[]) => {
  const calls = new Set(xs.map((a) => a.crankCalls));
  return { distinctCrankStatesSeen: calls.size, notifications: xs.length };
};
// sim lag: target tick from the slot in the notification vs the sim tick it carries
const lag = arrivals.processed.filter((a) => a.startSlot > 0).map((a) => Math.floor((a.lastSlot - a.startSlot) / 5) - a.simTick);
const crankCalls = after.crankCalls - before.crankCalls;
const wallS = (performance.now() - tSchedule) / 1000;

const result = {
  id, interval, iterations, taskId: taskId.toString(), sigs: { startSig, scheduleSig },
  slotMs: Math.round(slotMs * 100) / 100,
  check3: {
    crankCalls, expectedCalls: iterations, missed: iterations - crankCalls, failedTxsOnBoard: failed, okTxsOnBoard: okTx,
    slotDelta: stats(deltas),
    intervalMs: stats(deltas.map((d) => d * slotMs)),
    gapsOver2xInterval: deltas.filter((d) => d * slotMs > 2 * interval).length,
    histogramSlots: Object.fromEntries([...deltas.reduce((m, d) => m.set(d, (m.get(d) ?? 0) + 1), new Map<number, number>()).entries()].sort((a, b) => a[0] - b[0])),
    durationS: Math.round((deltas.reduce((a, b) => a + b, 0) * slotMs) / 100) / 10,
    sim: { stepsTotal: after.stepsTotal - before.stepsTotal, maxStepsPerCall: after.maxSteps, finalTick: after.simTick, hp: after.hp, ended: after.resultTag === 1, lagTicks: stats(lag) },
  },
  check5: Object.fromEntries(Object.entries(arrivals).map(([c, xs]) => [c, { ...updatesPerCall(xs), perSecond: perSecond(xs), interArrivalMs: stats(interArrival(xs)), over100ms: interArrival(xs).filter((x) => x > 100).length }])),
  wallS: Math.round(wallS),
};
console.log(JSON.stringify(result, null, 1));
save(`crank-${id}.json`, result);
save(`crank-${id}.raw.json`, { deltas, arrivals, slotSamples });
process.exit(0);
