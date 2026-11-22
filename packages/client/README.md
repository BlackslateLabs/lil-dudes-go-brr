# @lil-dudes/client

The contract between the game client (`apps/web`) and the chain. Owned by Kai; changes need a
`CONTRACT` entry in `PROGRESS_LOG.md`.

- `types.ts`: `MatchView` (one moment of a match), `PrivateView` (my rig and peek), `MatchEvent`.
- `constants.ts`: timings and lane geometry, mirroring `crates/sim/src/constants.rs` (a test checks
  every value against the Rust build).
- `source.ts`: `MatchSource`, the only thing the app talks to during a match.
- `offline.ts`: **`OfflineSource`**, the real rules (`crates/sim` compiled to WASM, bundled in
  `@lil-dudes/sim-wasm`) with the Warlord bot on the other side. No chain, no Rust needed.
- `mock.ts`: `MockSource`, a rough scripted match (not the real rules). Still works as a fallback.
- `live/`: **`LiveSource`** (a real match on the Private Ephemeral Rollup, devnet) plus the
  base-layer lobby calls (`createMatch`, `joinMatch`, `delegateMatch`, `cancelMatch`,
  `settleMatch`, `closeMatch`). `codec.ts` decodes the on-chain state; `verify.ts` rebuilds every
  deal from the seed (`dealsFor`) for the result screen and Verify.

```ts
import { OfflineSource, LANE_WIDTH } from '@lil-dudes/client';

const src = new OfflineSource();                    // was: new MockSource()  (later: LiveSource)
const off = src.subscribe((view, priv, events) => { /* draw view, play effects for events */ });
src.start();                                         // 20 Hz until the match ends, then stops itself
src.setAim(LANE_WIDTH / 2);                          // on drag (absolute lane x, see types.ts)
src.rig(4);                                          // plant window: one opponent cell, not gold
src.peek(0);                                         // during play: one of my unrevealed cells
```

`OfflineSource` options (all optional): `mySide`, `myName`, `opponentName`, `stake` (lamports, only
changes the payout numbers), `speed` (playback multiplier), `seed` / `botSeed` (bigint; same seeds +
same inputs = same match), `tutorial` (the bot holds back in phase 1). Extras beyond `MatchSource`:
`step()` (advance one tick by hand), `view` (latest state), `seed`, `digest()`, `dispose()`.
The WASM loads synchronously from an inlined copy, so there is nothing to `await` and no Vite config.

Rules the renderer should know (SPEC.md, marked M1):
- During a plant window every gate's `hint` is `'none'` except gold. Hints appear when play starts.
- Invalid `rig` / `peek` calls are ignored (wrong window, used up, gold, revealed, bad cell). Check
  `PrivateView` (`myRig`, `myPeek`) and `SideView.rigUsed` / `peekUsed` to see what took.
- Cohorts clash wherever they meet (x within `CLASH_REACH`), usually in the clash zone.
- A `clash` event's `y` is measured from side 0's cannon; a cohort's `y` from its own cannon.

### Live matches (M3)

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
// src.setAim(x) / src.rig(cell) / src.peek(cell) as before
// after the end: src.reveal() (seed + all deals + rigs/peeks), settlement is automatic
```

- `view.status` is `'waiting'` until the match starts on the TEE (~3 s after delegation: private
  permissions, salts + VRF seed, crank). `onStage` reports `connecting / setup / playing /
  finishing / finished`.
- The feed renders ~3 ticks (150 ms) behind the newest chain state, at 20 Hz. Events are derived
  from state diffs (same types and meanings as offline; `clash` is one event per tick at the
  average contact point).
- The burner needs SOL only on the base layer (stake + ~0.013 SOL rent, refunded by
  `closeMatch`); on the TEE it needs none.
- Headless end-to-end run (bot vs bot on devnet, settles and sweeps back):
  `pnpm --filter @lil-dudes/client live -- --stake 50000000` (results in `scripts/out/`).

### Result screen data (M4): `reveal()`

Same shape from `OfflineSource.reveal()` (any time) and `LiveSource.reveal()` (null until the
match is FINISHED). `await live.awaitReveal()` waits for the settlement (base txs included).

| Field | What |
|---|---|
| `seed`, `deals[3]` | the VRF seed and every deal (`goldCell`, true `ops[9]`, both sides' `hints`) |
| `history[phase]` | `rigs[s]` (cell side s rigged), `peeks[s]` (`{cell, op, gold}`), `sprung[s]` (that rig was hit) |
| `gotchas[]` | `{ phase, tick, side, cell, riggedBy }`: `side`'s stream hit the rig `riggedBy` planted |
| `result`, `hp`, `finalTick`, `names` | final result (`winner`, `ko`, `moved`, `fee`) and HP |
| `payout` | `kind` (ko/timer/draw/aborted), `free`, `winner`, `stake`, `leadPm`, `sharePm`, `moved`, `fee`, `paid[2]` (back from the vault), `net[2]`, `why` (one neutral line, e.g. "Lil B won on the timer by 20.0% HP → takes 60.0% of the stake, minus a 5% fee.") |
| `txs[]` | `{ what, signature, layer: 'base' \| 'tee', url, by }`, oldest first: create/join/delegate, this device's TEE txs (`set_aim ×N` folded), commit + undelegate + settle (Magic Action) or `settle`, close. TEE txs that touch a private account show as redacted on the explorer, by design. |
| `settlement` | `{ state: 'offline' \| 'pending' \| 'settled', by?: 'action' \| 'fallback' \| 'free', signature? }` (MVP §3.7 "Settling…") |
| `matchUrl` | explorer link of the Match account (live) |

Also exported: `payoutOf(stake, result, hp, aborted?, names?)`, `matchTxs(base, id)`,
`settlementOf(base, id)`, `BASE_EXPLORER` / `TEE_EXPLORER` / `ACCOUNT_EXPLORER`.

To use it from the web app, add `"@lil-dudes/client": "workspace:*"` to `apps/web/package.json`.
The package ships TypeScript source (no build step); Vite compiles it.

```bash
pnpm --filter @lil-dudes/client test        # constants parity, WASM parity digest, full matches
pnpm --filter @lil-dudes/client smoke       # a full match on the timer, headless, with a log
```
