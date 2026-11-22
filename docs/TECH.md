# Lil Dudes Go Brr: Technical Design

Status: **BUILT through M5 (back end)**: live 1v1 on devnet + the TEE, hidden info re-checked, money edges, faucet, online bot, sweeper. Updated 2026-11-22. Game rules: [SPEC.md](SPEC.md).
Facts marked ✅ were checked against MagicBlock docs, MagicBlock's example repo, or live devnet on
2026-11-21/22; ⚠️ = unverified; ❌ = disproved. **Stage 0 (M2) ran on 2026-11-22: every check passed
or has a proven workaround. Numbers and rerun commands: [spikes/stage0/RESULTS.md](../spikes/stage0/RESULTS.md).**
**M3 (2026-11-22): the real `lil_dudes` program is on devnet (`4QFSXrcG…9FDa`) and three headless bot-vs-bot
matches ran end to end through `LiveSource` (KO, KO, timer win), each paid out exactly by the Magic Action.
Final accounts, instructions and compute: §4; client: §5; results: `packages/client/scripts/out/`.**
**M4–M5 (2026-11-22): privacy re-check of the real program PASS (§4 Privacy); `reveal()` carries the whole
result screen (§5); anyone-after-timeout refunds (program upgraded); server faucet, online bot, sweeper,
hardening and a deploy plan (§9). Web wiring is Suparno's (PROGRESS_LOG handoff).**
**v3 (PROPOSED 2026-11-22): the rules change to a 1v1 race against the same base (SPEC v3). The chain
plumbing below carries over unchanged; the rules engine, Match/Secrets layout, codec, payout and bot
change (§4 notes the v3 sizes once `crates/sim` v3 lands). Client changes: §5.**

## 1. Decisions

