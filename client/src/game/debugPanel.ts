import type * as THREE from 'three';
import type { BackroomsGame } from './game';

/** Panel de ajuste en vivo (`?debug`, solo en desarrollo local). Se carga con import() dinámico: no pesa sin `?debug`. */
export async function openDebugPanel(g: BackroomsGame) {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'debug' });
  const fog = g.scene.fog as THREE.Fog;
  const o = {
    fogColor: '#' + fog.color.getHexString(),
    copiar: () => navigator.clipboard.writeText(JSON.stringify(vals(), null, 2)),
  };
  const bloom = g.bloomPass;
  const vals = () => ({
    hemi: g.hemi.intensity,
    flash: { intensity: g.flash.intensity, distance: g.flash.distance },
    fog: { color: o.fogColor, near: fog.near, far: fog.far },
    bloom: bloom && { strength: bloom.strength, threshold: bloom.threshold, radius: bloom.radius },
    vhs: g.vhs.uniforms.uAmount.value,
  });
  gui.add(g.hemi, 'intensity', 0, 2, 0.01).name('hemisferio');
  gui.add(g.flash, 'intensity', 0, 20, 0.1).name('linterna (se repone al encender)');
  gui.add(g.flash, 'distance', 0, 60, 0.5).name('linterna alcance');
  const f = gui.addFolder('niebla');
  f.add(fog, 'near', 0, 40, 0.1);
  f.add(fog, 'far', 1, 80, 0.1);
  f.addColor(o, 'fogColor').onChange((c: string) => fog.color.set(c));
  if (bloom) {
    const b = gui.addFolder('bloom');
    b.add(bloom, 'strength', 0, 3, 0.01);
    b.add(bloom, 'threshold', 0, 1, 0.01);
    b.add(bloom, 'radius', 0, 1.5, 0.01);
  }
  gui.add(g.vhs.uniforms.uAmount, 'value', 0, 1, 0.01).name('VHS');
  gui.add(o, 'copiar').name('copiar JSON');
}
