# Lil Dudes Go Brr: Game Spec v5 (changes to v4)

Status: **agreed by Kai, 23 Nov 2026** (Suparno to review). Written as changes to `docs/SPEC.md` v4:
everything not listed here stays as v4. Where they disagree, this file wins.

---

## 0. v5 in one paragraph

Two players race **the same seeded level at their own pace**:
- **Fight 1**: one tower.
- **Fight 2**: two towers guarding the town hall.
- When your last Fight 2 tower falls you **BREACH**: a **3-2-1 Rush** (3.5 s) in which everything
  you still have on the lane, plus what you fire, storms the hall and counts.

Rules:
- **Gates are hidden** until a dude touches them. Most multiply, some hurt. One **timing gate** per
  stage cycles ×1 → ×5, and you pick the moment.
- **Both players get the same tools:** a **Champion** (a giant worth 8 that multiplies through
  gates, charged by fight time) and **Scout** (privately reveal one gate per stage).
- **No rig. No opponent mini-view,** just a thin progress line.
- **If an enemy reaches your cannon line, you lose the whole pot.**
- **If both survive:** the higher score wins; the winner keeps their stake plus a slice of the
  loser's stake equal to twice the winning margin.

---

## 1. What changes from v4 (summary table)

| Area | v4 (main) | v5 | Why |
|---|---|---|---|
| Rig | Once per stage, ÷2 on the opponent's copy | **Removed** | Kai: skill-based, no sabotage |
| Opponent view | Mini-lane | **Progress line only** (their stage, tower HP bar, score) | Kai; also removes the copying leak for honest players |
| End of Fight 2 | 8 s raid (+~6 s travel tail ≈ 14 s) | **Rush: 70 ticks (3.5 s) after the breach**; only dudes that reach the hall in that time count | Kai ("no waiting, count the army with a ~3 s timer"); Suparno's end rule (approved by Kai, 23 Nov); the genre uses this shape (1 s VICTORY stamp, then a 3.6 s countdown while the crowd keeps counting) |
| Gates | × only (×2–×6), big ×6–×10 | Hidden **×2–×5, ÷2, +N, −N** (± from row 2, sized to the row); big ×6–×10 behind crates; **1 timing gate per stage** | Kai: good and bad hidden gates; timing gate = fair skill gate (replaces the parked market gate) |
| Powers | Rig + Peek | **Champion** (meter) + **Scout** (= Peek) | Same tools for both; the reference's baseline champion is exactly this |
| Score | Gold (damage 1/pt, tower 50, raid loot 2/dude) | Same gold **+ FIRST bonus 50 per fight** (earlier breach tick) **+ Rush count** (2 per dude) | Kai: breaching first scores more; speed is rewarded by the tick |
| Payout (both survive) | Pot split in the ratio of gold | **Winner keeps own stake + takes `2 × margin` of the loser's stake (no cap)** | Kai: winner ≥ 50%, the rest decided by the scores, no cliffs |
| Death | Survivor takes the pot | Same | Kai |
| Bot | Rigs 1–3 s into a fight | No rig; fires the Champion when charged; Scouts at the start of a fight | |
| Time bonus | (none) | **None** (dropped) | FIRST + Rush already reward speed; simpler |
| Market gate | (parked) | **Post-MVP** | Kai |

Everything not listed (towers, waves, fatigue, clash, death check, crates, cohorts, homing, layouts
mechanism, 3:00 cap, tick = 50 ms) **stays as v4**.

---

## 2. Match flow

```
Plant 3 s → Fight 1 → Transit 2 s → Plant 3 s → Fight 2 → BREACH → Rush 3.5 s → Done
```

- **Own pace:** each player moves on when their own towers are down. The opponent may be ahead or
  behind. Their progress line shows "THEM: Fight 2 · towers 40% · 312".
