# Lil Dudes Go Brr: Game Spec v2.1

Status: **design locked for the MVP, numbers are starting values to tune in playtests**.
Updated 2026-11-21 (v2.1: genre research on pacing, launch, cannon speed, crowd numbers, tutorial;
M1: details the spec was silent on, settled while building `crates/sim`, marked **(M1)**). The idea in plain words: [IDEA.md](IDEA.md). Source: the first design doc (v1), revised after the balance sim in
[`tools/balance/`](../tools/balance/). The technical design is in [TECH.md](TECH.md).

## 1. The game in one paragraph

**Lil Dudes Go Brr** is the game from the fake mobile ads, made real: a 1v1 crowd-cannon duel on Solana.
Each player has a cannon at their end of a vertical lane. Your cannon auto-fires a stream of little
units that pass through gates (×2, ×3, +10, −6, ÷2 …), grow or shrink, collide with the enemy
stream in the middle, and whatever survives damages the enemy cannon. Every gate shows `?` until a
unit passes through it. Once per phase you can secretly **rig** one of your opponent's gates into a
trap, and **peek** at one of your own. Both players stake play money (devnet); the winner takes at
least half of the loser's stake, and more the bigger the win. The match runs on-chain in a MagicBlock
Private Ephemeral Rollup, so neither player can cheat or see hidden gates, and payment settles
automatically.

**Pitch:** "We made the fake ad real. 1v1, on-chain, and your opponent may have rigged the gate."

## 2. Arena and controls

```
  [ THEIR CANNON ]  HP          <- opponent (always drawn at the top on your phone)
  ?   ?   ?                    <- their 3 gate rows x 3 columns (their mob passes these)
  ?   ?   ?
  ?   ?   ?
  ~~~~~~ CLASH ZONE ~~~~~~      <- the two streams meet and subtract
  ?   ?   ?                    <- your 3 gate rows x 3 columns
  ?   ?   ?
  ?   ?   ?
  [ YOUR CANNON ]   HP          <- you: drag left/right to move the cannon
```

- **Control:** drag anywhere to slide your cannon left/right. The cannon
  auto-fires; there is no fire button. Each phone draws its own cannon at the bottom.
- **Gates affect only their owner's units.** Your units pass your 3 rows, then the clash zone, then
  run past their gates without effect into their cannon.
