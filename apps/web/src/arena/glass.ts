import { Color, DoubleSide, ShaderMaterial, Vector2 } from 'three';

/**
 * The gate face: a bold, opaque candy panel drawn in one shader on a plane that is a little bigger
 * than the panel (the margin holds a soft outer glow). Saturated body with a top-to-bottom shade,
 * a thick bright rim inside a dark outline (so it reads on the pale lane), a gloss band, and a
 * slow sheen sweep. The panel itself (the rounded rectangle) is exactly `uSize` world units, so
 * what you see is what the sim counts.
 *
 * Colours above 1.0 (sweep, flash) are HDR and bloom on the high tier.
 */
export const GLASS_PAD = 0.3;

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

const float OUTLINE = 0.07; // dark edge
const float RIM = 0.24;     // bright rim, inside the outline

void main() {
  vec2 full = uSize + 2.0 * uPad;
  vec2 p = (vUv - 0.5) * full;
  vec2 hb = uSize * 0.5;
  float d = sdRound(p, hb, 0.34);
  float aa = fwidth(d) * 1.2;
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float t = clamp(p.y / uSize.y + 0.5, 0.0, 1.0);

  // Body: saturated, deeper at the bottom, a touch lighter at the top.
  vec3 body = mix(uBody * 0.62, mix(uBody, vec3(1.0), 0.12), smoothstep(0.0, 1.0, t));
  // Inner bevel: a slightly darker ring just inside the rim, so the face looks sunk in a frame.
  float bevel = smoothstep(RIM + 0.22, RIM, -d);
  body *= 1.0 - bevel * 0.22;
  // Gloss band across the upper part of the face.
  float gloss = smoothstep(0.55, 0.7, t) * (1.0 - smoothstep(0.86, 0.95, t));
  body = mix(body, vec3(1.0), gloss * 0.16);

  // Rim (bright, with its own light-to-dark shade) and the dark outline on the very edge.
  float rimK = 1.0 - smoothstep(RIM - aa, RIM + aa, -d);
  vec3 rim = mix(uRim * 0.82, uRim * 1.1, t);
  vec3 col = mix(body, rim, rimK);
  float outK = 1.0 - smoothstep(OUTLINE - aa, OUTLINE + aa, -d);
  col = mix(col, vec3(0.106, 0.082, 0.188), outK * 0.85);

  // Sheen sweep every few seconds, on the face only.
  float diag = p.x * 0.45 + p.y;
  float sweepPos = mix(-hb.x - hb.y - 1.5, hb.x + hb.y + 1.5, fract(uTime * 0.2 + uSeed));
  float sweep = smoothstep(0.35, 0.0, abs(diag - sweepPos)) * 0.55 * (1.0 - rimK);
  col += vec3(1.0) * sweep;

  // Flash (multiply / reveal).
  col += uFlashColor * uFlash * 1.4;

  vec4 panel = vec4(col, uOpacity * inside);

  // Outside the panel: a soft rim-coloured glow.
  float outD = max(d, 0.0);
  float glow = exp(-outD * 10.0) * (1.0 - inside) * (0.3 + uFlash);
  vec4 outside = vec4(uRim * 1.3, glow * 0.5);
  gl_FragColor = vec4(panel.rgb * panel.a + outside.rgb * outside.a, panel.a + outside.a);
  gl_FragColor.rgb /= max(gl_FragColor.a, 0.001);
  gl_FragColor.a = min(gl_FragColor.a, 1.0);
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
      uSize: { value: new Vector2(4, 2.6) },
      uPad: { value: GLASS_PAD },
      uBody: { value: new Color() },
      uRim: { value: new Color() },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uSeed: { value: seed },
      uFlash: { value: 0 },
      uFlashColor: { value: new Color('#ffffff') },
    },
  }) as GlassMaterial;
}
