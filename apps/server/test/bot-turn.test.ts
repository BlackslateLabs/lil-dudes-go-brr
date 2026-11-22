// The online bot's per-tick decision (botTurn) on rules v4, against a local match: the WASM
// Warlord deciding from the public codec bytes alone, exactly as on the live feed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FINAL_STAGE, OfflineSource, type PrivateView } from '@lil-dudes/client';
import { Bot } from '@lil-dudes/sim-wasm';
import { botTurn } from '../src/bot';

test('botTurn drives side 0 through a whole v4 match: rigs from its own lane in its fights', () => {
  let rigs = 0;
  let finished = 0;
  for (const seed of [3n, 8n, 13n]) {
    // Side 0 is ours (driven by botTurn), side 1 the built-in bot.
    const src = new OfflineSource({ seed, botSeed: seed + 100n });
    const brain = new Bot(0, seed * 7919n);
    const refused: number[] = [];
    let priv: PrivateView = { myRig: null, myPeek: null };
    src.subscribe((_v, p) => (priv = p));
    const rigged = new Set<number>();
    while (!src.view.result) {
      const me = src.view.sides[0];
      botTurn(brain, src.publicBytes(), {
        setAim: (x) => src.setAim(x),
        rig: (slot) => {
          // What LiveSource would check before sending.
          if (!src.canRig(slot)) refused.push(slot);
          else assert.equal(me.phase, 'fight', 'the v4 bot rigs in its fight');
          src.rig(slot);
        },
        peek: (slot) => src.peek(slot),
      });
      src.step();
      if (priv.myRig && !rigged.has(priv.myRig.stage)) {
        rigged.add(priv.myRig.stage);
        assert.equal(priv.myRig.stage, src.view.sides[0].stage, 'the rig names my own stage');
        rigs++;
      }
    }
    const me = src.view.sides[0];
    if (me.phase === 'done') {
      assert.equal(me.stage, FINAL_STAGE);
      finished++;
    }
    assert.deepEqual(refused, [], 'the Bot only asks for rigs the sim takes');
    brain.free();
    src.dispose();
  }
  assert.ok(rigs >= 3, `${rigs} rigs`);
  assert.ok(finished >= 1, 'side 0 never finished its raid');
});
