# Progress log

Shared, append-only log for Kai and Suparno. **Add new entries at the bottom.** Never
edit or delete someone else's entry. Read the last ~10 entries at the start of every session.

Tags (use any that apply): `CONTRACT` (changes `packages/client` / `MatchView`), `BLOCKER`,
`DECISION`, `HANDOFF` (asks the other person to do something), `STAGE` (a stage exit test passed).

Template:

```
## YYYY-MM-DD HH:MM IST · <Kai|Suparno> · <area> · [TAGS]
**Did:** what changed (files/areas), in 1–4 bullets
**Decided:** decisions and why (or "none")
**Blocked / risks:** (or "none")
**Next / handoff:** what comes next, and anything the other person must do
```

---

## 2026-11-21 · Kai · planning · [DECISION]
**Did:**
- Reviewed the v1 design. Ran balance sims (`tools/balance/balance_sim.py`)
  and a settlement fuzzer (`tools/balance/settle_fuzz.py`, 300k cases, conservation exact).
- Wrote `docs/SPEC.md` (game v2), `docs/TECH.md` (architecture, PROPOSED), this log.
- Verified on devnet: TEE ER, VRF oracle and pricing oracle are live; ER slots are ~10 ms; ER VRF is
  free and <50 ms (docs); Private ER permissions are per account; Magic Actions can move funds; the RPS
  example's web stack works with Anchor 1.0.2.

**Decided:**
- v2 rule changes vs v1: re-deal gates every 40 s; gold ×3/÷3 (not ×10/÷10); HP tuned for ~25% KO
  (v1 gave 60–95% KO); Raise → Double-or-Toll at 1:20 (stretch), because v1's Raise ended ~60% of
  matches at halftime; keep the mirrored layout; Rig + Peek once per phase; no power-up meter in the MVP.
- Hidden `?` values (not just rigs) must live in private TEE accounts.
- Stack (PROPOSED): web PWA, TS + Vite + React 19 + Three.js/R3F; Anchor 1.0.2 + ER SDK 0.18.x;
  shared integer Rust sim crate; web3.js + @coral-xyz/anchor 0.32.1 client; burner keys; devnet SOL
  stakes; Hono server for faucet/matchmaking; pnpm + Cargo monorepo.

**Blocked / risks:** Deploy wallet has 0 devnet SOL (need ~5). Stage 0 unknowns: TEE tx-data
privacy, crank on the TEE, burner with 0 SOL on the ER.

**Next / handoff:** Kai and Suparno confirm the stack → `git init` + scaffold (Stage 0/1). Suparno:
add the two MCP servers, start collecting CC0 low-poly assets (crowd unit, cannon,
gates, arena) and log them in `CREDITS.md` once `apps/web` exists.

## 2026-11-21 · Kai · repo setup · [DECISION]
**Did:**
- `git init` (branch `main`), first commit: docs, this log, balance sims, `.gitignore`, `.gitattributes`.
- Removed the working name from all docs. Program/crate id is `duel` until we choose a name.
- `docs/TECH.md` §5: client runs the sim as WASM for smooth prediction + an offline mode; crowd/look budget.

**Decided:**
- **Each person keeps a private, gitignored notes file.** Put one line in yours:
  "read the last ~10 entries of PROGRESS_LOG.md at the start, append an entry after each piece of work".
- Game name: not chosen yet; decide together later.
- Stages in TECH.md §7 are a draft only; Kai is reviewing them.

**Blocked / risks:** deploy wallet still 0 devnet SOL. No GitHub remote yet.

**Next / handoff:** Kai: create the GitHub repo and invite Suparno. Suparno: clone, write your own
your own notes file, add the two MCPs, start the arena feel prototype in `apps/web` (look notes in TECH.md §5).

## 2026-11-21 · Kai · docs · [DECISION]
**Did:**
- Added `docs/IDEA.md`: what we're building, why it needs Solana + MagicBlock, who it's for, the player
  journey, how a match feels, look and identity, what makes it different.
- Removed every mention of other games' names from the docs.

**Decided:** we target a genre, not one game. **Never name other games** anywhere in the repo, docs,
code or UI (it reads as a clone in the submission). Say "crowd-cannon genre" or "the game from the ads".

**Blocked / risks:** none new.

**Next / handoff:** Suparno: read `docs/IDEA.md` first. It's the one-page picture, and the look section is yours to shape.

## 2026-11-21 · Kai · docs · [DECISION]
**Did:** Put the name in IDEA/SPEC/TECH. Code ids: repo `lil-dudes-go-brr`, Anchor program `lil_dudes`.

**Decided:** The game is called **Lil Dudes Go Brr**.

**Blocked / risks:** none.

**Next / handoff:** Kai is doing genre research (gameplay recording + game data) outside the repo. Findings
come back as generic mechanics edits to SPEC/TECH.

## 2026-11-21 · Kai · genre research
**Did:**
- Genre research (playtesting + measured gameplay recordings). Notes are private, not in the repo.

**Decided:** none yet. Proposed generic edits, to confirm together:
- Sim: cannon `x` moves toward the aim at a max speed per tick; cohorts get a short fast "launch" after spawn;
  a gate row applies once per cohort.
- Client: new units "pour" out of a gate over ~0.1–0.25 s instead of popping in; fast-then-ease launch
  animation; relative drag with a catch-up buffer; try a narrow-FOV (~30°) camera pitched ~44°; random
  culling above the unit cap; quality tiers (60/30 fps, 0.75 res, no shadows); no per-hit damage numbers.
- Bot: re-pick a target every ~2 ticks, best revealed gate (or hint), alternate between ties, brake near the target.
- The genre's natural fight length (~15–45 s) supports our 40 s re-deal.

**Blocked / risks:** none.

**Next / handoff:** Kai: turn the agreed points into SPEC/TECH edits. Suparno: the client points above are for the arena feel prototype.

## 2026-11-21 · Kai · docs · [DECISION]
**Did:** Folded the genre research into the docs: SPEC v2.1 (§2, §3, §4, §6, §7, §9, §11–13), TECH §4 Match
account + §5 client (screens, HUD, crowds, look, feel, performance), IDEA player journey.

**Decided:**
- Volley every 8 ticks (0.4 s) of `B = 4` units; Surge = every 4 ticks; cohort cap **40/side**. This fixes
  a real bug in the old §6 (32 cohorts at 10/s would vanish after 3.2 s, before reaching the clash).
- Launch boost (3× cruise for 6 ticks), max cannon step per tick, each row applies once per cohort.
- Gates ~75% of their column (gaps make aim matter); confirm in the first prototype.
- No number badge per crowd: one number per clash front + per-side totals. Static camera ~44°/FOV 30°.
- First match = guided bot tutorial, **skippable**, and replayable from Home.

**Blocked / risks:** HP, `B` and the ± deck values need re-tuning on the real sim. Deploy wallet still 0 SOL.

**Next / handoff:** Kai: scaffold the monorepo + `crates/sim` (v2.1 rules) + Stage 0 spikes on devnet-tee.
Suparno: arena feel prototype in `apps/web` (TECH §5 is the brief: drag, volleys, gate pour, clash
front, camera, 75% gates).

## 2026-11-21 · Kai · planning · [DECISION]
**Did:** Wrote `docs/MVP.md`: the full MVP (features in/stretch/out), every screen, edge cases, look
and sound, starting numbers, build order M1–M7 with who does what, the cut order, wallets.

**Decided:**
- Build order: **M1 playable offline** (sim + WASM + arena) and **M2 chain proven** (Stage 0) in parallel,
  then M3 live 1v1 → M4 hidden info → M5 money + onboarding → M6 feel + tutorial → M7 ship.
- The tutorial runs on the local sim (instant, no SOL), and a Skip is always visible.
- Deploy wallet (5 SOL) is for program deploys only; a separate server sponsor wallet (~5 SOL) comes in M5.

**Blocked / risks:** none. Deploy wallet funded (5 SOL).

**Next / handoff:** Kai: M1 (scaffold, sim, WASM, local bot) then M2 spikes. **Suparno: read
`docs/MVP.md`, own the §5 OPEN items (dudes design, arena theme, cannon/gates, logo, font, palette,
audio), and build the M1 arena prototype.** Private research is shared through a separate private repo
cloned into `pvt-docs/` (Kai will send the link).

## 2026-11-21 · Kai · planning · [DECISION] [CONTRACT]
**Did:** `docs/MVP.md` §9 "Working in parallel"; TECH §3: `MatchSource` with Mock → Offline → Live
implementations; `packages/sim-wasm` committed prebuilt.

**Decided:** Suparno never needs Rust, Solana tools or SOL. The web app talks only to `MatchSource`; Kai
pushes a scaffold with a working `MockSource` first, and the rest are one-line swaps later.

**Blocked / risks:** none.

**Next / handoff:** Kai: scaffold + `MockSource`, push. Suparno: after pulling, `pnpm install && pnpm --filter web dev --host`, then build the arena on the mock.

## 2026-11-21 · Kai · scaffold · [CONTRACT] [HANDOFF]
**Did:** Scaffolded the monorepo on `main` (foundation only, no game logic yet):
- Root: `package.json` (pnpm 10.34.9, Node ≥ 22.12, scripts), `pnpm-workspace.yaml` (`apps/*`, `packages/*`),
  `tsconfig.base.json`, `README.md`, Cargo workspace (`programs/*`, `crates/*`), `Anchor.toml`.
- `programs/lil_dudes`: Anchor 1.0.2 + ER SDK =0.18.0 (`anchor, vrf, access-control, crank`), a `ping`
  placeholder. Program id `4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa` (keypair kept by Kai, not in git).
- `crates/sim`: constants (MVP §6) + core types + tests. `crates/sim-wasm`: wasm-bindgen stub.
- **`packages/client` (`@lil-dudes/client`): `MatchView` v0, `PrivateView`, `MatchEvent`, constants,
  `MatchSource`, and a working `MockSource`** (full 2:00 fake match: volleys, reveals, gate counts,
  GOTCHA, clash, hits, plant/re-deal/Surge, KO/timer end with payout). See `packages/client/README.md`.
- `packages/sim-wasm` (empty until M1), `apps/server` (Hono `/health`), `tests-magicsvm/`, `spikes/`.
- **`apps/web` is NOT on main.** It lives on Suparno's branch.

**Decided:** All `x` are absolute lane coordinates from side 0's view; side 1 mirrors when drawing.
`y` is measured from each cohort's own cannon. Lane: 3000 wide × 12000 long sim units (MVP §6).

**Blocked / risks:** none.

