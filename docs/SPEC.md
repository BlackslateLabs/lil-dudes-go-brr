# Lil Dudes Go Brr: Game Spec v4

Status: **PROPOSED (2026-11-22), replaces v3.** Suparno decided the direction; Kai to confirm or
amend (PROGRESS_LOG). Numbers are starting values, measured from the genre where possible, to tune
in playtests. The idea in plain words: [IDEA.md](IDEA.md). Tech: [TECH.md](TECH.md).

**What changed from v3:**
- **Two stages, town hall finale.** The separate Raid stage is gone. Fight 2's base has the town
  hall (the old vault) at the far end; when Fight 2's towers fall, the raid starts **in place**: the
  big mob that was hitting the towers rolls straight on into the town hall (§3).
- **Gate edges count.** A cohort a little outside a gate's (or crate's) edge still goes through it
  (`GATE_GRACE`); where two gates overlap, the nearest centre wins (§6).
- **Big gates are much wider** (1,000 instead of 700); layouts re-authored around them (§9).
- **Rig from your own lane.** Rig is no longer tied to your Plant: any time you are alive and not
  done, once per stage, you name a gate of **your current stage** and it rigs the opponent's copy of
  that gate (§6). The bot rigs 1–3 s into its fight (§10).

The v3 change still holds: the two players don't fight each other. Each fights **the same enemy
base** on their own identical copy of one level (a race), the way the genre's single-player fights
work. Losing = an enemy reaches your cannon. Otherwise the gold you earned decides the payout.

## 1. The game in one paragraph

**Lil Dudes Go Brr** is the game from the fake mobile ads, made real, as a 1v1 race on Solana. Both
players get an identical copy of the same level: an enemy base with towers that pour waves of
troops down a lane toward your cannon, and gates in between that multiply your dudes. Your cannon
fires nonstop; you steer it. Grow your crowd through the gates, grind down the waves, knock out the
towers, and the moment the last one falls your crowd storms the town hall for loot. If one enemy
dude reaches your cannon, you're dead and your opponent takes the whole pot. If you both survive,
the pot is split by the gold you each earned. Every gate shows `?` until your dudes pass through it,
and once per stage you can secretly **rig** a gate on your opponent's copy and **peek** at one of
your own. The match runs in a MagicBlock Private Ephemeral Rollup, so nobody can see hidden gates or
rigs, and payment settles automatically.

**Pitch:** "We made the fake ad real. Race a friend through the same level, on-chain, and they may
have rigged your gate."

## 2. The arena (one copy per player)

```
  ████ TOWN HALL ████           <- the enemy base edge (y = LANE_LENGTH); raided after Fight 2
   [T1]        [T2]             <- towers with HP labels; they release waves
                                   enemy waves walk down the lane toward your cannon
     ?      ?                   <- sparse gate rows: 1-3 gates per row, open lane between
        <-  ?  ->               <- some rows slide (conveyor gates)
   [crate 40] ?                 <- a big gate locked behind a crate
  ==========[CANNON]==========  <- your cannon line (y = 0): an enemy crossing it kills you
          (thumb space)
```

- **One lane per player, identical copies.** Same level layout, same gate values, same wave
  schedule. Nothing either player does touches the other's lane except a **rig** (§6). Your screen
  shows your lane full size and a small live view of your opponent's lane, gold and stage.
- **Control:** drag anywhere to slide the cannon left/right; it auto-fires. The cannon's `x` moves
  toward the aim by at most `CANNON_STEP` per tick; volleys spawn at the sim's `x`.
- **Coordinates:** `x` across the lane `0..LANE_WIDTH`; `y` from your cannon line (0) up to the base
  edge (`LANE_LENGTH`). Your dudes move +y, enemy troops −y.
- **Proportions (genre-measured):** a fresh volley reaches the first gate row in ~0.3 s; gates sit in
  the third of the lane nearest the cannon; a dude needs ~7–8 s from the cannon to a tower on an
  empty lane, so the long walk up is where the fight happens.
- **(impl)** A done player's cannon still follows the aim; nothing else happens in that lane.

## 3. A level: stages and the race

A level has **2 stages**: **Fight 1** (one tower) and **Fight 2** (two towers, the town hall behind
them). Each player moves through them **at their own pace**: knock out every tower in a fight and you
move on; your opponent may be ahead or behind.

