// The TS decoder of the on-chain public state vs the Rust codec (through the WASM build).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codec_version } from '@lil-dudes/sim-wasm';
import { CODEC_VERSION, decodePublic, PUBLIC_LEN, toMatchView } from '../src/codec';
import { OfflineSource } from '../src/index';

test('codec constants match the WASM build', () => {
  new OfflineSource().dispose(); // loads the WASM
  assert.equal(codec_version(), CODEC_VERSION);
  assert.equal(PUBLIC_LEN, 1046);
});

test('decodePublic(publicBytes) == the WASM view at every tick of whole matches', () => {
  for (const seed of [1n, 42n, 77n]) {
    const src = new OfflineSource({ seed, botSeed: seed + 1n, stake: 100_000_000, mySide: seed === 42n ? 1 : 0 });
    const names: [string, string] = [src.view.sides[0].name, src.view.sides[1].name];
    let ticks = 0;
    for (;;) {
      const bytes = src.publicBytes();
      assert.equal(bytes.length, PUBLIC_LEN);
      const p = decodePublic(bytes);
      assert.deepEqual(toMatchView(p, src.matchId, names), src.view, `seed ${seed} tick ${src.view.tick}`);
      if (src.view.result) break;
      src.step();
      ticks++;
    }
    assert.ok(ticks > 100);
    src.dispose();
  }
});

test('decodePublic refuses short buffers and other codec versions', () => {
  const src = new OfflineSource({ seed: 3n });
  const bytes = src.publicBytes();
  assert.throws(() => decodePublic(bytes.subarray(0, 100)));
  const bad = bytes.slice();
  bad[0] = 99;
  assert.throws(() => decodePublic(bad));
  // With an offset (the Match account header precedes the state).
  const padded = new Uint8Array(PUBLIC_LEN + 40);
  padded.set(bytes, 40);
  assert.deepEqual(decodePublic(padded, 40), decodePublic(bytes));
  src.dispose();
});
