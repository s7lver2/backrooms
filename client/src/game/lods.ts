// Los LOD horneados (tools/bake_lods.mjs -> public/models/lods/backrooms/<modelo>.json + .bin): por modelo y material, hasta 3 indices más gruesos
// sobre los mismos vertices que la malla fundida de `instanced()`. El motor (Phoenyx) los elige en la GPU por el error en pantalla; three los ignora.
import * as THREE from 'three';

interface Baked {
  groups: { mat: string; verts: number; diag: number; lods: { error: number; off: number; count: number }[] }[];
  bin: ArrayBuffer;
}

const data = new Map<string, Baked>();

/** Descarga los LOD de los modelos; los que no tengan (o falle) se quedan sin LOD, sin más. */
export async function loadLods(models: readonly string[], base = '/models/lods/backrooms/'): Promise<void> {
  await Promise.all(
    models.map(async (m) => {
      try {
        const [j, b] = await Promise.all([fetch(base + m + '.json'), fetch(base + m + '.bin')]);
        if (j.ok && b.ok && (j.headers.get('content-type') ?? '').includes('json')) data.set(m, { ...(await j.json()), bin: await b.arrayBuffer() });
      } catch {
        /* sin LOD */
      }
    }),
  );
}

/** Los LOD 1..3 de una malla fundida (mismos atributos, otro indice), o undefined si no coincide con lo horneado. */
export function lodsFor(model: string | undefined, matName: string, geo: THREE.BufferGeometry): { geometry: THREE.BufferGeometry; error: number }[] | undefined {
  const d = model && data.get(model);
  const pos = geo.attributes.position;
  if (!d || !pos || geo.index) return;
  const g = d.groups.find((x) => x.mat === matName && x.verts === pos.count);
  if (!g) return;
  geo.computeBoundingBox();
  const ratio = geo.boundingBox!.getSize(new THREE.Vector3()).length() / g.diag; // el modelo puede ir a otra escala que la horneada
  if (!(ratio > 0)) return;
  return g.lods.map((l) => {
    const lg = new THREE.BufferGeometry();
    for (const [k, a] of Object.entries(geo.attributes)) lg.setAttribute(k, a);
    lg.setIndex(new THREE.BufferAttribute(new Uint32Array(d.bin, l.off, l.count), 1));
    return { geometry: lg, error: l.error * ratio };
  });
}
