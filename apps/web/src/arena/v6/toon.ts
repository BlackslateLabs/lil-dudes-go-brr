// v6 "toy" shading for our own models (apps/web/public/assets/models/v6, built by tools/art).
//
// Every piece carries one vertex colour layer:
//   R = region: 0 team colour · 0.33 skin/light · 0.66 dark detail · 1 neutral/white
//   G = run-cycle mask (dudes): 0 rigid · 0.5 left limbs · 1 right limbs
//   B = baked ambient occlusion (1 open … ~0.5 crevices)
// The material maps regions to colours (the team colour is a uniform, so one model serves both
// teams), multiplies the AO, and lights it with a matcap: a small sphere image that holds the
// whole "glossy plastic toy" lighting, painted in code here (ours, not a borrowed image). With
// `run`, instances also get a run cycle in the vertex shader (limbs swing, the body hops), phased
// per instance by an `aPhase` instanced attribute, so a crowd of hundreds costs nothing extra.
import { CanvasTexture, Color, InstancedBufferAttribute, MeshMatcapMaterial, SRGBColorSpace, type BufferGeometry } from 'three';

let matcap: CanvasTexture | null = null;

/** A soft glossy plastic sphere: warm key from the top left, cool rim, a tight specular dot. */
export function toyMatcap(): CanvasTexture {
  if (matcap) return matcap;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = S / 2;
  // Base: light top-left falling to a soft shade bottom-right.
  const base = g.createRadialGradient(R * 0.7, R * 0.6, R * 0.1, R, R, R);
  base.addColorStop(0, '#ffffff');
  base.addColorStop(0.55, '#e6e2ee');
  base.addColorStop(0.85, '#a9a2bd');
  base.addColorStop(1, '#8c84a6');
  g.fillStyle = base;
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.fill();
  // Cool rim light around the edge (strongest bottom-right).
  const rim = g.createRadialGradient(R, R, R * 0.78, R, R, R);
  rim.addColorStop(0, 'rgba(200,230,255,0)');
  rim.addColorStop(1, 'rgba(210,235,255,0.75)');
  g.fillStyle = rim;
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.fill();
  // Specular highlight.
  const spec = g.createRadialGradient(R * 0.62, R * 0.5, 0, R * 0.62, R * 0.5, R * 0.28);
  spec.addColorStop(0, 'rgba(255,255,255,0.95)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.fillRect(0, 0, S, S);
  matcap = new CanvasTexture(c);
  matcap.colorSpace = SRGBColorSpace;
  return matcap;
}

export interface ToonOptions {
  /** Colour of region 0 (team). */
  team: string;
  /** Region 0.33 / 0.66 / 1.0 colours. */
  skin?: string;
  dark?: string;
  neutral?: string;
  /** Instanced run cycle (needs an `aPhase` instanced attribute, see `addPhase`). */
  run?: boolean;
  /** Overall brightness multiplier (1 = as painted). */
  bright?: number;
  /** Self-glow of the team colour (0..1), e.g. a pulsing gate pillar. */
  glow?: number;
}

export interface ToonMaterial extends MeshMatcapMaterial {
  userData: {
    uniforms: {
      uTeam: { value: Color };
      uSkin: { value: Color };
      uDark: { value: Color };
      uNeutral: { value: Color };
      uTime: { value: number };
      uBright: { value: number };
      uGlow: { value: number };
    };
  };
}

/** One shared toy material (a `uTime` uniform drives the run cycle: set it per frame). */
export function toonMaterial(o: ToonOptions): ToonMaterial {
  const m = new MeshMatcapMaterial({ matcap: toyMatcap(), vertexColors: true }) as ToonMaterial;
  const uniforms = {
    uTeam: { value: new Color(o.team) },
    uSkin: { value: new Color(o.skin ?? '#ffe3c8') },
    uDark: { value: new Color(o.dark ?? '#241a3a') },
    uNeutral: { value: new Color(o.neutral ?? '#ffffff') },
    uTime: { value: 0 },
    uBright: { value: o.bright ?? 1 },
    uGlow: { value: o.glow ?? 0 },
  };
  m.userData = { uniforms };
  const run = !!o.run;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uTime;
        ${run ? 'attribute float aPhase;' : ''}
        varying vec3 vRegion;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vRegion = color.rgb;
        ${
          run
            ? /* glsl */ `
        float ph = uTime * 13.0 + aPhase;
        float side = color.g > 0.75 ? 1.0 : (color.g > 0.25 ? -1.0 : 0.0);
        // Legs (low) and arms (high) swing in opposite phase; the body hops and waddles.
        float limb = position.y < 0.32 ? 1.0 : -0.8;
        transformed.z += side * limb * sin(ph) * 0.13;
        transformed.y += abs(sin(ph)) * 0.07 + side * max(0.0, sin(ph * side)) * 0.02;
        transformed.x += sin(ph * 0.5) * 0.025 * position.y;`
            : ''
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform vec3 uTeam; uniform vec3 uSkin; uniform vec3 uDark; uniform vec3 uNeutral;
        uniform float uBright; uniform float uGlow;
        varying vec3 vRegion;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        float r = vRegion.r;
        vec3 region = r < 0.165 ? uTeam : (r < 0.5 ? uSkin : (r < 0.83 ? uDark : uNeutral));
        diffuseColor.rgb = region * mix(0.55, 1.0, vRegion.b) * uBright;`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `outgoingLight = outgoingLight * 1.18 + (vRegion.r < 0.165 ? uTeam * uGlow : vec3(0.0));
        #include <opaque_fragment>`,
      );
  };
  // Distinct programs for run / static variants.
  m.customProgramCacheKey = () => (run ? 'toon-run' : 'toon');
  return m;
}

/** Adds the per-instance run phase attribute (random, fixed) to a geometry used instanced. */
export function addPhase(geo: BufferGeometry, count: number): void {
  const a = new Float32Array(count);
  for (let i = 0; i < count; i++) a[i] = (i * 2.399) % (Math.PI * 2);
  geo.setAttribute('aPhase', new InstancedBufferAttribute(a, 1));
}