| Area | Choice | Why |
|---|---|---|
| Platform | **Web app (PWA)**, phone-first, works on desktop | Judges click a link. No install, no app store. |
| Game client | **TypeScript + Vite + React 19**, arena in **Three.js via @react-three/fiber + drei** | Wallet and MagicBlock SDKs are JS. Crowds = `InstancedMesh` (hundreds of units, cheap). AI agents are strongest here. Low-poly glTF assets drop in. |
| Not Godot | — | Godot 4 web export is GDScript-only (no C#), every chain call goes through a JS bridge, the download is big, and it is weak on iOS Safari. |
| Not Unity | — | MagicBlock has a Unity SDK, but WebGL builds are heavy, iteration is slow, and agents are weaker. |
| Program | **Anchor 1.0.2**, one program `lil_dudes`, `ephemeral-rollups-sdk = 0.18.x` features `anchor, vrf, access-control, crank` | Matches MagicBlock's current examples; 0.20 is the validator-2.0 line (`#[vrf]` broken there). ✅ Built and run on the TEE in Stage 0. `Cargo.lock` pins Anchor's macro crates to 1.0.2 (see §6). |
| Shared sim | **`crates/sim`**: pure Rust, integer-only, deterministic, no Solana deps | Same code runs in the program, native tests, the balance runner, and later WASM (Verify replay). |
| Chain client (TS) | **@solana/web3.js 1.x + @coral-xyz/anchor 0.32.1 + @magicblock-labs/ephemeral-rollups-sdk 0.18.0** + wallet-adapter | ✅ The exact stack of MagicBlock's Rock-Paper-Scissors app (PER + burner + bot + stakes), and it works against Anchor 1.0.2 programs. `@solana/kit` 8 + `ephemeral-rollups-kit` 0.18.0 is the later migration, not now. |
| Rollup | **Private Ephemeral Rollup (TEE)**, `devnet-tee.magicblock.app` | Hidden `?` values, rigs and peeks need private accounts. ✅ TEE ER, VRF oracle and pricing oracle report live; ✅ slots measured at 10.0 ms; ✅ private accounts and tx data are hidden from the opponent (Stage 0 checks 1–2). |
| Player keys | **Per-device burner keypair** (localStorage) as the playing identity; Phantom only to top up / withdraw | ✅ RPS example pattern: no wallet popups ever during play; TEE auth token signed by the burner. ✅ A burner with 0 SOL can pay for its own TEE txs (Stage 0 extra a); only base-layer steps need SOL. |
| Stakes | **Devnet SOL** in a per-match vault PDA on the base layer | ✅ Proven in the RPS example. SPL test-USDC is a stretch goal. |
| Server | **`apps/server`: Hono on Node** | Faucet/top-up of burners from a sponsor wallet (faucets are rate-limited), quick-match queue, health. Not in the trust path for game outcomes. |
| Tests | **MagicSVM 0.3.0** Rust tests (`cargo +stable test`), plus native `crates/sim` unit tests | ✅ Same as the examples. MagicSVM does not prove live routing, TEE privacy or real VRF. Devnet does. |
| Monorepo | **pnpm workspaces + a Cargo workspace** in one git repo | One place for both of us. |
| Hosting | Web on Vercel; server on Vercel/Render; programs on devnet | Free tiers. |

## 2. Architecture

```
 Phone / browser (apps/web)                        Solana devnet (base layer)
 ┌──────────────────────────────┐   create/join    ┌───────────────────────────────┐
 │ React UI + R3F arena         │ ───────────────► │ game program                  │
 │  - burner keypair            │   delegate       │  Config, Vault PDA (stakes)   │
 │  - TEE auth token            │                  │  Match/Secrets/Peek (owned by │
 │  - interpolates cohorts      │ ◄── settle ───── │   delegation program in play) │
 └──────┬──────────────▲────────┘   (Magic Action) └──────────────┬────────────────┘
        │ set_aim/rig/ │ accountSubscribe(Match) ~20/s            │ delegate / commit
        │ peek (gasless)│                                        ▼
        ▼              │                    ┌──────────────────────────────────────┐
 ┌─────────────────────┴────────────────────┤ MagicBlock Private ER (TEE, devnet)  │
 │ Match (public)   Secrets (private)       │  crank → advance() every 50 ms       │
 │ Peek[A], Peek[B] (private, owner only)   │  VRF (ER queue, free, <50 ms)        │
 └──────────────────────────────────────────┴──────────────────────────────────────┘
 apps/server: faucet/top-up for burners, quick-match queue (no game authority)
```

## 3. Repo layout

```
lil-dudes-go-brr/
├─ (private per-person notes file, gitignored)
├─ PROGRESS_LOG.md              append-only shared log (git union-merge)
├─ docs/  IDEA.md  SPEC.md  TECH.md  MVP.md
├─ Anchor.toml  Cargo.toml      Cargo workspace: programs/*, crates/*
├─ programs/lil_dudes/          Anchor program (Kai)
├─ crates/sim/                  deterministic match sim (Kai; Suparno reads)
├─ crates/sim-wasm/             wasm-bindgen wrapper around crates/sim (Kai)
├─ tests-magicsvm/              MagicSVM integration tests (own [workspace], like the examples)
├─ packages/sim-wasm/           PREBUILT wasm-pack output, committed (no Rust needed to use it)
├─ packages/client/             TS: MatchView types, MatchSource (mock/offline/live), tx builders (Kai)
├─ apps/web/                    game client (Suparno)
│  └─ public/assets/CREDITS.md  every asset + source + licence
├─ apps/server/                 Hono faucet + matchmaking (Kai)
├─ tools/balance/               balance sims (python now, Rust runner later)
└─ spikes/                      throwaway Stage 0 experiments (not shipped)
```

**The contract between back end and front end is `packages/client`**: the `MatchView` TS type
(decoded Match account), the event list, constants (lane geometry, timings), and one interface,
`MatchSource`, with three implementations behind it:

| Source | What it is | When it exists |
|---|---|---|
| `MockSource` | hand-written TS fake: scripted cohorts, gates, reveals, events at 20 Hz | day 1 of the scaffold |
| `OfflineSource` | the real rules (`packages/sim-wasm`) + local bot, no chain | end of M1 |
| `LiveSource` | the chain feed (TEE websocket), played out ~3 ticks behind, events from state diffs (no prediction needed: p99 gap 51–53 ms); `reveal()` / `awaitReveal()` for the result screen, `settleNow()` | ✅ M3, M4–M5 |

The web app only talks to `MatchSource` (`subscribe(view => …)`, `setAim(x)`, `rig(cell)`,
`peek(cell)`), so moving from mock → offline → live is a one-line change, with no rendering rewrite.
**The WASM build is committed prebuilt**, so front-end work needs only Node + pnpm, never Rust. Kai
rebuilds it whenever the sim changes. Any change to `MatchView`, `MatchSource` or the constants needs a
PROGRESS_LOG entry tagged `CONTRACT`.

## 4. On-chain model

### Accounts

| Account | Layer | Visibility | Size (rules v4) | Holds |
|---|---|---|---|---|
| `Match` `["match", id]` | delegated → TEE | **public** (no permission) | 1,792 B (8 + 310 header + 1,474 state) | id, stake S, both picks, create/join times, ready/seed-request/start slots, players (stake wallets), burners (TEE signers), treasury, names, status, flags, bumps, last GOTCHA per copy (`[tick u16, gate slot, rigged by]` at data offset 288), seed + rig/peek history (16 B at data offset 296, published at `finish`), 6 B pad, and the sim's **public state** (codec, data offset 318) |
| `Secrets` `["secrets", id]` | delegated → TEE | **private, no members** | 152 B | raw VRF output, both players' salts, the sim's **secret state** (codec, data offset 112: seed, every stage's true gate values, the per-stage rig/peek history) |
| `Peek[s]` `["peek", id, s]` | delegated → TEE | **private, member = burner s** | 56 B | that player's view of their current stage (= the sim's `PrivateView`), data offsets 49–55: `stage` (255 = never written), `rig_stage`, `rig_slot` (the victim's stage and gate slot, 255 = none; rules v4: `rig_stage` always equals `stage`), `peek_stage` (255 = none), `peek_slot`, `peek_op` (`GateOp::to_byte`), pad. Stale when `stage` is behind the side's public stage |
| `Vault` `["vault", id]` | base, never delegated | public | 0 data (SOL) | both stakes (2S) until settled |

No `Config` account (M3): the treasury is a constant (the deploy wallet) and `delegate_match` only
accepts the TEE validator; the test build (`--features magicsvm`) lifts both for MagicSVM.
Codec (`crates/sim/src/codec.rs`, TS decoder `packages/client/src/codec.ts`): fixed offsets, little
endian, only live cohorts copied; rules v4 (codec 3): public part 1,474 B (a side is 720 B, with
the raid timer `raid_ticks` u16 at side offset 718), secret part 40 B (seed, 2 stages × 8 values,
then the 16-byte history last: 2 stages × 2 sides × [rig stage, rig slot, peek slot, peek op], so
`finish` copies the seed and the history as-is).

All far under the 10,240 B commit limit ✅. Commit **once** at the end (commit + undelegate), so the
10-commit nonce limit and the per-commit fees don't matter ✅.

(Stage 0 packed the v2 state into 1,307 B with a spike codec; M3's codec was 1,131 B and ~12× cheaper.)

**Permissions (✅ Stage 0 check 1).** Ephemeral permissions only: created on the ER by the delegated
PDA itself (`CreateEphemeralPermissionCpi`, PDA-signed, PDA pays), nothing to create or delegate on the
base layer. `Match`: **no permission** (an account without one is public, even without a token).
`Secrets`: `is_private: true, members: []` → unreadable by everyone (both players, the authority,
token-less clients; `getAccountInfo`, `getMultipleAccounts`, `getProgramAccounts`, `accountSubscribe`,
`programSubscribe` all omit it) while the program reads it. `Peek[side]`: `is_private: true,
members: [that burner]` (flags TX_LOGS | TX_MESSAGE | TX_BALANCES | ACCOUNT_SIGNATURES) → only that player.
Size `35 + 33·(1+N)` B, ER rent `32 × (size + 60)` lamports (4,096 for 0 members, 5,152 for 1):
pre-fund it into the PDA at `create_match`. No need to close them before undelegation.
M3: `init_permissions` creates all three in one tx, members taken from the Match (never from the
caller); no salt can be written before it ran (status gate), because an account without a
permission is public.

### Instructions (M3; semantics updated for rules v3, IDL instructions unchanged)

- **Base:** `create_match(id, pick, burner, name)` (A: escrows the pick, pays all rent + permission
  rent), `join_match(id, pick, burner, name)` (B: S = lower pick, A's excess refunded),
  `delegate_match(id)` (Match + Secrets + Peek×2 → the TEE in one tx, commit frequency `u32::MAX`),
  `cancel_match(id)` (creator while open, **anyone after 20 min**; either player 60 s after an
  undelegated join, **anyone after 5 min**; refunds always go to the recorded players),
  `settle_action(id)` (`#[action]`, the Magic Action scheduled by `finish`), `settle(id)`
  (permissionless fallback, once the Match is back on base), `close_match(id)` (anyone after
  settlement; rent → creator).
- **TEE:** `init_permissions`, `request_seed(salt)` (each player's private salt; the second one
  requests the ER VRF; retry allowed after 300 slots), `callback_seed(randomness)` (`const`
  VRF identity, infallible, seed = sha256(vrf ‖ salt0 ‖ salt1)[..8], writes the start state: the
  seed's layout, both players in the Plant of Fight 1, every stage's values in Secrets),
  `start` (tick 0 = now, schedules the crank; any player), `advance` (anyone; catch-up ≤ 8),
  `set_aim(x)` (public, writes the aim byte-wise, ~3.3k CU), `plant_rig(cell)` / `peek_cell(cell)`
  (`cell` is a **gate slot** 0..8 of the stage; catch up ≤ 2, apply with the sim's
  rules, write Secrets + my Peek from the sim's private view; refused = error, nothing spent.
  Rig (rules v4, `lil_dudes_sim::can_rig`; the program has no phase check of its own): in any
  phase while I am alive and not done, once per stage of mine, a slot of MY current stage, applied
  to the opponent's copy of that stage; refused if they are dead or done, already past that stage,
  on it with that gate revealed, the slot is missing, or that stage already holds a rig. A rig on a
  stage they have not reached yet springs when they get there. Peek: only in my own Fight/Raid,
  once per stage, an unrevealed gate of my current stage), `finish` (anyone with a result,
  or an abort of a match that never started: a player at once before the permissions / ~60 s
  after, **anyone ~5 min (30,000 slots) after READY**: publishes seed + history in the Match,
  refreshes both Peeks to each side's final stage, commit + undelegate all four, post-commit
  action `settle_action`). `advance` (the crank) does not touch the Peeks, so a Peek changes only
  on its owner's own rig/peek and at `finish`.
- ⚠️ Rules v3 port not yet built or run (no SBF toolchain where it was written): `anchor build`,
  redeploy and the MagicSVM suite are pending (Kai). The same holds for the rules v4 port (two
  stages, the raid in place, any-phase rig; Match still 1,792 B, state at data offset 318; Secrets
  152 B): host `cargo test -p lil_dudes` passes and `tests-magicsvm` type-checks; the SBF build,
  the IDL regeneration and the MagicSVM run are pending.
- Tested in MagicSVM (17 tests, `tests-magicsvm/`, every instruction + refused cases, the M5
  anyone-after-timeout refunds) and on devnet (live matches, the privacy re-check, the sweeper e2e).

### Time and the tick

- ✅ Live ER slots are ~10 ms. **1 tick = 5 slots = 50 ms (20 Hz).**
  `target_tick = (Clock.slot − start_slot) / 5`.
- `advance()` is **idempotent catch-up**: it steps from `last_tick` to `target_tick` (capped per tx,
  see the compute budget below) and returns OK if already current. **Every** player instruction calls it first.
- The crank calls `advance` every 50 ms. Rules v3 and v4: **5,400 runs** (1.5 × 3,600; M3 had 3,600 = 1.5 × 2,400: the interval is wall time
  but ticks follow slots, so this covers slots up to 15 ms), not cancelled (the legacy
  `CancelTask` needs an undocumented task-context account); `advance` is a no-op after the end. ✅ The docs
  say cranks don't guarantee exact timing, so correctness never depends on the crank firing on time.
  ✅ **Stage 0 check 3:** a 50 ms crank (legacy `ScheduleTask`, which the TEE's validator 1.1.1 runs) on the
  TEE drove a real bot-vs-bot match: 3,000/3,000 and 2,600/2,600 calls, 0 missed, 0 failed; after the
  first call (~0.5 s after scheduling) every interval was 4–6 slots (40–60 ms; 99.8% exactly 50 ms in the
  second run); the sim never lagged the slot clock. Heartbeats are not needed. Task ids are global on
  1.1.1: derive one per match. The crank keeps firing after the match ends until its iterations run out.
- ✅ **Stage 0 check 5 (Node):** `accountSubscribe` over the TEE websocket with a token delivers
  20.0 updates/s (per-second min 18), inter-arrival p50 49.9 / p90 51.5 / p99 157 ms, and never skips a
  state (late updates arrive bunched). Render ~3 ticks (150 ms) behind the newest snapshot. ⚠️ Phone
  not measured yet: `spikes/stage0/ws-rate.html`.

### Compute budget (✅ measured: Stage 0 on the TEE, M3 in MagicSVM)

| | M2 spike | **M3** |
|---|---|---|
| decode + encode the state | 68,388 CU | **5,870 CU** (codec in `crates/sim` at opt-level 3, live cohorts only, `MatchState::zeroed`) |
| one tick, M2's worst case (40v40 crossed, far apart) | 50,493 | **13,483** (clash: flat copy + x-bucket pre-check, same pairs, same order) |
| one tick, new worst case (40v40 crossed, dx 700, in the bucket window) | 50,493 | **38,443** (physically unreachable: ≤ ~27 live per side) |
| one tick, Surge peak of a real bot match | 5,715 | 6,022 |
| real `advance`, 8-tick catch-up (Anchor included) | – | 15,410 |
| real crank calls over a match (p50 / max) | 44,700 / 92,500 | 3,161 / 15,704 (MagicSVM, 4 of 5 calls are no-ops there) |
| `set_aim` | – | 3,319 |
| ticks per 400k crank tx at the worst case | 6 | **10** (cap set to 8) |

Caps: **8 ticks per `advance` (crank), 2 in player txs** (`plant_rig`, `peek_cell`). Rerun:
`tests-magicsvm/tests/bench.rs` (program feature `bench`) and `tests/tee.rs`.

⚠️ **Rules v3/v4: needs a re-bench.** The numbers above are the v2.1 state. v3 adds enemy cohorts
(16 per lane), towers, crates, homing and a 1,470 B codec (v4: 1,474 B, the raid in place); `bench.rs` now measures full lanes
(40 cohorts + 16 enemies per side) and a bot match's busiest tick, but nobody has run it yet, so
the 8 / 2 caps are unconfirmed for v3. `finish` now also decodes the state once to refresh the
Peeks (~6k CU at v2.1 codec cost).

### Randomness

One VRF seed per match (✅ ER VRF is free and <50 ms) arrives in `callback_seed` → stored in
`Secrets` (M3: seed = sha256(vrf ‖ salt0 ‖ salt1)[..8], each salt sent privately by its player). Rules v3: layout = seed % 6, each stage's gate values from `deal_rng(seed, stage)` (`Deal::new`). The
seed is public only after the match, for Verify.

✅ **Stage 0 check 4:** requested from the TEE on `DEFAULT_EPHEMERAL_QUEUE` (by a 0-SOL burner), the
callback lands **2 slots (~20 ms) after the request** (10/10; client sees it ~200 ms after sending).
Two rules learned the hard way:
- ❌ SDK 0.18.0's `#[vrf_callback]` evaluates `scoped_vrf_identity_const(&crate::ID)` at **runtime**
  (software SHA-256 + ed25519, ~250k CU) → every callback ran out of the oracle's ~300k CU budget and
  the oracle retried it forever. Fix: declare `#[account(address = VRF_IDENTITY)] pub
  vrf_program_identity: Signer<'info>` with `const VRF_IDENTITY: Pubkey = Pubkey::new_from_array(
  scoped_vrf_identity_const(&crate::ID).0);` (the macro then skips its own check).
- ✅ (hazard) A **failed** callback tx is publicly readable (VRF instruction data included) and retries resend
  the same payload. So the callback must never fail, and the seed is `H(vrf_randomness ‖ salts)` with
  salts nobody else sees: each player's own (sent in a tx that touches `Secrets`), the bot's from a
  private house-entropy account.

### Privacy: what must never leak

- Unrevealed gate values and the seed, not just rigs. If they were in `Match`, a modified client
  would read every `?`.
- **No `msg!` of secrets** (logs are visible to log-permitted members).
- ✅ **Stage 0 check 2:** the opponent cannot read my `plant_rig`/`peek` instruction data or logs.
  A tx that touches any private account (even read-only, even if it fails) is redacted for everyone
  who is not a member: `getTransaction` returns slot + blockhash + err only; it is left out of
  `getSignaturesForAddress`, `onLogs`, `programSubscribe` and `getBlock`; 0 leaks found. A member of
  the private account (`Peek` → its player) sees the full tx; a tx touching only public accounts is
  public. Rule: **every tx carrying secret input lists `Secrets` or `Peek`**. Commit-reveal is not needed.
  Exception: the VRF oracle's failed callbacks (see Randomness).
- ✅ **M4 re-check on the REAL program (devnet + TEE, 2026-11-22): PASS, 2 runs, 0 fails.**
  `packages/client/scripts/privacy-check.ts` (out: `scripts/out/privacy-*.json`): a free live match,
  bots on both sides through `LiveSource`, A's salt tagged and sent by hand, both sides rig and peek
  every phase. While it ran, the opponent B (own token), a stranger C (third token) and a token-less
  client tried every path on A's secrets, mid-match and again in phase 3:

  | Probe (B, C, no token) | Result (run 1: 3 phases · run 2: KO in phase 2) |
  |---|---|
  | `getAccountInfo` / `getMultipleAccounts` of Secrets and A's Peek | `null` every time; each Peek visible to its own burner only (control ✅) |
  | `getProgramAccounts` (by size 1,376 / 200 / 56 B) | Match only; Secrets never; a Peek only to its owner |
  | `accountSubscribe(Secrets / A's Peek)` | **0** notifications (B's own Peek: 7 / 6 ✅; Match: ~20/s ✅) |
  | `programSubscribe` | Match updates only (2,465 / 1,362), never Secrets or a foreign Peek |
  | `logsSubscribe` (program / Secrets / each Peek) | 34 / 26 notifications on the program (public `set_aim`/`advance`), **0** on Secrets and the Peeks |
  | `getTransaction` of A's `request_seed`, `plant_rig` ×3, `peek_cell` ×3, `start`, and B's | **redacted** (slot + err only) for everyone, **even the sender**: these txs also touch Secrets, which has no members. A's public `set_aim`: full for all (control ✅) |
  | `getSignaturesForAddress` (Secrets, A's Peek, Match, program, A's burner) | 0 of A's secret txs listed; every tx a prober could read in full was checked: none touched Secrets or a foreign Peek |
  | leak search (~25–44k decoded strings per prober, base64/base58 → hex) | **0 hits** for A's salt, the `request_seed` data, every rig/peek ix data, A's Peek bytes, and (read from base after the match) the VRF output, B's salt and the secret state |
  | public Match snapshots (2,460 / 1,359) | seed = 0 and history empty until FINISHED; **no hint shown during a plant window** (191 / 127 snapshots), so a rig's timing never gives its cell away (`plant_rig` publicly flips only `rig_used`); unrevealed gates encode as `(0, 0)` |
  | base layer during play | delegated Secrets still holds its creation bytes (VRF, salts, state all zero): nothing is committed before `finish` |

  SOL: ~0.012 per run (fees; rent refunded by `close_match`). After `finish` everything is public on
  base by design (Verify needs the seed); probes after that are not counted.

### Settlement

`finish` on the ER → `MagicIntentBundleBuilder.commit_and_undelegate(Match, Secrets, Peek×2)` +
post-commit action `settle_action` on base → pays winner/loser/treasury from the Vault per SPEC §8
(`moved`/`fee` from `crates/sim` `payout`, stored in the final public state; rules v3: a death
moves S, so the survivor gets 2S − fee; both alive splits the pot by gold; a draw or abort
refunds S each). **M5:** the result
screen's "Settle now" is `LiveSource.settleNow(server?)` (permissionless `settle`, fee paid by the
burner or by the server's sponsor via `POST /settle`), and the server's sweeper settles anything
still unpaid 30 s after it is back on base (§9). If the action fails,
anyone calls `settle` directly. ✅ **M3 on devnet:** the finisher is a 0-SOL burner (it is the
action's escrow authority) and the action paid out exactly in all three runs, ~0.4 s after `finish`
was confirmed (KO 0.05 and 0.1 SOL, timer win 0.05 SOL with lead 649‰ → moved 82.45% of S).

✅ **Stage 0 check 6:** one base-layer tx (fee paid by the TEE validator) commits, undelegates and runs
the action; the vault PDA (system-owned, never delegated) was drained to the recipient 5.3 s after
`finish` (undelegation alone: 0.8–5.1 s). With the action skipped, a third-party wallet's `settle`
paid out; a second `settle` is refused. Shape that worked: `settle_action` (`#[action]`, accounts
Match read-only + Vault + recipients + System; declare `source_program`, `escrow_auth`, `escrow`
last, `escrow` = signer pinned to `ephemeral_balance_pda_from_payer(escrow_auth, 255)`) and `settle`
(anyone, Match must be undelegated) over one shared payout function. In the action the Match can
still be owned by the delegation program: read it raw, don't write it (the drained vault is the
idempotency guard), or use `add_post_undelegate_actions`. The base tx is a **v1 transaction**: web3.js
1.x can't decode it (fetch raw with `maxSupportedTransactionVersion: 1`).

## 5. Client

- **Screens:** a first visit goes straight into the guided tutorial match vs the bot (SPEC §9), with
  **Skip tutorial** always visible. Home = one big **Play vs Bot** button, plus Quick Match, Room Code,
  Top up and How to play. → Match → Result (payout count-up, full reveal, Verify, explorer links,
  "under the hood" tx log like the RPS app). Rematch and Verify appear ~1.5–2 s after the result lands.
  Screen changes use one short branded wipe (≤ 1.5 s).
- **HUD (portrait, v3):** the top ≤ 8% holds you (left: name, gold, stage pips), the opponent (right:
  name, gold, stage pips or DEAD/DONE) and the timer + stake (centre). HP labels sit on the **towers**
  in world space (`1.2K` style, ticking smoothly); crate counters on crates. Your cannon sits at
  ~75–80% of screen height; the bottom ~20% is empty drag area. Prompts appear just above your cannon.
  No per-hit numbers anywhere.
- **Opponent mini-view (v3):** a small live map of the opponent's lane in a corner (2D canvas, not a
  second WebGL scene): their stage, gates (`?`/revealed), crowd and waves as dots, towers with HP, gold.
  During your plant it enlarges and its gates are tap targets for the rig.
- **Render loop (M3, `LiveSource`):** raw-websocket `accountSubscribe` on Match + my Peek with the
  burner's TEE token; snapshots are played out at 20 Hz ~3 ticks behind the newest (measured on
  devnet: render gaps p50 50 / p99 51–53 ms, max 101 ms in a 2,049-tick match); events are derived
  from state diffs (tested against the sim's own events tick by tick); the TEE setup and `finish`
  are auto-driven by both players' sources (idempotent on-chain). Original plan:
  subscribe to `Match` over the TEE websocket. The client also runs **the same
  `crates/sim` compiled to WASM**: between 20 Hz chain snapshots it steps the sim locally (cohort motion
  is deterministic), and each snapshot corrects it. Only hidden gate values and the opponent's aim are
  unknown locally, and the snapshot that reveals them arrives within ~1 tick. Render ~3 ticks (150 ms)
  behind so corrections are invisible (✅ Stage 0: the TEE feed's p99 gap is ~157 ms, bunched, never lossy). The own cannon moves instantly on drag; `set_aim` is throttled to ~10 tx/s.
- **Offline mode:** the same WASM sim + a local bot runs the whole game with no chain. It is the dev
  mock for the front end, and the fallback demo if devnet is down.
- **Crowds:** one `InstancedMesh` per side, one instance per visible unit (cap ~1,500 per side on a
  phone; above that, cull instances **at random**, not from the back, so the crowd shape doesn't pop).
  Units are visual particles that follow their cohort with simple flocking (separation + follow); the
  walk cycle is a vertex-shader bob, not skeletal animation. Volleys ease out of the muzzle (fast for
  ~0.3 s, then cruise). When a cohort's count jumps at a gate, new instances **pour** out behind the
  gate over 0.05–0.25 s (~40/s) with a brighter tint that fades in ~0.15 s. In the clash, units die
  along the contact front over ~0.2–0.5 s with star particles, so the crowds visibly grind.
  Counts: one number per clash front + per-side totals in the HUD (no badge per cohort).
- **Look:** portrait, **static** perspective camera showing the whole lane from your cannon to the base
  (pitch ~44°, FOV ~30°, a telephoto look that packs crowds into a mass). It moves only for the stage
  transit (drive up) and the end (push-in). Your dudes blue, the base's troops red. Low-poly + toon/flat shading, one palette texture, blob shadows
  (no shadow maps), fake glow sprites instead of bloom, bold outlined numbers (SDF text, OFL font).
  Gate text is colour-coded by side and by hint.
- **Feel:**
  - **Drag:** relative, with a catch-up buffer. The cannon chases the finger at a capped speed, with
    a bump at the lane edges.
  - **Gate reveal:** the panel flips, the label punches (~1.4×, ~0.1 s), a white star flashes, the
    crowd pours out, and the colour flips to blue/red/gold.
  - **Danger and hits:** danger stripes on your cannon line when an enemy cohort is ≤ ~1.5 s away.
    A cannon hit flashes and throws sparks; shake is rate-limited (≤ 1 per 0.5 s).
  - **KO:** explosion, payout fountain flying to the winner's balance, count-up.
  - **Also:** GOTCHA overlay, haptics (`navigator.vibrate`, Android).
  - **Sound:** one distinct cue per event (shot pop, reveal tick, clash crackle, cannon hit, KO
    burst, payout chirps, GOTCHA sting). Events sit ~8–10 dB over the music; the music ducks on results.
- **Performance:** 60 fps in the arena, with the render loop capped or idle on menus and results.
  Budget < 100 draw calls on a mid-range Android. Quality tiers: drop to 30 fps,
  `setPixelRatio(0.75)` and no shadows when frame time stays high. Test with the peak scene (Surge +
  max crowds + KO), not an average one. Pre-allocate instance buffers and particle pools at match
  start, so nothing is allocated in the frame loop.
- **State:** zustand. **PWA:** vite-plugin-pwa.
- **Assets:** CC0 or properly licensed only (e.g. Kenney, Quaternius), logged in `CREDITS.md`.
  **Nothing copied from any existing game** (art, audio, code, names, characters).

## 6. Endpoints and versions

- Base RPC `https://rpc.magicblock.app/devnet` · TEE `https://devnet-tee.magicblock.app` (+ `?token=`)
  · TEE validator identity `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (✅ re-checked 2026-11-22 with
  `getIdentity`; `devnet-tee-as.magicblock.app` from the status page is the same validator;
  magicblock-core 1.1.1) · status `https://status.magicblock.app/api/services`.
- ✅ TEE auth: `GET /auth/challenge?pubkey=` → sign the challenge → `POST /auth/login` → token; CORS is
  `*`, so a browser on any origin can do it. `getVersion`/`getIdentity`/`getSlot` need no token.
- Toolchain: Agave 3.1.10, Anchor 1.0.2 (avm), rustup stable (host), Node ≥ 22.12, pnpm 10.34 (pinned in `packageManager`). Front-end work needs only Node + pnpm.
  SBF builds outside `anchor build` need `cargo build-sbf --tools-version v1.52` (v1.51's cargo
  can't parse an edition-2024 dependency).
- ✅ **Deployed (M3, upgraded M5 2026-11-22):** `lil_dudes` = `4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa`
  on devnet, upgrade authority = the deploy wallet. M5 build 457,760 B (sha256 `6508568be59c55c6…`,
  `anchor build --ignore-keys`), slot 524,984,012, sig `4hovzsFw…cPYL`; the program account was
  first extended by 10,240 B (the loader extends by ≥ 10 KB, and the new .so was 88 B bigger):
  467,912 B, 2.3779 SOL rent. IDL unchanged.
- Client deps (M3): `@solana/web3.js` 1.98.4, `buffer`, `tweetnacl`, `bs58` only. The TEE auth
  (challenge → sign → login) and every instruction (from the committed IDL
  `packages/client/src/idl/lil_dudes.json`) are built in `packages/client/src/live/chain.ts`; no Anchor
  TS or MagicBlock TS SDK in the bundle.
- Rust: `anchor-lang = "1.0.2"`, `ephemeral-rollups-sdk = "0.18"` (never unpinned), `magicsvm = "0.3.0"` (dev).
  ✅ `anchor-lang =1.0.2` pulls its macro crates with `^1.0.2`, which resolved to 1.2.2 and breaks
  `#[account(init)]` (its codegen calls a 1.2.2-only function). `Cargo.lock` now pins `anchor-syn`,
  `anchor-derive-*` and `anchor-attribute-*` to 1.0.2 (`cargo update -p <crate> --precise 1.0.2`; keep
  it that way when updating), and `lil_dudes` allows `clippy::diverging_sub_expression` from Anchor
  1.0.2's `#[program]`. Zero-copy arrays like `[u8; 1312]` need `bytemuck` with `min_const_generics`.
  `sol_remaining_compute_units` is rejected by the devnet loader; measure with `sol_log_compute_units`.
- TS: `@coral-xyz/anchor@0.32.1`, `@solana/web3.js@^1.98`, `@magicblock-labs/ephemeral-rollups-sdk@0.18.0`,
  `@solana/wallet-adapter-*`, `react@19`, `three@0.187`, `@react-three/fiber@9`, `@react-three/drei@10`, `vite`, `hono@4`.
- Deploy cost ✅: measured 2.42 SOL for a 476 KB .so and 2.27 SOL for 446 KB (the spike: Anchor + the
  ER SDK + `crates/sim`). A fresh deploy needs ~1× the rent (the buffer is drained into the program);
  an **upgrade** needs a full-size buffer next to the live program (~2× at peak). Build with
  `opt-level = "z"` and `[profile.release.package.lil-dudes-sim] opt-level = 3` (592 → 476 KB for the
  spike, sim speed unchanged). Keep about 5 devnet SOL on the deploy wallet.

## 7. Stages (technical, not calendar)

Each stage has an exit test. B = back end (Kai by default), F = front end (Suparno by default).

| Stage | Goal | B track | F track | Exit test |
|---|---|---|---|---|
| **0 Spike** | Kill the unknowns on devnet-tee | `spikes/`: tiny program with public + private accounts, crank, ER VRF, commit+undelegate+action | Arena feel prototype vs a local mock sim (drag, stream, gates, crowd render on a phone) | All 6 checks below pass, or the fallback is chosen |
| **1 Contract + sim** | Freeze `MatchView` v0; real rules in `crates/sim` | sim crate + unit tests + Rust balance runner | renderer on the `MatchView` mock; HUD; gate popups | 10k simulated matches run natively; mock and sim agree on the types |
| **2 Live loop** | A real match on the ER, no secrets or money yet | program: create/join/delegate/seed/start/advance/set_aim/finish; MagicSVM tests; devnet deploy; `packages/client` | switch from the mock to the live subscription; latency feel on a phone | two browsers play a full 2:00 match on devnet |
| **3 Hidden info** | `?` truly hidden; rig, peek, gold, re-deal | Secrets/Peek permissions; deals from seed; reveal on pass | `?`/hint/gold visuals, plant window, GOTCHA, peek UI | the opponent's client cannot read unrevealed values (tested) |
| **4 Money** | Stakes + settlement | Vault, stake tiers, matched-stake refund, settle action + fallback | stake picker, result/payout screen, explorer links | settlement matches `settle_fuzz` math on devnet |
| **5 Onboarding** | Zero-friction first match | burner flow, server faucet, quick-match queue, room codes, on-chain bot | landing → instant bot match, top-up/withdraw with Phantom, PWA | a fresh phone plays the bot within ~30 s of opening the link |
| **6 Feel + tune** | Fun and balanced | Rust balance runner on real params; Surge; Double-or-Toll | juice pass, sound, haptics, Verify screen | playtest notes logged; HP/deck tuned |
| **7 Ship** | Submission | deploy, monitoring, demo room | demo video, landing copy | submitted |

**Stage 0 checklist (devnet-tee):** done 2026-11-22, details in
[spikes/stage0/RESULTS.md](../spikes/stage0/RESULTS.md).
1. ✅ A private account with no members can't be read by any client, while the program still reads it.
2. ✅ The opponent can't see `plant_rig` instruction data or logs (getTransaction / onLogs / ws). Exception: failed VRF callbacks are public.
3. ✅ A crank at 50 ms runs on the TEE validator for 2+ minutes (3,000/3,000 calls, 40–60 ms, sim lag 0).
4. ✅ `request_randomness` on the ER queue from the TEE calls back in 2 slots, **after** fixing the SDK's `#[vrf_callback]` (❌ as shipped).
5. ✅ (Node) / ⚠️ (phone) websocket `accountSubscribe` with a TEE token delivers 20 updates/s. Phone page: `spikes/stage0/ws-rate.html`.
6. ✅ commit + undelegate + post-commit action moves SOL out of a base-layer vault; the permissionless fallback works.
Also: ✅ a burner with 0 SOL can send ER transactions; ❌ `advance` with 40 steps × 80 cohorts does not fit (worst tick ~50k CU; max 6 steps per crank call, 2 at 200k CU).

## 8. Risks and fallbacks

| Risk | Fallback |
|---|---|
| TEE privacy of tx data fails (check 2) | ✅ Did not fail. (Was: commit-reveal rigs; peeks become "reveal-on-demand" of your own cell) |
| PER unusable overall (checks 1/5) | ✅ Did not fail. (Was: public ER; gate values rolled by ER VRF at first contact; commit-reveal rigs) |
| Crank unreliable on the TEE (check 3) | ✅ Did not fail. Client heartbeat `advance` txs stay possible (the program is catch-up based) |
| Magic Action fails | ✅ Permissionless `settle`, proven on devnet |
| VRF callback fails (SDK macro, check 4) | ✅ Declare `vrf_program_identity` with a `const` address; keep the callback infallible |
| A failed VRF callback leaks the randomness | Seed = `H(vrf ‖ private salts)`; the callback never fails |
| `advance` over the CU limit (extra b) | ✅ M3: codec 68k → 6k CU, worst tick 38k; caps 8 (crank) / 2 (player tx) |
| Crank ends before the match (slow ER slots) | ✅ M3: 1.5 × MATCH_TICKS runs (5,400 for the 3:00 cap of v3 and v4; covers 15 ms slots); LiveSource sends a heartbeat `advance` after 1 s without a tick |
| 0-SOL burner can't schedule the crank / escrow the action | ✅ Did not fail (M3 devnet, three runs) |
| Program upgrade needs ~2× rent in SOL | Small .so (`opt-level = "z"`, sim at 3); keep ≥ 5 SOL; or deploy fresh + close the old program |
| Anchor macro crates drift to 1.2.2 | Keep them pinned to 1.0.2 in `Cargo.lock` |
| Phone perf in 3D | Lower instance cap, flat shading, then a 2D sprite fallback in the same R3F scene |
| Faucet limits | Server sponsor wallet tops up burners; keep a funded deploy wallet |

## 9. Server (`apps/server`, M5)

Hono on Node, one instance, state in memory (rooms, queue, limits; a restart only drops waiting
players and resets limits). **Not in the trust path:** it never decides an outcome; every
on-chain thing it does is permissionless or its own player's move, and every refund goes to the
players recorded in the Match.

| Route | What |
|---|---|
| `GET /healthz` | `{ ok }` for platform health checks (no RPC, never rate-limited) |
| `GET /health` | rooms, queue size, faucet on/off, bot stats, sweeper stats |
| `POST /rooms {id, stake}` / `GET /rooms/:code` / `DELETE` | room codes (6 chars, 15 min) |
| `POST /queue {player, stake}` / `GET /queue/:ticket` / `DELETE` | quick match; a FREE ticket alone for 5 s gets the bot (`bot: true`, role `join`) |
| `POST /topup {burner, stake?}` | faucet: fills the burner to stake + 0.035 SOL (≤ 0.3); 1 / 10 min per burner, 3 / 10 min per IP, 3 SOL / hour; devnet only (genesis hash checked) |
| `GET /faucet` | sponsor address, balance, policy, spent last hour |
| `POST /settle {id}` | "Settle now" for a burner with no SOL: permissionless `settle`, sponsor pays (10 / 10 min per IP) |

- **Sponsor wallet** (`SPONSOR_KEYPAIR_PATH` or `SPONSOR_SECRET_KEY`, env only, never logged):
  `8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr`. Pays top-ups, the bot's float, the sweeper's fees.
- **Online bot** (`src/bot.ts`): its own wallet = burner (`BOT_KEYPAIR_PATH`,
  `CJbQuVNXhA2ygutqD48ucoHC3wfvawegSDTEL49Y9ogW`), a server-side `LiveSource` + the WASM Warlord,
  public state only. Creates stake-0 matches only (the human joins, so matched stake = 0); ≤ 2
  at once; ~0.012 SOL per match (delegation + commit; the rent comes back at close). ✅ devnet: a
  fresh 0-SOL burner was playing the bot **15.4 s** after asking for a top-up.
- **Sweeper** (`src/sweeper.ts`, every 60 s, sponsor-signed): cancels rooms open 20 min and joins
  never delegated for 5 min, aborts TEE matches stuck before the start ~5 min, finishes over
  matches nobody finished, nudges a dead crank (`advance`), settles a finished match the Magic
  Action left unpaid for 30 s, closes paid-out matches after 10 min (rent → creator).
- **Hardening:** CORS only for `CORS_ORIGINS` (default: localhost / LAN dev origins), 4 KB body
  cap, JSON-only writes, 240 requests / min per IP (`X-Forwarded-For` behind the proxy with
  `TRUST_PROXY=1`), secure headers, JSON errors without stack traces, strict validation of every
  pubkey / u64 / tier / code / ticket.

### Deploy (not done: Kai runs these)

Image: `apps/server/Dockerfile` (build context = repo root, ~only `packages/client`,
`packages/sim-wasm`, `apps/server`; keys and `.env` files are excluded by `.dockerignore` and
deleted in the image). One instance only (state is in memory). Recommended: **Render, Starter
plan** (free instances sleep after 15 min idle, which stops the bot and the sweeper and makes the
first request take ~1 min); `render.yaml` is the Blueprint.

1. Fund the sponsor: `solana transfer 8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr 3 --allow-unfunded-recipient -u devnet`.
2. Render → New → Blueprint → pick the repo (it reads `render.yaml`). In the service's
   Environment, set the three `sync: false` values: `SPONSOR_SECRET_KEY` = the JSON array in
   `~/.config/lil-dudes/sponsor.json`, `BOT_SECRET_KEY` = the one in `~/.config/lil-dudes/bot.json`
   (paste them in the dashboard only; never in a file in the repo), `CORS_ORIGINS` = the web
   app's URL (e.g. `https://lil-dudes.vercel.app`, comma-separate several).
3. Manual deploy (autoDeploy is off). Check `https://<service>.onrender.com/healthz` → `{"ok":true}`
   and `/health` → `faucet: true`, `bot.address` = `CJbQ…9ogW`, `sweeper.runs` going up.
4. Smoke test from the laptop: `pnpm --filter @lil-dudes/client exec tsx scripts/vs-server-bot.ts
   --server https://<service>.onrender.com` (a fresh burner: top-up → bot match → settle).
5. Give Suparno the URL for the web app's server setting.

Fly.io instead: `fly launch --no-deploy --dockerfile apps/server/Dockerfile --internal-port 8787`,
`fly secrets set SPONSOR_SECRET_KEY="$(cat ~/.config/lil-dudes/sponsor.json)" BOT_SECRET_KEY="$(cat
~/.config/lil-dudes/bot.json)" CORS_ORIGINS=https://… TRUST_PROXY=1`, keep `min_machines_running =
1` and `fly scale count 1`, then `fly deploy`. Locally: `pnpm --filter server start` reads
`apps/server/.env` (key paths, gitignored).
