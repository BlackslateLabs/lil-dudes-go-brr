# Stage 0 results (M2 "Chain proven")

Run 2026-11-22 on Solana devnet + `devnet-tee.magicblock.app` (TEE validator
`MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`, magicblock-core 1.1.1). Spike program: Anchor 1.0.2 +
`ephemeral-rollups-sdk =0.18.0` (`anchor, vrf, access-control, crank`) + the real `crates/sim`; TS: web3.js
1.98.4, `@coral-xyz/anchor` 0.32.1, `@magicblock-labs/ephemeral-rollups-sdk` 0.18.0. Two deployments:
v1 `9oXqBpV3…ZC7G` and v2 `7BE2WwiC…7HGM` (v2 only fixes the VRF callback, see check 4). Both closed.
Raw numbers: `out/*.json` (the `*.raw.json` files are gitignored).

| # | Check | Result | Headline numbers |
|---|---|---|---|
| 1 | Private account with no members is unreadable; the program still reads it | ✅ PASS | Secret invisible to A, B, authority, fresh key, no token; program echo matched; Peek visible to its member only |
| 2 | Opponent can't see `plant_rig` data or logs | ✅ PASS (+2 rules) | every tx touching a private account is redacted for everyone (A included), failed ones too; 0 leaks in 2,500+ notifications. **Exception: failed VRF callbacks are fully visible** |
| 3 | 50 ms crank for 2+ min on the TEE | ✅ PASS | 3,000/3,000 and 2,600/2,600 calls, 0 missed, 0 failed; steady interval 40–60 ms (99.8% exactly 50 ms in v2); sim lag 0 ticks |
| 4 | ER VRF from the TEE calls back | ✅ PASS after a fix (❌ with the SDK default) | 10/10 callbacks, **2 slots (~20 ms) on-chain**, send→callback seen p50 206 ms. SDK 0.18.0 `#[vrf_callback]` burns ~250k CU → every callback failed until fixed |
| 5 | accountSubscribe over the TEE ws with a token, ~20 updates/s | ✅ PASS from Node · phone: page ready, not run yet | 20.0 updates/s (per-second min 18), inter-arrival p50 49.9 / p90 51.5 / p99 157 ms, no state ever skipped |
| 6 | commit + undelegate + Magic Action pays from the vault; fallback works | ✅ PASS | vault drained by the action (5.3 s after `finish` in the timed run); skipped action → permissionless `settle` by a third party; double settle refused |
| a | 0-SOL burner sends TEE txs | ✅ PASS | never-funded keys sent plant_rig, advance, write_peek, request_seed |
| b | CU of `advance` with the real sim | ⚠️ 40 ticks does NOT fit | worst tick 49–50k CU + 74k fixed (codec 68k); max 26 ticks at 1.4M, **6 at the crank's 400k**, 2 at 200k. Real crank calls: p50 45k, max 92k |
| c | TEE validator identity | ✅ | `MTEWGuqx…xzo` on both `devnet-tee` and `devnet-tee-as` (same validator) |
| d | SOL spent | 0.0764 SOL | 5.0000 → 4.9236 (both programs closed: +2.4179 and +2.2648 back) |

Setup (`init` → 5× `delegate` → visible on the TEE → permissions) takes 8.7–11.4 s end to end.

---

## 1. Private account, no members ✅

**Rerun:** `npx tsx scripts/setup.ts && npx tsx scripts/privacy.ts`
(out: `privacy-795288976.json`)

Setup: `Secret` gets an ephemeral permission `is_private: true, members: []`; `Peek` gets
`is_private: true, members: [A]` (flags TX_LOGS | TX_MESSAGE | TX_BALANCES | ACCOUNT_SIGNATURES);
`Board` gets **no permission at all**. A (0 SOL) plants a rig into Secret; `prove_read` copies
`secret.value ^ 0x5A…` into the public Board.

| reader (own token) | Secret | Peek | Board |
|---|---|---|---|
| A (the planter) | null | **visible** | visible |
| B (opponent) | null | null | visible |
| authority (deploy wallet, paid for everything) | null | null | visible |
| a fresh keypair | null | null | visible |
| no token | null | null | visible |

