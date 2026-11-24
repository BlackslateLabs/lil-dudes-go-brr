// Rewrites the LAYOUTS table in src/constants.ts from the bundled WASM sim (crates/sim
// layouts.rs via `constants_json`), so the TS mirror can't drift. Rebuild the WASM first
// (packages/sim-wasm/build.sh), then:  pnpm --filter @lil-dudes/client exec tsx scripts/gen-layouts.ts
// The parity test (test/offline.test.ts) still checks every value.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simConstants } from '../src/index';

interface RustGate { row: number; x: number; width: number; big: boolean; timing: boolean; x_min: number; x_max: number; speed: number }
interface RustStage {
  towers: { x: number; hp: number; wave_base: number }[];
  rows: number[];
  gates: RustGate[];
  crates: { x: number; width: number; y: number; hp: number }[];
  walls: { x: number; y0: number; y1: number }[];
}
interface RustLayout { name: string; stages: RustStage[] }

const layouts = simConstants().LAYOUTS as RustLayout[];
const list = <T>(xs: T[], f: (x: T) => string, indent: string) =>
  xs.length === 0 ? '[]' : `[\n${xs.map((x) => `${indent}  ${f(x)},`).join('\n')}\n${indent}]`;
const stage = (s: RustStage) => `{
        towers: [${s.towers.map((t) => `{ x: ${t.x}, hp: ${t.hp}, waveBase: ${t.wave_base} }`).join(', ')}],
        rows: [${s.rows.join(', ')}],
        gates: ${list(s.gates, (g) => `{ row: ${g.row}, x: ${g.x}, width: ${g.width}, big: ${g.big}, timing: ${g.timing}, xMin: ${g.x_min}, xMax: ${g.x_max}, speed: ${g.speed} }`, '        ')},
        crates: ${list(s.crates, (c) => `{ x: ${c.x}, width: ${c.width}, y: ${c.y}, hp: ${c.hp} }`, '        ')},
        walls: ${list(s.walls, (w) => `{ x: ${w.x}, y0: ${w.y0}, y1: ${w.y1} }`, '        ')},
      }`;
const table = `export const LAYOUTS: readonly LayoutDef[] = [
${layouts
  .map(
    (l) => `  {
    name: '${l.name}',
    stages: [
      ${l.stages.map(stage).join(',\n      ')},
    ],
  },`,
  )
  .join('\n')}
];
`;

const file = fileURLToPath(new URL('../src/constants.ts', import.meta.url));
const src = readFileSync(file, 'utf8');
const start = src.indexOf('export const LAYOUTS: readonly LayoutDef[] = [');
if (start < 0) throw new Error('LAYOUTS table not found');
writeFileSync(file, src.slice(0, start) + table, 'utf8');
console.log(`wrote ${layouts.length} layouts to src/constants.ts`);