- **Breach (Fight 2's last tower falls):**
  - no new waves;
  - your cannon keeps firing for `RUSH_TICKS` = 70;
  - leftover enemies keep walking and can still kill you;
  - your dudes steer to the hall; a dude that reaches it scores `LOOT_PER_UNIT` (2) at once.
- **When the Rush ends:** dudes still on the lane do **not** count; the lane freezes and is
  cleared, and you are **done** at once (Suparno's rule, approved by Kai 23 Nov; the sim emits
  `RushEnd { side, lost }` so the UI can show what was left behind).
  - A fresh volley needs ~126 ticks to reach the hall, more than the Rush, so in practice the
    Rush counts the crowd already past the last gate row at the breach: the army you built.
    Firing during the Rush is for show.
- **Fight 1's breach has no Rush:** Transit starts at once, as in v4. It still scores FIRST.
  - Open question Q1: a 2 s mini-rush in Fight 1 too?
- **The match ends when:**
  - a player dies (at once); or
  - both are done; or
  - the 3:00 cap is hit (scores so far count).
- **No finish timer** for the slower player (Kai): the cap is the only limit.

## 3. Gates (hidden)

- **A normal `?` slot** draws its value from the seed, the same in both copies.

  | Kind | Value (starting distribution, tune with the balance runner) |
  |---|---|
  | **Good:** ×2 30%, ×3 20%, ×4 8%, ×5 2%, +N 12% | ~72% |
  | **Bad:** ÷2 14%, −N 12%, ÷3 2% | ~28% |

  - **+N / −N only from row 2,** with N sized to the crowd expected there:
    - row 2: ±5 (rules v7: ±1)
    - row 3: ±15 (v7: ±3)
    - row 4: ±30 (v7: ±6)

    On row 1, a single dude makes +5 act like ×6 and any −N wipe the shot. Rules v7 (§12): row 1
    draws only ×2–×5, and N is resized to the column crowds.
  - Ops (integer, saturating): `×k: c·k` · `÷k: floor(c/k)` · `+N: c+N` · `−N: max(0, c−N)`
    (a cohort at 0 dies).
- **A big slot,** usually behind a crate: ×6 30%, ×8 40%, ×10 30%. Always good; the crate is the
  price.
- **A gate flips face-up in your copy** the first time one of your dudes touches it (v4 rule). The
  first reveal plays a loud good or bad sting; later passes are quiet ticks.
- **Timing gate (new),** one per stage, placed by the layout:
  - always visible, shown as a ring with the current value;
  - its value **cycles ×1 → ×2 → ×3 → ×4 → ×5 → ×1**, one step per second, by the player's phase
    tick: `value = 1 + (phase_ticks / 20) % 5`. Both copies have the same phase at the same phase tick;
  - skill: send your volley through it on ×5;
  - costs one modulo per pass, needs no oracle.
- **Later (not v5):**
  - the enemy gate: it multiplies enemy waves until you push 40 dudes through it, then flips to you;
  - the market gate;
  - surprise buff gates.

## 3b. Layout rules 

- **Fixed difficulty per layout, the same for both players.**
  - No difficulty that adapts to the player: no level-based HP growth, no win/loss steps.
  - Keep only the in-fight wave timing and fatigue.
- **The best gate comes first.**
  - Row 1 holds the strongest value range.
  - The best gate per row falls row by row (genre: ×3.6 → ×2.9 → ×2.6).
- **Grow at the front, lose at the back.**
  - Gates sit in the first half.
  - Crates and hazards sit between the last gate row and the towers.
  - Push our last gate row from ~4,100 to **~5,500–6,500**, with row gaps **~1,300**.
- **Big gates are exposed but awkward:** early, off-centre, or guarded by a sliding hazard or decoy.
  **At most one** big gate locked behind a crate per layout.
- **PvP readability:**
  - gates within a narrower band of the lane;
  - fewer crates;
  - about 4–5 gates per stage.
- **Themes are reskins:** 3 of our own looks rotated per match. Cosmetic only, never a rule change.
- The 6 hackathon layouts are re-tunes of today's six (`crates/sim/src/layouts.rs`).

## 4. Champion and Scout (same for both players)

- **The trigger (rules v6, Suparno, 23 Nov):** the cannon fires **only while you hold the lane**
  (finger down; drag to aim while holding). No finger, no volleys. On chain: `set_fire(on)`.
- **Champion:**
  - its meter fills only by shooting: each volley fired in a Fight adds `FIRE_TICKS` (8); full at
    `CHAMP_TICKS` = 160 (20 volleys = 8 s of holding). No shooting, no charge;
  - **let go of the lane with a full meter** → the Champion goes out on the next tick: a
    **Champion cohort** of count 8, flagged `big`. The 👑 is a meter, not a button
    (`champion()` still works for scripts and the bot API);
  - it **goes through gates like any cohort and multiplies**: drawn as one giant per 8 dudes,
    so a ×3 gate makes three giants;
  - in a clash it counts as its number of dudes;
  - the meter resets and refills; it **carries from Fight 1 into Fight 2;**
  - the bot holds the trigger and lets go for one tick as soon as it is charged.
  - Chain: `set_fire(on)` (burner-signed; a release can call it) and `champion()`; the Champion
    spawns on the next tick.
- **Scout** (v4 Peek, unchanged):
  - once per stage, during your Fight or Rush;
  - privately see one of your face-down gates' true value;
  - private account, member = your burner.
- **Later, a second power-up from the same menu for both:**
  - **Summon Gate ×3:** a temporary ×3 gate where you aim, for 5 s;
  - or **Rage:** your dudes ×2 strength, ×2 speed, for 4 s.

## 5. Fight 2 gets teeth (Should: if the balance runner is happy)

- **Turret tower:** one of Fight 2's two towers fires a burst every 60 ticks that removes 2 dudes from
  the nearest cohort within 3,000 of it. "Don't trickle, build a crowd first."
- **Giants:** the small wave of each cycle in Fight 2 includes one giant enemy cohort (worth 5,
  speed ×0.6).

## 6. Score

| Part | Points |
|---|---|
| Damage to a tower | 1 per point actually dealt (v4) |
| Tower destroyed | 50 (v4 `TOWER_BONUS`) |
| **FIRST breach of a fight** | **+50** to the player whose breach tick is lower (ties: nobody) |
| **Rush:** a dude into the hall, or still on the lane at the end of the Rush | 2 each |

- Equal scores → **draw**: stakes back, no fee. Rarer now, because the Rush counts almost never match.
- **(impl)** Each player's breach ticks are stored in the public state. FIRST is settled when the
  later player breaches, or at the end if only one did.

## 7. Payout

- **Pot:** both stakes, `2S`. **Fee:** 5% of what actually moves.
- **Someone died:** the survivor gets `2S − fee`, with `fee = S × 5%`. Both died on the same tick:
  draw.
- **Both survived**, winner score `w` > loser score `l`:

  ```
  slice_bps = min(10000, 20000 × (w − l) / (w + l))   // 2 × margin; 100% once w ≥ 3·l
  moved     = S × slice_bps / 10000
  fee       = moved × 500 / 10000
  winner    = S + moved − fee
  loser     = S − moved
  ```

  Integer, floors; `winner + loser + fee = 2S` always.

| Scores | Winner share of the pot | Winner / loser / fee at S = 0.1 |
|---|---|---|
| 401–399 | 50.25% | 0.100475 / 0.0995 / 0.000025 |
| 520–480 | 54% | 0.1076 / 0.092 / 0.0004 |
| 600–400 | 70% | 0.138 / 0.06 / 0.002 |
| 700–300 | 90% | 0.176 / 0.02 / 0.004 |
| 750–250 and beyond | 100% | 0.195 / 0 / 0.005 |
| Death | 100% | 0.195 / 0 / 0.005 |

## 8. Screens and feel

| Screen | v5 |
|---|---|
| **Home** | One big primary button. First visit: **Play vs Bot (free)**, no wallet. Then Quick Match / Room Code with stake chips (Free · 0.05 · 0.1 · 0.25 devnet SOL). A slow bot-vs-bot match loops behind. |
| **Stake confirm** | One sheet: "Stake 0.1 · pot 0.2 · fee 5% of what moves · devnet" → sign once. |
| **VS / matchmaking** | At least 1 s. The real chain steps are the loading copy ("Locking stakes…", "Rolling the dice (VRF)…", "Entering the private arena…"). Then both cards (name, avatar, stake) → VS → LIVE. A bot is always labelled **Bot**, and never appears in staked play. |
| **Match HUD** | Slim timer pill, your score, the opponent progress line, Champion button + meter, Scout. **No pause in PvP:** a cog with sound / vibration / "Leave (forfeit)". |
| **First match (tutorial)** | No rules page. 4–5 one-line bubbles above the cannon, each ticked off: "Drag to aim" → "Gates multiply your dudes" → "Break the tower" → "Don't let them reach you" → "BREACH! Keep firing!". The bot can't overrun you in your first Fight 1. |
| **End sequence** | "BREACH!" stamp (1 s, battle sounds ducked) → big 3-2-1 (3.5 s) while dudes pour in and a counter climbs → "TIME!". Overrun: a red flash, a short sting, a sad music bed. |
| **Result** (scripted, ~6–8 s, tap to skip) | Banner → your score vs theirs, counting up **part by part** (damage, towers, FIRST, Rush) → the **payout split animates into your pill** (+0.038 SOL) with a coin shower → fee line → **Rematch** · Home → **Verify** + explorer links. "New record!" tag for a personal best. |
| **Transitions** | A logo wipe (0.8 s in / 0.35 s out) between Home, Match and Result, hiding loads. |
| **Sound** | Variants, voice caps and cooldowns (have). Add: rising ladders for every count-up, the breach stamp, countdown ticks, the payout coin ladder, VS whoosh, wipe sounds, one battle and one menu CC0 music loop, a mix that ducks battle sounds in the end sequence, `navigator.vibrate` on 4 big moments. |

## 9. Chain impact (program `lil_dudes`)

- **Remove:**
  - `plant_rig` and the rig fields (`gotcha`, the rig part of history and Peek);
  - the bot rig.
- **Add:**
  - `champion()` (burner-signed, like `set_aim`);
  - per-player `champ_meter` (u8), `champ_pending` (bool), `big` flag on a cohort, `breach_tick[2]`
    (u16 per fight), `rush_ticks`.
- **Sim:**
  - gate ops ± and ÷ (already ÷ for rig);
  - timing gate;
  - Rush end count;
  - FIRST;
  - the new payout in `payout.rs` and `settle`.
- **Sizes change** (codec version bump). Deploy **once** after v5 lands, with the MagicSVM suite,
  the compute bench (the worst tick must stay under the crank's 400k CU with `CRANK_CATCH_UP`), and a
  privacy check.
- **Verify** replays the seed plus both input logs (aim, champion, scout ticks).

## 10. Build tiers (hackathon: everything below "Must" and "Should" by the Wed 25 Nov 19:30 IST freeze)

| Tier | Item | Who |
|---|---|---|
| **Must** | Sim v5: no rig, ×/÷/± hidden gates, Rush end, FIRST, payout; bot update; balance run | Kai |
| **Must** | Champion (sim + instruction + button) | Kai + Suparno |
| **Must** | Program v5, tests, bench, deploy; LiveSource wired into the web; Quick Match + Room Code; server deployed | Kai (+ Suparno for UI) |
| **Must** | Flow: VS screen with chain steps, end sequence, scripted result with payout count-up, Verify | Suparno |
| **Must** | Mini-view removed → progress line | Suparno |
| **Should** | Timing gate (one per stage) | Kai + Suparno |
| **Should** | Tutorial bubbles; logo wipe; sound pass + music | Suparno |
| **Should** | Turret tower + giants in Fight 2 | Kai |
| **Should** | Rematch button; win-streak counter (cosmetic) | Suparno |
| Could | Summon Gate ×3; Victory Pack (VRF cosmetic pull, public odds); post-match emoji | |
| Later | Ghost Duels (async staked, recorded run hidden in the TEE), Daily Seed, rating + weekly league with a fee-funded pool, enemy gate, market gate, cosmetic seasons | |

## 11. Decisions (Kai, 23 Nov ~08:30)

1. No mini-rush after Fight 1: the Rush only happens at the end (Fight 1 keeps FIRST).
2. −N stays hidden inside `?` gates.
3. The timing gate is in the hackathon build, one per stage.
4. Champion charge = 8 s of fight time.
5. Payout: the winner keeps their own stake (≥ 50%), and the loser's stake is split by `2 × margin`
   with **no cap** (the loser gets 0 only when the winner scores ≥ 3× as much).
6. (Suparno, 23 Nov evening, rules v6) Hold to fire; the Champion charges by shooting and launches
   when you let go with a full meter; a Champion multiplies into more giants through gates.
7. (Suparno, 24 Nov, rules v7) The lane feel (§12): a ~35% shorter lane (towers at 7,200) at
   cruise 60; every stage is 2 or 3 columns of gates that fill their column edge to edge, with at
   most one empty cell; divider walls in half the layouts; the first row is always good and ±N is
   resized to the new column crowds (±1 / ±3 / ±6); no sliding gates (no room in a full column).
8. (Suparno, 24 Nov, rules v8) Levels (§13): one obstacle theme per stage from the genre's
   vocabulary (long walls, comb arms, wedges, a central block, pillar fields), plus speed pads,
   pipes and stand-alone breakable blocks, all in the sim and identical for both players; a row
   of 2–3 near-touching gates right in front of the cannon, the obstacles, then one or two gates
   beyond them. Enemies walk straight down to the cannon line and only fight what they meet (no
   homing on my crowds). ±N is now [0, 1, 1, 2].

---

## 12. v7 lane (rules v7, Suparno, 24 Nov)

Playtests: the lane felt too long and too wide; crowds looked like thin streams in an empty lane.
v7 makes the lane short and the choice a choice of **column**.

**Geometry** (`crates/sim/src/constants.rs`)

| | v6 | v7 |
|---|---|---|
| `LANE_WIDTH` | 3,000 | 3,000 |
| `LANE_LENGTH` / `TOWER_Y` = `VAULT_Y` | 12,000 / 11,000 | **8,200 / 7,200** |
| `CRUISE_SPEED` (launch 3×, giants 3/5) | 80 (240, 48) | **60 (180, 36)** |
| Cannon → tower walk | ~6.3 s | ~5.4 s |
| `DETECT_Y` | 4,000 | **5,000** (enemies notice crowds over most of the lane) |
| `DEFEND_Y` (bot) | 3,000 | **2,000** |
| `CLASH_REACH` / `CLASH_BAND` / `TOWER_HALF_W` / `STEER_STEP` | 400 / 400 / 300 / 40 | unchanged (x distances; the band still exceeds launch + cruise) |
| `WALL_HALF` | | **60** (walls are 120 thick) |

**Columns** (`crates/sim/src/layouts.rs`)

- Every stage is **3 columns** (x 0–1,000 / 1,000–2,000 / 2,000–3,000, gate centres 500 / 1,500 /
  2,500) or **2 columns** (0–1,500 / 1,500–3,000, centres 750 / 2,250). Never more than 3.
- A gate **fills its column edge to edge**: width = the column minus a wall's thickness (**880**
  for 3 columns, **1,380** for 2). Big and timing gates are the same width; a crate is as wide as
  the big gate it locks. With the `GATE_GRACE` edges, a full row covers the whole lane: the choice
  is which column, never threading a gap.
- **Full rows:** every row has a gate in every column, except for at most **one empty cell per
  stage** (open lane). With `GATES_MAX` 8, a 3-column stage is 3 rows (8 of 9 cells), a 2-column
  stage 4 rows (7–8 gates) or 3 rows (6).
- Rows are **front-loaded**: 3 rows at 1,000 / 2,000 / 3,000 or 4 at 900 / 1,800 / 2,700 / 3,600.
  The back half of the lane (3,600–7,200) is the clash zone.
- Kept: hidden `?` gates with bad outcomes, one timing gate per stage, big gates, at most one
  crate-locked big gate per layout (an exposed one sits in row 1 or 2, off-centre).
- **No sliding gates:** a gate that fills its column has no room to slide inside it, and a slider
  may never straddle a column boundary. The mechanism stays in the sim (and the rule in the test:
  only without walls, only inside its own column).
- Towers sit on column centres; Fight 2's two towers are in different columns.
- **Deck changes the columns forced** (balance runs showed fights stuck at 3:00):
  - the **first row is always good** (×2–×5 only). A full first row can't be dodged, and `÷2` on a
    lone dude is 0, so one bad first gate killed its column for the whole stage;
  - **±N is resized to the column crowds:** `PM_BY_ROW` [0, 5, 15, 30] → **[0, 1, 3, 6]** (a lone
    volley brings ~3 / ~5 / ~10 dudes to rows 2 / 3 / 4). −N now hurts a column instead of wiping
    it. The odds table is unchanged.

**Divider walls** (new mechanic; `StageDef.walls: &[WallDef { x, y0, y1 }]`, `WALL_HALF` = 60)

- On column boundaries only, from `y0` = 500 (past the cannon: the cannon and fresh volleys
  move freely across the lane) to `y1` = last row + 700. In **3 of 6 layouts**; the stages of one
  layout may differ (Pillars' Fight 2 has a single wall).
- Rules (deterministic, integer):
  - **(a)** while a cohort (mine or an enemy) is inside an active wall's span, its x never crosses
    it: any sideways move (homing, steering) is clamped to its column,
    `[left wall + WALL_HALF + 1, right wall − WALL_HALF − 1]` or the lane edge;
  - **(b)** a cohort entering a wall's span inside the wall's thickness is pushed to the nearer
    side (ties go left);
  - **(c)** no clash between a pair when a wall standing at the clash point's y lies strictly
    between their x's;
  - **(d)** a crowd that leaves the span (mine going up past `y1`, enemies coming down past `y0`)
    is free again.
- Order in a tick: my cohorts move up, then (b), then crates and gate rows, then homing with (a).
  Enemies steer with (a), walk down, then (b). Clash checks (c).
- The bot aims at column centres (every 100 across the lane only if a gate slides), so its
  volleys are in a column before they reach the walls, and it scores the column a wall would push
  an x into. It now floors `÷` to whole dudes when scoring (a lone dude through `÷2` scores 0).

**Layouts**

| # | Name | Fight 1 | Fight 2 | Walls |
|---|---|---|---|---|
| 0 | Twin Lanes | 2 columns × 4 rows, full | 3 × 3, locked big mid | no |
| 1 | Three Ways | 3 × 3, exposed big left | 3 × 3 | no |
| 2 | Long Shot | 3 × 3, locked big right | 2 × 4, full | both fights |
| 3 | Funnel | 3 × 3, locked big mid | 2 × 3, full | no |
| 4 | Zigzag | 2 × 4, exposed big left | 3 × 3, locked big mid | both fights |
| 5 | Pillars | 3 × 3 | 3 × 3 (one wall at 2,000), exposed big right | both fights |

**Tuning** (`tools/balance/tune_layouts.py` drives the balance runner; then a hand pick of
`wave_base` around the death cliffs)

| # | Layout | Fight 1 HP / wave_base | Fight 2 HP per tower / wave_base | Deaths (F1 / F2) | Length | F1 / F2 |
|---|---|---|---|---|---|---|
| 0 | Twin Lanes | 968 / 21 | 746 / 6 | 5.1% (177 / 103) | 66.7 s | 21.1 / 36.0 s |
| 1 | Three Ways | 1,016 / 22 | 573 / 9 | 6.2% (165 / 131) | 65.7 s | 21.2 / 35.2 s |
| 2 | Long Shot | 615 / 13 | 1,039 / 4 | 8.0% (384 / 57) | 65.9 s | 21.4 / 34.3 s |
| 3 | Funnel | 1,745 / 32 | 670 / 10 | 6.7% (272 / 78) | 67.1 s | 20.6 / 37.6 s |
| 4 | Zigzag | 1,634 / 16 | 405 / 3 | 9.3% (40 / 305) | 64.5 s | 21.0 / 34.1 s |
| 5 | Pillars | 554 / 9 | 853 / 8 | 7.0% (226 / 33) | 64.1 s | 20.7 / 35.3 s |
| | **All** (3,000 bot matches per layout) | | | **7.1%** | **65.7 s** | 21.0 / 35.4 s |

- No match hits the 3:00 cap; draws 0.7%; the Rush brings 16% of the gold; biggest cohort 3,200.
- v6 for comparison: 9.7% deaths, 67 s. The target stays the SPEC_V5 band (10–20% deaths, 60–90 s
  average; Kai's v5 tune landed at 10%). Deaths are a cliff in the integer `wave_base` (Long Shot
  Fight 1: 0.4% at 12, 11% at 13, 23% at 14), so each layout was hand-picked next to its cliff;
  `python tools/balance/tune_layouts.py --deaths N` re-tunes to another target in a few minutes.
- The bot needed two fixes the full rows exposed: it floors `÷` to whole dudes, and it weighs a
  crate-locked path by `d / (d + hp)` instead of writing it off (before, it never broke a crate,
  and a stage whose open columns were poor dragged to 3:00).

## 13. v8 levels (rules v8, Suparno, 24 Nov)

Playtests next to the genre showed our levels were the weakest part: open lanes with rows of
gates. v8 builds every stage from the genre's level vocabulary, in the sim, so it is real and the
same for both players (Verify re-derives it like everything else).

**Vocabulary** (`StageDef` in `crates/sim/src/layouts.rs`; mirrored in `packages/client`)

| Piece | Data | What it does |
|---|---|---|
| Long wall | `walls: [WallDef { x, y0, y1 }]` (v7) | splits the lane into lanes while it stands |
| Solid obstacle | `obstacles: [ObstacleDef { x0, y0, x1, y1, shape }]` | crowds flow around it: comb arms, pillars, a central block (`Rect`), wedges (`WedgeBL/BR/TL/TR`) |
| Speed pad | `pads: [PadDef { x0, y0, x1, y1 }]` | my cohorts on it get the launch boost again |
| Pipe | `pipes: [PipeDef { x0, y0, x1, y1, out_x, out_y }]` | my cohorts entering the box pop out at the exit, further up |
| Breakable block | `crates: [CrateDef]` (v4) | absorbs dudes until broken; now also stands alone, anywhere |

The client has the same fields in camelCase (`obstacles`, `pads`, `pipes` with `outX` / `outY`;
`shape` is `'rect' | 'wedgeBL' | 'wedgeBR' | 'wedgeTL' | 'wedgeTR'`), always present (`[]` if
none).

A wedge is the right triangle inside its box with the right angle at the named corner
(B = low y, the cannon side; T = high y; L = `x0`; R = `x1`): `WedgeBL` is (x0, y0), (x1, y0),
(x0, y1); `WedgeTL` is (x0, y0), (x0, y1), (x1, y1); the R ones mirror them. Its **open side**
faces away from that corner: +x for the L wedges, −x for the R ones.

**Rules** (integer, deterministic; constants `OBSTACLE_GRACE` 60, `SLIDE_STEP` 150)

- **Inside an obstacle** (`inside_obstacle`, client `insideObstacle(o, x, y, grace)`): the point
  is inside the box grown by the grace on every side and, for a wedge, on the inner side of the
  hypotenuse moved `grace` toward the open side along x: with `w = x1 − x0`, `h = y1 − y0` and
  (ax, ay) the distances from the right-angle corner (ax less the grace), `ax·h + ay·w ≤ w·h`.
- **Blocked → slide.** Each tick a crowd (mine moving +y, an enemy −y) checks its end point and
  the halfway point. If either is inside an obstacle (the first in list order), it does **not
  advance in y** that tick; it slides in x by at most `SLIDE_STEP` toward a free side of that
  obstacle: the box edge ± (grace + 1), if that x is inside the lane and the crowd's column (no
  standing wall crossed). A rect goes to the nearer reachable side (ties left); a wedge to its
  open side, else the other one. It never slides into another obstacle (it waits instead). Then
  the v7 wall push applies.
- **Homing** (my cohorts past the last row) never moves into an obstacle, and is skipped on a tick
  the cohort slid (the slide is its move, so homing cannot undo it).
- **Speed pads** (my cohorts only): a cohort whose centre is on a pad after moving gets `age = 0`,
  so it moves at `LAUNCH_SPEED` while on the pad and for `LAUNCH_TICKS` after. No new state.
- **Pipes** (my cohorts only): after crates and gate rows, a cohort whose centre is in a pipe's
  entrance box moves to (`out_x`, `out_y`) with `age = 0`, and `last_row` jumps past every row at
  or below `out_y`. It does nothing else that tick. Event `Pipe { side, cohort_id, pipe_ix }`
  (WASM event 15; client `{ type: 'pipe', side, cohortId, pipeIx }`).
- **Enemies walk straight down** at their speed; they no longer home in on my crowds, and only
  fight what they meet. Walls push them as before, obstacles deflect them by the same slide; pads
  and pipes ignore them. One reaching the cannon line still kills.
- **Crates** may stand alone (any x, y, width, HP) and absorb as before. No gold for breaking one
  (that would touch the score); the jackpot behind a locking crate stays the reward.
- Order in a tick for my cohorts: speed (boost) → move or slide → wall push → pad → crates →
  gate rows → pipe → homing.

**Design rules** (`layouts::tests::layouts_follow_the_design_rules` and the path tests in
`step::tests`): row 1 is 2–3 near-touching gates (880 wide three across, 1,380 two across) at
y 900–1,100 covering the whole lane; then one obstacle theme; then one or two gates beyond it;
exactly one timing gate and 3–5 hidden gates per stage; at most one crate-locked big gate per
layout; obstacles, pads and pipes inside the lane and off the gate rows and crate lines,
obstacles too thick to jump at launch speed; pipe exits clear of obstacles and walls; a coarse
flood fill reaches every tower; a lone dude fired from **every** x on the cannon line reaches a
tower (each Fight 2 tower on its own too) within 300 ticks, and enemies from every tower reach
the cannon line, by the real movement rules.

**The 12 stages**

| # | Layout | Fight 1 | Fight 2 |
|---|---|---|---|
| 0 | Three Lanes | walls at 1,000 / 2,000 (y 600–4,400); row 1 of 3; a breakable block (HP 20) in the middle lane at 2,600; row 2 (3,400): left `?`, right timing; tower 1,500 | same walls and row 1; row 2: left `?`, middle **crate-locked big gate** (crate HP 30 at 3,100), right timing; towers 500 / 2,500 |
| 1 | Funnel | row 1 of 3; edge wedges `WedgeTL` (0–1,000) and `WedgeTR` (2,000–3,000), y 1,900–3,500, squeeze the crowd into the middle 1,000; the timing gate alone at (1,500, 4,100); tower 1,500 | **Diamond**: four wedges round (1,500, 3,000), 1,400 wide, y 2,200–3,800, split the crowd left and right; rows of 2 at 1,000 and 4,400 (right one timing); towers 500 / 2,500 |
| 2 | Speed Comb | centre wall at 1,500 (600–4,800); the left half is a comb of four 120-tall arms (edge / wall alternately, ≥ 500 gaps) at 1,600 / 2,300 / 3,000 / 3,700 with a speed pad in each of the 3 pockets; the right half is open with a 700-wide block (HP 15) at 2,000 and a `?` at 2,700; top row (4,500): left `?`, right timing; tower 750 | mirrored (comb on the right, block and `?` on the left, timing on the left); towers 750 / 2,250 |
| 3 | Pipes | walls at 1,000 / 2,000 (600–5,200); row 1 of 3; the corridor has a `?` at 2,600 and the timing gate at 4,000; each side lane has a block (HP 10) at 1,500 and a lane-wide pipe (y 3,000–3,400) that pops out at (500 or 2,500, 5,600), past the walls and every row; tower 1,500 | the same, towers 1,200 / 1,800 in the corridor |
| 4 | Pillars | row 1 of 3; a checkerboard of 16 pillars (260 × 260, 440 gaps, rows 600 apart, every other row shifted) over y 1,900–3,960; row of 2 at 4,400 (right timing); tower 1,500 | the same field, an **exposed big gate** on the left of row 1, speed pads on both flanks (y 1,250–1,650); row 2: left timing, right `?`; towers 750 / 2,250 |
| 5 | Island | one block 1,100 × 1,300 (x 950–2,050, y 2,100–3,400); a speed pad on the left path, a 700-wide block (HP 15) on the right path; rows of 2 at 1,000 and 4,000 (right timing); tower 1,500 | **Fortress**: wedges `WedgeTL` (0–1,100) and `WedgeTR` (1,900–3,000) at y 5,000–6,000 in front of the towers funnel into the middle 800; pads on both flanks at mid-lane (2,600–3,200); row 1 of 3, row of 2 at 3,800 (right timing); towers 750 / 2,250 |

**Bot** (`crates/sim/src/bot.rs`): its aim points are row 1's gate centres. For each it **traces**
a volley's flight by the movement rules (launch boost, slides, wall pushes, pads, pipes) through
the rows and crates it crosses (cached per stage), then scores that path as before (revealed
values, guesses, the timing gate on arrival, `d / (d + hp)` for crates); a path stuck in a sealed
pocket scores 0. It alternates between aim points within 75% of the best (`NEAR_PCT`), so two
bots on one level do not play identically.

**Deck:** row 1 stays ×-only; `PM_BY_ROW` [0, 1, 3, 6] → **[0, 1, 1, 2]**: a later row is often
reached after a single multiplier (2–5 dudes), and v7's −3 there wiped whole paths (fights stuck
at 3:00).

