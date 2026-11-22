import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app';
import { parseOrigins } from '../src/guard';

const A = '4oarhNvGuppu2VKsYy3aSvYPSFTwovcY58t1B3a8aA4Z';

test('CORS: only the configured web origin (or local dev origins by default)', async () => {
  const prod = createApp({ origins: ['https://lildudes.example'] });
  const ok = await prod.request('/health', { headers: { origin: 'https://lildudes.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://lildudes.example');
  const bad = await prod.request('/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const pre = await prod.request('/topup', { method: 'OPTIONS', headers: { origin: 'https://lildudes.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /content-type/i);
  const dev = createApp({});
  assert.equal((await dev.request('/health', { headers: { origin: 'http://192.168.1.20:5173' } })).headers.get('access-control-allow-origin'), 'http://192.168.1.20:5173');
  assert.equal((await dev.request('/health', { headers: { origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  assert.deepEqual(parseOrigins(' https://a.example/, https://b.example '), ['https://a.example', 'https://b.example']);
  assert.equal(parseOrigins('*'), '*');
  assert.equal(parseOrigins(''), undefined);
});

test('guards: body cap, JSON only, per-IP rate limit, security headers, healthz never limited', async () => {
  let t = 1_000;
  const app = createApp({ now: () => t, trustProxy: true, perMinute: 5 });
  const post = (path: string, body: string, ip = '9.9.9.9', type = 'application/json') =>
    app.request(path, { method: 'POST', headers: { 'content-type': type, 'x-forwarded-for': ip }, body });
  assert.equal((await post('/queue', 'x'.repeat(5_000))).status, 413);
  assert.equal((await post('/queue', JSON.stringify({ player: A, stake: 0 }), '9.9.9.9', 'text/plain')).status, 415);
  // 2 used above; 3 more pass, the 6th is limited.
  for (let i = 0; i < 3; i++) assert.notEqual((await app.request('/health', { headers: { 'x-forwarded-for': '9.9.9.9' } })).status, 429);
  const limited = await app.request('/health', { headers: { 'x-forwarded-for': '9.9.9.9' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await app.request('/healthz', { headers: { 'x-forwarded-for': '9.9.9.9' } })).status, 200);
  assert.equal((await app.request('/health', { headers: { 'x-forwarded-for': '8.8.8.8' } })).status, 200);
  t += 60_001;
  const again = await app.request('/health', { headers: { 'x-forwarded-for': '9.9.9.9' } });
  assert.equal(again.status, 200);
  assert.equal(again.headers.get('x-content-type-options'), 'nosniff');
});

test('validation: bad params and unknown routes are clean JSON errors, never stack traces', async () => {
  const app = createApp({});
  for (const path of ['/rooms/' + 'A'.repeat(50), '/queue/../../etc', '/nope']) {
    const r = await app.request(path);
    assert.ok([400, 404].includes(r.status), `${path} → ${r.status}`);
    const body = (await r.json()) as { error?: string };
    assert.ok(body.error && !/at .*\.ts/.test(body.error), path);
  }
  const malformed = await app.request('/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":' });
  assert.equal(malformed.status, 400);
});
