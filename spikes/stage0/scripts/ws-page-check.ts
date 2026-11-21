// Mirrors ws-rate.html's protocol in Node: burner → challenge → login → raw WebSocket
// slotSubscribe for 5 s (the page's no-program mode). Usage: tsx scripts/ws-page-check.ts
import nacl from "tweetnacl";
import bs58 from "bs58";
const ep = "https://devnet-tee.magicblock.app";
const kp = nacl.sign.keyPair();
const pub = bs58.encode(kp.publicKey);
const c = await (await fetch(`${ep}/auth/challenge?pubkey=${pub}`)).json();
const sig = nacl.sign.detached(new TextEncoder().encode(c.challenge), kp.secretKey);
const j = await (await fetch(`${ep}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: pub, challenge: c.challenge, signature: bs58.encode(sig) }) })).json();
const ws = new WebSocket(`${ep.replace(/^http/, "ws")}?token=${j.token}`);
const t: number[] = [];
ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "slotSubscribe", params: [] }));
ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.params) t.push(performance.now()); };
await new Promise((r) => setTimeout(r, 5000));
ws.close();
console.log({ tokenOk: !!j.token, slotNotifications5s: t.length, perSec: t.length / 5 });
process.exit(0);
