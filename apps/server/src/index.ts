// lil-dudes-server: matchmaking (room codes + quick-match queue), the burner faucet (POST /topup)
// and the online bot. See app.ts. Config comes from the env (.env.example); the sponsor key is
// read from the env only and never logged.
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadSponsorKey, solanaFaucet } from './faucet';

const port = Number(process.env.PORT ?? 8787);
const rpc = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const sponsor = loadSponsorKey();
const faucet = sponsor ? solanaFaucet(rpc, sponsor) : null;
const app = createApp({ faucet, trustProxy: process.env.TRUST_PROXY === '1' });
serve({ fetch: app.fetch, port });
console.log(`server listening on :${port}; faucet ${faucet ? `on (sponsor ${faucet.address})` : 'off (no SPONSOR_KEYPAIR_PATH / SPONSOR_SECRET_KEY)'}`);