- Program read: B saw `secret_echo = 3384850978919226902`, exactly `value ^ 0x5A5A…` → the program reads the private account.
- B `getMultipleAccounts([Secret, Peek, Board])` → `[null, null, visible]`. B `getProgramAccounts` → only Board, CrankLog, Bench (Secret and Peek omitted).
- B `accountSubscribe(Secret)` / `(Peek)` → 0 notifications while A wrote to them.
- An account with **no permission is public** to everyone, even without a token.

**M3:** Match = no permission (public). Secrets = private, no members, until `finish` (then
`UpdateEphemeralPermission` → public, or just undelegate: base layer is public). Peek[side] = private,
member = that side's burner. Permissions don't need closing before undelegation (verified on every run).
Permission size `35 + 33·(1+N)` B (68 B for 0 members, 101 B for 1); ER rent `32 × (size + 60)` lamports
= 4,096 / 5,152 lamports, pre-funded into the PDA at create time (the PDA pays its own permission on the ER).

## 2. Opponent can't see `plant_rig` ✅ (with two rules)

**Rerun:** `npx tsx scripts/privacy.ts` (main), `scripts/privacy-control.ts` (positive controls),
`scripts/privacy-fail.ts` (failed txs), `scripts/privacy-vrf.ts` + `privacy-vrf2.ts` + `privacy-vrf3.ts` (VRF)

B had its own token and tried every path while A sent `plant_rig` (Secret only) and `plant_rig_board`
(Secret + public Board, like a real tx that runs `advance` first). Salts were tagged so any leak in hex,
base58 or base64 (of the salt or of the whole instruction data) would be found.

| tx touches | A (signer, fee payer) | B | no token |
|---|---|---|---|
| only public accounts (heartbeat `advance`) | full | full | full |
| a private account A is a member of (Peek) | **full** | redacted | redacted |
| a private account with no members (Secret) | redacted | redacted | redacted |
| Secret, and the tx **fails** (CU or constraint) | redacted (err code only) | redacted | redacted |
| Secret **read-only** (`request_seed`) | redacted | redacted | redacted |

"Redacted" = `getTransaction` returns the slot, blockhash and `err` only: 0 account keys, 0
instructions, 0 logs.
- `getSignaturesForAddress(Secret | Board | program | A)`: B only ever sees its own txs and
  public-only txs; A's plant txs are not listed to B at all (B can't even tell a plant happened, except
  from public state changes).
- Subscriptions: B `onLogs(program)` 1 notification (a public-only heartbeat), `onLogs(all)` 2,487
  (other programs' traffic; one mention of ours = that heartbeat), `programSubscribe` 5 (Board 4×,
  CrankLog 1×), `accountSubscribe(Secret/Peek)` 0. **Leak search: 0 hits.**
- `getBlock(slot)` and `getSignatureStatuses`: nothing beyond status.

**Exception (important): failed VRF callbacks are public.** The oracle's callback tx (top-level = VRF
program) that *fails* is readable by B in full, including the 168-byte VRF instruction data (it carries
the randomness) and all logs. The oracle retries a failed callback many times with **identical**
payloads. Successful callbacks are hidden from everyone: not listed via Board, the queue (172 queue txs
listed to B, none ours) or anything else.

**M3 rules:**
1. Every tx that carries secret input must list at least one private account (Secrets or Peek), even
   read-only. A tx touching only public accounts is fully public (fine for `set_aim`).
2. The seed callback must be infallible (fixed accounts, no state checks that can fail, small CU),
   and the match seed should be `H(vrf_randomness ‖ private salts)` so a leaked callback alone never
   reveals the deals (salts: each player's own, sent in a tx that touches Secrets; the bot's from a
   private house-entropy account).
3. Commit-reveal for rigs (TECH §8 fallback) is **not needed**.

## 3. Crank at 50 ms for 2+ minutes ✅

**Rerun:** `npx tsx scripts/crank.ts --iterations=3000 --listen=165` then
`npx tsx scripts/crank-cu.ts --id=<id> --program=<program id>` (out: `crank-795288976.json`,
`crank-795290806.json`, `crank-cu-795290806.json`)

`start` resets the Board to a fresh bot-vs-bot match (`crates/sim`, both sides driven by Warlord);
`schedule_crank` (legacy `ScheduleTask`, which is what validator 1.1.1 runs) calls
`advance(source = 1)`, which catches the sim up to `(slot − start_slot) / 5` (cap 40 steps) and logs the
slot delta since the previous call into CrankLog.

