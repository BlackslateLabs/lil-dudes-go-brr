// Scaffold. Faucet top-up (POST /topup) and quick-match (POST /queue) arrive in M5 (docs/MVP.md §7).
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, service: 'lil-dudes-server' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`server listening on :${port}`);
