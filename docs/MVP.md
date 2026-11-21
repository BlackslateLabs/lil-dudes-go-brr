# Lil Dudes Go Brr: MVP and build order

Status: **DECIDED** unless marked **OPEN**. Updated 2026-11-21.
Idea: [IDEA.md](IDEA.md) · Rules: [SPEC.md](SPEC.md) · Tech: [TECH.md](TECH.md).

## 1. The MVP in one paragraph

A phone-first web game. Opening the link drops a first-time player into a short, skippable guided
match against the bot. After that they can play the bot for free, or play a live 1v1 against a person
(quick match or room code) for a small devnet-SOL stake. Matches last 2:00, with hidden `?` gates,
one rig and one peek per phase, re-deals at 0:40 and 1:20, and Surge at 1:45. The match runs in
MagicBlock's Private Ephemeral Rollup. It settles automatically to the base layer, and the result
screen proves the match was fair.

**Never cut:** live 1v1 on the private rollup, hidden gates + rig, stakes that settle on-chain, the bot.

## 2. Features

| In the MVP | Stretch (only if MVP is done) | Out |
|---|---|---|
| Bot match (free), quick match, room code | Double-or-Toll (SPEC §8) | Real money, mainnet |
| Stakes: Free / 0.05 / 0.1 / 0.25 devnet SOL | Turncoat rig (if it beats ÷2) | Accounts, login, email |
| Hidden gates, hints, gold gate, rig, peek, re-deal, Surge | Emotes during a match | Cards, upgrades, meta progression |
| Guided first match (skippable, replayable) | Spectator link | Leaderboards, seasons |
| Result screen + Verify + explorer links | Sliding gate rows, Giant power-up | Chat |
| Burner wallet, auto top-up, withdraw to any address | Test-USDC stakes | Native app |
| Offline mode (no chain) as fallback demo | | |
| Sound, music, haptics, quality auto-switch | | |

## 3. Screens

Portrait everywhere. On desktop the game sits in a centred phone-shaped column.

### 3.1 First visit
- Logo wipe (≤ 1.5 s) → straight into the **tutorial match** (3.2). A burner keypair is created in
  `localStorage` silently. The tutorial is local (offline sim), so it starts instantly and needs no SOL.
- **Skip tutorial** sits at the top right during the logo and the whole tutorial. Skip → Home.

### 3.2 Tutorial match (vs bot, local)
- The same arena as a real match. Each beat shows a one-line prompt above the cannon and a ✓ when done:
  1. "Drag to aim". 2. "Hit a gate". 3. "Crash into their dudes". 4. "Blue hint = probably good".
  5. "Rig one of their gates" (plant window). 6. "Peek at one of yours". Then the match plays out freely.
- The bot holds back in phase 1, so a newcomer can't be knocked out.
- End → short result → **Home**, with "Play for real" pulsing.

### 3.3 Home
- Big **PLAY VS BOT** button. Under it: **Quick Match**, **Room Code**.
- Top bar: player name (random "Lil ____", tap to edit), wallet balance pill (tap → Wallet sheet), settings cog.
- Footer: **How to play** (replays the tutorial), "Devnet play money" note, link to the Verify explainer.
- Background: an idle crowd stream loops behind the buttons.

### 3.4 Match setup
- **Vs bot:** no stake picker (always free). Starts immediately.
- **Quick Match / Room Code:** stake chips `Free · 0.05 · 0.1 · 0.25`. The matched stake is the lower
  of the two picks; the excess is refunded at start, and this is shown before confirming. If the balance is too
  low, the tile shows "Top up" instead.
- **Room Code:** *Create* shows a 6-character code + share-link button. *Join* takes a code or opens from the link.

### 3.5 Waiting
- **Quick Match queue:** spinner with the dudes marching in place, elapsed time, Cancel. After **30 s**:
  "No one around. Play the bot while you wait?" (staying in the queue).
- **Room:** "Waiting for your friend…" plus the code. Cancel → `cancel_match` refunds the stake.
- When both have joined: "Opponent found" (names + stake) → 3-2-1 → match. Delegation and seed happen
  behind this countdown.

### 3.6 Match
- **HUD** (top ≤ 8%): you (left), opponent (right), centre = timer + stake + three phase pips.
- **Arena:** a static camera shows the whole lane. Their cannon and gates are at the top, yours at the
  bottom; your cannon sits at ~75–80% of screen height, and the bottom ~20% is empty thumb space. HP labels sit on each cannon.