**Tuning** (`TUNE`; 3,000 bot matches per layout)

| # | Layout | Fight 1 HP / wave_base | Fight 2 HP per tower / wave_base | Deaths (F1 / F2) | Length | F1 / F2 |
|---|---|---|---|---|---|---|
| 0 | Three Lanes | 411 / 6 | 400 / 5 | 7.3% (0 / 302) | 65.4 s | 21.1 / 33.3 s |
| 1 | Funnel | 372 / 13 | 372 / 5 | 5.5% (87 / 91) | 66.5 s | 21.3 / 35.4 s |
| 2 | Speed Comb | 273 / 10 | 250 / 5 | 0.7% (40 / 0) | 62.2 s | 21.4 / 29.2 s |
| 3 | Pipes | 407 / 26 | 330 / 14 | 3.5% (70 / 140) | 67.6 s | 25.2 / 32.3 s |
| 4 | Pillars | 403 / 7 | 1,119 / 4 | 6.3% (196 / 0) | 65.2 s | 21.5 / 35.7 s |
| 5 | Island | 218 / 12 | 423 / 6 | 10.3% (515 / 8) | 64.1 s | 21.8 / 35.9 s |
| | **All** | | | **5.6%** | **65.2 s** | 22.0 / 33.6 s |

- Deaths are again a cliff in the integer `wave_base` (e.g. Speed Comb Fight 1: 1.4% at 10,
  18% at 11), so each layout sits next to its cliff. Enemies no longer home in, so the waves are
  far smaller than in v7: a wave walks straight down its tower's lane, and only volleys in that
  lane meet it. A player who never shoots the tower's lane is overrun by the first wave (~6 s).
