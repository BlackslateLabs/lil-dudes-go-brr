# Lil Dudes Go Brr: MVP and build order

Status: **DECIDED** unless marked **OPEN**. Updated 2026-11-22 (M4–M5 back end done: §4 edge cases, §8 wallets;
**v3 rules PROPOSED**: §1, §2, §3.2, §3.6–3.8, §5, §6, §7 follow SPEC v3).
Idea: [IDEA.md](IDEA.md) · Rules: [SPEC.md](SPEC.md) · Tech: [TECH.md](TECH.md).

## 1. The MVP in one paragraph

A phone-first web game. Opening the link drops a first-time player into a short, skippable guided
match against the bot. After that they can play the bot for free, or race a person live (quick match
or room code) for a small devnet-SOL stake. Both players play identical copies of one level against
the same enemy base (two tower fights, then a loot raid), with hidden `?` gates, one rig (on the
opponent's copy) and one peek per stage. An enemy reaching your cannon ends it; otherwise the pot is
split by gold. A match takes ~1:30–2:00 (3:00 cap). The match runs in
MagicBlock's Private Ephemeral Rollup. It settles automatically to the base layer, and the result
screen proves the match was fair.

**Never cut:** live 1v1 race on the private rollup, hidden gates + rig, stakes that settle on-chain, the bot.

## 2. Features

| In the MVP | Stretch (only if MVP is done) | Out |
|---|---|---|
| Bot match (free), quick match, room code | Turncoat trap | Real money, mainnet |
| Stakes: Free / 0.05 / 0.1 / 0.25 devnet SOL | Pipes, turbo pads, portals, cages | Accounts, login, email |
| Towers + waves, hidden gates, sliding gates, crates, rig, peek, raid + gold | Emotes during a match | Cards, upgrades, meta progression |
| Guided first match (skippable, replayable) | Spectator link | Leaderboards, seasons |
| Result screen + Verify + explorer links | Champion / Giant meter, more layouts | Chat |
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
  1. "Drag to aim". 2. "Hit a gate". 3. "Stop the wave before it reaches you". 4. "Knock out the tower".
  5. "Rig one of their gates" (stage 2 plant). 6. "Peek at one of yours". 7. "Raid the vault!".
- The player's fight-1 waves are at 50%, so a newcomer can't die early (SPEC §10).
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
- **HUD** (top ≤ 8%): you (left: name, gold, stage pips), opponent (right: name, gold, stage pips or
  DEAD/DONE), centre = timer + stake.
- **Arena:** a static camera shows your whole lane, cannon to base. The base and its towers are at the
  top (HP labels on the towers), your cannon at ~75–80% of screen height, and the bottom ~20% is
  empty thumb space. A **mini-view** of the opponent's lane sits in a corner (their stage, crowd,
  towers, gold, live).
- **Plant (3 s, start of each of your stages):** the stage's gates appear face-down, your cannon holds
  fire, the mini-view enlarges, and "Tap one of their gates to rig it" appears. Tap a gate on their
  copy → it locks in with a trap icon only you see. No tap = no rig.
- **Peek:** an eye button by your thumb (one per stage). Tap → tap one of your `?` gates → only you
  see its value for the rest of the stage.
- **Events:** reveal flip + pour, wave release (tower pulse), clash front, crate counter + break,
  GOTCHA overlay, danger stripes when an enemy wave nears your line, tower hit flash + explosion,
  transit (field wipe + drive up), "RAID!" banner + loot counter, the opponent's stage changes in the
  mini-view.
- **Leaving:** no pause. Closing the tab keeps your cannon firing at its last position (SPEC §11).
- **End:** your death (an enemy reaches your line), the opponent's death, or both done → payout
  fountain → Result. If you finish first, you watch the opponent's lane until the end.

### 3.7 Result
- WIN / LOSE / DRAW, gold for both (and who died), then a count-up of the money moved with one line
  explaining why ("They died → you take the pot" / "900 vs 600 gold → you take 60% of the pot, 5% fee").
- Full reveal: every stage's gate values from the seed, with rigs marked (and whether they sprang) and
  who peeked what.
- Buttons (after ~1.5–2 s): **Rematch** (same opponent, same stake; both must accept), **Home**,
  **Verify**. Explorer links to the settle tx and the match account.
- If settlement is still landing: a "Settling…" state; after 20 s, a **Settle now** button
  (permissionless `settle`).

