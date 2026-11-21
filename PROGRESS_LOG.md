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
