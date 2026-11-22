# @lil-dudes/client

The contract between the game client (`apps/web`) and the chain, for **rules v4** (`docs/SPEC.md`:
each player races an identical copy of one level; two stages, Fight 1 and Fight 2, and when Fight
2's last tower falls the town hall raid starts in place). Owned by Kai; changes need a `CONTRACT`
entry in `PROGRESS_LOG.md`.

- `types.ts`: `MatchView` (one moment of a match: one `LaneView` per player), `PrivateView` (my rig
  and peek this stage), `MatchEvent`.
- `constants.ts`: timings, lane geometry, gate odds and the level pool `LAYOUTS`, mirroring
  `crates/sim` (a test checks every value against the Rust build). `layout.ts`: helpers over it
  (`stageDef`, `gateXAt` for smooth sliding gates, `covers` / `gateAt` for which gate a crowd at
  `x` goes through, `crateOfGate`, `fightGold`, `applyOp`).
- `source.ts`: `MatchSource`, the only thing the app talks to during a match.
- `offline.ts`: **`OfflineSource`**, the real rules (`crates/sim` compiled to WASM, bundled in
  `@lil-dudes/sim-wasm`) with the Warlord bot on the other side. No chain, no Rust needed.
- `mock.ts`: **`MockSource`**, a hands-off match on the real rules with the bot on both sides
  (no input needed; for building screens).
- `live/`: **`LiveSource`** (a real match on the Private Ephemeral Rollup, devnet) plus the
  base-layer lobby calls (`createMatch`, `joinMatch`, `delegateMatch`, `cancelMatch`,
  `settleMatch`, `closeMatch`). `codec.ts` decodes the on-chain state; `verify.ts` rebuilds the
  layout and every stage's gate values from the seed (`dealsFor`) for the result screen and Verify.

```ts
import { OfflineSource, LANE_WIDTH } from '@lil-dudes/client';

const src = new OfflineSource();                    // or new MockSource() / LiveSource.connect(...)
const off = src.subscribe((view, priv, events) => { /* draw view.sides[src.mySide] big, the other small */ });
src.start();                                         // 20 Hz until the match ends, then stops itself
src.setAim(LANE_WIDTH / 2);                          // on drag (absolute lane x)
if (src.canRig(2)) src.rig(2);                       // any phase: MY gate slot 2 traps their copy of it
src.peek(0);                                         // my fight / raid: my own unrevealed gate slot 0
```

`OfflineSource` options (all optional): `mySide`, `myName`, `opponentName`, `stake` (lamports, only
changes the payout numbers), `speed` (playback multiplier), `seed` / `botSeed` (bigint; same seeds +
same inputs = same match; the seed picks the layout), `tutorial` (side 0's Fight 1 waves at 50%),
`selfBot` (the bot also plays `mySide`; inputs ignored: Home-screen background, demos, tests).
Extras beyond `MatchSource`: `step()` (advance one tick by hand), `view` / `priv` (latest state),
`seed`, `digest()`, `reveal()`, `publicBytes()`, `history()`, `dispose()`.
`MockSource` options: `mySide`, `myName`, `opponentName`, `stake`, `speed`, `startTick` (fast-forward,
no events), `seed` / `botSeed` (default fixed). The WASM loads synchronously from an inlined copy,
so there is nothing to `await` and no Vite config.

Rules the renderer should know:
- Each lane has its own `stage` (0 fight 1, 1 fight 2 = `FINAL_STAGE`; `STAGES` = 2) and `phase`
  (`plant`, `fight`, `transit`, `raid`, `done`, `dead`). The flow is plant → fight → transit →
  plant → fight → **raid → done**: the raid is the town hall raid of Fight 2, in place (same stage,
  same field, no transit or plant before it; a `stage` event `{ stage: 1, phase: 'raid' }` fires on
  the tick the last tower falls). `phaseTick` counts ticks of the current phase, except that the
  raid keeps counting Fight 2's (gates slide on without a jump). `raidTicks` counts the raid
  itself: the cannon fires while `raidTicks < RAID_TICKS` (8 s), and the lane is `done` once that
  is over and no dudes are left (leftover enemies leave). Lanes move at their own pace. In
  `transit` the lane already shows the NEXT stage (towers, crates, gates).
- `gates` / `towers` / `crates` are the current stage's, with their layout geometry filled in
  (`y`, `width`, `big`, `moving`, `maxHp`). A gate's `x` is the sim's x this tick; for smooth
  drawing between ticks use `gateXAt(stageDef(layout, stage).gates[slot], phaseTick + frac)`
  during fight / raid. `locked` = a big gate behind a crate that still has HP. Big gates are
  1,000 wide. A crowd goes through a gate (or crate) when it is within `GATE_GRACE` (100) of its
  edge; if two gates of a row cover it, the nearest centre wins (`gateAt`).
- In the raid the towers are all at 0 HP; draw the town hall behind them (centred on `HALL_X`,
  spanning the base at `VAULT_Y`). Past the last gate row raid crowds steer to `HALL_X`.
- `revealed` is null while face-down; `{ kind: 'div', value: 2 }` is a sprung rig (GOTCHA).
- Rig and peek name a **gate slot of MY current stage** (index into my lane's `gates`). **Rig from
  your own lane**: tapping my gate `slot` traps the same slot of the opponent's copy of my stage.
  Any phase (plant, fight, transit, raid) while I'm alive and not done, once per stage of mine.
  `canRig(slot)` is the sim's own rule (call it per gate per frame to grey out the rest): no when
  the opponent is dead or done, already past my stage, on my stage with that gate revealed in
  their lane, the slot doesn't exist, or my rig is used. Peek: my own unrevealed gate, during my
  fight / raid, once per stage. Refused calls are ignored. Check `PrivateView` (`myRig: { stage,
  slot }` = their stage (= mine when I rigged) and slot; `myPeek: { stage, slot, op }`) and
  `LaneView.rigUsed` / `peekUsed` to see what took.
- `enemies` are the base's troops walking down (`age` is always 0). An enemy reaching y ≤ 0 kills
  that player (`phase: 'dead'`, a `death` event; the match ends at once).
- `gold` = 1 per point of tower damage + 50 per tower + 2 per dude reaching the town hall in the
  raid; `raidGold` is the raid part (gold past every tower of both stages, in `raid` / `done`). `result`: `winner` (null = draw), `died` (the one side that died, or
  null), `gold`, `moved`, `fee`.
- Events carry `side` = whose lane; `clash.killed` units on each side; `stage` events announce
  every phase change.

### Live matches

```ts
import { Keypair } from '@solana/web3.js';
import { baseConnection, createMatch, joinMatch, delegateMatch, LiveSource } from '@lil-dudes/client';

const base = baseConnection();                        // devnet (MagicBlock RPC)
const burner = Keypair.generate();                     // per device, kept in localStorage; funded on base
// A (room creator):
const { id } = await createMatch(base, burner, { stake: 50_000_000, burner: burner.publicKey, name: 'Lil Kai' });
// B (joins with the code = id):  await joinMatch(base, burnerB, { id, stake: 50_000_000, burner: burnerB.publicKey, name: 'Lil Sup' });
await delegateMatch(base, burner, id);                 // either side, once B is in
const src = await LiveSource.connect({ matchId: id, burner, onStage: (s, d) => console.log(s, d) });
src.subscribe((view, priv, events) => { /* same as OfflineSource */ });
src.start();                                           // auto-drives the TEE setup, then plays
// src.setAim(x) / src.rig(slot) / src.peek(slot) as offline
// after the end: src.reveal() (seed, layout, all values, rigs/peeks); settlement is automatic
```

- `view.status` is `'waiting'` until the match starts on the TEE (~3 s after delegation: private
  permissions, salts + VRF seed, crank), then `'playing'`, then `'ended'`. `onStage` reports
  `connecting / setup / playing / finishing / finished`.
- `rig` is sent only when `canRig(slot)` says yes on the newest chain state (`can_rig_bytes`, the
  same rule the program runs); `peek` only during my own fight / raid (once per stage).
- The feed renders ~3 ticks (150 ms) behind the newest chain state, at 20 Hz. Events are derived
  from state diffs (`live/events.ts`): exact for volleys, waves, reveals, GOTCHAs, gates, crates,
  stages, deaths and the end; tower hits, loot and clashes are summed per snapshot. Fight 2 →
  raid is re-run straight through (same stage, field and clock).
- The private view comes from my Peek account; it only counts when written in my current stage
  (the program can't update it on a stage change).
- The burner needs SOL only on the base layer (stake + rent, refunded by `closeMatch`); on the TEE
  it needs none.
- Headless end-to-end run (bot vs bot on devnet, settles and sweeps back):
  `pnpm --filter @lil-dudes/client live -- --stake 50000000` (results in `scripts/out/`).

### Result screen data: `reveal()`

Same shape from `OfflineSource.reveal()` (any time) and `LiveSource.reveal()` (null until the
match is FINISHED). `await live.awaitReveal()` waits for the settlement (base txs included).

| Field | What |
|---|---|
| `seed`, `layout`, `layoutName` | the VRF seed and the level it picked |
| `values[stage][slot]` | every stage's true gate values (identical in both copies; a rig makes one ÷2 on top: `trueOp(reveal, side, stage, slot)`) |
| `history[stage]` | per stage of the ACTOR (2 stages): `rigs[s]` (`{ stage, slot }` of the opponent's lane side s rigged; v4: `stage` is the actor's own), `peeks[s]` (`{ slot, op }`), `sprung[s]` (that rig was hit) |
| `gotchas[]` | `{ stage, tick, side, slot, riggedBy }`: `side`'s dudes hit the rig `riggedBy` planted |
| `result`, `gold`, `dead`, `finalTick`, `names` | final result, gold per side, who died |
| `payout` | `kind` (`death` / `gold` / `draw` / `aborted`), `free`, `winner`, `died`, `bothDied`, `stake`, `gold`, `goldPm` (each side's share of the gold, ‰), `moved`, `fee`, `sharePm` (moved / S), `paid[2]` (back from the vault), `net[2]`, `why` (one neutral line, e.g. "Lil A won on gold, 900 to 600 (60.0% of the pot) → takes 20.0% of Lil B's stake, minus a 5% fee.") |
| `txs[]` | `{ what, signature, layer: 'base' \| 'tee', url, by }`, oldest first: create/join/delegate, this device's TEE txs (`set_aim ×N` folded), commit + undelegate + settle (Magic Action) or `settle`, close. TEE txs that touch a private account show as redacted on the explorer, by design. |
| `settlement` | `{ state: 'offline' \| 'pending' \| 'settled', by?: 'action' \| 'fallback' \| 'free', signature? }` |
| `matchUrl` | explorer link of the Match account (live) |

Payout (SPEC §8): a death moves the loser's whole stake S; if both survive the pot 2S is split by
gold, so the winner (more gold) gains `floor(S·(gw − gl)/(gw + gl))`; equal gold, no gold or a
double death is a draw; the fee is 5% of the money moved. Also exported: `resultFor(stake, dead,
gold)` (that formula), `payoutOf(stake, result, { aborted?, names?, dead? })`, `dealsFor(seed)`,
`decodeHistory(bytes)`, `matchTxs(base, id)`, `settlementOf(base, id)`, `BASE_EXPLORER` /
`TEE_EXPLORER` / `ACCOUNT_EXPLORER`.

To use it from the web app, add `"@lil-dudes/client": "workspace:*"` to `apps/web/package.json`.
The package ships TypeScript source (no build step); Vite compiles it.

```bash
pnpm --filter @lil-dudes/client test        # constants parity, WASM parity digest, codec, events, reveal
pnpm --filter @lil-dudes/client smoke       # a full match on the timer, headless, with a log
```
