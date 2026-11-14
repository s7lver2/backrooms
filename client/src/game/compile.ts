import { DEV_LOCAL } from '../devGate';
import * as THREE from 'three';
import { isStill } from './still';
import { settings } from '../settings';

/*
 * Lo que se compila de fondo (la escena siguiente) se aparta mientras alguien interactúa: cada
 * clic, tecla o toque da 2 s sin compilar, lo que duran las animaciones que provoca (coger el
 * mando, ir a una tele). En la pantalla de carga no: ahí no hay nada que estorbar.
 */
let quietUntil = 0;
const touched = () => {
  if (!document.documentElement.dataset.loading) quietUntil = performance.now() + 2000;
};
if (typeof window !== 'undefined') for (const e of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(e, touched, { passive: true, capture: true });
// desarrollo: &nopar hace como Firefox, sin compilación en paralelo
if (typeof window !== 'undefined' && DEV_LOCAL && new URLSearchParams(location.search).has('nopar')) {
  const get = WebGL2RenderingContext.prototype.getExtension;
  WebGL2RenderingContext.prototype.getExtension = function (this: WebGL2RenderingContext, n: string) {
    return n === 'KHR_parallel_shader_compile' ? null : get.call(this, n as 'OCULUS_multiview');
  } as typeof get;
}

/*
 * Cuánto se precompila (ajuste SHADER WARM-UP; se lee una vez al arrancar, así que se aplica al recargar):
 * 2 completo (todo, también lo oculto), 1 rápido (solo lo visible; lo oculto se compila al mostrarse) y
 * 0 perezoso (nada: cada programa se compila al pintarse por primera vez, con el tirón que eso trae).
 */
const warmup = [0, 1, 2].includes(settings.warmup) ? settings.warmup : 2;

/**
 * Compila los materiales de una escena antes de pintarla: también lo oculto (sin las luces ocultas,
 * que cambiarían la cuenta de luces) y en la variante del destino intermedio, que es donde pinta el
 * compositor. Objeto a objeto, soltando el hilo cada ~40 ms: Firefox no compila en paralelo y cada
 * programa le cuesta unos 0,4 s; de golpe, una escena entera colgaba el navegador medio minuto. Así
 * tarda lo mismo, pero la página sigue viva. Al final espera a que todo esté listo (en Chrome,
 * que sí compila en paralelo, es ahí donde se espera).
 *
 * `around` envuelve cada paso (no lo que pasa entre uno y otro, cuando otra escena puede estar
 * pintando con el mismo renderer): para el estado que la escena necesita al compilar.
 */
/** Sube a la GPU las texturas de la escena (la primera vez que se pintan cuestan un tirón: al girar la cámara hacia algo nuevo), soltando el hilo cada ~30 ms. */
async function uploadTextures(r: THREE.WebGLRenderer, scene: THREE.Scene) {
  const seen = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture && (v as THREE.Texture).image) seen.add(v as THREE.Texture);
  });
  let t = performance.now();
  for (const tex of seen) {
    r.initTexture(tex);
    if (performance.now() - t > 30) (await new Promise((res) => setTimeout(res))), (t = performance.now());
  }
}

export async function compileGently(r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera, around = <T>(fn: () => T) => fn(), progress?: (f: number) => void) {
  if (warmup === 0) {
    await uploadTextures(r, scene);
    progress?.(1);
    if (DEV_LOCAL) console.info('[compile] perezoso: nada precompilado');
    return;
  }
  const quick = warmup === 1;
  const hidden: THREE.Object3D[] = [], items: THREE.Object3D[] = [];
  // en rápido solo lo visible: traverseVisible no entra en lo oculto, así que `hidden` se queda vacío
  (quick ? scene.traverseVisible : scene.traverse).call(scene, (o: THREE.Object3D) => {
    if (!o.visible && !(o as THREE.Light).isLight) hidden.push(o);
    // con una luz dentro, compilarlo suelto la contaría dos veces: lo coge la pasada final
    if ((o as THREE.Mesh).material && !o.getObjectByProperty('isLight', true)) items.push(o);
  });
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const step = <T>(fn: () => T) =>
    around(() => {
      const before = r.getRenderTarget();
      for (const h of hidden) h.visible = true;
      r.setRenderTarget(rt);
      const out = fn();
      r.setRenderTarget(before);
      for (const h of hidden) h.visible = false;
      return out;
    });
  // sin compilación en paralelo, compile() solo encola el trabajo (Firefox lo manda a otro proceso)
  // y se paga entero en la primera espera: preguntar por cada programa nuevo lo paga ya, uno a uno
  const gl = r.getContext(), sync = !r.extensions.has('KHR_parallel_shader_compile');
  let seen = r.info.programs?.length ?? 0, t = performance.now();
  const stat = { from: seen, at: t, busy: 0 };
  for (const [i, o] of items.entries()) {
    // sin compilación en paralelo, cada programa congela la página: solo con la pantalla quieta (ver still.ts)
    while (sync && (performance.now() < quietUntil || !isStill())) await new Promise((res) => setTimeout(res, 100));
    const b0 = performance.now();
    step(() => r.compile(o, cam, scene));
    const ps = r.info.programs ?? [];
    if (sync) for (; seen < ps.length; seen++) gl.getProgramParameter(ps[seen].program, gl.LINK_STATUS);
    stat.busy += performance.now() - b0;
    if (performance.now() - t > 40) {
      progress?.(i / items.length);
      await new Promise((res) => setTimeout(res));
      t = performance.now();
    }
  }
  if (quick) {
    // compileAsync recorrería la escena entera (también lo oculto): aquí solo se espera a los programas ya pedidos
    const ready = (p: unknown) => (p as { isReady?: () => boolean }).isReady?.() ?? true;
    while (!(r.info.programs ?? []).every(ready)) await new Promise((res) => setTimeout(res, 10));
  } else await step(() => r.compileAsync(scene, cam));
  rt.dispose();
  await uploadTextures(r, scene);
  // desarrollo: cuánto ha costado (en Firefox, sin compilación en paralelo, es casi todo bloqueo)
  if (DEV_LOCAL)
    console.info(`[compile] ${(r.info.programs?.length ?? 0) - stat.from} programas, ${Math.round(stat.busy)} ms bloqueando, ${Math.round(performance.now() - stat.at)} ms en total (${sync ? 'sin' : 'con'} paralelo, ${quick ? 'rápido' : 'completo'})`);
}