| | v1 run (3,000 × 50 ms) | v2 run (2,600 × 50 ms) |
|---|---|---|
| crank calls / expected | 3,000 / 3,000 | 2,600 / 2,600 |
| failed txs | 0 | 0 |
| slot delta histogram | 4: 111 · **5: 2,777** · 6: 111 · 57: 1 (first call) | 4: 3 · **5: 2,593** · 6: 3 |
| interval (10 ms slots) | p50 50, p99 60, max 570 (first), sd 9.9 ms | p50 50, p99 50, max 60, sd 0.48 ms |
| sim | KO at tick 2,025 (HP 0 : 136), lag **0 ticks** during play | KO at tick 1,217, lag 0 |
| max catch-up per call | 12 steps (first call only) | 11 (first call only) |

- ER slot time measured at 10.0 ms. The first crank call lands ~0.5 s after scheduling; then it is
  metronomic. The crank keeps running after the match ends until its iteration count is used up
  (so `finish` must cancel it, or schedule exactly the iterations needed).
- Real `advance` CU per crank call over a whole match: p50 44.7k, p90 80.8k, p99 82.4k, max 92.5k.
  **Crank txs get a 399,700 CU limit** (no SetComputeUnitLimit needed).

**M3:** keep the crank as the clock (one task per match, task id unique per match: on 1.1.1 task ids are
global). Client heartbeat fallback is not needed but `advance` stays permissionless and catch-up based.

## 4. ER VRF from the TEE ✅ after a fix

**Rerun:** `npx tsx scripts/vrf.ts --n=10` (out: `vrf-795290806.json`). Diagnosis trail:
`vrf-probe.ts`, `vrf-queue.ts`, `vrf-compare.ts`, `vrf-as.ts`, `vrf-as-debug.ts`.

