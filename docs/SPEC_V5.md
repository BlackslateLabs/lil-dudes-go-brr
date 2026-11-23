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
    - row 2: ±5
    - row 3: ±15
    - row 4: ±30

    On row 1, a single dude makes +5 act like ×6 and any −N wipe the shot.
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

- **Champion:**
  - its meter fills 1 per fight tick while you are alive in a Fight; full at `CHAMP_TICKS` = 160
    (8 s);
  - tap → the next volley is a **Champion cohort**: count 8, flagged `big`, drawn as one giant with
    a ×N badge;
  - it **goes through gates like any cohort** (a ×3 gate makes it worth 24);
  - in a clash it counts as its number of dudes;
  - the meter resets and refills; it **carries from Fight 1 into Fight 2;**
  - the bot fires it as soon as it is charged.
  - Chain: new player instruction `champion()` (burner-signed); the sim spawns at the next fire tick.
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

---

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