| Phase | Length | What happens |
|---|---|---|
| **Plant** | 3 s | The stage's gates appear face-down. No waves yet, your cannon holds fire (you can move it). |
| **Fight** | until every tower is down | Your cannon fires; towers release waves; rig and peek allowed (§6). |
| **Transit** (after Fight 1) | 2 s | Fight 1 cleared: the field is wiped (your dudes and theirs), the cannon drives up to Fight 2. |
| **Raid** (after Fight 2) | 8 s of firing | Fight 2's last tower fell: the raid starts **in place, no wipe**. Your dudes already in flight keep going, leftover enemies keep walking (and can still kill you), no new waves. The cannon fires for `RAID_TICKS` more; every dude that reaches the town hall earns loot (§5). |

- Flow: Plant → Fight 1 → Transit → Plant → Fight 2 → Raid → Done.
- A player is **done** when their raid ends: fire over and no dudes of theirs left on the lane. Any
  enemies still on the lane leave with it (nothing can hang the match).
- **The match ends** when (a) a player dies (§4), at once, or (b) both players are done, or
  (c) the **time cap** `MATCH_TICKS` (3:00) is reached: whatever each player has earned so far counts.
- Typical match: plant 3 s + fight 1 ~20–27 s + transit 2 s + plant 3 s + fight 2 ~26–36 s + raid
  ~14 s ≈ 1:10–1:20. The cap only bites if someone stalls.
- **(impl)** Each phase has its own per-player tick counter (`phase_ticks`, 0 on its first tick),
  **except that the Raid keeps counting the Fight's ticks**, so sliding gates and the volley rhythm
  carry on through the switch without a jump. A separate public counter `raid_ticks` (0 before the
  raid) times the raid's fire window. The cannon fires on fight ticks 0, 8, 16, … (the first volley
  on the first Fight tick) and keeps that rhythm in the raid while `raid_ticks < RAID_TICKS`.
- **(impl)** When Fight 1's last tower falls the player enters Transit and their `stage` moves on at
  once: the field is wiped and Fight 2's towers, crates and face-down gates are loaded, so Transit
  already shows (and a rig already names) Fight 2. Plant and Transit have no units.
- **(impl)** The raid starts on the tick Fight 2's last tower falls (that tick is raid tick 0). Its
  travel tail (8 s of fire + ~6 s for the last volley to reach the town hall) makes it ~14 s.

## 4. Towers, waves, death

Genre numbers (from the data and the measured recording): towers fire waves in a big → small →
medium cycle, **6.5 / 6.5 / 4 s** apart, the first ~3.25 s after the fight starts, and waves fade
over time so every fight ends.

