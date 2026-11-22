# @lil-dudes/client

The contract between the game client (`apps/web`) and the chain, for **rules v3** (`docs/SPEC.md`:
each player races an identical copy of one level; Fight 1, Fight 2, Raid). Owned by Kai; changes
need a `CONTRACT` entry in `PROGRESS_LOG.md`.

- `types.ts`: `MatchView` (one moment of a match: one `LaneView` per player), `PrivateView` (my rig
  and peek this stage), `MatchEvent`.
- `constants.ts`: timings, lane geometry, gate odds and the level pool `LAYOUTS`, mirroring
  `crates/sim` (a test checks every value against the Rust build). `layout.ts`: helpers over it
  (`stageDef`, `gateXAt` for smooth sliding gates, `crateOfGate`, `fightGold`, `applyOp`).
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
src.rig(2);                                          // my plant: gate slot 2 of the opponent's current stage
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
- Each lane has its own `stage` (0 fight 1, 1 fight 2, 2 raid) and `phase` (`plant`, `fight`,
  `transit`, `raid`, `done`, `dead`); `phaseTick` counts ticks of the current phase. Lanes move at
  their own pace. In `transit` the lane already shows the NEXT stage (towers, crates, gates).
- `gates` / `towers` / `crates` are the current stage's, with their layout geometry filled in
  (`y`, `width`, `big`, `moving`, `maxHp`). A gate's `x` is the sim's x this tick; for smooth
  drawing between ticks use `gateXAt(stageDef(layout, stage).gates[slot], phaseTick + frac)`
  during fight / raid. `locked` = a big gate behind a crate that still has HP.
- `revealed` is null while face-down; `{ kind: 'div', value: 2 }` is a sprung rig (GOTCHA).
- Rig and peek name a **gate slot** (index into that stage's `gates`). Refused calls are ignored
  (wrong phase, used up, revealed, opponent finished, stage already rigged). Check `PrivateView`
  (`myRig: { stage, slot }` = the opponent's stage and slot I rigged during this stage of mine;
  `myPeek: { stage, slot, op }`) and `LaneView.rigUsed` / `peekUsed` to see what took.
- `enemies` are the base's troops walking down (`age` is always 0). An enemy reaching y ≤ 0 kills
  that player (`phase: 'dead'`, a `death` event; the match ends at once).
- `gold` = 1 per point of tower damage + 50 per tower + 2 per dude reaching the vault in the raid;
  `raidGold` is the raid part. `result`: `winner` (null = draw), `died` (the one side that died, or
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
- `rig` is only sent during my own plant and `peek` during my own fight / raid (once per stage).
- The feed renders ~3 ticks (150 ms) behind the newest chain state, at 20 Hz. Events are derived
  from state diffs (`live/events.ts`): exact for volleys, waves, reveals, GOTCHAs, gates, crates,
  stages, deaths and the end; tower hits, loot and clashes are summed per snapshot.
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
| `history[stage]` | per stage of the ACTOR: `rigs[s]` (`{ stage, slot }` of the opponent's lane side s rigged), `peeks[s]` (`{ slot, op }`), `sprung[s]` (that rig was hit) |
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
