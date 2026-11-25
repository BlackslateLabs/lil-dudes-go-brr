// lil-dudes-server: matchmaking (room codes + quick-match queue), the burner faucet (POST /topup)
// and the online bot. See app.ts. Config comes from the env (.env.example); the sponsor key is
// read from the env only and never logged.
import { serve } from '@hono/node-server';
import { baseConnection } from '@lil-dudes/client';
import { createApp } from './app';
import { onlineBot } from './bot';
import { loadKey, loadSponsorKey, solanaFaucet } from './faucet';
import { parseOrigins } from './guard';
import { History } from './history';
import { chainReader } from './record';
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
const origins = parseOrigins(process.env.CORS_ORIGINS);
// Match history: in memory, plus an append-only JSON-lines file when HISTORY_FILE is set (public
// data only). Records are read from the Match account on the base layer.
const historyFile = process.env.HISTORY_FILE?.trim() || null;
const history = new History(historyFile);
const reader = chainReader({ base: baseConnection(process.env.BASE_RPC_URL), bot: () => bot?.address ?? null });
const app = createApp({ faucet, bot, origins, history, reader, trustProxy: process.env.TRUST_PROXY === '1', sweeperStats: () => sweep?.stats ?? null });
serve({ fetch: app.fetch, port });
console.log(
  `server listening on :${port}; faucet ${faucet ? `on (sponsor ${faucet.address})` : 'off (no SPONSOR_KEYPAIR_PATH / SPONSOR_SECRET_KEY)'}; bot ${bot ? `on (${bot.address})` : 'off'}; sweeper ${sweep ? 'on' : 'off'}; CORS ${origins === '*' ? 'any origin' : origins ? origins.join(' ') : 'local dev origins'}; history ${historyFile ? `${history.size} matches from ${historyFile}` : 'in memory'}`,
);