- **Tower:** `x`, `hp` (layout), sits at `TOWER_Y`. HP label on the tower (`1.2K` style).
- **Waves:** each live tower releases one enemy cohort at its `x`:
  - first wave `FIRST_WAVE_TICKS` (0.5 s) after the fight starts (the 3 s plant is the grace);
  - then on the cycle `WAVE_GAPS = [130, 130, 80]` ticks (6.5 / 6.5 / 4 s);
  - size = `wave_base × cycle% × fatigue‰`, cycle% = `[115, 85, 100]` (big, small, medium), at least 1;
  - **fatigue** (genre): 1000‰ for the first 15 s of the fight, then falling linearly to 100‰ at
    45 s, and 100‰ after. Stalemates can't last. (The genre also resizes waves to how you're doing;
    we **don't**: it would make an identical-copies race unfair.)
  - A destroyed tower releases nothing more. The raid releases no waves.
  - **(impl)** Waves spawn at the tower's `x` on `TOWER_Y`. All live towers of a fight share the
    one schedule (Fight 2's two towers release together, down their own columns).
- **Enemy troops** walk down at the same cruise speed as your dudes, toward your cannon line.
  They are not affected by gates.
- **Death:** if any enemy cohort reaches `y ≤ 0` (your cannon line), you **die** instantly, in the
  raid too. Both players dying on the same tick = draw.
- **(impl)** The death check runs after movement, clash and tower hits, so a volley at the line can
  still stop an enemy; a death beats a tower falling on the same tick.
- **Clash:** your cohorts and enemy cohorts that meet cancel 1:1 (`min(a, b)` from both). They meet
  once they've crossed each other in `y` and their `x` differ by at most `CLASH_REACH`. Front-most
  pairs resolve first.
  **(impl)** "Crossed" = your cohort's `y` is at or above the enemy's by at most `CLASH_BAND`
  (400, more than the fastest closing speed per tick, so no crossing pair skips it); pairs further
  past each other have missed. Front-most = stored order (oldest first) on both sides.
- **Targeting (genre: units home in):**
  - An enemy cohort steers sideways (`STEER_STEP` per tick) toward the nearest of your cohorts in
    front of it within `DETECT_Y`; otherwise it walks straight down.
  - Your cohort walks straight while it is still among the gate rows (aiming is your job). Past the
    last gate row it steers toward the nearest enemy cohort in front within `DETECT_Y`, else toward
    the nearest live tower, or **in the raid toward the town hall's centre** (`HALL_X`, mid-lane).
  - **(impl)** "Nearest" enemy/cohort = smallest squared distance (ties: the older one); nearest
    tower = smallest `|dx|`. Raid cohorts still clash with any enemy ahead before the town hall.
- **Hitting a tower:** a cohort that reaches `TOWER_Y` within `TOWER_HALF_W + CLASH_REACH` of a live
  tower's `x` deals damage = its count and is removed (kamikaze, as in the genre). A cohort that
  reaches the base edge without hitting anything is lost.
  **(impl)** The whole cohort is removed even on overkill.
- **Crates (locks):** some big gates sit behind a crate with a counter. A cohort crossing the crate's
  row inside its span is absorbed into it (`min(count, crate hp)` units are spent); at 0 the crate
  breaks and the gate behind it is open. Crates are part of the layout, identical for both.
  **(impl)** A crate sits 300 below the row of the big gate it locks and covers that gate's span
  (1,000); its edges count like a gate's (`GATE_GRACE`, §6); a locked gate never moves. A cohort
  that breaks a crate goes on with what is left.

## 5. Gold

Gold is the "loot" of the genre: you earn it by hurting the base.

| Source | Gold |
|---|---|
| Damage to a tower | 1 per point of damage actually dealt (overkill earns nothing) |
| Tower destroyed | `TOWER_BONUS` (50) |
| Raid: a dude reaches the town hall | `LOOT_PER_UNIT` (2) per dude |

**(impl)** The town hall spans the whole base: a raid cohort loots when it reaches `VAULT_Y =
TOWER_Y`, anywhere across the lane.

The tower part is roughly the same for two players who clear both fights, so **the raid decides
most close matches**. Because the raid starts in place, the crowd you built to break Fight 2's towers
is the crowd that storms the town hall: about half of all gold comes from the raid (§12).

## 6. Hidden gates, Rig and Peek

- **Gates:** each stage's gates come from the layout (position, width, movement, slot type). Their
  **values are hidden** (`?`) until your first cohort passes through, then shown to both players
  (in your copy). Values are dealt per stage from the VRF seed and are **identical in both copies**.
  - **Normal slot:** a multiplier drawn from the genre's distribution: ×2 47%, ×3 34%, ×4 12%,
    ×5 4%, ×6 3%.
  - **Big slot** (usually behind a crate): ×6 30%, ×8 40%, ×10 30%.
  - **Op:** `×k → c·k`. Integer, saturating. A gate row applies **once per cohort** (track the last
    row passed). A cohort in a gap passes unchanged. The raid uses Fight 2's gates as they are
    (revealed ones stay revealed, broken crates stay broken).
  - **Edges count:** a cohort is a point in the sim but is drawn as a small crowd, and a gate has
    posts. A cohort passes a gate if `|x − gate x| · 2 ≤ width + 2 · GATE_GRACE` (`GATE_GRACE =
    100`). If two gates of a row both match, the **nearest centre** wins (the lower slot on ties).
    Crates use the same grace.
  - **(impl)** Gate **slots** = a stage's gates in layout order (by row, then `x`); Rig and Peek
    name a slot. Normal gates are 600 wide (some layouts use 500 or 700), big gates 1,000. The test
    is made at the gate's `x` on the crossing tick.
- **Moving gates:** a gate with `speed ≠ 0` slides between `x_min` and `x_max` and back (ping-pong),
  `speed` sim units per tick, measured from the start of that player's Fight (the raid carries on
  from where the fight left it). Its `x` is public at every tick.
  **(impl)** Before that (Plant, Transit) it waits at its start `x`; it starts toward +x if
  `speed > 0`, else toward −x.
