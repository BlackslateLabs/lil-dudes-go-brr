// The burner faucet's wallet side (MVP §4 "Faucet abuse", §8 "Server sponsor wallet").
// The sponsor key comes from the server env only (SPONSOR_KEYPAIR_PATH or SPONSOR_SECRET_KEY) and
// is never logged or returned. Devnet only: the RPC's genesis hash is checked before the first send.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

/** What the app needs from a faucet (tests pass a fake). */
export interface Faucet {
  /** The sponsor's public address. */
  readonly address: string;
  balance(pubkey: string): Promise<number>;
  /** Sends `lamports` from the sponsor; resolves with the confirmed signature. */
  send(pubkey: string, lamports: number): Promise<string>;
  /** The sponsor keypair, for server-side players (the bot's burner is funded from it). */
  readonly keypair?: Keypair;
  readonly connection?: Connection;
}

/** Loads the sponsor key from the env (a keypair file path, or the key itself as a JSON array or
 *  base58). Returns null if neither is set. Throws on a malformed key without echoing it. */
export function loadSponsorKey(env: NodeJS.ProcessEnv = process.env): Keypair | null {
  const raw = env.SPONSOR_SECRET_KEY?.trim() || (env.SPONSOR_KEYPAIR_PATH ? fs.readFileSync(env.SPONSOR_KEYPAIR_PATH, 'utf8').trim() : '');
  if (!raw) return null;
  try {
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw);
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new Error('sponsor key is set but malformed (expected a 64-byte JSON array or base58)');
  }
}

export function solanaFaucet(rpc: string, sponsor: Keypair): Faucet {
  const conn = new Connection(rpc, 'confirmed');
  let devnet: Promise<void> | null = null;
  const assertDevnet = () =>
    (devnet ??= conn.getGenesisHash().then((g) => {
      if (g !== DEVNET_GENESIS) {
        devnet = null;
        throw new Error(`faucet refuses to run: ${rpc} is not devnet (genesis ${g})`);
      }
    }));
  return {
    address: sponsor.publicKey.toBase58(),
    keypair: sponsor,
    connection: conn,
    async balance(pubkey) {
      return conn.getBalance(new PublicKey(pubkey), 'confirmed');
    },
    async send(pubkey, lamports) {
      await assertDevnet();
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: new PublicKey(pubkey), lamports }));
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = sponsor.publicKey;
      tx.sign(sponsor);
      const signature = await conn.sendRawTransaction(tx.serialize());
      const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      if (res.value.err) throw new Error(`top-up tx failed: ${JSON.stringify(res.value.err)}`);
      return signature;
    },
  };
}
