import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askBot } from '../src/live/server';

// The server's JSON guard refuses a POST without `content-type: application/json` (415): askBot
// must send a JSON body even though it has nothing to say.
test('askBot posts JSON to /queue/:ticket/bot', async () => {
  const real = globalThis.fetch;
  let seen: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ ticket: 'abcdefghjkmnpqrs', state: 'waiting', stake: 0 }), { status: 200 });
  }) as typeof fetch;
  try {
    const t = await askBot('https://srv.example/', 'abcdefghjkmnpqrs');
    assert.equal(t.state, 'waiting');
    assert.equal(seen!.url, 'https://srv.example/queue/abcdefghjkmnpqrs/bot');
    assert.equal(seen!.init?.method, 'POST');
    assert.equal((seen!.init?.headers as Record<string, string>)['content-type'], 'application/json');
    assert.equal(seen!.init?.body, '{}');
  } finally {
    globalThis.fetch = real;
  }
});
