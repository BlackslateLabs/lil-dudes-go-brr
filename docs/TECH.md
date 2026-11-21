# Lil Dudes Go Brr: Technical Design

Status: **PROPOSED, confirm before scaffolding.** Updated 2026-11-21. Game rules: [SPEC.md](SPEC.md).
Facts marked ✅ were checked against MagicBlock docs, MagicBlock's example repo, or live devnet on
2026-11-21; ⚠️ = unverified, to be proven in Stage 0.

## 1. Decisions

| Area | Choice | Why |
|---|---|---|
| Platform | **Web app (PWA)**, phone-first, works on desktop | Judges click a link. No install, no app store. |
| Game client | **TypeScript + Vite + React 19**, arena in **Three.js via @react-three/fiber + drei** | Wallet and MagicBlock SDKs are JS. Crowds = `InstancedMesh` (hundreds of units, cheap). AI agents are strongest here. Low-poly glTF assets drop in. |
| Not Godot | — | Godot 4 web export is GDScript-only (no C#), every chain call goes through a JS bridge, the download is big, and it is weak on iOS Safari. |
| Not Unity | — | MagicBlock has a Unity SDK, but WebGL builds are heavy, iteration is slow, and agents are weaker. |
| Program | **Anchor 1.0.2**, one program `lil_dudes`, `ephemeral-rollups-sdk = 0.18.x` features `anchor, vrf, access-control, crank` | Matches MagicBlock's current examples; 0.20 is the validator-2.0 line (`#[vrf]` broken there). |
| Shared sim | **`crates/sim`**: pure Rust, integer-only, deterministic, no Solana deps | Same code runs in the program, native tests, the balance runner, and later WASM (Verify replay). |
| Chain client (TS) | **@solana/web3.js 1.x + @coral-xyz/anchor 0.32.1 + @magicblock-labs/ephemeral-rollups-sdk 0.18.0** + wallet-adapter | ✅ The exact stack of MagicBlock's Rock-Paper-Scissors app (PER + burner + bot + stakes), and it works against Anchor 1.0.2 programs. `@solana/kit` 8 + `ephemeral-rollups-kit` 0.18.0 is the later migration, not now. |
| Rollup | **Private Ephemeral Rollup (TEE)**, `devnet-tee.magicblock.app` | Hidden `?` values, rigs and peeks need private accounts. ✅ TEE ER, VRF oracle and pricing oracle report live; ✅ slots measured at ~10 ms. |
| Player keys | **Per-device burner keypair** (localStorage) as the playing identity; Phantom only to top up / withdraw | ✅ RPS example pattern: no wallet popups ever during play; TEE auth token signed by the burner. |
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
| `LiveSource` | the chain feed (TEE websocket) + WASM prediction | M3 |

The web app only talks to `MatchSource` (`subscribe(view => …)`, `setAim(x)`, `rig(cell)`,
`peek(cell)`), so moving from mock → offline → live is a one-line change, with no rendering rewrite.
**The WASM build is committed prebuilt**, so front-end work needs only Node + pnpm, never Rust. Kai
rebuilds it whenever the sim changes. Any change to `MatchView`, `MatchSource` or the constants needs a
PROGRESS_LOG entry tagged `CONTRACT`.

## 4. On-chain model

### Accounts

| Account | Layer | Visibility | Approx size | Holds |
|---|---|---|---|---|
| `Config` | base | public | ~100 B | admin, treasury, fee bps, toll bps |
| `Vault` (per match) | base | public | 0 data (SOL) | both stakes until settle |
| `Match` (per match) | delegated → TEE | **public** | ~1.3 KB (alloc 1,536) | players, burner keys, bot flag, tutorial flag, stake, status, `start_slot`, `last_tick`, phase, HP×2, cannon x×2 + aim×2, cohorts 2×40×10 B (`count u32, x i16, y i16, age u8, last_row u8`), gate view 2×9 (hint, revealed op/val), rig/peek counters, double state, winner |
| `Secrets` (per match) | delegated → TEE | **private, no readers** until the end | ~128 B | VRF seed, true gate values for the current deal, active rig per side |
| `Peek` (per player) | delegated → TEE | **private, member = that player's burner** | ~32 B | last peek result |

All far under the 10,240 B commit limit ✅. Commit **once** at the end (commit + undelegate), so the
10-commit nonce limit and the per-commit fees don't matter ✅.

### Instructions

- **Base:** `init_config`, `create_match(id, stake, burner, vs_bot)`, `join_match(burner)`,
  `delegate_match` (Match, Secrets, Peek×2 → TEE validator), `cancel_match` (refund if nobody joined),
  `settle` (`#[action]` target of the Magic Action; **also callable by anyone** after undelegate as the
  fallback, since a failed action drops every action in the bundle ✅).
- **ER (TEE):** `init_permissions`, `request_seed` + `callback_seed` (`#[vrf]` / `#[vrf_callback]`,
  ER queue), `start` (schedules crank), `advance` (crank or anyone), `set_aim(x)` / `plant_rig(cell)` /
  `peek(cell)` (signed by the registered burner), `respond_double` (stretch), `finish` (flip Secrets
  public, commit + undelegate with the `settle` Magic Action).

### Time and the tick

- ✅ Live ER slots are ~10 ms. **1 tick = 5 slots = 50 ms (20 Hz).**
  `target_tick = (Clock.slot − start_slot) / 5`.
- `advance()` is **idempotent catch-up**: it steps from `last_tick` to `target_tick` (capped per tx,
  e.g. 40 steps) and returns OK if already current. **Every** player instruction calls it first.
- The crank calls `advance` every 50 ms (≈2,600 iterations per match, cancelled at the end). ✅ The docs
  say cranks don't guarantee exact timing, so correctness never depends on the crank firing on time.
  Fallback if cranks misbehave on the TEE ⚠️: clients send `advance` heartbeats.
- ✅ Precedent: 20 ticks/s game physics inside an ER has already shipped in a past Blitz entry.

### Randomness

One VRF seed per match (✅ ER VRF is free and <50 ms) arrives in `callback_seed` → stored in
`Secrets`. Each deal = `hash(seed, phase)` → shuffle + gold cell + gold value + hint coin-flips. The
seed is public only after the match, for Verify.

### Privacy: what must never leak

- Unrevealed gate values and the seed, not just rigs. If they were in `Match`, a modified client
  would read every `?`.
- **No `msg!` of secrets** (logs are visible to log-permitted members).
- ⚠️ Whether the opponent can read the *instruction data* of my `plant_rig`/`peek` tx on the TEE
  (`getTransaction`, `onLogs`, signature subscriptions). Stage 0 must test it. Fallback: commit-reveal
  for rigs (hash at plant; the program verifies the reveal the rigger's client sends when a cohort
  reaches the row; a missing reveal = rig forfeited).

### Settlement

`finish` on the ER → `MagicIntentBundleBuilder.commit_and_undelegate(Match, Secrets, Peek×2)` +
post-commit action `settle` on base → pays winner/loser/treasury from the Vault per SPEC §7, refunds
unused escrow. If the action fails, anyone calls `settle` directly.

## 5. Client

- **Screens:** a first visit goes straight into the guided tutorial match vs the bot (SPEC §9), with
  **Skip tutorial** always visible. Home = one big **Play vs Bot** button, plus Quick Match, Room Code,
  Top up and How to play. → Match → Result (payout count-up, full reveal, Verify, explorer links,
  "under the hood" tx log like the RPS app). Rematch and Verify appear ~1.5–2 s after the result lands.
  Screen changes use one short branded wipe (≤ 1.5 s).
- **HUD (portrait):** the top ≤ 8% holds you (left), the opponent (right), and the timer + stake +
  phase pips (centre). HP labels sit on the cannons in world space (`2.2K` style, ticking smoothly).
  Your cannon sits at ~75–80% of screen height; the bottom ~20% is empty drag area. Prompts appear
  just above your cannon. No per-hit numbers anywhere.
- **Render loop:** subscribe to `Match` over the TEE websocket. The client also runs **the same
  `crates/sim` compiled to WASM**: between 20 Hz chain snapshots it steps the sim locally (cohort motion
  is deterministic), and each snapshot corrects it. Only hidden gate values and the opponent's aim are
  unknown locally, and the snapshot that reveals them arrives within ~1 tick. Render ~1 tick behind
  so corrections are invisible. The own cannon moves instantly on drag; `set_aim` is throttled to ~10 tx/s.
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
- **Look:** portrait, **static** perspective camera showing the whole lane cannon to cannon (start at
  pitch ~44°, FOV ~30°, a telephoto look that packs crowds into a mass). It moves only for re-deals
  (slight pull-back) and KO (push-in). Low-poly + toon/flat shading, one palette texture, blob shadows
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
  · TEE validator identity `MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo` (from the RPS example; ⚠️
  re-check) · status `https://status.magicblock.app/api/services`.
- Toolchain: Agave 3.1.10, Anchor 1.0.2 (avm), rustup stable (host), Node ≥ 24, pnpm 10.
- Rust: `anchor-lang = "1.0.2"`, `ephemeral-rollups-sdk = "0.18"` (never unpinned), `magicsvm = "0.3.0"` (dev).
- TS: `@coral-xyz/anchor@0.32.1`, `@solana/web3.js@^1.98`, `@magicblock-labs/ephemeral-rollups-sdk@0.18.0`,
  `@solana/wallet-adapter-*`, `react@19`, `three@0.187`, `@react-three/fiber@9`, `@react-three/drei@10`, `vite`, `hono@4`.
- Deploy cost ✅: program rent ≈ 1.5 SOL (300 KB) to 2.5 SOL (500 KB), plus a temporary buffer of the
  same size during deploy. Keep about 5 devnet SOL on the deploy wallet.

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

**Stage 0 checklist (devnet-tee):**
1. A private account with no members can't be read by any client, while the program still reads it.
2. The opponent can't see `plant_rig` instruction data or logs (getTransaction / onLogs / ws).
3. A crank at 50 ms runs on the TEE validator for 2+ minutes.
4. `request_randomness` on the ER queue from the TEE calls back, and we can measure the latency.
5. A browser websocket `accountSubscribe` with a TEE token delivers ~20 updates/s on a phone.
6. commit + undelegate + post-commit action moves SOL out of a base-layer vault.
Also: whether a burner with 0 SOL can send ER transactions, and the per-tx compute of `advance` with 40 steps × 80 cohorts (40 per side).

## 8. Risks and fallbacks

| Risk | Fallback |
|---|---|
| TEE privacy of tx data fails (check 2) | Commit-reveal rigs; peeks become "reveal-on-demand" of your own cell |
| PER unusable overall (checks 1/5) | Public ER; gate values rolled by ER VRF **at first contact** (nothing to read beforehand); commit-reveal rigs |
| Crank unreliable on the TEE (check 3) | Client heartbeat `advance` txs (the program is already catch-up based) |
| Magic Action fails | Permissionless `settle` |
| Phone perf in 3D | Lower instance cap, flat shading, then a 2D sprite fallback in the same R3F scene |
| Faucet limits | Server sponsor wallet tops up burners; keep a funded deploy wallet |
