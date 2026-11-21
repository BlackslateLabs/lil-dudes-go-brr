# @lil-dudes/client

The contract between the game client (`apps/web`) and the chain. Owned by Kai; changes need a
`CONTRACT` entry in `PROGRESS_LOG.md`.

- `types.ts`: `MatchView` (one moment of a match), `PrivateView` (my rig and peek), `MatchEvent`.
- `constants.ts`: timings and lane geometry, mirroring `crates/sim/src/constants.rs`.
- `source.ts`: `MatchSource`, the only thing the app talks to during a match.
- `mock.ts`: `MockSource`, a rough scripted match (every field and event type), for building the
  front end now. Not the real rules.

```ts
import { MockSource, LANE_WIDTH } from '@lil-dudes/client';

const src = new MockSource({ speed: 1 });           // later: new OfflineSource(...) / new LiveSource(...)
const off = src.subscribe((view, priv, events) => { /* draw view, play effects for events */ });
src.start();
src.setAim(LANE_WIDTH / 2);                          // on drag
```

To use it from the web app, add `"@lil-dudes/client": "workspace:*"` to `apps/web/package.json`.
The package ships TypeScript source (no build step); Vite compiles it.
