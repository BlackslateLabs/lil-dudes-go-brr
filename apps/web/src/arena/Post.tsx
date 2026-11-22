import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { HalfFloatType } from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';

/**
 * HDR post-processing for the high tier: the scene renders into a half-float target, then ONE
 * merged full-screen pass does bloom (mip-chain blur at reduced resolution), a soft vignette and
 * tone mapping. Bloom is selective by brightness: only things pushed above 1.0 (gate rims, post
 * orbs, sparkles, emissive doors) glow; the lit lane and grass stay below the threshold.
 */
export function Post() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const composer = useMemo(() => {
    // MSAA on the scene target only where pixels are big (DPR 1); at DPR 2 edges are fine as is.
    const c = new EffectComposer(gl, { frameBufferType: HalfFloatType, multisampling: dpr < 1.5 ? 4 : 0 });
    c.addPass(new RenderPass(scene, camera));
    const bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.1,
      luminanceSmoothing: 0.2,
      intensity: 0.9,
      radius: 0.7,
    });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.38 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    c.addPass(new EffectPass(camera, bloom, vignette, tone));
    return c;
  }, [gl, scene, camera, dpr]);

  useEffect(() => composer.setSize(size.width, size.height), [composer, size.width, size.height]);
  useEffect(() => () => composer.dispose(), [composer]);

  // Priority 1 takes over rendering from R3F.
  useFrame((_, dt) => composer.render(dt), 1);
  return null;
}
