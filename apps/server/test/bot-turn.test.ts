// The online bot's per-tick decision (botTurn) on rules v5, against a local match: the WASM
// Warlord deciding from the public codec bytes alone, exactly as on the live feed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FINAL_STAGE, OfflineSource, type PrivateView } from '@lil-dudes/client';
import { Bot } from '@lil-dudes/sim-wasm';
import { botTurn } from '../src/bot';

test('botTurn drives side 0 through a whole v5 match: scouts its fights, calls its Champion', () => {
  let scouts = 0;
  let champions = 0;
  let finished = 0;
  for (const seed of [3n, 8n, 13n]) {
    // Side 0 is ours (driven by botTurn), side 1 the built-in bot.
    const src = new OfflineSource({ seed, botSeed: seed + 100n });
    const brain = new Bot(0, seed * 7919n);
    const refused: string[] = [];
    let priv: PrivateView = { myPeek: null };
    src.subscribe((_v, p, events) => {
      priv = p;
      champions += events.filter((e) => e.type === 'volley' && e.side === 0 && e.champion).length;
    });
    const scouted = new Set<number>();
    while (!src.view.result) {
      const me = src.view.sides[0];
      botTurn(brain, src.publicBytes(), {
        setAim: (x) => src.setAim(x),
        peek: (slot) => {
          // What LiveSource would check before sending.
          if (me.peekUsed || me.gates[slot]?.revealed || me.gates[slot]?.timing) refused.push(`peek ${slot}`);
          src.peek(slot);
        },
        champion: () => {
          if (!src.canChampion()) refused.push('champion');
          src.champion();
        },
      });
      src.step();
      if (priv.myPeek && !scouted.has(priv.myPeek.stage)) {
        scouted.add(priv.myPeek.stage);
        assert.equal(priv.myPeek.stage, src.view.sides[0].stage, 'the Scout is of my own stage');
        scouts++;
      }
    }
    const me = src.view.sides[0];
    if (me.phase === 'done') {
      assert.equal(me.stage, FINAL_STAGE);
      finished++;
    }
    assert.deepEqual(refused, [], 'the Bot only asks for what the sim takes');
    brain.free();
    src.dispose();
  }
  assert.ok(scouts >= 3, `${scouts} scouts`);
  assert.ok(champions >= 3, `${champions} champions`);
  assert.ok(finished >= 1, 'side 0 never finished its Rush');
});