**Next / handoff:** **Suparno:** merge `main` into `web/arena-prototype` and rearrange your side to fit
it: keep main's root `package.json` / `pnpm-workspace.yaml` / `tsconfig.base.json` (add any root scripts you need), take
main's `pnpm-lock.yaml` and run `pnpm install`, keep your `dev-dist/` gitignore line. Then add
`"@lil-dudes/client": "workspace:*"` to `apps/web/package.json`, drive the arena from `MockSource`, and
tell me if the lane geometry (MVP §6 / `constants.ts`) doesn't match your arena. Merge into `main`
once it builds. Kai next: `crates/sim` step function → WASM → `OfflineSource` (M1), then M2 spikes.

## 2026-11-21 22:40 IST · Kai · M1 OfflineSource · [CONTRACT] [HANDOFF]
**Did:**
- `crates/sim`: the real rules (SPEC v2.1) + Warlord bot, compiled to WASM in `packages/sim-wasm/pkg`
  (committed, ~60 KB, loads synchronously; no Rust needed).
- `packages/client`: **`OfflineSource`** (real rules + the bot on the other side, 20 Hz, same
  `MatchSource` contract as `MockSource`). `MockSource` still works. Tests: `pnpm --filter
  @lil-dudes/client test` (TS constants == Rust constants, bundled WASM == current Rust source).

**Decided:** `MatchView`, `PrivateView`, `MatchEvent` and `MatchSource` are **unchanged** (no renamed
or removed fields). Additions and clarified meanings:
- New constants: `PHASES` (3), `CELLS` (9), `CLASH_REACH` (500 = half a column), `HINT_PCT` (60).
- During a plant window every gate's `hint` is `'none'` except gold (hints appear when play starts).
- `clash` event `y` is measured from side 0's cannon. `hit.side` = the cannon that was hit.
  `gotcha.side` = whose stream sprang the trap.
- `rig`/`peek` calls that aren't allowed are silently ignored; peek only works during play (not
  in the plant). Watch `PrivateView.myRig` / `myPeek` and `rigUsed` / `peekUsed`.
- Cohorts clash wherever they meet within `CLASH_REACH` in x (normally the clash zone).

**Blocked / risks:** none for the front end.

**Next / handoff:** **Suparno:** after pulling, run `pnpm install` (new workspace dep
`@lil-dudes/sim-wasm`). Then the one-line swap: `new MockSource(opts)` → `new OfflineSource(opts)`
(import from `@lil-dudes/client`). Options are the same (`mySide`, `myName`, `opponentName`,
`stake`, `speed`) plus `seed`, `botSeed`, `tutorial`; `startTick` is mock-only. No Vite config needed.
Extras: `src.step()`, `src.view`, `src.dispose()`. Details: `packages/client/README.md`.

## 2026-11-21 22:50 IST · Kai · M1 sim + offline · [STAGE] [DECISION]
**Did:** M1 back-end track done. A full 2:00 match runs through `OfflineSource` with the real rules
and the bot (headless smoke: `pnpm --filter @lil-dudes/client smoke`).
- `crates/sim` (no_std, no alloc, integer-only, no deps, no-panic clippy lints, builds under the SBF
  rustc 1.84): `MatchState { public, secret }`, `step(&mut state, &Inputs, &mut impl EventSink)`,
  mirrored deals from `f(seed, phase)` (SplitMix64), every SPEC v2.1 rule, SPEC §7 `payout()`,
  `Warlord::decide(&PublicState)` (cannot see secrets by construction), state `digest()`.
- Tests: **63** in `crates/sim` (per-rule unit tests; determinism tick by tick; fuzz on 1,204
  seeds with random/invalid inputs; payout parity on 3,010 vectors generated from
  `settle_fuzz.settle`; golden bot-vs-bot match), **5** in `crates/sim-wasm`, **7** TS tests in
  `packages/client`. Clippy, fmt, typecheck, `anchor build --ignore-keys` all pass.
- Balance runner: `cargo run -p lil-dudes-sim --example balance --release` (5,000 bot-vs-bot):
  **KO 68.6%** (phase 1/2/3: 761/1286/1383), side 0/1/draw 49.7/49.9/0.5%, **avg length 86.9 s**,
  **avg payout 89.2% of S** (65.7% on timer endings), final HP winner 1832 / loser 340, 3.0
  GOTCHAs per match, peak 27 live cohorts per side (cap 40).

**Decided** (written into SPEC.md, marked **(M1)**):
- Plant windows: gates face-down and inactive (in-flight cohorts pass unchanged); hints hidden
  except gold; cannons can still move. The first volley fires on the first tick of play.
- Hint coin flips are per side (values mirrored, hints not), so a fake blue can't be spotted by
  comparing the grids. Hints go public only after rigs lock.
- Rig trap (÷2) is the gate's value for the rest of the phase. Peek: play only (never stale);
  gold can be peeked; revealed cells are refused without using the peek.
- Clash: cohorts meet once they've reached each other along the lane and their x differ by
  ≤ `CLASH_REACH` (half a column); they subtract wherever they meet; front-most pairs first.
- Double KO on one tick = draw. Tick order: inputs → cannons → move + gates → clash → hits → KO → fire.
- Bot: defends against grown cohorts within 3,000 units; best column by revealed values else hints
  (blue/gold ×2, grey ×1, red ÷2); random rig on the first plant tick, random peek on the first
  play tick; tutorial = aims into a gap in phase 1, no rig/peek. Its seed must be independent of
  the match seed (on-chain: separate VRF bytes, M3/M4).
- `crates/sim` declares `rust-version = 1.84` (Solana platform-tools); `programs/lil_dudes`
  declares `target_os = "solana"` for check-cfg so workspace clippy passes.

**Blocked / risks:**
- KO rate 68.6% vs the ~25% target. Not tuned (M6): likely the bots often pick different columns
  (independent hints), so streams pass each other and race. Knobs: HP, `CLASH_REACH`, the bot.
- The bot is weak against a player who reads revealed gates (smoke run: 2110 vs 116 HP). M6.
- Not yet tried inside `apps/web`/Vite (not on main). The WASM is inlined and initialised
  synchronously, so no plugin or asset URL is needed.
- Double-or-Toll is not in the sim; payout parity covers the no-Double path only.

**Next / handoff:** Kai: **M2** (Stage 0 spikes on devnet-tee, TECH §7 checklist), including the
compute of `advance` × 40 steps with the real sim. Suparno: swap to `OfflineSource` (entry above)
and tell me what feels wrong in the real rules (speeds, gate gaps, clash reach).

## 2026-11-22 01:45 IST · Kai · M2 chain proven · [STAGE] [DECISION]
**Did:** Stage 0 on devnet + devnet-tee with a throwaway program (`spikes/stage0/`: Anchor 1.0.2, ER SDK
=0.18.0, the real `crates/sim` in a public Board account, private Secret/Peek, crank, ER VRF, vault +
Magic Action) and TS scripts per check. Full numbers + rerun commands: `spikes/stage0/RESULTS.md`.
Docs: TECH §1/§4/§5/§6/§7/§8 updated (⚠️ → ✅/❌, compute budget, permission sizes, rules below).

| Check | Result | Numbers |
|---|---|---|
| 1 private account, no members | ✅ | invisible to both players, authority, no-token; program reads it; Peek visible to its member only |
| 2 opponent can't see plant_rig | ✅ | any tx touching a private account is redacted (even read-only, even failed); 0 leaks. Exception: failed VRF callbacks are public |
| 3 crank 50 ms, 2+ min | ✅ | 3,000/3,000 + 2,600/2,600 calls, 0 missed; 40–60 ms steady; sim lag 0 over a real bot match |
| 4 ER VRF from the TEE | ✅ after fix | callback 2 slots (~20 ms) after the request, 10/10. SDK 0.18.0 `#[vrf_callback]` burns ~250k CU → fails until `vrf_program_identity` is declared with a `const` address |
| 5 ws accountSubscribe ~20/s | ✅ Node, phone pending | 20.0/s, inter-arrival p50 49.9 / p99 157 ms, no state skipped |
| 6 commit+undelegate+action, fallback | ✅ | vault → recipient by the action (≤ 5.3 s after finish); skipped action → third-party `settle` works; double settle refused |
| a 0-SOL burner on the TEE | ✅ | never-funded keys send all ER txs |
| b `advance` CU, real sim | ❌ 40 ticks/tx | worst tick ~50k CU + 74k fixed (codec 68k): max 26 ticks at 1.4M, 6 per crank call (400k), 2 at 200k; real crank calls p50 45k / max 92k |
| c TEE identity | ✅ | `MTEWGuqx…xzo` (devnet-tee = devnet-tee-as), validator 1.1.1 |
| d SOL spent | 0.0764 SOL | 5.0000 → 4.9236; both spike programs closed (+2.4179, +2.2648 SOL back) |

**Decided:**
- Keep the PER (TEE) plan as is; **no fallbacks needed** (no commit-reveal, no heartbeats). Rule: every
  tx with secret input lists `Secrets` or `Peek`. Match has no permission (public); Secrets private
  with no members; Peek[side] private with that burner as member. Permissions are ephemeral, created on
  the ER and pre-funded into the PDA (4,096 / 5,152 lamports for 0 / 1 member).
- ER VRF on the TEE with the `const VRF_IDENTITY` callback pattern; the callback must be infallible and
  the seed = `H(vrf ‖ private salts)` (a failed callback is public and retried with the same bytes).
- `advance` catch-up cap: **6 steps in the crank, 2 in player txs** (not 40). M3 cuts the cost: codec into
  `crates/sim` (opt 3) or zero-copy Match; clash bucketed by column.
