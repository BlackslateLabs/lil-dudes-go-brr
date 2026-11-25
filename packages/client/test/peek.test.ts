import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyRead, peekLine, type PeekAttempt } from '../src/live/peek';

const b64 = (bytes: number[]) => Buffer.from(Uint8Array.from(bytes)).toString('base64');

test('an RPC error is DENIED, with its text', () => {
  const r = classifyRead('account', { error: { message: 'Permission denied: account is private', code: -32602 } });
  assert.deepEqual(r, { outcome: 'denied', detail: 'Permission denied: account is private' });
  assert.equal(classifyRead('account', { error: { code: -32000 } }).detail, 'error -32000');
});

test('a null value is hidden (the rollup answers as if the account did not exist)', () => {
  assert.equal(classifyRead('account', { result: { context: { slot: 1 }, value: null } }).outcome, 'hidden');
  assert.equal(classifyRead('account', { result: undefined }).outcome, 'hidden');
});

test('bytes that come back are readable', () => {
  const r = classifyRead('account', { result: { value: { data: [b64([1, 2, 3, 4]), 'base64'] } } });
  assert.deepEqual(r, { outcome: 'readable', detail: '4 bytes' });
});

test('the base-layer copy of delegated Secrets: zero secret bytes are "zeroed", real ones readable', () => {
  const zeros = new Array(144).fill(0);
  assert.equal(classifyRead('base-account', { result: { value: { data: [b64(zeros), 'base64'] } } }).outcome, 'zeroed');
  const filled = zeros.slice();
  filled[20] = 7;
  assert.equal(classifyRead('base-account', { result: { value: { data: [b64(filled), 'base64'] } } }).outcome, 'readable');
});

test('a listing is readable only if it contains the account we wanted', () => {
  const list = { result: [{ pubkey: 'A' }, { pubkey: 'B' }] };
  assert.deepEqual(classifyRead('list', list, 'C'), { outcome: 'hidden', detail: 'not listed (2 accounts returned)' });
  assert.equal(classifyRead('list', list, 'B').outcome, 'readable');
  assert.equal(classifyRead('list', { error: { message: 'getProgramAccounts is not allowed' } }, 'B').outcome, 'denied');
  assert.equal(classifyRead('signatures', { result: [] }).outcome, 'hidden');
  assert.equal(classifyRead('signatures', { result: [{}, {}] }).detail, '2 signatures listed');
});

test('console line', () => {
  const a: PeekAttempt = { method: 'getAccountInfo', target: 'true gate values + seed', via: 'rollup (your login)', outcome: 'hidden', detail: 'null', ms: 40 };
  assert.equal(peekLine(a), 'getAccountInfo(true gate values + seed) via rollup (your login) → NOTHING: null');
  assert.match(peekLine({ ...a, outcome: 'denied', detail: 'nope' }), /→ DENIED: nope$/);
});
