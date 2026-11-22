// lil-dudes-server: matchmaking (room codes + quick-match queue), the burner faucet (POST /topup)
// and the online bot. See app.ts. Config comes from the env (.env.example); the sponsor key is
// read from the env only and never logged.
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { onlineBot } from './bot';
import { loadKey, loadSponsorKey, solanaFaucet } from './faucet';
import { sweeper } from './sweeper';

const port = Number(process.env.PORT ?? 8787);
const rpc = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const sponsor = loadSponsorKey();
const faucet = sponsor ? solanaFaucet(rpc, sponsor) : null;
// The online bot needs the sponsor (it funds the bot's wallet). BOT=0 turns it off.
const bot = faucet && process.env.BOT !== '0' ? onlineBot({ faucet, baseRpc: process.env.BASE_RPC_URL, wallet: loadKey('BOT') ?? undefined }) : null;
// The sweeper (permissionless refunds / settles / closes, sweeper.ts) signs with the sponsor. SWEEP=0 turns it off.
const sweep = sponsor && process.env.SWEEP !== '0' ? sweeper({ signer: sponsor }) : null;
sweep?.start();
const app = createApp({ faucet, bot, trustProxy: process.env.TRUST_PROXY === '1', sweeperStats: () => sweep?.stats ?? null });
serve({ fetch: app.fetch, port });
console.log(
  `server listening on :${port}; faucet ${faucet ? `on (sponsor ${faucet.address})` : 'off (no SPONSOR_KEYPAIR_PATH / SPONSOR_SECRET_KEY)'}; bot ${bot ? `on (${bot.address})` : 'off'}; sweeper ${sweep ? 'on' : 'off'}`,
);
