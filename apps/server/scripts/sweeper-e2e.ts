// Devnet e2e of the money edges nobody has to be around for (MVP §4), against the deployed program:
//   M1: created + joined (0.05 SOL each), never delegated → after JOIN_ANYONE_SECS (5 min) the
//       sweeper cancels it: both refunded, accounts closed (rent to the creator).
//   M2: created + joined + delegated, permissions made, nobody sends a salt → after
//       ABORT_ANYONE_SLOTS (~5 min) the sweeper aborts it on the TEE: the settle action refunds
//       both; then the sweeper closes it (grace shortened to 0 for the test).
// Also: withdraw rules on a real burner, recoverMatches, settleNow on a settled match.
// The sweeper signs with a fresh key funded here (stand-in for the sponsor). Funds come from the
// Solana CLI wallet (~/.config/solana/id.json; loaded to sign, never printed) and are swept back.
//   pnpm --filter server exec tsx scripts/sweeper-e2e.ts
import {
  baseConnection,
  chain,
  createMatch,
  delegateMatch,
  joinMatch,
  planWithdraw,
  recoverMatches,
  settleNow,
  teeToken,
  waitForStatus,
  withdraw,
} from '@lil-dudes/client';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import fs from 'node:fs';
import os from 'node:os';
import { sweeper } from '../src/sweeper';

const S = 50_000_000;
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s]`, ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = baseConnection();
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, 'utf8')) as number[]));
const fund = (to: PublicKey, lamports: number) => chain.send(base, [SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports })], [funder]);
const bal = (k: PublicKey) => base.getBalance(k, 'confirmed');

async function main() {
  const start = await bal(funder.publicKey);
  const [a, b, sw] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  await fund(a.publicKey, 2 * S + 70_000_000);
  await fund(b.publicKey, 2 * S + 10_000_000);
  await fund(sw.publicKey, 20_000_000);
  const out: Record<string, unknown> = {};

  // --- withdraw rules on a real burner -------------------------------------------------------
  const w = Keypair.generate();
  await fund(w.publicKey, 3_000_000);
  const dust = await withdraw(base, w, funder.publicKey, 3_000_000 - 5_000 - 100).catch((e: Error) => e.message);
  const part = await withdraw(base, w, funder.publicKey, 1_000_000);
  const fresh = await withdraw(base, w, Keypair.generate().publicKey, 500_000).catch((e: Error) => e.message);
  const all = await withdraw(base, w, funder.publicKey);
  out.withdraw = { dustRefused: String(dust).includes('rent-exempt'), partial: part.amount, freshAddressRefused: String(fresh).includes('new address'), all: all.amount, left: await bal(w.publicKey) };
  log('withdraw', out.withdraw);

  // --- recoverMatches: the creator's own open room -----------------------------------------------
  const { id: r } = await createMatch(base, a, { stake: S, burner: a.publicKey, name: 'Room' });
  const rec = await recoverMatches(base, a);
  out.recover = rec.map((x) => ({ id: x.id.toString(), action: x.action }));
  log('recoverMatches', out.recover, 'room gone:', !(await base.getAccountInfo(chain.matchAccounts(r).game)));

  // --- M1 (never delegated) and M2 (delegated, no salts) ------------------------------------------
  const bA = Keypair.generate();
  const bB = Keypair.generate();
  const { id: m1 } = await createMatch(base, a, { stake: S, burner: bA.publicKey, name: 'M1 A' });
  await joinMatch(base, b, { id: m1, stake: S, burner: bB.publicKey, name: 'M1 B' });
  const { id: m2 } = await createMatch(base, a, { stake: S, burner: bA.publicKey, name: 'M2 A' });
  await joinMatch(base, b, { id: m2, stake: S, burner: bB.publicKey, name: 'M2 B' });
  await waitForStatus(base, m2, chain.Status.JOINED);
  await delegateMatch(base, a, m2);
  const tee = chain.teeConnection(await teeToken(bA));
  for (let i = 0; i < 120 && !(await tee.getAccountInfo(chain.matchAccounts(m2).game)); i++) await sleep(250);
  await chain.send(tee, [chain.ixs.initPermissions(chain.matchAccounts(m2), bA.publicKey)], [bA], { cu: 400_000 });
  const before = { a: await bal(a.publicKey), b: await bal(b.publicKey) };
  log('M1', m1.toString(), 'joined; M2', m2.toString(), 'READY on the TEE; both abandoned now. Sweeping every 30 s…');

  const sweep = sweeper({ signer: sw, timing: { closeAfterMs: 0 }, log: (...x) => log('[sweep]', ...x) });
  const gone = async (id: bigint) => !(await base.getAccountInfo(chain.matchAccounts(id).game, 'confirmed'));
  const timeline: Record<string, number> = {};
  while (Date.now() - t0 < 12 * 60_000) {
    const did = await sweep.runOnce();
    for (const d of did) {
      const k = d.split(':')[0]!;
      timeline[k] ??= Math.round((Date.now() - t0) / 1000);
    }
    if ((await gone(m1)) && (await gone(m2))) break;
    await sleep(30_000);
  }
  const after = { a: await bal(a.publicKey), b: await bal(b.publicKey) };
  out.sweeper = {
    m1Gone: await gone(m1),
    m2Gone: await gone(m2),
    timelineSec: timeline,
    // Both stakes of both matches back to each player (A also gets M1's + M2's rent back from close).
    bGot: after.b - before.b,
    aGot: after.a - before.a,
    stats: sweep.stats,
  };
  log('sweeper', out.sweeper);

  // --- settleNow on a match that no longer needs it ---------------------------------------------
  out.settleNowClosed = await settleNow(base, a, m2).catch((e: Error) => e.message.split('\n')[0]);
  log('settleNow after close', out.settleNowClosed);

  // Sweep everything back.
  for (const k of [a, b, sw]) {
    const left = await bal(k.publicKey);
    const plan = planWithdraw(left, 'all', 1);
    if (plan.ok) await withdraw(base, k, funder.publicKey).catch(() => undefined);
  }
  const end = await bal(funder.publicKey);
  log('SOL spent', (start - end) / LAMPORTS_PER_SOL);
  fs.mkdirSync('scripts/out', { recursive: true });
  fs.writeFileSync(`scripts/out/sweeper-e2e-${m2}.json`, JSON.stringify({ ...out, sol: (start - end) / LAMPORTS_PER_SOL }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  const ok = (out.sweeper as { m1Gone: boolean; m2Gone: boolean; bGot: number }).m1Gone && (out.sweeper as { m2Gone: boolean }).m2Gone && (out.sweeper as { bGot: number }).bGot === 2 * S;
  log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
