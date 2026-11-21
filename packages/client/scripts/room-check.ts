// Room-code round trip against a running apps/server (no chain): tsx scripts/room-check.ts [url]
import { createRoom, findRoom, newMatchId } from '../src/index';
const server = process.argv[2] ?? 'http://localhost:8787';
const id = newMatchId();
const room = await createRoom(server, id, 100_000_000);
const found = await findRoom(server, room.code.toLowerCase());
console.log({ code: room.code, sameId: found.id === id, stake: found.stake });
await findRoom(server, 'ZZZZZZ').then(() => console.log('UNEXPECTED: found'), (e) => console.log('unknown code →', String(e)));