- **Layout is mirrored:** your 9 gates and theirs are the same values in the same cells, so luck is
  equal. (The sim showed mirrored is fairer than shuffling each side: with shuffled layouts, the
  better player's win rate dropped from 78% to 63%.)
- **Lane proportions (feel target):** each side's 3 gate rows sit close to its own cannon. A fresh
  volley reaches row 1 in ~0.3 s and has passed all 3 rows within ~1.2 s. The clash zone is the middle
  ~40% of the lane. On an empty lane a cohort needs ~3 s from its cannon to the midline and ~6 s to
  the enemy cannon. The gates act at once; the walk is the fight.
- **Cannon speed:** the cannon's `x` moves toward the player's aim by at most `CANNON_STEP` per tick
  (it crosses the full lane in ~5 ticks). Volleys always spawn at the sim's `x`, never at the raw aim.
- **Gate width:** start with each gate ~75% of its column, so there are small gaps and aiming matters.
  A cohort in a gap passes the row unchanged. Confirm in the first prototype (full width is the fallback).

## 3. Match timeline (2:00)

| Time | Event |
|---|---|
| 0:00–0:03 | **Plant 1**: gates dealt face-down, no hints yet. Each player rigs one opponent cell. Cannons hold fire. |
| 0:03–0:40 | Phase 1: fire, reveal, peek. Hints appear at 0:03. |
| 0:40 | **Re-deal**: all 18 gates replaced with a fresh mirrored deal. Plant 2 (3 s), new Rig and Peek. |
| 1:20 | Re-deal + Plant 3. (Stretch: Double-or-Toll window opens, §8.) |
| 1:45–2:00 | **Surge**: fire rate ×2 for both players (a volley every 4 ticks instead of 8). |
| 2:00 | Timer. Higher cannon HP wins. |

Re-dealing is what keeps `?` alive: the cannon never stops, so a fixed layout is fully revealed
within seconds and rigs would have nowhere to go.

Each plant window is an animated beat: the board flips face-down, both cannons hold fire, and a
one-line prompt says what to do ("Rig one of their gates!").

**(M1)** Details of the plant window and the tick:
- During a plant window every gate is face-down and **inactive**: cohorts still in flight from the
  last phase pass the fresh deal's rows unchanged. Nothing can be revealed before the rigs are in.
- Hints appear when play starts (0:03, 0:43, 1:23). During the plant only the gold gate shows, so
  the rigger knows which cell can't be rigged. Cannons can still move.
- The first volley of a phase fires on the first tick of play, then every `FIRE_TICKS`.
- One tick, in order: inputs (aim, rig, peek) → cannons step → cohorts move and cross rows →
  clash → cannon hits → KO check → fire. Invalid inputs (wrong window, used up, bad cell) are
  ignored and use nothing. Something visible should happen at
least every ~5–10 s of play (reveals, clashes, cannon hits, GOTCHA, re-deal).

## 4. Gates

- **Deck per deal (9 cells, mirrored):** `×2, ×2, ×2, ×3, +6, +6, +10, −6, ÷2`, shuffled by VRF.
  One random cell per deal is replaced by the **gold gate**.
- **Gold gate:** `×3` or `÷3`, 50/50 by VRF, same value on both sides. Its expected effect (×1.67) is
  about equal to a normal good gate (×1.71), so taking it is a real risk call. (The v1 value ×10/÷10
  averaged ×5, so you'd always take it, and it doubled the KO rate from 22% to 48%, making luck decide.)
- **Reveal:** a gate reveals when the first cohort passes through it, and stays revealed for both
  players until the next deal. A row applies once per cohort (the sim tracks the last row each
  cohort passed, so a tick boundary can never apply a row twice).
- **Hints:** each unrevealed gate shows its true colour (blue = good, red = bad) with probability
  60%, otherwise gray. Gold always shows gold. A rigged gate shows a fake blue.
  **(M1)** The coin flips are made **per side** (values are mirrored, hints are not). With mirrored
  hints, a fake blue would be exposed whenever the same cell on the other grid shows grey or red.
  Hints go public only when play starts, after rigs are locked, so no hint ever visibly changes.
- **Op semantics on a cohort of `c` units:** `×k → c·k`, `+n → c+n`, `−n → max(0, c−n)`,
  `÷k → floor(c/k)`. Integer only.

## 5. Rig and Peek (one of each per phase)

- **Rig:** during the 3-second plant window, choose one cell in the opponent's grid (not the gold
  gate). It becomes a trap with a fake blue hint. When their stream first passes it: both screens
  flash **GOTCHA** with the rigger's emote, and the trap fires.
  - MVP trap: `÷2`. **(M1)** The trap replaces the gate's value for the rest of the phase: it
    reveals as `÷2`, and every later cohort through it is halved too.
  - Test in playtest: **Turncoat**, where the first cohort through switches sides and runs at its
    own cannon. The sim showed a ÷2 trap barely changes win rates (it costs about one volley), so
    Turncoat is the candidate to make rigs matter. Keep whichever plays better.
- **Peek:** privately see the true value of one unrevealed cell on your own side (this also exposes
  a rig). Only you can see the result. **(M1)** Peeks work during play only, not in the plant
  window, so a rig planted later in the same window can't make a peek stale. The gold gate can be
  peeked (it shows ×3 or ÷3). Peeking a revealed cell is refused and keeps the peek.
- Rigs and peeks reset every phase. Unused ones are lost. No power-up meter in the MVP.

## 6. Mobs and combat

- A cohort is a group of units moving together: `{count, x, y, age, last_row}`. The cannon fires a
  **volley** every `FIRE_TICKS = 8` ticks (0.4 s): one cohort of `B = 4` units at its current `x`.
  Surge halves `FIRE_TICKS` to 4. Max **40** live cohorts per side (≈15 live normally, ≈30 in Surge
  with a ~6 s lane).
- **Launch:** for its first `LAUNCH_TICKS = 6` ticks a cohort moves at 3× cruise speed, then at
  cruise. Both sides use identical speeds.
- **Growth comes from the gates, not the fire rate.** The cannon's raw output is small, and the crowd
  "pours" out of good gates. The `+n`/`−n` deck values are relative to `B` and get retuned with it.
- A cohort crossing a gate row is affected by the gate whose span contains its `x` (none if it's in a gap).
- In the clash zone, opposing cohorts that meet subtract counts. 120 blue vs 80 red leaves 40 blue.
  **(M1)** Two opposing cohorts **meet** once they have reached each other along the lane (their
  distances from their own cannons add up to the lane length, so nothing can tunnel through) and
  their `x` differ by at most `CLASH_REACH` = half a column. Streams in the same column collide;
  streams a column apart pass each other. They subtract wherever they meet: normally in the clash
  zone, but a fresh volley can also block a cohort right at its cannon (defending). When one cohort
  meets several, pairs resolve front-most first, and the survivor carries on.
- A cohort reaching the enemy cannon deals damage equal to its count and is removed.
- The client draws a cohort as a swarm of instances (capped); jitter is cosmetic. Counts are shown
  sparingly: one number at each clash front (the winning side's surplus) and per-side totals in the
  HUD. There is **no badge on every cohort** and no per-hit damage numbers.

## 7. HP, ending, payout

- **Cannon HP:** a config constant. Tune it so about **25% of matches end in KO**: the model hit 22% at
  2,200 HP in its own units, while v1's 1,000 HP gave 60–95% KOs and made the timer, payout margin
  and Surge irrelevant. The real value comes from playtesting the real sim. HP depends on
  `FIRE_TICKS`, `B` and the deck, so re-tune it with the Rust balance runner whenever any of them changes.
- **KO** (HP 0) ends the match instantly. At the timer, higher HP wins; exactly equal = draw.
  **(M1)** Both cannons reaching 0 on the same tick is a draw (equal HP).
- **Stakes:** fixed tiers in devnet SOL: Free, 0.05, 0.1, 0.25. The matched stake **S** is the lower
  of the two picks; the excess is refunded at match start. Each player escrows **2S** (to cover the
  Double, §8; if Double is cut, escrow S).
- **Money moved (loser → winner):**
  - KO: `S` (×2 if doubled)
  - Timer win: `S × (50% + lead/2)`, where `lead` = winner HP% − loser HP%
  - Draw: nothing
- **Fee:** 5% of money moved, taken from the winner's side, to the treasury PDA.
- **Integer rules (micro-units / lamports):** `lead_pm = floor((hp_w − hp_l)·1000 / HP_MAX)`;
  `moved = floor(level · (500·1000 + 500·lead_pm) / 1_000_000)`; `fee = floor(moved · 500 / 10_000)`.
  Floors favour the loser. `settle_fuzz.py` checked 300k random cases: conservation is exact and no
  balance goes negative.

| $10-equivalent S | HP left | Moved | Fee | Winner nets |
|---|---|---|---|---|
| KO | 40% vs 0% | 10.00 | 0.50 | +9.50 |
| Clear win | 60% vs 40% | 6.00 | 0.30 | +5.70 |
| Close win | 51% vs 49% | 5.10 | 0.26 | +4.84 |
| Draw | 60% vs 60% | 0 | 0 | 0 |

Because every unit that lands changes the payout, the leader keeps attacking and the trailing player
keeps defending. There's no reason to stall or quit.

## 8. Double or Toll (stretch, after MVP)

- At the 1:20 re-deal, the player who is **ahead** may offer a Double. The other player has 5 s
  (play continues) to **accept** (stake level becomes 2S) or **decline**: pay a 15% S toll to the
  offerer, and the match **continues** at S.
- Why not v1's Raise/Fold at halftime: the sim showed the leader should always raise and the trailing
  player should fold whenever 10%+ behind, so about 60% of matches would end at halftime, killing the
  second half. Double-or-Toll keeps every match to the end, and in close matches (within 10%) accept
  vs decline differ by only about 0.04×S, which is a real dilemma.

## 9. Bot

- The **Warlord bot** runs inside the program: when one side is a bot, the tick moves its cannon using
  **public fields only** (revealed gates, hints). Every 2 ticks it picks a target column:
  1. defend if an enemy cohort is close to its cannon;
  2. otherwise the best revealed gate, else the best hint colour;
  3. alternate between equal options every 20–60 ticks;
  4. otherwise drift.
  It moves at the normal `CANNON_STEP` and brakes near the target. It never reads secrets; code
  review must enforce this. It rigs and peeks at random cells.
  **(M1)** As built in `crates/sim/src/bot.rs`:
  - Its only inputs are the public state and its own seed (independent of the match seed).
    The type signature enforces this. It never sees its own peek result.
  - Defend = the biggest enemy cohort that has grown past a raw volley and is within 3,000 units
    (~1.5 s) of its cannon; it aims straight at it.
  - Best gate = the column whose three gates turn a fresh volley into the most units, using revealed
    values where known and hint colour otherwise (blue/gold ≈ ×2, grey ≈ ×1, red ≈ ÷2). Its own
    grid only. With nothing known all columns tie, and rule 3 makes it drift between them.
  - Rig: a random unrevealed non-gold cell, on the first tick of each plant. Peek: a random
    unrevealed cell of its own on the first tick of play.
- **Tutorial:** a player's first match is a guided match against the bot. It teaches one mechanic per
  beat (aim → gates → clash → hints → rig → peek). Each beat has a one-line prompt above the cannon and
  a ✓ when done. In phase 1 the bot holds back, so a newcomer can't be knocked out. **(M1)**
  Holding back = the bot aims into the gap between two columns, so no gate grows its volleys
  (at most 93 × 4 = 372 damage in phase 1), and it doesn't rig or peek. It plays normally from
  phase 2. A **Skip tutorial**
  button is always visible (on the first-visit screen and during the match). Skipping goes straight
  to Home. The tutorial can be replayed from Home ("How to play").
- Bot matches are free. The bot never takes stakes (that would make us a casino).

## 10. Fairness and anti-cheat

- The match sim is authoritative on-chain. Clients only send cannon position, rig cell, peek cell
  and (stretch) double responses.
- Unrevealed gate values, rigs and the VRF seed live in private accounts in the TEE. The public match
  account only ever holds hints and revealed values.
- **No rage-quit:** if a player disconnects, their cannon keeps firing at its last position.
- **Verify:** at match end the seed and every rig are made public. The result screen re-derives all
  deals in the browser and links the settlement transaction.

## 11. MVP scope

| MVP | Stretch | Cut / roadmap |
|---|---|---|
| Mirrored deals + re-deal every 40 s | Double-or-Toll | Live-price "market gates" |
| `?` gates, hints, gold gate | Zombies (VRF-timed neutral hordes) | Tournaments, season pass |
| Rig + Peek (Private ER) | Lure / Giant power-ups + meter | Cosmetic packs |
| Cohort sim, HP, KO/timer, Surge | Turncoat rig (if not adopted in MVP) | Solana Mobile dApp Store build |
| Fixed SOL stakes, escrow, settlement | Test-USDC (SPL) stakes | Real-money anything |
| Burner key + on-chain bot + room codes | Emotes, auto clips, rank ladder | |
| Result screen + Verify + explorer link | Spectator view | |
| Guided first match (skippable, replayable) | | |
| Juice: reveal punch + pour, clash front, hit flash, KO + payout count-up, danger stripes, sound, GOTCHA | | |

## 12. Balance evidence (rough model)

`tools/balance/balance_sim.py` uses a flow model: affine gates, best-expected-column players, and a
skill value equal to the probability of not misplaying. It's directional, not exact. Key runs
(equal skill = 0.85 vs 0.85; gap = 0.90 vs 0.60):

| Config | KO (equal) | Better player wins | Avg moved | Avg length |
|---|---|---|---|---|
| v1 as written (HP 1000, gold ×10, fixed gates) | 62% | 78% | 85% of S | 77 s |
| v2 (mirrored, re-deal 40 s, gold ×3, Surge ×1.5, HP 2200) | 22% | 74% | 73% of S | 112 s |
| v2 with gold ×10 | 48% | 77% | 81% of S | 95 s |

These runs predate the v2.1 changes (volley every 0.4 s, `B = 4`, launch boost, gate gaps, Surge ×2),
so treat them as directional. The real numbers will be re-tuned with a Rust balance runner built on
the actual sim crate (TECH.md, Stage 6).

## 13. Open questions

1. Turncoat vs ÷2 rig: decide in the first playtest.
2. Exact deck values, `B` and HP: decide after the Rust sim exists.
3. Gate width (~75% with gaps vs full width): decide in the first arena prototype.
4. Stake currency: devnet SOL for the MVP (proven path); switch to an SPL test-USDC if time allows.
5. Name: **Lil Dudes Go Brr** (decided 2026-11-21).