- Caps: 9 of 18,000 matches (all Speed Comb, one rare deal: ÷3 on one path and ÷2 on the other
  leave lone volleys at 0–1 dude). Draws 52% (identical bots on mirrored copies; 100% on Pipes,
  whose corridor is the only path the bot likes).

## Status (23 Nov, Kai): v5 built end to end

Branch `sim-v5` (from main + Suparno's sim commits). Everything below is done and tested:

- **Sim:** no rig; ×/÷/± hidden gates (± from row 2); the timing gate; Rush (70 ticks, Suparno's
  end rule, `RushEnd`); FIRST +50 settled on the breach tick (ties: nobody); Champion (meter 160
  fight ticks, carries over, count 8, through gates; the bot calls it when charged); Fight 2 giants
  (5, speed ×0.6, one per tower per small wave); v5 payout (`slice_bps`, no cap). Codec 5
  (PUBLIC_LEN 1,484, SECRET_LEN 32), WASM layout 4.
- **Balance** (auto-tuned `TUNE`, 1,000 bot matches per layout): **10.0% deaths, 68 s average**,
  Fight 1 ~22 s, Fight 2 ~37 s, no cap hits. See "Open" below for the payout spread.
- **Program:** `champion()` instruction; `plant_rig` and the GOTCHA record removed (offsets kept);
  Match 1,800 B, Secrets 136 B; VRF callback fixed (`MatchState::new` overflowed the 4 KB SBF
  frame, now built in place by `MatchState::reset`). MagicSVM 18/18. Bench: 4,202 CU per full
  tick, 8-tick crank catch-up ~46k CU (budget 400k). Not deployed yet.
- **Client / web / server:** v5 contract (see the CONTRACT entry in PROGRESS_LOG), Champion
  button live, FIRST in the score parts, timing gate shows its value, ±/÷3 labels.

**Open**
- Turret tower (§5) not built.
- **Payout spread:** damage gold is capped by tower HP, so two players who both clear share the
  same ~1,500 base; only FIRST and the Rush separate them, and bot vs bot moves ~9% of S on
  average (43% draws between identical bots). A decision for Kai.
- An idle mid-lane cannon narrowly beat the bot in the parity match: the bot needs to be smarter
  about the timing gate and the middle path.

## Earlier hand-off (sim v5, Suparno, 23 Nov)

Branch `wip/sim-v5` (not pushed). Sim tests, clippy `-D warnings` and fmt are green at every commit.

**Done**
- `8ab52ab` Sim v5: remove rig. No rig input, `can_rig`, GOTCHA or `rig_used`. Secret history is
  now `[peek slot, peek op]` per stage and side (SECRET_LEN 32, HISTORY_LEN 8). Codec v4,
  RULES_VERSION 5. `tools/balance/regen_golden.py` re-records the goldens and the WASM parity
  digest.
- `88a30e9` Sim v5: gate ops ÷ ± and the v5 deal. GateOp Add/Sub. Op byte: `k` = ×k,
  `0x40|n` = +n, `0x80|k` = ÷k, `0xC0|n` = −n. The §3 table, with N = 5/15/30 by row; a ±N drawn
  on row 1 is re-drawn as × or ÷. WASM views, events and peeks carry the op byte, and
  `constants_json` gains `PM_BY_ROW`.

**Not done**
- Timing gate and the v5 layouts (§3, §3b): about 80% written, in `git stash` ("WIP sim v5
  commit 3"). It has `Slot::Timing`, `timing_value`, `TIMING_STEP_TICKS`/`TIMING_MAX`, the six
  layouts re-tuned (4 rows 1,400…5,500/5,700, `GATE_BAND` 300–2,700, one timing gate per stage,
  at most one crate) and the new layout test.
- Rush end, FIRST, Champion, enemy giants, payout v5, bot + balance, and the full WASM surface
  plus the pkg rebuild.
- **(Suparno) Rush-end rule change, to apply:** when `RUSH_TICKS` (70) runs out, only dudes that
  already reached the hall count. Dudes still on the lane are not counted: clear them and go
  Done at once. Emit `RushEnd { side }` (no gold) so the UI can freeze. This replaces §2's "every
  dude still on the lane is counted too".

**Next steps**
1. `git stash pop`, then:
   - add a `Slot::Timing` arm in `bot::path_score`: × `timing_value(now + travel_ticks(row_y))`;
   - skip timing slots in `bot::random_hidden`;
   - add the `gate_t` argument to the `move_cohorts` calls in `step/tests.rs`;
   - update the layout-0 positions in the step and bot tests (gates now at 900 / 2,100; timing
     at slot 2; slider at slot 3; F2 crate at y 3,800);
   - in the fuzz test, check that timing gates never reveal;
   - re-record with `python tools/balance/regen_golden.py`, then commit.
2. Rush: rename Raid to Rush (`rush_ticks`, `RUSH_TICKS` = 70), apply the rule above, and add
   `breach_tick[2]` per side plus FIRST (+50 to the lower tick, settled in `step` when the later
   side breaches, or in `finish` for a single breach).
3. Champion: `champ_meter` (u8, fills in Fight, `CHAMP_TICKS` 160, carries over),
   `champ_pending`, `SideInput.champion`, a count-8 cohort flagged `champion` (codec: bit 7 of the
   cohort `last_row` byte, flag 16 of the side flags), and an `Event::Champion`. The bot fires it
   when charged.
4. Giants: in Fight 2 each small wave adds one giant enemy (5, speed ×0.6, flag in the enemy
   record byte 11).
5. Payout: `slice_bps` per §7 in `payout.rs`, then update `settle_fuzz.py` and regenerate the
   vectors.
6. Codec side tail: u8 `champ_meter` and 2 × u16 `breach_tick` (SIDE_LEN 725).
7. Balance: tune `TUNE` in `layouts.rs` for 10–20% deaths and a 60–90 s average.
8. WASM layout v4: rebuild with `bash packages/sim-wasm/build.sh`.

**Breaks outside the sim** (by design, for Kai and Suparno):
- `programs/lil_dudes` uses `SideInput.rig`, `can_rig`, `Rig`, `StageLog.rigs`, `rig_used`, the
  4-byte history layout and `plant_rig`/`RigRefused`.
- `packages/client`: the codec is v4 (no rig flag; history is 2 B per entry), op bytes now
  include 0x40/0xC0, the WASM `set_input(side, aim, peek)` drops `rig`, and `can_rig`,
  `can_rig_bytes` and the gotcha event are gone. The committed `packages/sim-wasm/pkg` is still
  v4 (not rebuilt).
