// Prints where a match is (base/TEE), its status and the vault balance. Usage: tsx scripts/check-match.ts <id>
import { baseConnection, chain, fetchMatch } from '../src/index';
const id = BigInt(process.argv[2] ?? '0');
const base = baseConnection();
const a = chain.matchAccounts(id);
const info = await base.getAccountInfo(a.game, 'confirmed');
const m = await fetchMatch(base, id);
console.log({
  id: id.toString(),
  match: a.game.toBase58(),
  exists: !!info,
  owner: info?.owner.toBase58(),
  status: m?.header.status,
  vault: await base.getBalance(a.vault, 'confirmed'),
  secrets: !!(await base.getAccountInfo(a.secrets, 'confirmed')),
});
