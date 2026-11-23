import { Color, DoubleSide, ShaderMaterial, Vector2 } from 'three';

/**
 * The "glowing glass panel" gate face, drawn in one shader on a plane that is a little bigger than
 * the panel (the margin holds the outer glow). The panel itself (the rounded
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

  // Flash (multiply / reveal).
  col += uFlashColor * uFlash * 1.6;
  alpha = min(1.0, alpha + uFlash * 0.35);

  vec4 panel = vec4(col, alpha * inside);

  // Outside the panel: soft rim-coloured glow.
  float outD = max(d, 0.0);
  float glow = exp(-outD * 9.0) * (1.0 - inside) * (0.45 + uFlash);
  vec3 outCol = uRim * 1.4 * glow;
  float outA = glow * 0.55;

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
    },
  }) as GlassMaterial;
}