| | v1 (SDK default `#[vrf_callback]`) | v2 (fixed) |
|---|---|---|
| callbacks | **0 / 14** (TEE, private or public Secret, burner or funded payer) and 0 / 3 on devnet-as | **10 / 10** |
| on-chain latency | – | callback 2 slots after the request (p50; max 7) ≈ 20 ms |
| client send → callback seen (ws) | – | p50 206 ms, max 362 ms (the request's HTTP confirm takes ~520 ms, so the callback usually arrives before it) |
| payer | – | A, a 0-SOL burner (ER queue is free) |

Root cause (found via devnet-as, where txs are public): the oracle *does* call back and our callback
fails with `consumed 270,433 of 270,433 compute units: exceeded CUs meter`. SDK 0.18.0's
`#[vrf_callback]` injects `#[account(address = …scoped_vrf_identity_const(&crate::ID).0)]` inline, so this
`const fn` (pure-Rust SHA-256 + ed25519 point decompression) runs **at runtime** (~250k CU); the oracle
gives the whole callback ~300k. MagicBlock's own roll-dice demo (legacy identity) works on both the TEE
and devnet-as (5/5 each, ~70–85 ms after confirm), which isolated it. The bug also added ~30 KB to the .so.

Fix (v2): declare the field yourself (the macro then skips its own) with a compile-time constant:

```rust
const VRF_IDENTITY: Pubkey = Pubkey::new_from_array(
    ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity_const(&crate::ID).0,
);
#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackSeed<'info> {
    #[account(address = VRF_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    // …
}
```

**M3:** one VRF request per match on the ER queue from the TEE (free), with this callback pattern and
the rules from check 2 (infallible callback; seed = H(vrf ‖ private salts)). Worth reporting the macro
bug to MagicBlock (not done).

## 5. accountSubscribe ~20 updates/s ✅ (Node) · phone pending

**Rerun (Node):** part of `scripts/crank.ts` (raw `WebSocket`, A's token, Board account, base64).
**Rerun (phone):** `ws-rate.html` (see below).

| | v1 processed | v1 confirmed | v2 processed |
|---|---|---|---|
| notifications / distinct crank states | 3,002 / 3,001 | 3,002 / 3,001 | 2,602 / 2,601 |
| updates per second (146 full seconds) | min 18, p50 20, max 21, mean 20.0 | same | min 18, p50 20, max 21 |
| inter-arrival ms | p50 49.9, p90 51.5, p99 157, max 554, sd 23.8 | p50 49.9, p90 51.6, p99 157 | p50 49.9, p90 52.6, p99 160 |
| gaps > 100 ms | 102 (3.4%) | 103 | 98 |

- **No state is ever skipped**: crank_calls increments by exactly 1 per notification. A > 100 ms gap
  is always followed by near-zero gaps (169 fast followers): delivery is bunched, not lost.
- Delivery delay relative to the on-chain slot clock: p50 10, p90 12, p99 118, max 577 ms.
- `processed` and `confirmed` behave the same on the ER.

**Phone:** `ws-rate.html` (one file). Serve it on the LAN and open it on the phone:

```bash
cd spikes/stage0 && python3 -m http.server 8000
# phone: http://<laptop-ip>:8000/ws-rate.html?account=<BOARD_PUBKEY>   (needs a crank running:
#   redeploy the spike (~2.3 SOL, refunded on close), `npx tsx scripts/setup.ts`, then
#   `npx tsx scripts/crank.ts --iterations=3600 --listen=185`)
# or, with no program at all: http://<laptop-ip>:8000/ws-rate.html?mode=slot   (slotSubscribe, ~92/s)
```

It signs a TEE token with an in-memory burner (tweetnacl from jsdelivr, no `crypto.subtle` needed on
plain-http LAN pages), subscribes over the raw WebSocket, and shows updates/s, inter-arrival
p50/p90/p99, max gap and jitter, plus a JSON result to paste back. Verified from Node: the auth
endpoints send `Access-Control-Allow-Origin: *` (incl. preflight for `Content-Type`), and
`slotSubscribe` delivers 92 notifications/s on the TEE. The spike program is closed, so account mode
needs a redeploy or the M3 Match account.

**M3:** render ~3 ticks (150 ms) behind the newest snapshot, not 1 tick, to absorb the p99 bunching;
the WASM prediction covers the gap. 20 Hz × 1.5 KB base64 ≈ 40 KB/s per client is fine.

## 6. Settlement: commit + undelegate + Magic Action, and the fallback ✅

**Rerun:** `npx tsx scripts/settle.ts --id=<id> --mode=action` and `--mode=fallback` (on a fresh
`setup.ts --kinds=board,secret,peek,log`) (out: `settle-action-795288976.json`,
`settle-action-795290806.json`, `settle-fallback-795290523.json`)

`finish(with_action)` on the TEE sets `finished = 1` and schedules `commit_and_undelegate([Board,
Secret, Peek, CrankLog])` with, optionally, a post-commit action `settle_action` (accounts: Board
read-only, Vault writable, recipient writable, System program; DLP appends `source_program`,
`escrow_auth`, `escrow`). The vault is a system-owned PDA on the base layer, never delegated.

| | action run 1 | action run 2 | fallback run |
|---|---|---|---|
| `finish` confirm on the TEE | (crashed script, resumed) | 637 ms | 631 ms |
| Board undelegated on base after finish | not timed (script crashed after the commit; state checked after) | 5.07 s | 0.77 s |
| vault drained after finish | yes (10,000,000 → 0) | 5.27 s | not by the action (skipped): 10,000,000 lamports left |
| who paid | the TEE validator (`MTEW…`) is the fee payer of the base tx | same | `settle` sent by a fresh third-party wallet |
| recipient gain | +10,000,000 | +10,000,000 | +10,000,000 |
| second settle | – | – | refused (AlreadySettled) |
| `settle_action` called directly without the escrow signature | – | – | cannot even be signed |

- The base tx that lands the commit + undelegate + action is a **v1 transaction** (new format):
  web3.js 1.x `getTransaction` throws; fetch it raw with `maxSupportedTransactionVersion: 1`.
- In the action, the Board may still be owned by the delegation program, so the handler reads it raw
  (discriminator + fixed offsets) and does not write it; the drained vault is the idempotency guard.
  `settle` (fallback) requires the Board to be undelegated (owner check) and marks `settled = 1`.
- `close_all` after undelegation reclaims 0.0527 SOL per run.

**M3/M5:** keep exactly this shape: `settle_action` (`#[action]`, escrow signer pinned to its
derivation) and `settle` (anyone, undelegated Board only) over one shared payout function; pay only
the players recorded in the committed Match. Consider `add_post_undelegate_actions` so the handler can
also write `settled` on the Match.

## Extra a: 0-SOL burner on the TEE ✅

Burners A and B (0 lamports on base, never funded) and a brand-new keypair sent `plant_rig`,
`plant_rig_board`, `write_peek`, `prove_read`, `advance` and `request_seed` as fee payers on the TEE.
Getting a token only needs a signature. **M3:** play needs no SOL on the burner; only base-layer steps
(create/join/stake/top-up) do.

## Extra b: compute budget of `advance` ⚠️

**Rerun:** `npx tsx scripts/bench.ts` (simulated on the TEE; out: `bench-795288976.json`)

Worst case: 40 live cohorts per side, every pair within reach in y (the clash loop visits all 1,600
pairs every tick) but in far-apart columns (nobody dies), cruising, past all gates, ~56 ticks from any
cannon. Program built with `opt-level = "z"`, `crates/sim` at `opt-level = 3`.

| | CU |
|---|---|
| decode 1,307 B state (codec in the program crate) | 35,440 |
| encode | 32,938 |
| Anchor + account load | 5,573 |
| **fixed overhead per tx** | **73,951** |
| one worst-case tick (no bot / both bots) | 49,166 / 50,182 |
| 40 worst-case ticks (projected) | ~2.05M → exceeds 1.4M (simulation fails at n = 40) |
| max ticks per tx at 1.4M / 400k (crank) / 200k (default) | **26 / 6 / 2** |
| real crank calls during a bot match (1 tick each) | p50 44.7k, max 92.5k |

**M3:** cap catch-up per `advance` to what the budget allows at worst case (≤ 6 per crank call, ≤ 2 in
a default-budget player tx, or have player txs request 1.4M CU), and cut the costs:
1. Move the codec into `crates/sim` (opt-level 3) or make the Match account a zero-copy mirror (68k →
   a few k).
2. Clash: bucket cohorts by column before pairing (O(n²) → O(n) for streams in different columns).
Normal play is far below worst case (peak 27 cohorts/side in the balance runner).

## Extra c: TEE validator identity ✅

`getIdentity` on `devnet-tee.magicblock.app` and `devnet-tee-as.magicblock.app` → both
`MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo`; `getVersion` → magicblock-core 1.1.1, solana-core 4.0.0
(so legacy `ScheduleTask` cranks, SDK 0.18.x). `getVersion`/`getIdentity`/`getSlot` need no token.

## Extra d: SOL spent

| item | lamports |
|---|---|
| start balance (deploy wallet `FdZL…rfbB`) | 5,000,000,000 |
| v1 deploy (475,784 B .so) | −2,421,196,174 |
| v1 close | +2,417,856,560 |
| v2 deploy (445,656 B .so) | −2,267,990,841 |
| v2 close | +2,264,806,320 |
| end balance | 4,923,621,481 |
| **total spent** | **76,378,519 (0.0764 SOL)** |

The rest went to tx fees, delegation/commit fees and ~0.002 SOL of rent left in MagicBlock's demo
program (its player PDAs have no close instruction). Every burner was swept back to 0.

## Other findings for M3

- **Anchor macro drift (fixed on main):** `anchor-lang =1.0.2` depends on its macro crates with `^1.0.2`,
  so `Cargo.lock` had `anchor-syn` / `anchor-derive-accounts` / `anchor-attribute-*` **1.2.2**, whose
  `init` codegen calls `system_program::create_account_allow_prefund` (only in anchor-lang 1.2.2):
  any `#[account(init)]` fails to compile. Fixed with `cargo update -p <crate> --precise 1.0.2` for all
  ten macro crates (main's lock too); Anchor 1.0.2's `#[program]` then needs
  `#![allow(clippy::diverging_sub_expression)]`.
- **Program size = SOL:** the spike .so was 592 KB at opt-level 3 → 476 KB with `opt-level = "z"`
  (sim kept at 3): 2.42 SOL rent. An upgrade needs a buffer of the full new size on top of the live
  program (≈ 2× rent at peak), so keep ≥ 5 SOL on the deploy wallet or deploy fresh + close the old.
- `sol_remaining_compute_units` is rejected by the devnet loader ("Unresolved symbol"); use
  `sol_log_compute_units` for measurements.
- Zero-copy accounts need `bytemuck` with `min_const_generics` for arrays like `[u8; 1312]`.
- The TEE endpoint `devnet-tee-as.magicblock.app` (status page) is the same validator as
  `devnet-tee.magicblock.app`.
