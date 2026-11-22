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