### 3.8 Verify
- Shows the VRF seed, then re-derives the layout and every stage's gate values in the browser (WASM
  sim) and checks every revealed gate against the on-chain final state. Big ✓ "This match was fair",
  plus a step-by-step "under the hood" list of every transaction, with links.

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
| Nobody joins a room / the queue is cancelled | `cancel_match` refunds the stake: the creator any time; **anyone after 20 min** (the server's sweeper does it; the refund always goes to the creator). |
| Join but never delegated (crash) | Either side can cancel after 60 s → refund; **anyone after 5 min** (sweeper). On app start, `recoverMatches(base, burner)` cancels the player's own stale matches. |
| Settle action fails | Anyone can call `settle`; the result screen offers **Settle now** (`LiveSource.settleNow(server)`: the burner pays the fee, or the server's sponsor via `POST /settle`); the sweeper settles anything still unpaid 30 s after it is back on base. |
| Chain or rollup down | Banner "Live play is down"; Play vs Bot falls back to offline mode. |
| Balance too low | Stake chips greyed out; "Top up" offered. Free stays playable. |
| Faucet abuse | `POST /topup` fills a burner to stake + 0.035 SOL (≤ 0.3 SOL), at most once per 10 min per burner, 3 per 10 min per IP, 3 SOL per hour in total; devnet only (genesis hash checked). |
| Two tabs, same burner | The second tab shows "Already playing in another tab". |
| Burner lost (site data cleared) | Funds lost (devnet). The warning in 3.9 says so. |
| Player never shows after delegation (no salt) | `LiveSource` aborts ~65 s after READY (a player may after ~60 s); the sweeper aborts after ~5 min if nobody is left. Everyone is refunded by the settle action. |
| Paid-out matches pile up | The sweeper closes them 10 min after settlement (rent back to the creator); the grace keeps result screens and Verify readable. |
| Withdraw leaves rent dust | `withdraw()` refuses to leave 1–890,879 lamports (below rent-exempt) or to send < 890,880 to a brand-new address; "withdraw all" empties the burner. |

## 5. Look and sound

**Decided:** portrait; a static telephoto camera (pitch ~44°, FOV ~30°); low-poly toy world with toon
shading; on your phone **your dudes are blue and the base's troops are red**. Gate colours: unrevealed =
neutral panel with `?`, revealed = blue (big gates gold), a sprung trap = red. Big outlined numbers on
gates, towers, crates and the clash front only. Round, chunky UI buttons. One distinct sound per event.

**OPEN (Suparno owns, decide in the arena prototype):**
1. The **lil dudes** character design (original; small, round, readable in a crowd of 1,000).
2. The arena theme for the MVP (one arena only).
3. The cannon design, gate panel design, logo, UI font (an OFL font), colour palette.
4. Music + sfx sources (CC0 / properly licensed, in `CREDITS.md`).

## 6. Starting numbers

The v3 constants are in SPEC §12 (genre-measured starting values); the balance runner tunes tower HP
and wave sizes per layout (`cargo run -p lil-dudes-sim --example balance --release`). Targets: bot vs
bot death rate ~10–25%, fights ~20–45 s, matches ~1:15–2:15.

## 7. Build order

Each milestone ends with something you can play or test. K = Kai, S = Suparno.

| # | Milestone | K | S | Done when |
|---|---|---|---|---|
| **M1** | **Playable offline** | monorepo scaffold; `crates/sim` (SPEC v2.1, tests); WASM build; local bot; `packages/client` `MatchView` v0 | arena prototype (camera, drag, crowds, gates, clash, HUD) on the WASM sim | a full 2:00 match vs the local bot on a phone at 60 fps |
| **M2** | **Chain proven** | Stage 0 spike program on devnet-tee (TECH §7 checklist) | art direction (§5 OPEN items), first real assets | all 6 checks pass, or the fallback is chosen and logged |
| **M3** | **Live 1v1** | `lil_dudes` program: create/join/delegate/start/advance/set_aim/finish; MagicSVM tests; client feed | switch the arena to the live feed with WASM prediction; room-code screens | two phones play a full live match on devnet, smooth |
| **M4** ✅ back end | **Hidden info** | Secrets/Peek permissions, VRF deals, rig, peek, reveal, re-deal | plant window, peek, GOTCHA, re-deal flip, Verify screen | the opponent's client provably can't read `?` values; Verify ✓ |
| **M5** ✅ back end | **Money + onboarding** | vault, stakes, settle action + fallback; `apps/server` faucet + quick-match queue | stake picker, wallet sheet, result count-up, Home, waiting screens | a staked match settles correctly on devnet from a fresh phone |
| **M3b** | **v3 rules (race vs the base)** | review SPEC v3; redeploy the program on the v3 sim; MagicSVM on v3 | `crates/sim` v3 + WASM, `packages/client` v3, program compiles, arena v3 (towers, waves, mini-view) | a full offline v3 match vs the bot; a live devnet run on v3 |
| **M6** | **Feel + tutorial** | Rust balance runner → tune towers/waves/layouts; bot polish; perf of `advance` | tutorial, juice pass, sound, haptics, quality tiers, more layouts | 5 people play; notes logged; numbers tuned |
| **M7** | **Ship** | deploy, monitoring, README | demo video, landing copy | submitted |

M1 and M2 run in parallel. M2 does not block M1, and M1 does not need SOL.

**If time runs short, cut in this order:** quick-match queue (keep room codes + bot) → Verify replay
(keep the reveal + explorer links) → interactive tutorial (replace with 4 static "how to play" cards)
→ layouts beyond 3.

## 8. Wallets and SOL

- **Deploy wallet** (`FdZL…rfbB`, 5 SOL): program deploys only. The program locks ~1.5–2.5 SOL of
  rent, and each upgrade needs a temporary buffer of the same size (refunded). Close the Stage 0 spike
  program after M2 to get its rent back.
- **Server sponsor wallet** `8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr` (made in M5; key only in the
  server's env, on Kai's machine at `~/.config/lil-dudes/sponsor.json`): tops up burners, funds the
  online bot (~0.012 SOL per bot match), pays the sweeper's fees.
- **Online bot wallet** `CJbQuVNXhA2ygutqD48ucoHC3wfvawegSDTEL49Y9ogW` (`BOT_KEYPAIR_PATH`): its own
  burner, topped up by the sponsor (0.04 SOL float per live bot match).
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