- **Plant window (3 s, start of each phase):** the board flips face-down, both cannons stop, and a
  countdown ring plus "Tap one of their gates to rig it" appear. Tap a cell on their grid → it locks in
  with a small trap icon only you see. No tap = no rig.
- **Peek:** an eye button by your thumb (one per phase). Tap → tap one of your `?` cells → only you
  see its value for the rest of the phase (an outline marks it).
- **Events:** reveal flip + pour, clash front, GOTCHA overlay, danger stripes, cannon hit flash,
  re-deal flip, "SURGE" banner at 1:45.
- **Leaving:** no pause. Closing the tab keeps your cannon firing at its last position (SPEC §10).
- **End:** KO explosion or a timer horn → payout fountain → Result.

### 3.7 Result
- WIN / LOSE / DRAW, final HP for both, then a count-up of the money moved with one line explaining why
  ("Won by 22% → you take 61% of the stake, 5% fee").
- Full reveal: both boards from every deal, with rigs marked and who peeked what.
- Buttons (after ~1.5–2 s): **Rematch** (same opponent, same stake; both must accept), **Home**,
  **Verify**. Explorer links to the settle tx and the match account.
- If settlement is still landing: a "Settling…" state; after 20 s, a **Settle now** button
  (permissionless `settle`).

### 3.8 Verify
- Shows the VRF seed, then re-derives every deal and hint in the browser (WASM sim) and checks them
  against the on-chain final state. Big ✓ "This match was fair", plus a step-by-step "under the hood"
  list of every transaction, with links.

### 3.9 Wallet sheet
- Burner address (copy), balance, **Top up** (server faucet, devnet), **Withdraw** (to any address,
  e.g. Phantom; with Phantom installed, "Send to my Phantom" fills the address in).
- Warning: "This wallet lives in this browser. Clearing site data loses it. Withdraw first."

### 3.10 Settings
- Sound, music, haptics toggles; quality Auto / Low; replay the tutorial; show the burner address.

## 4. Edge cases (decided)

| Case | Behaviour |
|---|---|
| Opponent disconnects mid-match | Their cannon keeps firing at its last position; the match runs to the end. |
| Nobody joins a room / the queue is cancelled | `cancel_match` refunds the stake. |
| Join but never delegated (crash) | Either side can cancel after 60 s → refund. |
| Settle action fails | Anyone can call `settle`; the result screen offers the button. |
| Chain or rollup down | Banner "Live play is down"; Play vs Bot falls back to offline mode. |
| Balance too low | Stake chips greyed out; "Top up" offered. Free stays playable. |
| Faucet abuse | Server tops up a burner to 0.3 SOL at most once per 10 minutes per burner + IP. |
| Two tabs, same burner | The second tab shows "Already playing in another tab". |
| Burner lost (site data cleared) | Funds lost (devnet). The warning in 3.9 says so. |

## 5. Look and sound

**Decided:** portrait; a static telephoto camera (pitch ~44°, FOV ~30°); low-poly toy world with toon
shading; on your phone **you are always blue and they are always red**. Gate colours: unrevealed = neutral
panel with a hint glow (blue / red / grey), gold = gold, revealed good = blue, bad = red. Big outlined
numbers on gates, cannons and the clash front only. Round, chunky UI buttons. One distinct sound per event.

**OPEN (Suparno owns, decide in the arena prototype):**
1. The **lil dudes** character design (original; small, round, readable in a crowd of 1,000).
2. The arena theme for the MVP (one arena only).
3. The cannon design, gate panel design, logo, UI font (an OFL font), colour palette.
4. Music + sfx sources (CC0 / properly licensed, in `CREDITS.md`).

## 6. Starting numbers

| Constant | Value | Notes |
|---|---|---|
| Tick | 50 ms (5 ER slots) | 2,400 ticks per match |
| Plant windows | ticks 0–60, 800–860, 1600–1660 | cannons hold fire |
| Surge | from tick 2,100 | `FIRE_TICKS` 8 → 4 |
| `FIRE_TICKS` / `B` | 8 / 4 | volley = one cohort of 4 |
| `LAUNCH_TICKS` | 6 at 3× cruise | |
| Cohort cap | 40 per side | |
| `CANNON_STEP` | lane width / 5 per tick | |
| Gate width | ~75% of the column | OPEN until the prototype |
| HP, ± deck values | tuned by the Rust balance runner | target ~25% KO |

## 7. Build order

Each milestone ends with something you can play or test. K = Kai, S = Suparno.