- Settlement shape proven: `settle_action` (`#[action]`, escrow signer pinned) + permissionless `settle`
  over one payout function; base settle tx is a v1 transaction (web3.js 1.x can't decode it).
- Main `Cargo.lock`: Anchor macro crates pinned to 1.0.2 (they had drifted to 1.2.2, which breaks
  `#[account(init)]`); `lil_dudes` allows `clippy::diverging_sub_expression` from Anchor's `#[program]`.
- Build profile for the real program: `opt-level = "z"`, sim at 3 (592 → 476 KB; rent 2.42 SOL).

**Blocked / risks:**
- Phone ws rate not measured yet: `spikes/stage0/ws-rate.html` (needs the spike redeployed or the M3
  Match; `?mode=slot` works with no program).
- Upgrades need ~2× program rent (buffer + live program): keep ≥ 5 SOL or deploy fresh + close.
- SDK `#[vrf_callback]` bug not yet reported to MagicBlock.

**Next / handoff:** Kai: **M3** `lil_dudes`: accounts + permissions per above; create/join/delegate on
base; on the TEE `init_permissions`, `request_seed`/`callback_seed` (const identity), `start` (crank,
unique task id), `advance` (cap 6/2), `set_aim`, `finish` (cancel crank, commit+undelegate + settle
action); codec in `crates/sim` + TS decoder in `packages/client` (`LiveSource`); MagicSVM tests; devnet
deploy. **Suparno:** nothing changes in `MatchSource`; plan for the live feed to render ~3 ticks
(150 ms) behind the newest snapshot (TECH §5), and run `ws-rate.html` on your phone when Kai has a
Match on devnet.

## 2026-11-22 02:25 IST · Kai · answers for Suparno · [DECISION] [HANDOFF]
**Decided** (answers to the questions in `web/arena-prototype`'s log):
- **Double-or-Toll: cut from the MVP.** It stays a stretch idea (SPEC §8) after we ship. Escrow is
  `S` per player; payout is the no-Double path only (already what `crates/sim` and the parity tests do).
- **Lane drawn 1.5× wider than the sim (18 × 48 world units vs 3000 × 12000): fine.** It's visual only.
  Map x with one linear scale for everything (gates, gaps, cohorts, cannons, clash) so what you see
  lines up with what the sim decides. Sim constants don't change.
- **Result screen, all 3 deals: yes.** At match end the seed is public (Verify needs it), so the
  boards are rebuilt from it. Coming: a WASM helper `dealsFor(seed)` and, in the contract, the rig +
  peek history per phase (both sides) on the final result (`CONTRACT` entry when it lands, M3/M4).
  Keep the sample boards until then.

**Next / handoff:** **Suparno:** merge into `main` tomorrow morning (your branch is ~14 commits behind;
dry-run merge showed no conflicts): `git pull`, `pnpm install`, swap `MockSource` → `OfflineSource`,
then merge. `MatchSource` won't change for `LiveSource`. Kai: M3 (real `lil_dudes` program) now.

## 2026-11-22 03:10 IST · Kai · M3 step 1 (codec) · [DECISION]
**Did:** M3 step 1 done; next: step 2 (accounts + permissions).
- `crates/sim/src/codec.rs`: compact LE codec, public part (1,046 B, Match account) and secret part
  (85 B, Secrets account) separately; fixed offsets, only live cohorts copied, `MatchState::zeroed()`
  so decoding builds nothing. TS decoder `packages/client/src/codec.ts` (`decodePublic`,
  `toMatchView`), checked every tick against the WASM build (`public_bytes`).
- Sim: `apply_input` (player txs apply inputs between ticks, same as the next `step`), per-phase
  rig + peek `history` in `SecretState` (not in `digest`, so M1 digests and the golden match are
  unchanged), clash loop over a flat copy with an x-bucket pre-check (same pairs, same order;
  tested against the plain loop on 4,000 random fronts).
- MagicSVM bench (`tests-magicsvm/tests/bench.rs`, program feature `bench`), same states, new build
  vs the M2 spike `.so`:

| | new | M2 |
|---|---|---|
| codec (decode + encode, full 40v40) | **5,870 CU** | 68,388 CU |
| tick, M2 worst (40v40 crossed, far apart) | 13,483 | 50,493 |
| tick, near miss (40v40 crossed, dx 700, the new worst) | 38,443 | 50,493 |
| tick, Surge peak of a real bot match | 6,022 | 5,715 |
| ticks per 400k crank tx at the worst state | **10** | 6 |

**Decided:** release profile `opt-level = "z"`, sim at 3 (root `Cargo.toml`). SBF builds need
`cargo build-sbf --tools-version v1.52` (v1.51's cargo can't parse an edition-2024 dep).
Crank cancel: the SDK's legacy `CancelCrankCpi` needs an undocumented task-context account, so
`start` schedules exactly the iterations a match needs and `advance` is a no-op after the end.

**Blocked / risks:** none.

## 2026-11-22 03:35 IST · Kai · M3 steps 2–3 (accounts, base layer) · [DECISION]
**Did:** M3 steps 2 and 3 done; next: step 4 (TEE instructions; the code is in, tests next).
- `programs/lil_dudes`: `Match` (zero-copy, 1,376 B: header + the codec's public state), `Secrets`
  (192 B: VRF output, both salts, the codec's secret state), `Peek[side]` (56 B: that player's own
  rig + peek, each stamped with its phase), vault PDA (system-owned, base only). `create_match`
  (stake tiers 0/0.05/0.1/0.25 SOL, pre-funds the ephemeral permission rent), `join_match` (S =
  lower pick, A's excess refunded), `delegate_match` (all four accounts in one tx, TEE pinned,
  never commits on a timer), `cancel_match` (creator while open; either player 60 s after an
  undelegated join), `init_permissions` (Secrets private/no members, Peek[s] private/member burner s).
- `tests-magicsvm/tests/flow.rs` (MagicSVM 0.3.0, IDL-driven instruction builders): create → join
  → delegate → permissions with the viewer filter (Secrets hidden from both burners and anyone,
  each Peek visible only to its burner), VRF seed + start + crank (40 ticks in 200 slots, 0
  failures), cancel/refund paths and refused cases.

**Decided:** no `Config` account: the treasury is a constant (the deploy wallet; a fixed test key
in the `magicsvm` feature build) and `delegate_match` only accepts the TEE validator
(`MTEWGuqx…xzo`); the test build (`--features magicsvm`) lifts the pin because MagicSVM's validator
differs. `set_aim` writes the aim straight into the public state (no catch-up, no Secrets): it is
public anyway and costs ~3k CU. Instruction names: `peek_cell` (not `peek`, the account type).
Rent: A pays all four accounts (~0.013 SOL), refunded by `close_match`.

**Blocked / risks:** a crank scheduled by a 0-SOL burner and the Magic Action escrowed by a burner
are unproven on devnet (MagicSVM accepts both); fallback = the funded server/test wallet sends
`start`/`finish`, and `settle` stays permissionless.

## 2026-11-22 04:15 IST · Kai · M3 step 4 (TEE instructions) · [DECISION]
**Did:** M3 step 4 done; next: step 5 (rig/peek/finish/settle tests; the code is in).
- `tests-magicsvm/tests/tee.rs`: salts refused before the permissions exist and from strangers;
  one salt → no VRF; salts set once; seed == sha256(vrf ‖ salt0 ‖ salt1)[..8] and the deal comes
  from it; the public Match never holds the seed; a forged VRF callback is refused; `start` only
  once, only by a player, only when seeded; crank catch-up cap 8 per `advance`; `set_aim` clamps,
  refuses strangers and stops after the end; a full match on the crank + manual `advance`.
- Measured in MagicSVM (real `advance`, Anchor included): 8-tick catch-up 15.4k CU, `set_aim`
  3.3k CU, crank calls p50 3.2k / max 15.7k over 2,150 runs (0 failures).

**Decided:** `CRANK_ITERATIONS` = 1.5 × MATCH_TICKS (3,600): the crank interval is wall time but
ticks follow ER slots, so slots slower than ~11.7 ms would end a 2,400-run crank before the match;
1.5× covers slots up to 15 ms, extra runs are cheap no-ops, and `advance` stays permissionless
(LiveSource sends a heartbeat `advance` if no new tick for 1 s).
MagicSVM tests build their dependencies at opt-level 2 without debug info (`tests-magicsvm`):
the first build is ~25 min, then a full suite runs in about a minute.

**Blocked / risks:** the disk filled up (100%) during the first optimised test build; I cleared
`target/debug` and the spike's intermediate build dirs (all regenerable; every `deploy/` dir and
keypair kept). ~8 GB free now: watch it.

## 2026-11-22 04:35 IST · Kai · M3 step 5 (rig, peek, finish, settle) · [STAGE] [CONTRACT]
**Did:** M3 step 5 done; next: step 6 (the remaining refused-case tests + autofixer; most are in).
- Program: `plant_rig` / `peek_cell` (catch up ≤ 2 ticks, apply, write Secrets + the player's own
  Peek only; refused = error), `finish` (anyone with a result; a player may abort an unstarted
  match after ~60 s; publishes the seed + all 3 phases' rigs and peeks in the Match, then commit +
  undelegate Match/Secrets/Peek×2 with the `settle_action` Magic Action), `settle` (permissionless
  fallback), `close_match` (rent back to the creator).
- `tests-magicsvm/tests/endgame.rs`, all pass: rig refused on gold / cell 9 / stranger / the
  opponent's Peek / twice / during play; peek refused in the plant / on a revealed cell (and
  that keeps the peek) / twice; each Peek readable only by its burner; a 0.1 SOL KO match paid
  out by the Magic Action exactly (winner +0.195, loser 0, treasury +0.005), seed + history
  published, second settle and second finish refused; fallback settle pays once; abort refunds
  both; a free match settles and closes.
- `@lil-dudes/sim-wasm`: `deals_for(seed)`, `SimMatch.history()`, `Bot` (Warlord deciding from
  the on-chain public bytes, for headless live matches).

**Decided / CONTRACT (additions only, nothing renamed):** in `@lil-dudes/client`:
`dealsFor(seed)` → the 3 deals (`{ phase, goldCell, ops[9], hints: [side0[9], side1[9]] }`),
`decodeHistory(bytes)`, `revealOf(seed, history)` → `MatchReveal { seed, deals, history }` where
`history[phase] = { rigs: [cell|null, cell|null], peeks: [{cell, op, gold}|null, …] }`
(`rigs[s]` = the opponent cell side s rigged). `OfflineSource.reveal()` returns it (LiveSource will
too, after the match). Also exported: `decodePublic` / `toMatchView` (the on-chain state decoder).
**Suparno:** the result screen's "all 3 deals + rigs + peeks" can use `src.reveal()` now (offline).

**Blocked / risks:** MagicSVM leaves the DLP's delegation metadata on base after undelegation and
re-delegates on the next write; tests clear it (the real DLP does). Not a program issue.

## 2026-11-22 04:45 IST · Kai · M3 step 6 (tests) · [STAGE]
**Did:** M3 step 6 done; next: step 7 (devnet deploy).
- MagicSVM suite: **15 tests in 5 files, all pass** (`cargo +stable test --manifest-path
  tests-magicsvm/Cargo.toml`, ~3 min after the one-time build; needs `anchor build --ignore-keys`
  for the IDL and the `magicsvm`/`bench` feature builds, see `tests-magicsvm/tests/common/game.rs`):
  every instruction, plus refused cases: wrong signer (salt, start, set_aim, rig, peek, abort),
  double settle (after the action and after the fallback), double finish, double join, rig twice
  / on gold / during play / through the opponent's Peek, peek in the plant / on a revealed cell /
  twice, salts before the permissions, a forged VRF callback, `settle_action` without the escrow
  signature, odd stakes, a default burner, delegating an open match, closing an open match, and
  the deployed build refusing any validator but the TEE.
- `solana-mcp program_autofixer` on base.rs, tee.rs and game.rs + state.rs: no issues.

## 2026-11-22 04:30 IST · Kai · M3 step 7 (devnet deploy) · [STAGE]
**Did:** M3 step 7 done; next: step 8 (LiveSource + a headless bot-vs-bot live match on devnet).
- `lil_dudes` deployed to devnet at `4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa` (fresh deploy,
  slot 524,869,490, sig `4NTNUdwn…WXSzX`), 457,672 B (`opt-level = "z"`, sim at 3; the M2 spike
  was 475,784 B), upgrade authority = the deploy wallet `FdZL…rfbB`, built with `anchor build
  --ignore-keys` (sha256 `aa2f5ccf83cde27f…`). Default features: TEE pinned, treasury = deploy wallet.
- SOL: 9.923621481 → 7.594650761 (−2.328970720: 2.3258526 locked as program rent, ~0.003 fees).

**Blocked / risks:** an upgrade needs a full-size buffer (~2.33 SOL) next to the live program;
7.59 SOL covers one at a time (the buffer is refunded after each upgrade).

## 2026-11-22 04:50 IST · Kai · M3 step 8 (LiveSource, live devnet match) · [STAGE] [CONTRACT] [HANDOFF]
**Did:** M3 step 8 done; next: step 9 (apps/server quick-match queue + room codes).
- `packages/client/src/live/`: **`LiveSource`** (same `MatchSource`, no field changes): burner
  signs everything on the TEE (0 SOL), TEE token (challenge/login, ~25 lines, no MagicBlock TS SDK),
  raw-websocket `accountSubscribe` on Match + my Peek, 20 Hz playout ~3 ticks behind the newest
  snapshot, events derived from state diffs (tested against the sim's own events tick by tick over
  whole matches), `set_aim` throttled to 10/s (fire and forget), rig/peek deduped. It **auto-drives
  the TEE choreography**: init_permissions → private salt + VRF request → start (crank) →
  heartbeat `advance` if the crank stalls → finish. Lobby calls (base layer): `createMatch`,
  `joinMatch`, `delegateMatch`, `cancelMatch`, `settleMatch`, `closeMatch`, `fetchMatch`, `isSettled`.
- Headless run `pnpm --filter @lil-dudes/client live` (bot vs bot through two LiveSources, WASM
  Warlord on each side, fresh 0-SOL burners), twice on devnet + devnet-tee, both ✅ end to end:

| | run 1 (0.05 SOL) | run 2 (0.1 SOL) |
|---|---|---|
| create → join → delegate | 8.1 s | 7.8 s |
| delegate → playing (perms, salts, VRF, start) | 3.8 s | 4.4 s |
| match | KO at tick 593 (side 1) | KO at tick 2,049 (side 0), all 3 phases |
| finish → paid by the Magic Action | 0.4 s, exact (+0.0975 / 0, fee 0.0025) | 0.4 s, exact (+0.195 / 0, fee 0.005) |
| Verify (seed + rigs re-derive every revealed gate) | 12 gates, 0 mismatches | 11 gates, 0 mismatches |
| snapshots / ticks, render gap p50 / p99 / max | 617 / 593, 50 / 53 / – ms | 2,092 / 2,049, 50 / 51 / 101 ms |
| cost | 0.012 SOL | 0.012 SOL |

  Proven on devnet now: a 0-SOL burner can be the crank authority (`start`) and the Magic Action's
  escrow authority (`finish`); four accounts delegate in one tx; ephemeral permissions + VRF +
  crank + commit/undelegate/action all work in the real program. Raw results:
  `packages/client/scripts/out/live-*.json`. SOL: 7.594650761 → 7.570683081 (two runs, everything
  closed and swept back).

**CONTRACT (additions only):** `LiveSource.connect({ matchId, burner, onStage?, onTx?,
delayTicks? })` → `MatchSource`; `view.status` is `'waiting'` until the match starts on the TEE.
Extras: `currentStage`, `reveal()` (after the end, same shape as `OfflineSource.reveal()`),
`latest`/`latestBytes`, `awaitFinal(base)`, `stats`, `dispose()`. Lobby functions above, plus
`baseConnection`, `STAKE_TIERS`, `newMatchId`, `teeToken`, `chain.*` (PDAs, decoders, ix builders).
New deps of `@lil-dudes/client`: `@solana/web3.js` 1.98.4, `buffer`, `tweetnacl`, `bs58`.

**Next / handoff:** **Suparno:** the one-line swap is ready: `await LiveSource.connect({ matchId,
burner })` instead of `new OfflineSource(…)`, then `subscribe`/`start` as today (README "Live
matches"). Show a waiting state while `view.status === 'waiting'` / `onStage` is `setup`. If Vite
complains about `global`, add `define: { global: 'globalThis' }`. Lobby screens: wire Room Code
to `createMatch` (share `id`) / `joinMatch`; the server queue + room-code API comes next (step 9).
Phone ws check: run any live match and watch it on the phone (the feed is the same).

## 2026-11-22 05:15 IST · Kai · M3 Live 1v1 (step 9 + summary) · [STAGE] [DECISION] [HANDOFF]
**Did:** M3 step 9 done (last step). `apps/server` (Hono, in memory, no keys, not in the trust
path): room codes (`POST /rooms {id, stake}` → 6-char code, `GET /rooms/:code`) and a quick-match
queue (`POST /queue {player, stake}` → ticket, `GET /queue/:ticket` → `{state: matched, id, role:
create|join, opponent}`), 2 tests; client helpers `createRoom`, `findRoom`, `quickMatch`,
`waitForStatus`. A third live devnet match went through the queue (`--server … --mode queue`).

**M3 result: a real 1v1 match runs on devnet + the Private ER, end to end, and settles itself.**

| What | Status / number |
|---|---|
| Program | `lil_dudes` on devnet `4QFSXrcG…9FDa`, 457,672 B, 16 instructions, TEE-pinned |
| Tests | sim 63 · sim-wasm 8 · program 3 · MagicSVM 15 (every instruction + refused cases) · client TS 12 · server 2; autofixer clean |
| Codec | 68,388 → 5,870 CU; worst tick 50.5k → 13.5k (M2 state) / 38.4k (new worst); 10 ticks per 400k crank tx |
| Live runs (bot vs bot, 0-SOL burners) | 3 / 3 ✅: KO 0.05, KO 0.1 (3 phases), timer win 0.05 (lead 649‰ → 82.45% of S); every payout exact via the Magic Action ~0.4 s after `finish`; Verify 11–15 revealed gates, 0 mismatches |
| Timings | create→delegate ~8 s; delegate→playing ~4 s (permissions, salts, VRF, start); render gap p50 50 / p99 51–53 ms |
| SOL (deploy wallet) | 9.923621481 → 7.558699241: 2.3258526 locked as program rent, ~0.003 deploy fees, 3 × 0.012 per live match (everything closed and swept back) |

**Decided:** (beyond the step entries) LiveSource auto-drives the whole TEE choreography from
both players (idempotent on-chain), so the web app only does lobby calls + `connect`/`start`;
no WASM prediction in the live feed (the 3-tick buffer already gives p99 ~52 ms); room codes and
the queue only hand out match ids and roles.

**Blocked / risks:**
- Not yet on phones or in `apps/web` (headless Node only); the phone ws rate is still unmeasured.
- Disk: 5 GB free (96%); MagicSVM's test build needs ~1 GB, `target/debug` ~5 GB.
- The bots are lopsided live (one KO was 2200:0); balance work stays in M6.
- Crank tasks are not cancelled; they run out (≤ 3,600 runs) as cheap no-ops / failed retries.
- The server keeps state in memory (one instance; a restart drops waiting players).

**Next (M4–M5 plan):**
- M4 hidden info is mostly done on-chain (Secrets/Peek privacy, VRF deals, rig, peek, re-deal,
  reveal, Verify data). Left: a privacy re-check of the real program on devnet with a second
  token (`getTransaction` / `getAccountInfo` of Secrets and the opponent's Peek, like Stage 0
  check 2), Verify screen data from `reveal()`, GOTCHA/peek UI wiring.
- M5 money + onboarding: burner top-up faucet (`POST /topup`, sponsor wallet in the server env),
  wallet sheet (withdraw), stake picker (tiers already enforced on-chain), "Settle now" button
  (`settleMatch`), on-chain bot for Play vs Bot online (or keep the bot offline: decide), deploy
  the server (Render/Vercel), close old matches automatically.

**Handoff (Suparno):** LiveSource is ready behind the same `MatchSource`: README "Live matches"
in `packages/client`. Room Code screen: creator `createMatch` → `createRoom(server, id, stake)` →
show `code`; joiner `findRoom(server, code)` → `joinMatch`; creator `waitForStatus(JOINED)` →
`delegateMatch`; both `LiveSource.connect({ matchId, burner })` → `start()`. Quick Match:
`quickMatch(server, burner.publicKey, stake)` → by `role` create or (`waitForStatus(OPEN)` then)
join, as `packages/client/scripts/live-bot-match.ts` does. Run the server with
`pnpm --filter server dev` (port 8787). Burners need devnet SOL for the base steps (stake +
~0.013 SOL rent) until the M5 faucet lands; ask me for a top-up.

## 2026-11-22 · Kai · M4/5 step 1 (privacy re-check) · [STAGE]
**Did:** M4/5 step 1 done; next: step 2 (result data from `reveal()`).
`packages/client/scripts/privacy-check.ts`: a free live match on devnet + the TEE (bots via two
LiveSources, both rig + peek every phase) while the opponent B, a third-token stranger C and a
token-less client probe A's secrets mid-match and in phase 3. **PASS, 2 runs, 0 fails**:
Secrets / A's Peek `null` on getAccountInfo, getMultipleAccounts, getProgramAccounts; 0
notifications on accountSubscribe / logsSubscribe of Secrets and the Peeks; programSubscribe only
ever shows Match; every `request_seed` / `plant_rig` / `peek_cell` / `start` is redacted for all
(even the sender, since they touch Secrets); 0 secret txs listed by getSignaturesForAddress; 0 leak
hits for salts, VRF output, rig/peek ix data, Peek bytes, secret state; no hint shown in a plant
window (rig timing gives nothing away); base Secrets untouched until `finish`. Table: TECH §4
Privacy. SOL ~0.012 per run (fees). Raw: `scripts/out/privacy-*.json`.

## 2026-11-22 · Kai · M4/5 step 2 (result data) · [STAGE] [CONTRACT]
**Did:** M4/5 step 2 done; next: step 3 (faucet).
`reveal()` now carries everything the result screen needs, same shape offline and live (README
"Result screen data"). Proven on a 0.05 SOL live devnet match (`live-11364960300607690146.json`):
`payout.paid` = the real balance deltas (23,825,000 / 74,866,250), result matches, 5 GOTCHAs all
match the published rigs, settled by the Magic Action, every tx labelled with an explorer link.
SOL 0.012 (fees). New tests: `test/reveal.test.ts` (SPEC §7 payout cases, 12 offline bot matches:
every GOTCHA = that phase's rig, `sprung` set, conservation exact).

**CONTRACT (additions only, nothing renamed):** `MatchReveal` gains optional `matchId`, `names`,
`result`, `hp`, `finalTick`, `gotchas: GotchaLog[]`, `payout: PayoutInfo`, `txs: TxRecord[]`,
`settlement: SettlementInfo`, `matchUrl`; `PhaseLog` gains `sprung: [boolean, boolean]`.
`LiveSource`: `awaitReveal(timeoutMs?)`, option `baseRpc`; after the end it tracks the settlement
itself and calls `onStage('finished', 'settled')`. New exports: `payoutOf`, `markSprung`,
`matchTxs`, `settlementOf`, `BASE_EXPLORER`, `TEE_EXPLORER`, `ACCOUNT_EXPLORER` and the types.
**Suparno:** the result screen can read `reveal().payout.why` / `.paid` / `.net` for the count-up
line, `history[p].sprung` + `gotchas` for the rig marks, `txs[].url` for explorer links, and
`settlement.state` for "Settling…" (it is `'offline'` for bot matches).

## 2026-11-22 · Kai · M4/5 step 3 (faucet) · [STAGE] [CONTRACT] [HANDOFF]
**Did:** M4/5 step 3 done; next: step 4 (online bot).
`apps/server`: `POST /topup { burner, stake? }` tops a burner up to `stake + 0.035 SOL` (create rent
~0.0153 + delegation deposits ~0.012, returned at undelegation, + fees), capped at 0.3 SOL; no-op
if it has enough. Limits (in memory): 1 per 10 min per burner, 3 per 10 min per IP
(`X-Forwarded-For` when `TRUST_PROXY=1`), 3 SOL per hour in total, one in flight per burner.
Devnet only: refuses to send unless the RPC's genesis hash is devnet's. `GET /faucet` → address,
balance, policy, spent last hour. Sponsor key from the env only (`SPONSOR_KEYPAIR_PATH` or
`SPONSOR_SECRET_KEY`, see `.env.example`), never logged. 4 new tests (fake faucet). Devnet e2e
(deploy wallet as a stand-in sponsor, swept back): 0.085 SOL in 3.0 s, second call no-op, third
refused "retry in 598 s".
**Sponsor wallet:** `8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr` (key in
`~/.config/lil-dudes/sponsor.json` on Kai's machine, mode 600, outside the repo). **Kai: fund it
with 3 SOL from the deploy wallet** (`solana transfer 8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr
3 --allow-unfunded-recipient -u devnet`): ~35 top-ups at 0.05, plus the online bot's working
capital; the deploy wallet keeps ~4.5 SOL (≥ one 2.33 SOL upgrade buffer).

**CONTRACT (addition):** `topUp(server, burner, stake?)` → `{ sent, signature?, balance, target }`
(throws "… (retry in N s)" on a limit). **Suparno:** Wallet sheet "Top up" → `topUp(server,
burner.publicKey)`; before a staked Quick Match / Room → `topUp(server, burner.publicKey, stake)`.

## 2026-11-22 · Kai · M4/5 step 4 (online bot) · [STAGE] [CONTRACT] [HANDOFF]
**Did:** M4/5 step 4 done; next: step 5 (money edges).
`apps/server/src/bot.ts`: a FREE Quick Match ticket alone for 5 s gets the server's bot. The bot
creates (pays the rent, back at close), the human only joins, the bot delegates and plays through
a server-side `LiveSource` + the WASM Warlord (public state only). Staked tickets never get the
bot, and the matched stake is min(picks) = 0 anyway. Cap 2 concurrent; the bot wallet
(`BOT_KEYPAIR_PATH`, else a fresh key per start) is funded by the sponsor (0.04 SOL float per
match); nobody joins in 60 s → `cancel_match`. `LiveSource` now aborts a match stuck in READY
(opponent never sent a salt) ~65 s in: everyone refunded (MVP §4), view `status: 'ended'`,
`result: null`. 3 new queue tests.
**Devnet e2e** (`packages/client/scripts/vs-server-bot.ts`, a fresh 0-SOL burner against a local
server): top-up 1.6 s → matched with the bot 6.7 s → joined 10.9 s → **playing 15.4 s** → KO,
settled (free) 61 s; the burner spent 10,000 lamports. **Correction to step 3:** the ~0.012 SOL
of delegation + commit per match is a real cost, not returned at undelegation (bot float 0.04 →
0.028 after one match with everything closed): each bot match costs the sponsor ~0.012 SOL.
Bot wallet (persistent key, Kai's machine): `CJbQuVNXhA2ygutqD48ucoHC3wfvawegSDTEL49Y9ogW`.

**CONTRACT (addition):** `QuickMatch.bot: boolean`. **Suparno:** Quick Match on the free tier: if
`q.bot`, show "Playing the Warlord bot" (the flow is the normal `role: 'join'` one:
`waitForStatus(OPEN)` → `joinMatch` → `LiveSource.connect`). Before joining, `topUp(server,
burner.publicKey)` so a fresh burner can pay the join fee.

## 2026-11-22 · Kai · M4/5 step 5 (money edges) · [STAGE] [DECISION] [CONTRACT]
**Did:** M4/5 step 5 done; next: step 6 (server hardening + deploy plan).
- **Program (upgraded on devnet, slot 524,984,012):** refunds nobody has to be around for.
  `cancel_match`: anyone after 20 min for an open room (refund → creator), anyone after 5 min
  for a join never delegated (both refunded); `finish` abort: anyone ~5 min (30,000 slots) after
  READY. Payees stay fixed by the Match; IDL unchanged (client untouched). MagicSVM 17/17 (2 new:
  refused before each timeout, exact refunds after). Autofixer clean.
- **Client:** `settleNow(base, payer, id, server?)` + `LiveSource.settleNow(server?)` (the "Settle
  now" button: burner pays the fee, else the server's sponsor via `POST /settle`); `withdraw(base,
  burner, to, amount?)` + pure `planWithdraw` (no 1–890,879 lamport dust left, ≥ 890,880 to a new
  address, "all" empties it); `myMatches` / `recoverMatches(base, burner)` (on app start: cancel own
  stale rooms/joins, settle, close). `settlementOf` treats a closed match as settled.
- **Server:** `POST /settle {id}` (sponsor-paid, 10 / 10 min per IP) and the **sweeper** (every
  60 s: cancel abandoned rooms/joins, abort never-started TEE matches, finish over ones, nudge a
  dead crank, settle a late Magic Action after 30 s, close paid-out matches after 10 min). The bot
  no longer closes its matches right away (the human's result screen still reads them).
- **Devnet:** sweeper e2e PASS (`apps/server/scripts/sweeper-e2e.ts`): a join never delegated and
  a delegated match with no salts, both abandoned → cancelled / aborted + closed at ~6.5 min, B got
  exactly its 2 stakes back, A stakes + rent; withdraw rules on a real burner; recoverMatches
  cancelled an open room. Regression live match (0.05, KO) on the upgraded program: exact payout,
  reveal OK. Tests: client 16, server 13.
- **SOL (deploy wallet):** 7.510728881 → 7.456424681 for the upgrade (0.0520192 extra program
  rent for the 10 KB extension, ~0.0023 fees; buffer refunded); e2e + regression ~0.036 more.

**Decided:** permissionless refunds after long timeouts (20 min / 5 min / ~5 min) instead of
player-only: safe because the payees are fixed, and it lets the sweeper clean up when everybody
left. A player's own fast paths (creator any time, 60 s, ~60 s) are unchanged.

**CONTRACT (additions):** `settleNow`, `LiveSource.settleNow`, `withdraw`, `planWithdraw`,
`RENT_EXEMPT_MIN`, `BASE_FEE`, `vaultBalance`, `myMatches`, `recoverMatches`, types
`SettleNowResult`, `WithdrawPlan`, `Recovered`.

## 2026-11-22 · Kai · M4/5 step 6 (server hardening + deploy plan) · [STAGE]
**Did:** M4/5 step 6 done (last step). `apps/server/src/guard.ts`: CORS only for `CORS_ORIGINS`
(default localhost / LAN dev origins), 240 req/min per IP (before anything else), 4 KB body cap,
JSON-only writes (415), secure headers, JSON 404/500 without stack traces, strict room-code /
ticket formats; `GET /healthz` (never limited). `apps/server/Dockerfile` + `.dockerignore` (keys
and `.env` excluded and deleted in the image) + `render.yaml` (Starter, 1 instance, secrets
`sync: false`). Docker's daemon isn't running here, so the image itself was not built; the
Dockerfile's steps were replayed in a clean copy (`pnpm install --frozen-lockfile --filter
server...` → start → `/healthz` ok, CORS / 415 / 503 / 404 as expected). 3 new tests (16).
Exact deploy steps: TECH §9 "Deploy". **Not deployed.**

## 2026-11-22 · Kai · M4–M5 back end done (summary) · [STAGE] [DECISION] [HANDOFF]
**M4 + M5 back end: done.** Hidden info is provably hidden on the real program, the result screen
has all its data, and money + onboarding work end to end on devnet.

| What | Result |
|---|---|
| Privacy re-check (real program, devnet + TEE) | **PASS**, 2 runs, 0 fails, 0 leak hits (opponent token, third token, no token; every read path + subscription; TECH §4) |
| `reveal()` (Live + Offline) | deals, rigs/peeks/`sprung`, GOTCHAs, payout + why, txs + explorer links, settlement; live 0.05 SOL match: paid = balance deltas exactly |
| Faucet `POST /topup` | 0.085 SOL in 3.0 s; limits per burner / IP / hour; devnet-only guard |
| Online bot | fresh 0-SOL burner → playing the bot in **15.4 s**; free only; ~0.012 SOL per match |
| Money edges | program upgraded (anyone-after-timeout refunds); `settleNow`, `withdraw`, `recoverMatches`; sweeper e2e PASS (abandoned join cancelled, stuck delegated match aborted + closed, exact refunds) |
| Tests | Rust 80 · MagicSVM 17 · client 16 · server 16; clippy -D warnings, fmt; autofixer clean |
| Program | `4QFSXrcG…9FDa` upgraded at slot 524,984,012 (457,760 B .so, account extended to 467,912 B) |

**SOL (deploy wallet):** 7.558699241 → 7.432407001 this session (−0.1263): upgrade 0.0543
(0.0520 now locked as program rent; buffer refunded), devnet runs ~0.072 (2 privacy, 2 live, 1 bot,
1 sweeper e2e, faucet e2e; ~0.012 per live match is the real delegation + commit cost).
**Sponsor `8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr`: 0 SOL, Kai funds 3 SOL** (step 3 entry).

**Decided:** faucet target stake + 0.035 SOL (≤ 0.3); the bot creates and the human joins (a fresh
burner needs only fees); anyone-after-timeout refunds (20 min / 5 min / ~5 min); the sweeper
closes paid-out matches after 10 min (result screens keep working); Render Starter recommended
over free (free sleeps → bot and sweeper stop).

**Risks:** server state is in memory (one instance; a restart drops the queue and resets limits);
a commit that never lands on base (Match stuck delegated after `finish`) has no program-side
recovery (never seen); the sponsor drains ~0.012 SOL per bot match plus top-ups (3 SOL ≈ 35
staked top-ups or ~80 free ones + bot matches; watch `GET /faucet`); devnet faucets for refills.

**Handoff (Suparno), exact calls** (all in `@lil-dudes/client`; `server` = the server URL):
- **First visit / Home:** on start, `recoverMatches(baseConnection(), burner)` (refunds stale matches).
- **Wallet sheet:** balance `baseConnection().getBalance(burner.publicKey)`; **Top up**
  `topUp(server, burner.publicKey)`; **Withdraw** `withdraw(base, burner, new PublicKey(addr), 'all' |
  lamports)` (show its error text: dust / new-address rules); validate first with
  `planWithdraw(balance, amount, destBalance)` to grey out the button.
- **Stake picker:** before a staked Quick Match / Room, `topUp(server, burner.publicKey, stake)`;
  grey a tier if the top-up throws a limit and the balance < stake + 0.035 SOL.
- **Quick Match (free):** `quickMatch(...)` may return `bot: true` after ~5 s → "Playing the
  Warlord bot"; flow is the normal `role: 'join'` one. `topUp(server, burner.publicKey)` first.
- **Waiting:** `LiveSource` `onStage('setup', 'opponent never showed: aborting (refund)')` → show
  "Opponent didn't show, refunded"; then `view.status === 'ended'` with `result === null`.
- **Result:** `await src.awaitReveal()` (or `src.reveal()` + `onStage('finished','settled')`):
  `payout.why` / `paid` / `net` for the count-up line, `deals` + `history[p].rigs/peeks/sprung` +
  `gotchas` for the full reveal, `txs[].url` + `matchUrl` for explorer links. If
  `settlement.state === 'pending'` 20 s after the end → **Settle now** button →
  `await src.settleNow(server)`.
- **Offline (bot) result:** `new OfflineSource(...).reveal()` has the same shape (`settlement:
  'offline'`, `txs: []`).
- **Server URL:** local `http://<laptop-ip>:8787` (`pnpm --filter server start`); deployed URL after
  Kai runs TECH §9 "Deploy".

## 2026-11-22 · Kai · sponsor funded · [STAGE]
**Did:** the sponsor wallet `8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr` is funded with **3 SOL** from
the deploy wallet (now 4.432 SOL, still above the ~2.33 SOL upgrade buffer). This replaces the
"sponsor at 0 SOL, Kai funds 3 SOL" line in the M4-M5 summary: the faucet, online bot and sweeper
can run locally (`pnpm --filter server start`, key paths in the gitignored `apps/server/.env`).
**Left:** deploy the server (TECH §9 "Deploy", not done), then Suparno wires `apps/web` per the
last [HANDOFF].
## 2026-11-21 20:01 IST · Suparno · planning · [DECISION] [HANDOFF]
**Did:**
- Read IDEA/SPEC/TECH/this log. Started the front-end track on branch `planning/initial-build-plan`.
- Checked the hackathon pages: no deadline is published (Luma or submit site). The submit form asks for
  an "Explorer link (integration proof)" and optional program address, and says "We check recent devnet
  and mainnet activity". Real devnet matches on our program count.

**Decided:**
- The docs (IDEA/SPEC/TECH) are the source of truth for the game. Confirmed as-is: Rig (free, once per
  phase), HP + KO/timer, margin payout, all unrevealed gates private, PWA only (no APK).
- Spectator betting: cut (roadmap line only). Spectator view stays a stretch goal.
- Calendar: code freeze end of **Wed Nov 26 IST**; Nov 27 = demo video, README, submit. Will confirm
  the real deadline in the Telegram Builders group.
- Suparno works the front-end track now against a mock `MatchView` and does not wait for the back end.

**Blocked / risks:** none for the front end.

**Next / handoff:** **Kai, one question: should Double-or-Toll (SPEC §8) be cut from the MVP entirely?**
If yes, escrow per player becomes S instead of 2S (SPEC §7). Suparno is unsure. For cutting: a mid-match
handshake + timer + UI, and little demo value. It touches your settle/escrow code, so it's your call.
Reply with an entry here.

## 2026-11-21 20:35 IST · Suparno · web · [DECISION] [HANDOFF]
**Did:**
- Branch renamed to `web/arena-prototype` (all front-end work goes here; nothing to `main`).
- pnpm workspace root (`package.json` with `packageManager: pnpm@10.34.9`, `pnpm-workspace.yaml` for
  `apps/*` + `packages/*`). Cargo workspace, `programs/`, `crates/`, `packages/client` untouched (Kai's).
- `apps/web`: Vite 8 + React 19.3 + TS 5.9 + three 0.187 + R3F 9 + drei 10 + zustand 5 + vite-plugin-pwa 2.
  Screens: Home (stake picker, Play vs Bot; Quick Match / Room Code disabled), Match (static arena from
  code shapes: lane, 2×3×3 `?` gates, clash zone, both cannons, drag to slide your cannon, HUD
  placeholders), Result (stub). `?screen=match` opens a screen directly. `public/assets/CREDITS.md` started.
- `pnpm --filter web build` passes (typecheck + build). Checked on PC only; phone testing comes later.

**Decided:**
- **No TypeScript game sim on the front end.** The arena will be driven by Kai's sim / `MatchView` once it
  exists. Until then the front end works on look, screens and anything that needs no game state.
- Website = the app itself (Home → Match → Result), no separate marketing site.
- Art: code-built shapes now; licence-free (CC0) assets later, every one logged in `CREDITS.md`.
  Suparno won't model anything.
- PC browser first, phone later.

**Blocked / risks (waiting on Kai):**
- **`MatchView` v0 type + a way to get it in the browser** (mock feed or the sim compiled to WASM). Until
  then crowds, gate reveals, HP, timer and Rig/Peek UI can't show real state.
- **Double-or-Toll cut or keep?** (question in the entry above.)
- Deploy wallet still has 0 devnet SOL (from Kai's earlier entry).
- Toolchain note: Suparno's machine is on Node 22.19 (TECH says ≥24) and runs pnpm via `corepack pnpm`.
  Vite 8 is fine on Node 22.12+.

**Next / handoff:** Kai: when `MatchView` v0 is ready, log it with `CONTRACT` and say how the web app
should consume it (import path, a mock emitter, or WASM). Suparno continues the front end.

## 2026-11-21 20:58 IST · Suparno · web · [DECISION]
**Did:**
- **Visual model** `apps/web/src/arena/frame.ts` (`ArenaState`): what the renderer reads (cohorts as
  count + normalised x + progress p, 2×9 gate views with hint/revealed, HP, cannon x, events). It is
  front-end only, **not** a proposal for `MatchView`; a small adapter will map `MatchView` into it.
- **Showcase** `apps/web/src/showcase/showcase.ts`: a scripted ~26 s loop (fixed board, scripted cannons,
  both GOTCHAs in the first second, KO + slow-mo, restart) that fills `ArenaState`. Not the game sim: no
  deals, phases, Rig/Peek choices, hidden info, bot or payout. Your cannon follows your drag.
- Arena: instanced crowds (cap 1,500/side, sub-linear units for big counts), one count badge per column
  on the leading group, gates with hint colours / reveal flip / gold / rigged, number pops, camera shake,
  GOTCHA + K.O. overlays, synthesised sound (WebAudio, no audio files), bright toy palette, Lilita One
  font (OFL, credited). Home has the showcase looping behind the menu; Result shows **sample** data:
  payout + why (SPEC §7 integer maths), all 3 deals revealed with rigs/peeks/gold, Verify + explorer
  links (disabled until the chain exists).
- Bot matches are labelled free; the stake picker sits only under Quick Match / Room Code (SPEC §9).
- Dev params: `?screen=match|result`, `?t=12` fast-forwards the showcase.

**Decided:** Asset survey (all CC0, verify formats on download): units → Quaternius *Cube World Kit*
(glTF) or Kenney *Blocky Characters*; arena dressing → Quaternius *Stylized Nature MegaKit* (glTF);
gates stay code-built; no good bright cannon pack found yet (Quaternius turrets are steampunk, FBX only).

**Blocked / risks:** same as before (MatchView v0, Double-or-Toll answer, deploy SOL). Bundle is ~1.1 MB
(three.js); code-split later.

**Next / handoff:** none for Kai beyond the open questions above.

## 2026-11-21 21:55 IST · Suparno · web · [DECISION] [HANDOFF]
**Did:**
- Rebased `web/arena-prototype` onto `main` (all merges are **rebase merges** from now on, linear history).
  Took main's root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`; kept the `dev-dist/` ignore line.
- `apps/web` now depends on `@lil-dudes/client` and extends `tsconfig.base.json`. **The arena is driven by
  `MockSource`** through a small `MatchFeed` (`apps/web/src/match/feed.ts`): keeps the last two 20 Hz
  snapshots and renders one tick behind (interpolated), predicts your cannon locally, fans out events.
  Swapping to `OfflineSource`/`LiveSource` is one line in `screens/Match.tsx`.
- **Removed** my scripted showcase and private visual model (superseded by MockSource and SPEC v2.1;
  ignore my two earlier web entries' notes about them).
- Brought the client in line with SPEC v2.1 / TECH §5 / MVP §3: static camera pitch 44° FOV 30° showing the
  whole lane (your cannon ~77% down, bottom ~20% free), geometry from `constants.ts` (rows 1500/2500/3500,
  gates 75% wide with gaps, clash zone 3600–8400), you blue / them red, **no per-cohort badges** (per-side
  totals in the top bar), HP labels on the cannons (`2.2K`, ticking smoothly), top bar ≤ 8% (you | timer,
  stake, phase pips | them), relative drag, plant prompt + tap-to-rig, peek button (one per phase) with
  private markers, GOTCHA / SURGE / K.O. overlays, shake only on hits to you (≤ 1 per 0.5 s) and KO,
  Result from the real `MatchResult` (count-up, why-line, Rematch/Verify after ~1.8 s), Home = big Play vs
  Bot + PvP stakes + How to play, with a silent mock match looping behind.
- `pnpm --filter web build` passes (typecheck + build). Checked on PC via headless screenshots only.

**Decided:**
- The lane is **drawn 1.5× wider than its sim proportions** (sim 3000 × 12000 is 1:4; drawn 18 × 48 world
  units). At true proportions under the 44°/30° camera the lane filled only ~55% of a portrait screen near
  you and ~37% far away. Visual only; no rule changes.

**Blocked / risks:**
- Result reveal of all 3 deals uses **sample boards**: `MatchView` only carries the current deal.

**Next / handoff:** **Kai:** (1) is drawing the lane wider than the sim OK, or do you want to change
`LANE_WIDTH`/`LANE_LENGTH` instead? (2) For the Result screen's full reveal, can the contract expose every
deal's final board + both rigs + my peeks at match end (e.g. `MatchResult.deals`)? Suparno next: clash front
+ pour + launch ease, then the MVP §5 OPEN art items.

## 2026-11-22 13:25 IST · Suparno · design v3 · [DECISION] [HANDOFF]
**Did:** Re-studied the genre (private research in `pvt-docs/`): its fights are **player vs base**
(a tower at the top releases waves; gates multiply your dudes; an enemy reaching your cannon line
loses; the finale is a loot raid on the base), and its "PvP" is async raids. Wrote **SPEC v3
(PROPOSED)** in `docs/SPEC.md`, replacing v2.1.

**Decided (Suparno):**
- **1v1 race against the same base**: each player plays an **identical copy** of one level (same
  layout, gate values, wave schedule). Players never fight each other. Each screen shows your lane
  full size + a small live view of the opponent.
- Level = 3 stages: Fight 1 (one tower), Fight 2 (two towers), Raid (vault). Each player advances at
  their own pace. Towers release waves on the genre's big/small/medium cycle (6.5/6.5/4 s) with the
  genre's fatigue (15 s → 45 s), but **no adaptive difficulty** (unfair in an identical-copies race).
- **Death = an enemy reaches your cannon line → the other player takes the whole pot.**
- Both survive → the pot is **split in the ratio of gold earned** (gold: 1 per tower damage point,
  50 per tower destroyed, 2 per dude reaching the vault in the raid). 5% fee on the money moved.
- Hidden `?` gate values (VRF, identical copies) stay. Gates follow the genre: **sparse rows** (1–2
  gates, open lane), **sliding rows**, **big gates behind crates**, multiplier values from the genre's
  distribution. A pool of **6 hand-designed layouts**, VRF picks one; more designs later.
- **Rig (once per stage, in your plant): trap one gate on the opponent's copy** of the stage they're
  in (÷2 after GOTCHA). **Peek** once per stage on your own copy.
- All merges are rebase merges (linear history).

**Interpretations to confirm (Suparno + Kai):** "take in ratio of gold" = proportional split of the
pot (SPEC §8); raid length 8 s (genre-measured) instead of 3 s; ÷2 trap for the MVP.

**Blocked / risks:** this replaces the rules underneath M1–M5. The chain plumbing (TEE, permissions,
VRF, crank, settle action, lobby, faucet, LiveSource transport) carries over; the rules engine,
Match/Secrets layout, codec, payout, bot and their tests change. Code freeze is Nov 26.

**Next / handoff:** Suparno (with Claude) implements v3 on `web/arena-prototype`: `crates/sim` v3 +
WASM, `packages/client` contract, program compile, `apps/web`; each step logged here. **Kai: please
read SPEC v3 and reply here (agree / amend)** before merging. The program redeploy + MagicSVM run
need your machine (Solana toolchain + devnet SOL).

## 2026-11-22 14:00 IST · Suparno · sim v3 · [STAGE] [CONTRACT]
**Did:** `crates/sim` rewritten to SPEC v3 (21 commits, `RULES_VERSION` 3, codec v2), WASM rebuilt.
- Six hand-designed layouts in `crates/sim/src/layouts.rs` (Twin Lanes, Conveyor, Long Shot, Funnel,
  Zigzag, Stairway): sparse rows, ≥1 sliding row and ≥1 crate-locked big gate each, tower HP / wave size
  tuned per layout. VRF seed picks the layout (`seed % 6`, public once seeded).
- Per-side stages (Plant → Fight → Transit → … → Raid → Done), waves with the genre cycle + fatigue,
  homing, clash, crates, tower hits + gold, raid loot, death, payout `(stake, dead, gold)`.
- Codec: public **1,470 B** (was 1,046), secret **56 B** (was 85), history **24 B** (was 30); seed first
  and history last in the secret part, aim offset unchanged.
- Tests: 71 lib + determinism + fuzz (1,204 seeds) + golden per layout + settle parity (3,013 vectors,
  `tools/balance/settle_fuzz.py` rewritten for v3); sim-wasm 9; clippy -D warnings + fmt clean.
- Balance (2,000 bot-vs-bot per layout): **deaths 14.7%**, **avg match 91 s** (fights ~30 s / ~35 s,
  raid ~14 s), raid = 35% of gold, avg payout 15.9% of S, 0.5% hit the 3:00 cap.
- Implementation decisions are in SPEC v3 as **(impl)** lines.

**Decided:** see the (impl) lines; notably the trap is ÷2 from the moment it's planted, a rig can't land on
a revealed gate, and the Peek account keeps its 48-byte size with repurposed fields (stage, rig stage/slot,
peek stage/slot/op).

**Blocked / risks (design, for Suparno + Kai):**
- Two equal players who both clear both fights earn the **same tower gold**, so the raid alone separates
  them (bots tie on gold ~58% of the time). Humans won't play identically, but it's a design question.
- **Finishing faster earns nothing** unless the opponent hits the 3:00 cap (as the SPEC is written).
  Candidate fix: a time bonus, or let the faster player's raid start the opponent's countdown.
- The bot never breaks crates (it only values a big gate once its crate is broken), so big gates are unused in
  the bot numbers.

**Next / handoff:** program port (compile-checked here; Kai builds/redeploys/runs MagicSVM) and client
port are in progress; then `apps/web` on v3.

## 2026-11-22 14:16 IST · Suparno · program v3 · [CONTRACT] [HANDOFF]
**Did:** `programs/lil_dudes` ported to the v3 sim (13 commits). **No instruction changed** (names,
accounts, args): `plant_rig(cell)` / `peek_cell(cell)` keep their arg, which is now a **gate slot**.
- Accounts: **Match 1,792 B** (unchanged up to 288; `gotcha` 288..296 now [tick lo, tick hi, slot,
  rigged_by]; `history` 296..320 = 24 B; `_pad` 2; public state 322..1792), **Secrets 168 B** (state
  112..168), **Peek 56 B** (side 48, then stage, rig_stage, rig_slot, peek_stage, peek_slot, peek_op, pad).
  All pinned by `offset_of!` asserts. `CRANK_ITERATIONS` 5,400 (MATCH_TICKS 3,600).
- Rig/peek validated by the sim's v3 rules (own plant / own fight-or-raid). Peeks refreshed from the private
  view after each rig/peek and at finish; **`advance` can't write Peeks** (it would change the IDL), so a Peek
  stays stale across a stage change until the owner's next rig/peek or finish: clients treat
  `Peek.stage != public stage` as "nothing this stage".
- Settle uses the v3 payout stored by the sim. **CONTRACT:** `packages/client/src/idl/lil_dudes.json` edited by
  hand for the account layouts + refusal messages; checked against Anchor's IDL generator (types, errors,
  accounts identical; instructions only differ by the PDA seeds `anchor build` adds, as before).
- MagicSVM tests ported to v3 and **compile**; not run (no SBF toolchain here). TECH §4 updated, unverified
  facts marked ⚠️. Host checks: check (3 feature sets), clippy -D warnings, fmt, `cargo test -p lil_dudes` (4).

**Blocked / risks:** nothing is built as SBF, deployed or run in MagicSVM yet. Runtime-uncertain tests:
`endgame::rig_and_peek_follow_the_v3_rules_and_stay_private` (edits Match bytes on the rollup to show a gate
face-up), `endgame::finish_publishes_...` (expects a GOTCHA on the gate B fires through), `tee::match_runs_to_the_end`
(manual advance cap raised to 600).

**Next / handoff:** **Kai:** `anchor build` (IDL should match the committed JSON), the magicsvm + bench feature
builds, the full MagicSVM suite + `--test bench -- --nocapture` (confirm catch-up caps 8/2 still fit; `finish` now
also decodes once), redeploy to devnet, re-run the privacy check (account sizes 1,792 / 168 / 56).

## 2026-11-22 16:03 IST · Suparno · client + web v3 · [CONTRACT] [STAGE]
**Did:**
- `packages/client` ported to v3 (28 commits): constants + `LAYOUTS` mirrored from Rust (tested), `OfflineSource`
  decodes the v3 view/events/private view into `MatchView` v3 (`types.ts`), new option **`selfBot`** (bot plays
  my side too), `MockSource` = bot-vs-bot on the real rules (fixed seeds), codec v2 decoder (on-chain bytes ==
  offline view at every tick of 4 matches), v3 `dealsFor` / history / `reveal()` / `payoutOf` (death or gold
  ratio, plain-English `why`), LiveSource: Peek v3 decode (stale stage = nothing this stage), events derived from
  state diffs (checked against the sim's own events over 7 matches), rig/peek by slot in my own phases.
  Server bot drives the v3 `Bot`. Tests: client 21/21, server 16/16, smoke = a full v3 match headless.
- `apps/web` on v3 (12 commits): your lane full size (base + towers with HP labels, crates with counters, gate
  pool incl. sliding and crate-locked big gates, your dudes vs the base's troops, cannon line), opponent
  **mini-view** (2D canvas; during your plant it enlarges and you tap a gate there to rig it), top bar with gold +
  stage pips, stage/RAID/TOWER DOWN banners, GOTCHA, peek, result with gold and the ratio/death line. Home
  background = bot-vs-bot. Dev params: `?screen=match&autoplay=1&seed=N`.
- Whole-branch check: sim / sim-wasm / program tests, clippy -D warnings, fmt, MagicSVM compile, client
  typecheck + tests + smoke, server typecheck + tests, web build: **all pass**.

**Decided:** payout rounding follows the sim (the winner always gets `floor(S·(gw−gl)/(gw+gl))`, floors favour
the loser). `MatchResult.died` is null when nobody died or both died on the same tick (lanes' phase tells them apart).

**Blocked / risks:** live paths (LiveSource feed, Match/Peek decoders on real accounts, live scripts) compile but
weren't run (no devnet here). Live event derivation approximates two cases (a merged wave shows as a count
increase; a feed gap across a stage change loses that stage's last reveals). Web checked on PC via headless
screenshots only; the result screen's full per-stage reveal (`reveal()`) isn't wired into the UI yet.

**Next / handoff:** PR `web/arena-prototype` → `main` (rebase merge) once Kai has reviewed SPEC v3. **Kai:** the
build/redeploy/MagicSVM/bench/privacy runs in the program entry above, then a live v3 devnet match.

## 2026-11-22 19:45 IST · Suparno · rules v4 (sim, program, client, server, web) + art decisions · [DECISION] [CONTRACT] [HANDOFF]
**Did:**
- **Rules v4** (`docs/SPEC.md` v4, `crates/sim`, WASM pkg rebuilt): two stages. Fight 2 has the **town hall**
  behind its towers; when the last tower falls the raid starts **in place** (no wipe, no plant): the mob
  rolls on into the hall, the cannon fires 8 s more (`raid_ticks`), loot as before. Gate edges count
  (`GATE_GRACE` 100, nearest centre wins, crates too); big gates 700 → 1000 wide, layouts re-authored,
  `wave_base` retuned. **Rig from your own lane**: any phase, once per stage, a slot of *your* current
  stage rigs the opponent's copy of it (refused if they passed that stage or opened that gate);
  `can_rig` in the sim/WASM. Bot rigs 1–3 s into each fight. Balance (2,000 bot matches per layout):
  deaths 14.5%, avg match 74.8 s (was 91 s), raid ≈ 55% of gold, gold ties 47.5%.
- **Program** (`programs/lil_dudes`): Match still 1,792 B; history 16 B at 296; `_pad` 6; **state at
  318** (was 322). Secrets 152 B (state at 112). Peek unchanged. `plant_rig` docs/RigRefused message
  follow the any-phase rule (no instruction/IDL name changes). IDL JSON layouts updated. MagicSVM rig
  tests flipped + a new "rig ahead but not behind" test. TECH.md sizes updated.
- **CONTRACT, `packages/client`**: `STAGES` 2, `FINAL_STAGE` (replaces `RAID_STAGE`), `GATE_GRACE`,
  `HALL_X`; `LaneView.raidTicks`; `phaseTick` keeps counting into the raid; new
  `MatchSource.canRig(slot)` (Offline → `sim.can_rig`, Live → `can_rig_bytes`, Mock → false);
  `rig(slot)` = a slot of MY stage, any phase; codec v3 (PUBLIC_LEN 1,474), `STATE_OFFSET` 318,
  `SECRETS_LEN` 152, history 16; `covers` / `gateAt` helpers. Server bot exports `botTurn`.
- **Web**: town hall model (shakes and counts loot), crowds drawn as a narrow column (what touches a
  gate goes through it), 😈 Rig button + tap your own gate (red pulse on valid gates, red frame on the
  one you rigged), mini-map view only, raid countdown, `?speed=N` for test runs. `docs/ART.md`: glow-up
  plan, asset sources and the **art decisions** table.

**Decided:** (Suparno) town hall finale in Fight 2 instead of a separate raid stage; rig from your own
lane; big gates visibly bigger; art picks in `docs/ART.md` (Kenney Mini Characters / villains, Blaster
Kit cannon, Tower Defense towers, Fantasy Town hall, KayKit Block Bits crates, Nature Kit, Kenney
particles, glass gates and chunky CSS in code, Lilita One + Baloo 2, "candy platformer" lighting).
Sound effects and music still open.

**Blocked / risks:** Not verified here (no SBF toolchain/devnet; the MagicSVM test binaries also fail to
link with the mingw toolchain on this machine, same as before these changes): anchor/SBF build, MagicSVM
run, compute re-bench (the raid in place may raise worst-case tick cost), redeploy (Secrets shrank, so v3
accounts are unreadable by v4), live devnet scripts. Bots still tie on gold often (47.5%; Zigzag/Stairway
84–88%); leftover enemies are cleared when a lane finishes (you can't die after your last loot).

**Next / handoff:** Kai: please review SPEC v4 §3/§6 and the program diff, then SBF build, MagicSVM run,
bench and redeploy. Suparno/Claude: start the glow-up (lighting and materials first, then the picked packs).

## 2026-11-22 22:30 IST · Suparno · web glow-up (models, look, sound) · [DECISION]
**Did:**
- **Models** (`apps/web/src/arena/{Crowds,Base,Cannon,Scenery}.tsx`, `arena/models/`, `public/assets/models/*.glb`, 668 KB):
  Kenney Mini Characters knight (our dudes, team blue) and robot (base troops, team red), ~400 tris each,
  one InstancedMesh per team with a cheap hop/waddle; Blaster Kit launcher on a Tower Defense base as the
  cannon; Tower Defense towers (flash on hit, sink at 0 hp); a two-storey town hall assembled from the
  Fantasy Town Kit (door glows in the raid); Blaster Kit crates (placeholder for KayKit Block Bits);
  ~600 seeded Nature Kit props around the lane in one static mesh. Team colours repaint swatches of the
  shared colormaps from `PALETTE` at load (no extra PNGs). Rebuild script in `arena/models/tools/`.
- **Look** (`Arena.tsx`, `Post.tsx`, `quality.ts`, `Gates.tsx`, `glass.ts`, `Fx.tsx`, `particles.ts`,
  `styles.css`): candy daylight with soft shadows, gradient sky, striped lawn, tiled lane, candy-cane
  kerbs; HDR bloom/vignette on capable devices (`?fx=low|high` to force); glowing glass gates in a
  shader (exact `g.width*SX`; rig frame and GOTCHA crack in the shader); pooled particles from a 28 KB
  atlas (Kenney Particle Pack + our puffs/coins); chunky candy CSS for home, HUD, buttons and result;
  Baloo 2 self-hosted. New dependency: `postprocessing` 6.39.6 (+25 KB gzip).
- **Sound** (`feel/sound.ts`, `public/assets/sfx/`): 26 Kenney recordings replace the synth (shots,
  gates, clash, waves, tower hit/down, crates, loot coins, GOTCHA, fight bell, raid, win/lose, clicks);
  variants, pitch spread and voice caps. API unchanged plus new cues.
- PWA precaches models, fonts, effects and sounds (42 files, 2.6 MB). Drawn cannon follows a bot-driven
  aim (autoplay/home). Credits logged in `apps/web/public/assets/CREDITS.md`.

**Decided:** (Suparno) Kenney sound effects are fine; well-known stock music rejected as too
recognisable. Music still open (CC0 shortlist on Suparno's picks page). Crates stay on the Kenney
placeholder until the KayKit Block Bits zip is downloaded by hand.

**Blocked / risks:** Nobody has listened to the sound yet, or played on a real phone (perf tiers are
guesses: low tier = ≤4 cores or ≤2 GB). The first frames stall while GLBs load and the offline match
keeps ticking; consider starting the match once assets are ready. No outline pass (pass budget).

**Next / handoff:** Suparno: listen and play on a phone; pick music. Claude: start the match after
assets load, music once picked, KayKit crates when available. Kai: nothing needed for the glow-up
(no `packages/client` changes).

## 2026-11-23 08:50 IST · Kai · rules v5 agreed · [DECISION] [HANDOFF]
**Decided (Kai):** rules v5 = changes on top of Suparno's v4, written in `docs/SPEC_V5.md` (and linked from the top of
`docs/SPEC.md`). In short:
- **Rig removed. Opponent mini-lane removed** → a thin progress line (their stage, tower HP bar, score).
- **End of Fight 2 = BREACH → 3.5 s Rush** (`RUSH_TICKS` 70) instead of the 8 s raid; whatever is still on the lane
  when it ends is counted (2 per dude). No mini-rush after Fight 1.
- **Gates:** hidden ×2–×5, ÷2/÷3, +N/−N (± only from row 2, sized to the row), big ×6–×10 behind crates, plus **one
  timing gate per stage** (visible, cycles ×1→×5 one step per second by phase tick).
- **Champion** (meter = 160 fight ticks, a cohort worth 8 that multiplies through gates, new `champion()` ix) +
  **Scout** (= Peek, unchanged). Same for both players.
- **Score** = v4 gold + **FIRST +50** per fight (lower breach tick) + Rush count. No time bonus.
- **Payout (both survive):** winner keeps own stake + takes `2 × margin` of the loser's stake (margin = (w−l)/(w+l),
  no cap); 5% fee on what moves. Death: survivor takes the pot.
- **Screens:** VS screen with the real chain steps as loading copy, tutorial bubbles in the first bot match, BREACH →
  3-2-1 end sequence, scripted result with the payout counting up, Rematch, Verify, no pause in PvP. Layout rules
  (gates further down the lane, at most one locked big gate) are in SPEC_V5 §3b.

**Next / handoff:**
- **Suparno:** please read `docs/SPEC_V5.md`. Stop work on the rig button and the mini-lane.
  - Must: VS screen, end sequence, result ceremony, progress line.
  - Should: tutorial bubbles, logo wipe, sound pass.
  - Tiers are in §10.
- **Kai:** sim v5 → program v5 → one deploy.

## 2026-11-23 · Suparno · web v5 front end (HUD, end sequence, flow, result, sound) · [DECISION] [HANDOFF]
**Did:** (branch `web/v5-flow`, plan in `docs/FRONTEND_V5.md`)
- **Match HUD:** rig removed (button, mode, gate frame, taps, GOTCHA overlay); opponent mini-lane replaced by a
  progress line (their stage, tower HP %, score); your score big in the top bar, slim timer, cog menu (sound,
  vibration, leave/forfeit with confirm, no pause); Scout (= peek) renamed; danger pulse when enemies pass 25% of
  the lane; the match starts only once the models have loaded.
- **End sequence:** BREACH! stamp → 3-2-1 gradient numerals synced to the raid/Rush clock with a live hall counter
  → TIME!; OVERRUN! / THEY FELL! stamps; battle sounds ducked from the breach. Score parts (damage, towers, FIRST,
  Rush) tallied per side from events for the result.
- **Flow:** screens home → VS → match → result with a logo wipe; one primary button on Home (PLAY VS BOT, or
  QUICK MATCH + Room Code on a paid chip, staked play unlocks after the first bot match); stake confirm sheet;
  VS screen (You vs Bot, or the real chain steps for staked play); scripted result (parts count up, payout bar,
  +SOL pill with coins, fee, Rematch/Home, Verify links, "New record!"); first-match tutorial bubbles with
  gentler Fight 1 waves (the sim's tutorial option). A bot is always labelled "Bot".
- **Sound:** 16 new cues (breach, countdown, ladder, payout, VS, wipe, play button, danger, Champion), battle /
  ui / music buses with ducking, haptics on big moments, music by screen. Music picked by Suparno (all CC0):
  "Pixel Sprinter" (match) and "Flowerbed Fields" (menu) by Zane Little Music, "Victory" by celestialghost8,
  "Game over short jingle" by Kosmo The Cat. Credits logged.

**Decided:** (Suparno) keep the Kenney look for this pass; music as above.

**Blocked / risks:** Waits on Kai's client v5: Champion data (`champMeter`, `champion()`; the button is built and
hidden until then), `RUSH_TICKS` / `rushTicks` (the end sequence falls back to the v4 raid clock), FIRST events,
the timing gate and ± / ÷3 gate ops, the v5 payout, and LiveSource for Quick Match / Room Code. When the client
drops the `gotcha` event, `apps/web/src/arena/Fx.tsx` needs its gotcha branch removed. Not yet heard on speakers or
played on a phone.

**Next / handoff:** Kai: client v5 exports `RUSH_TICKS`, `CHAMP_TICKS`, `LaneView.rushTicks`, `champMeter`,
`champPending`, `MatchSource.champion()`, and a FIRST event or field; the web picks them up by name.
Suparno/Claude: timing-gate ring and new gate labels once the ops exist; LiveSource wiring.
