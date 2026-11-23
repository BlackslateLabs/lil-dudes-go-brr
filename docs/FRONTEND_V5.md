# Front end for v5: the plan

Status: **in progress** (Suparno, 23 Nov 2026), on branch `web/v5-flow`. This is the web side of
`docs/SPEC_V5.md` §8 and §10. Kai's side (sim v5, Champion, program, client contract, server) is in
SPEC_V5 §9–10.

The web keeps running on `OfflineSource` with the v4 rules while Kai builds v5. Everything here is built
so the v5 data drops in when `packages/client` v5 lands: score parts, the Rush clock, Champion, timing
gate and the new gate ops.

## Workstreams

| # | Stream | What | Tier | Needs Kai's v5? |
|---|---|---|---|---|
| A | **Match HUD** | Remove the rig button, rig mode, rig frame and the opponent mini-lane. Add the **opponent progress line** (their stage, tower HP bar, score). Slim timer pill and your score. **Champion** button + meter (hidden until the source supports it). Scout (= peek, renamed). Cog menu (sound, vibration, "Leave match (forfeit)" with confirm), no pause. | Must | Champion data only |
| A | **End sequence** | BREACH! stamp (1 s) → big 3-2-1 (gradient numerals) while dudes pour in and a counter climbs → TIME!. Overrun: red flash + sting. Driven by the phase and the raid/Rush clock (v4 `raidTicks` / `RAID_TICKS` now, `RUSH_TICKS` in v5). | Must | Clock name only |
| A | **Score parts** | Tally damage, towers, FIRST and Rush per side from events into `LastMatch.breakdown`. | Must | FIRST/Rush events |
| A | **Start when ready** | The match doesn't start ticking until the models are loaded (no first-frame stall). | Should | no |
| B | **Screens and flow** | Screen states `home → vs → match → result`. **Logo wipe** between them (0.8 s in / 0.35 s out). **VS screen**: real chain steps as the loading copy (staked), a short "You vs Bot" for free play; a bot is always labelled Bot. **Stake confirm sheet**. Home: one big primary button. | Must | Live source for staked play |
| B | **Result ceremony** | Scripted ~6–8 s, tap to skip: banner → both scores counting up part by part → payout split animating into your pill with a coin shower → fee line → Rematch / Home → Verify + explorer links. "New record!" for a personal best. | Must | v5 payout numbers |
| B | **Tutorial** | First bot match: 4–5 one-line bubbles above the cannon, ticked off one by one. | Should | no |
| C | **Sound pass** | Count-up ladders, breach stamp, countdown ticks, payout coin shower, VS whoosh/impact, wipe sounds, play-button charge, danger pulse, Champion charged/launch; battle ducking in the end sequence; music (menu + match + win/lose); `navigator.vibrate` on big moments. First gate reveal loud, later passes quiet. | Should | no |
| later | **Timing gate ring, ±/÷ labels** | The ring cycling ×1→×5 with a sweeping light; `+N` / `−N` / `÷3` labels. | Should | yes |
| later | **Live play** | `LiveSource` in the web; Quick Match / Room Code. | Must | yes |

## Shared contracts (already on the branch)
- `store.ts`: `Screen` gains `'vs'`; `LastMatch.breakdown: [ScoreParts, ScoreParts]`.
- `feel/sound.ts`: new cue functions (`breach`, `countdown(n)`, `ladder(step)`, `payout`, `whoosh`,
  `vsHit`, `wipeIn`, `wipeOut`, `playButton`, `danger`, `champCharged`, `champLaunch`) plus
  `setBattleDuck(on)`, `playMusic(track)` and `haptic(kind)`. Stubs now; the sound pass fills them in.
- `match/Tutorial.tsx`: mounted in the match screen; the flow stream fills it in.

## Art direction for this pass
Keep the Kenney glow-up. No new model families before the freeze. UI numerals for the countdown and
score use the orange→yellow gradient with a thick dark outline. One big primary button per screen.
