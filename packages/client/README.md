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

To use it from the web app, add `"@lil-dudes/client": "workspace:*"` to `apps/web/package.json`.
The package ships TypeScript source (no build step); Vite compiles it.

```bash
pnpm --filter @lil-dudes/client test        # constants parity, WASM parity digest, full matches
pnpm --filter @lil-dudes/client smoke       # a full match on the timer, headless, with a log
```
