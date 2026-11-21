// lil-dudes-server: matchmaking (room codes + quick-match queue) for live matches. See app.ts.
// The faucet / burner top-up (POST /topup) arrives in M5 (docs/MVP.md §7).
import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp().fetch, port });
console.log(`server listening on :${port}`);