| # | Milestone | K | S | Done when |
|---|---|---|---|---|
| **M1** | **Playable offline** | monorepo scaffold; `crates/sim` (SPEC v2.1, tests); WASM build; local bot; `packages/client` `MatchView` v0 | arena prototype (camera, drag, crowds, gates, clash, HUD) on the WASM sim | a full 2:00 match vs the local bot on a phone at 60 fps |
| **M2** | **Chain proven** | Stage 0 spike program on devnet-tee (TECH §7 checklist) | art direction (§5 OPEN items), first real assets | all 6 checks pass, or the fallback is chosen and logged |
| **M3** | **Live 1v1** | `lil_dudes` program: create/join/delegate/start/advance/set_aim/finish; MagicSVM tests; client feed | switch the arena to the live feed with WASM prediction; room-code screens | two phones play a full live match on devnet, smooth |
| **M4** | **Hidden info** | Secrets/Peek permissions, VRF deals, rig, peek, reveal, re-deal | plant window, peek, GOTCHA, re-deal flip, Verify screen | the opponent's client provably can't read `?` values; Verify ✓ |
| **M5** | **Money + onboarding** | vault, stakes, settle action + fallback; `apps/server` faucet + quick-match queue | stake picker, wallet sheet, result count-up, Home, waiting screens | a staked match settles correctly on devnet from a fresh phone |
| **M6** | **Feel + tutorial** | Rust balance runner → tune HP/deck; bot polish; perf of `advance` | tutorial, juice pass, sound, haptics, quality tiers | 5 people play; notes logged; numbers tuned |
| **M7** | **Ship** | deploy, monitoring, README | demo video, landing copy | submitted |

M1 and M2 run in parallel. M2 does not block M1, and M1 does not need SOL.

**If time runs short, cut in this order:** Double-or-Toll (already stretch) → quick-match queue
(keep room codes + bot) → Verify replay (keep the reveal + explorer links) → interactive tutorial
(replace with 4 static "how to play" cards) → Surge.

## 8. Wallets and SOL

- **Deploy wallet** (`FdZL…rfbB`, 5 SOL): program deploys only. The program locks ~1.5–2.5 SOL of
  rent, and each upgrade needs a temporary buffer of the same size (refunded). Close the Stage 0 spike
  program after M2 to get its rent back.
- **Server sponsor wallet** (new keypair, made in M5, kept only in the server's env): tops up burners.
  It needs ~5 SOL for testing and the demo week.
- **Two test burners** for live testing come from the sponsor wallet.

## 9. Working in parallel

**Day 0: Kai scaffolds and pushes the bare minimum, then Suparno pulls and starts.** The scaffold contains:
- pnpm workspace + Cargo workspace (empty program and sim crates that build).
- `apps/web`: Vite + React + R3F, running on a phone over Wi-Fi (`pnpm --filter web dev --host`), with a
  placeholder lane, camera and a draggable cannon.
- `packages/client`: `MatchView` v0, constants, `MatchSource`, and a working **`MockSource`** (fake
  match at 20 Hz: volleys, gates revealing, clash, hits, plant windows, Surge, a fake end).
- Nothing in `apps/web` needs Rust, Solana tools or SOL. Requirements: Node ≥ 24, pnpm 10, a phone on the same Wi-Fi.

**Then the two tracks only meet at `packages/client`:**

| When | Kai delivers | Suparno switches to | Suparno is never blocked because |
|---|---|---|---|
| Day 0 | scaffold + `MockSource` | builds the arena, HUD, screens on the mock | the mock already emits every event type |
| End of M1 | `OfflineSource` (prebuilt WASM sim + bot) | one-line swap; tunes feel on the real rules | the mock keeps working as a fallback |
| M3 | `LiveSource` + room-code calls | one-line swap; tests on two phones | offline mode stays the demo fallback |
| M4–M5 | rig/peek/stake/wallet calls in `packages/client` | wires buttons to calls | each screen is built first against mock calls that resolve after a fake delay |

**Rules:** Kai owns `packages/client` and announces each change with a `CONTRACT` log entry. If
Suparno needs a new field or event, he adds a `HANDOFF` entry ("need X in MatchView") and keeps
going with a local stand-in value. Screens that need chain calls (wallet, stake, waiting) are built
against fake functions with the same signatures first.

**Suparno → Kai:** the arena geometry he settles on (lane length, row spacing, gate width), since
the sim's constants must match; the dude/cannon/gate sizes; what feels wrong in the sim (too
slow, too fast) during M1.
**Kai → Suparno:** constants + `MatchView` (day 0), the WASM sim (M1), the live feed (M3), and the chain
calls (M4–M5).
