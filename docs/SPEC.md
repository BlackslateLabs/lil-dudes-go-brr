# Game Spec v2 (name not chosen yet)

Status: **design locked for the MVP, numbers are starting values to tune in playtests**.
Updated 2026-11-21. The idea in plain words: [IDEA.md](IDEA.md). Source: the first design doc (v1), revised after the balance sim in
[`tools/balance/`](../tools/balance/). The technical design is in [TECH.md](TECH.md).

## 1. The game in one paragraph

It is the game from the fake mobile ads, made real: a 1v1 crowd-cannon duel on Solana.
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

## 3. Match timeline (2:00)

| Time | Event |
|---|---|
| 0:00–0:03 | **Plant 1**: gates dealt face-down, no hints yet. Each player rigs one opponent cell. Cannons hold fire. |
| 0:03–0:40 | Phase 1: fire, reveal, peek. Hints appear at 0:03. |
| 0:40 | **Re-deal**: all 18 gates replaced with a fresh mirrored deal. Plant 2 (3 s), new Rig and Peek. |
| 1:20 | Re-deal + Plant 3. (Stretch: Double-or-Toll window opens, §8.) |
| 1:45–2:00 | **Surge**: fire rate ×2 for both players. |
| 2:00 | Timer. Higher cannon HP wins. |

Re-dealing is what keeps `?` alive: the cannon never stops, so a fixed layout is fully revealed
within seconds and rigs would have nowhere to go.

## 4. Gates

- **Deck per deal (9 cells, mirrored):** `×2, ×2, ×2, ×3, +6, +6, +10, −6, ÷2`, shuffled by VRF.
  One random cell per deal is replaced by the **gold gate**.
- **Gold gate:** `×3` or `÷3`, 50/50 by VRF, same value on both sides. Its expected effect (×1.67) is
  about equal to a normal good gate (×1.71), so taking it is a real risk call. (The v1 value ×10/÷10
  averaged ×5, so you'd always take it, and it doubled the KO rate from 22% to 48%, making luck decide.)
- **Reveal:** a gate reveals when the first cohort passes through it, and stays revealed for both
  players until the next deal.
- **Hints:** each unrevealed gate shows its true colour (blue = good, red = bad) with probability
  60%, otherwise gray. Gold always shows gold. A rigged gate shows a fake blue.
- **Op semantics on a cohort of `c` units:** `×k → c·k`, `+n → c+n`, `−n → max(0, c−n)`,
  `÷k → floor(c/k)`. Integer only.

## 5. Rig and Peek (one of each per phase)

- **Rig:** during the 3-second plant window, choose one cell in the opponent's grid (not the gold
  gate). It becomes a trap with a fake blue hint. When their stream first passes it: both screens
  flash **GOTCHA** with the rigger's emote, and the trap fires.
  - MVP trap: `÷2`.
  - Test in playtest: **Turncoat**, where the first cohort through switches sides and runs at its
    own cannon. The sim showed a ÷2 trap barely changes win rates (it costs about one volley), so
    Turncoat is the candidate to make rigs matter. Keep whichever plays better.
- **Peek:** privately see the true value of one unrevealed cell on your own side (this also exposes
  a rig). Only you can see the result.
- Rigs and peeks reset every phase. Unused ones are lost. No power-up meter in the MVP.

## 6. Mobs and combat

- A cohort is a group of units moving together: `{count, x, y}`. The cannon spawns a cohort of
  `B = 6` units every 100 ms at its current `x`. Max 32 live cohorts per side.
- A cohort crossing a gate row is affected by the gate whose column span contains its `x`.
- In the clash zone, opposing cohorts that meet subtract counts. 120 blue vs 80 red leaves 40 blue.
- A cohort reaching the enemy cannon deals damage equal to its count and is removed.
- The client draws a cohort as a swarm of sprites (capped) with a number badge; jitter is cosmetic.

## 7. HP, ending, payout

- **Cannon HP:** a config constant. Tune it so about **25% of matches end in KO**: the model hit 22% at
  2,200 HP in its own units, while v1's 1,000 HP gave 60–95% KOs and made the timer, payout margin
  and Surge irrelevant. The real value comes from playtesting the real sim.
- **KO** (HP 0) ends the match instantly. At the timer, higher HP wins; exactly equal = draw.
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
  **public fields only** (revealed gates, hints). It never reads secrets. Code review must enforce this.
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
| Juice: popups, shake, sound, GOTCHA | | |

## 12. Balance evidence (rough model)

`tools/balance/balance_sim.py` uses a flow model: affine gates, best-expected-column players, and a
skill value equal to the probability of not misplaying. It's directional, not exact. Key runs
(equal skill = 0.85 vs 0.85; gap = 0.90 vs 0.60):

| Config | KO (equal) | Better player wins | Avg moved | Avg length |
|---|---|---|---|---|
| v1 as written (HP 1000, gold ×10, fixed gates) | 62% | 78% | 85% of S | 77 s |
| v2 (mirrored, re-deal 40 s, gold ×3, Surge ×1.5, HP 2200) | 22% | 74% | 73% of S | 112 s |
| v2 with gold ×10 | 48% | 77% | 81% of S | 95 s |

The real numbers will be re-tuned with a Rust balance runner built on the actual sim crate (TECH.md, Stage 6).

## 13. Open questions

1. Turncoat vs ÷2 rig: decide in the first playtest.
2. Exact deck values and HP: decide after the Rust sim exists.
3. Stake currency: devnet SOL for the MVP (proven path); switch to an SPL test-USDC if time allows.
4. Name: not chosen yet; the team picks it later.