- **Rig (once per stage, from your own lane):** any time you are alive and not done (Plant, Fight,
  Raid or Transit), you name one gate slot of **your current stage**; it rigs the **same slot of the
  same stage in your opponent's copy** (both lanes are the same level). It becomes a **trap** with
  the same `?` face. When their first cohort passes it: both screens flash **GOTCHA**, and from then
  on it acts as `÷2` for the rest of that stage (`÷k → floor(c/k)`).
  Refused (and not used up) when: the opponent is dead or done; the opponent has already moved past
  that stage; the opponent is on that stage and has already revealed that gate in their copy; the
  slot doesn't exist; or that opponent stage already holds a rig. A rig on a stage the opponent
  hasn't reached yet is allowed and springs when they get there. An unused rig does not carry over
  to your next stage.
  **(impl)** The trap applies from the moment the rig is placed (so the first pass already gets
  `÷2`; rigs can't land on revealed gates, so no shown value ever changes). The rig is recorded
  under the rigger's own stage, naming the victim's stage (always the same stage now) and slot.
  The public state shows only "rig used this stage", never which gate. Whether a rig would be
  accepted can be decided from public state alone (`can_rig`): a rig on the opponent's stage `k`
  can only come from your own stage `k`, so "already rigged" is your own `rig_used`.
- **Peek (once per stage, during your Fight or Raid):** privately see the true value of one of your
  own unrevealed gates in your current stage. A rigged gate peeks as `÷2`. Refused on a revealed
  gate (and not used up).
  **(impl)** The result is frozen when you peek (a rig placed later doesn't update it). Fight 2 and
  its raid are one stage: one peek covers both.
- **Privacy:** gate values, the seed, rigs and peeks live in the private Secrets/Peek accounts (TECH
  §4). The public Match account holds only revealed values, gate positions and everything else.

## 7. Cannon, volleys, cohorts

- The cannon fires a **volley** every `FIRE_TICKS = 8` ticks (0.4 s; genre 0.38 s): one cohort of
  `VOLLEY_SIZE = 1` dude at its `x` (genre: one unit per shot; the gates make the flood).
- **Launch:** for its first `LAUNCH_TICKS = 6` ticks a cohort moves at `LAUNCH_SPEED` (3× cruise),
  then at `CRUISE_SPEED`.
- Caps: `COHORT_CAP = 40` live cohorts of yours, `ENEMY_CAP = 16` enemy cohorts per lane (a wave
  that would exceed it merges into the newest enemy cohort of that tower).
- **(impl)** At `COHORT_CAP` a volley is skipped. Without an enemy cohort of that tower the merging
  wave joins the newest enemy cohort of any tower. Cohort and enemy ids share one counter.

## 8. Ending and payout

- **Death:** the survivor wins the pot. Money moved = `S` (the loser's whole stake).
- **Both survive (both done, or the cap):** the pot `2S` is split **in the ratio of gold earned**:
  `share_a = floor(2S · gold_a / (gold_a + gold_b))`, `share_b = 2S − share_a`. The player with more
  gold is the winner; money moved = `share_w − S`.
  Equal gold, or both 0 → **draw**, nothing moves.
- **Fee:** 5% of the money moved, from the winner's side, to the treasury (`fee = floor(moved·500/10_000)`).
- **Stakes:** Free, 0.05, 0.1, 0.25 devnet SOL; matched stake `S` = the lower pick; each player escrows `S`.
- **Integer rules:** all in lamports, floors favour the loser; conservation is exact.

| S = 1.00 | Gold | Moved | Fee | Winner nets |
|---|---|---|---|---|
| B dies | – | 1.00 | 0.05 | +0.95 |
| 900 vs 600 | 60% / 40% | 0.20 | 0.01 | +0.19 |
| 700 vs 650 | 51.9% / 48.1% | 0.037… | 0.0018… | +0.035… |
| 500 vs 500 | draw | 0 | 0 | 0 |

## 9. Layouts

- A **layout** = 2 stages; each stage lists its towers (`x`, `hp`, `wave_base`), gate rows (`y`) with
  1–3 gates each (`x`, `width`, slot type, optional movement), and crates. Fight 2's base is the
  town hall. Layouts are hand-designed in `crates/sim/src/layouts.rs` (a pool of 6 for the MVP);
  the VRF seed picks one per match (`layout = seed % LAYOUTS`, public once seeded).
- **(impl)** The MVP pool: 0 Twin Lanes (two clean side lanes, a sliding / locked middle),
  1 Conveyor (almost everything slides), 2 Long Shot (a locked big gate off to the side vs a safe
  path), 3 Funnel (everything through the middle, towers on the flanks), 4 Zigzag (rows alternate
  sides), 5 Stairway (a diagonal staircase of single gates). Rows at 1,400 / 2,400 / 3,400 (or
  1,400 / 2,300 / 3,200 / 4,100). Tower HP and `wave_base` are set per layout by the balance runner
  so every layout plays about as long and as dangerously.
- Design rules (genre-measured): rows hold **mostly 1–2 gates** with open lane between (a miss is a
  real miss); the first row sits ~1,400 units from the cannon, rows ~900–1,100 apart; the best
  multiplier is front-loaded; at least one sliding row per layout; at least one big gate behind a
  crate; towers placed so the waves come down different columns.
- **(impl)** With the grace edges: gates of a row keep at least `MIN_GAP = 2·GATE_GRACE + 200`
  (400) of open lane between them over their whole sweep, and a row covers at most two thirds of
  the lane counting each gate's grace edges; every gate stays on the lane over its sweep; a crate
  is as wide as its big gate (so it covers the gate's span, grace included). The layout test
  (`layouts_follow_the_design_rules`) checks all of it.
- More creative gates, obstacles and bases come later (idea pool: pipes, turbo pads, sweeping
  bars, portals, surprise gates, cages that grant a champion, a telegraphed lane attack).

## 10. Bot

- The **Warlord bot** plays the other copy using **public fields only** (its own lane, revealed
  values, gate positions); it never reads secrets (enforced by the type signature).
- Every 2 ticks: (1) **defend**: if an enemy cohort is within `DEFEND_Y` of its cannon, aim at it;
  (2) otherwise aim where its next volley gains the most: score candidate `x` positions by the
  product of the gates it would pass (revealed value, else ×2 expected, moving gates predicted at
  arrival time, edges counted as in §6, locked gates count only once the crate is broken);
  (3) alternate between ties every 20–60 ticks. It peeks a random own `?` at the start of each
  fight. Once per stage, at a random moment **1–3 s into its fight**, it rigs a random gate of its
  own current stage that is still face-down in its copy and that the rig rule accepts.
- **(impl)** Candidate aims every 100 across the lane. An unrevealed gate counts ×2 (normal slot)
  or ×8 (big slot). The estimate follows the volley's actual count: an unbroken crate in the way
  absorbs its HP first, so the bot never aims through a crate (and never breaks one on purpose).
  Defend aims at the lowest enemy within `DEFEND_Y`. Among tied spots it aims at a random point of
  the tied run (so two bots don't play identically) and moves to the next tied run every 20–60
  ticks. The rig moment (20–60 ticks) and slot come from the bot's own RNG; it never rigs when the
  rule would refuse (opponent finished or already past that stage, gate revealed in their copy).
- **Tutorial / holding back:** in the tutorial the bot's waves are irrelevant (it is a race, not a
  duel): instead the **player's** fight 1 waves are at 50% so a newcomer can't die early. Free only.
- Bot matches are free. The bot never takes stakes.

## 11. Fairness and anti-cheat

- The sim is authoritative on-chain. Clients only send aim, rig (gate) and peek (gate).
- Identical copies: same layout, same values, same wave schedule; no adaptive difficulty in PvP.
- **No rage-quit:** a disconnected player's cannon keeps firing at its last position.
- **Verify:** at the end the seed, every rig and peek are public; the result screen re-derives
  every stage's values and the layout and checks every revealed gate.

## 12. Constants (starting values)

| Constant | Value | Notes |
|---|---|---|
| Tick | 50 ms | 20 ticks/s |
| `MATCH_TICKS` | 3,600 (3:00) | time cap |
| `STAGES` / `FINAL_STAGE` | 2 / 1 | Fight 1, Fight 2 (+ its raid) |
| `PLANT_TICKS` / `TRANSIT_TICKS` / `RAID_TICKS` | 60 / 40 / 160 | 3 s / 2 s / 8 s |
| `FIRE_TICKS` / `VOLLEY_SIZE` | 8 / 1 | genre 2.6 shots/s, 1 unit |
| `CRUISE_SPEED` / `LAUNCH_SPEED` / `LAUNCH_TICKS` | 80 / 240 / 6 | ~7.5 s cannon → tower |
| `LANE_WIDTH` / `LANE_LENGTH` / `TOWER_Y` | 3,000 / 12,000 / 11,000 | |
| `TOWER_HALF_W` | 300 | |
| `CLASH_REACH` / `STEER_STEP` / `DETECT_Y` | 400 / 40 / 4,000 | |
| `CANNON_STEP` | 600 | lane in 5 ticks |
| `COHORT_CAP` / `ENEMY_CAP` | 40 / 16 | per lane |
| `FIRST_WAVE_TICKS` / `WAVE_GAPS` / cycle% | 10 / [130,130,80] / [115,85,100] | genre |
| Fatigue | 1000‰ to 300 ticks, → 100‰ at 900 ticks | genre 15 s → 45 s |
| `TOWER_BONUS` / `LOOT_PER_UNIT` | 50 / 2 | |
| `GATE_GRACE` | 100 | gate and crate edges count |
| Gate widths **(impl)** | 600 normal (500/700 in some layouts), 1,000 big | |
| `DEFEND_Y` (bot) | 3,000 | |
| Bot rig moment **(impl)** | 20–60 ticks into its fight | 1–3 s |
| `FEE_BPS` | 500 | |
| `CLASH_BAND` **(impl)** | 400 | how far past each other a crossing pair still meets |
| `VAULT_Y` / `HALL_X` **(impl)** | 11,000 / 1,500 | town hall line (= `TOWER_Y`) / centre the raid steers to |
| `MIN_GAP` **(impl)** | 400 | layout rule: open lane between gates of a row |
| Tutorial waves **(impl)** | 50% | side 0, Fight 1 |
| Limits **(impl)** | 4 rows, 8 gates, 2 towers, 2 crates per stage | fixed-size state |

**(impl) Balance (bot vs bot, 2,000 matches per layout, `cargo run -p lil-dudes-sim --example
balance --release`):** deaths 12.6–16.6% per layout (14.5% overall; about a third in Fight 1, the
rest in Fight 2, none so far in the raid), matches ~1:10–1:21 (1:15 average), Fight 1 ~22–27 s,
Fight 2 ~26–36 s, raid ~14 s, the raid ~38–66% of all gold (55% overall). Two bots on identical
copies often tie on gold (~48% draws; 88% on Stairway, whose single-gate rows leave the bots
nothing to choose); people won't play identically. v3 for comparison: 14.7% deaths, ~1:31, raid
35% of gold, 58% draws.

## 13. MVP scope

| MVP | Stretch | Later |
|---|---|---|
| 1v1 race on identical copies, 2 stages + town hall raid | Turncoat trap (rigged gate turns dudes against you) | More layouts, pipes, turbo pads, portals, cages |
| Towers, waves with fatigue, death on contact | Champion / Giant meter | Spectator view |
| Hidden `?` gates (VRF), sliding gates, crates | Emotes | Tournaments, leaderboards |
| Rig on the opponent's copy, Peek | Test-USDC stakes | Real money anything |
| Gold, raid loot, ratio payout, stakes, settlement | | |
| Burner, bot, room codes, quick match | | |
| Result screen + Verify + explorer links | | |
| Guided first match (skippable) | | |

## 14. Open questions

1. Payout when both survive: split by gold ratio (as written) — confirm the reading of "take in ratio
   of gold earned".
2. Raid length (8 s, genre-measured) vs a shorter final window. With the raid in place it is now
   ~half of all gold: is that too decisive?
3. Trap: `÷2` for the MVP vs Turncoat.
4. Layout pool contents (6 for the MVP; Suparno will add designs after playing the genre). Stairway
   plays nearly identically for two bots (88% gold ties); worth a rework.
5. **(impl)** When the raid ends, leftover enemies simply leave (so a finished lane can't hang the
   match). Alternative: keep them walking until they die or reach the line.
6. **(impl)** Rig while in Transit names Fight 2 (your `stage` already moved on). Rigging Fight 2
   while the opponent is still in Fight 1 is allowed and waits for them; rigging is refused once
   they are past your stage, so falling behind costs you that stage's rig.
