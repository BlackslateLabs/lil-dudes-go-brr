import { CanvasTexture, Color, DoubleSide, ShaderMaterial, Vector2 } from 'three';

/**
 * The "glowing glass panel" gate face, drawn in one shader on a plane that is a little bigger than
 * the panel (the margin holds the outer glow and the red rig frame). The panel itself (the rounded
 * rectangle) is exactly `uSize` world units, so what you see is what the sim counts.
 *
 * Colours above 1.0 (rim, sweep, flash) are HDR and bloom on the high tier.
 */
export const GLASS_PAD = 0.38;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform vec2 uSize;
uniform float uPad;
uniform vec3 uBody;
uniform vec3 uRim;
uniform float uOpacity;
uniform float uTime;
uniform float uSeed;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uRig;
uniform float uCrack;
uniform sampler2D uCrackMap;
varying vec2 vUv;

float sdRound(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 full = uSize + 2.0 * uPad;
  vec2 p = (vUv - 0.5) * full;
  vec2 hb = uSize * 0.5;
  float d = sdRound(p, hb, 0.3);
  float aa = fwidth(d) * 1.2;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float t = clamp(p.y / uSize.y + 0.5, 0.0, 1.0);

  // Glass body: deeper at the bottom, lighter at the top, a faint inner vignette.
  vec3 body = mix(uBody * 0.7, mix(uBody, vec3(1.0), 0.22), t);
  float inner = smoothstep(0.0, 0.55, -d);
  float alpha = uOpacity * mix(1.0, 0.82, inner);

  // Glowing rim just inside the edge, plus a crisp bright line on it.
  float rimBand = 1.0 - smoothstep(0.0, 0.2, -d);
  float rimLine = 1.0 - smoothstep(0.0, aa + 0.035, abs(d + 0.07));
  vec3 col = body + uRim * rimBand * 0.6 + uRim * rimLine * 1.6;
  alpha = max(alpha, rimBand * 0.85);

  // Static shine strip (top-left diagonal) and a slow sweep every few seconds.
  float diag = p.x * 0.45 + p.y;
  float strip = smoothstep(0.22, 0.0, abs(diag - (hb.y * 0.45 - hb.x * 0.2))) * 0.55;
  float sweepPos = mix(-hb.x - hb.y - 1.5, hb.x + hb.y + 1.5, fract(uTime * 0.22 + uSeed));
  float sweep = smoothstep(0.35, 0.0, abs(diag - sweepPos)) * 0.9;
  col += vec3(1.0) * (strip + sweep) * inner;
  alpha = max(alpha, (strip + sweep * 0.6) * inside);

  // Crack (sprung trap): jagged lines from the hit point.
  vec2 cuv = (p / uSize) + 0.5;
  float crack = texture2D(uCrackMap, cuv).r * uCrack;
  col = mix(col, vec3(1.6, 1.5, 1.5), crack);
  alpha = max(alpha, crack);

  // Flash (multiply / reveal / gotcha).
  col += uFlashColor * uFlash * 1.6;
  alpha = min(1.0, alpha + uFlash * 0.35);

  vec4 panel = vec4(col, alpha * inside);

  // Outside the panel: soft rim-coloured glow, and the red rig frame.
  float outD = max(d, 0.0);
  float glow = exp(-outD * 9.0) * (1.0 - inside) * (0.45 + uFlash);
  float frame = (1.0 - smoothstep(0.0, aa + 0.02, abs(d - 0.19) - 0.1)) * uRig;
  vec3 outCol = uRim * 1.4 * glow;
  float outA = glow * 0.55;
  outCol = mix(outCol, vec3(1.0, 0.18, 0.26) * 1.25, frame);
  outA = max(outA, frame * 0.95);

  vec4 outside = vec4(outCol, outA * (1.0 - inside));
  gl_FragColor = vec4(panel.rgb * panel.a + outside.rgb * outside.a, panel.a + outside.a);
  gl_FragColor.rgb /= max(gl_FragColor.a, 0.001);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export type GlassMaterial = ShaderMaterial & {
  uniforms: {
    uSize: { value: Vector2 };
    uPad: { value: number };
    uBody: { value: Color };
    uRim: { value: Color };
    uOpacity: { value: number };
    uTime: { value: number };
    uSeed: { value: number };
    uFlash: { value: number };
    uFlashColor: { value: Color };
    uRig: { value: number };
    uCrack: { value: number };
    uCrackMap: { value: CanvasTexture };
  };
};

export function makeGlassMaterial(seed: number): GlassMaterial {
  return new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      uSize: { value: new Vector2(4, 2.3) },
      uPad: { value: GLASS_PAD },
      uBody: { value: new Color() },
      uRim: { value: new Color() },
      uOpacity: { value: 0.5 },
      uTime: { value: 0 },
      uSeed: { value: seed },
      uFlash: { value: 0 },
      uFlashColor: { value: new Color('#ffffff') },
      uRig: { value: 0 },
      uCrack: { value: 0 },
      uCrackMap: { value: crackTexture() },
    },
  }) as GlassMaterial;
}

let crack: CanvasTexture | null = null;

/** Jagged white crack lines radiating from a point a little left of centre. Drawn once. */
function crackTexture(): CanvasTexture {
  if (crack) return crack;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  let s = 12345;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const cx = 110;
  const cy = 60;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.5;
    let x = cx;
    let y = cy;
    g.lineWidth = 3.2;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 4 + Math.floor(r() * 3);
    for (let k = 0; k < steps; k++) {
      const len = 14 + r() * 18;
      const aa = a + (r() - 0.5) * 0.9;
      x += Math.cos(aa) * len * 1.6;
      y += Math.sin(aa) * len;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.lineWidth = 2.4;
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const rad = 10 + k * 13;
    for (let j = 0; j <= 10; j++) {
      const a = (j / 10) * Math.PI * 2;
      const rr = rad * (0.8 + r() * 0.4);
      const x = cx + Math.cos(a) * rr * 1.5;
      const y = cy + Math.sin(a) * rr;
      if (j === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }
  g.globalAlpha = 0.7;
  g.stroke();
  crack = new CanvasTexture(c);
  return crack;
}
