// Informe de calidad de los .glb (client/public/models, o los archivos/carpetas que se pasen como argumento).
// Informativo: AVISO si pasa un umbral; sale con 0 salvo error de lectura. Uso: npm run check:glb [-- ruta ...]
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { ImageUtils, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// el mismo descodificador meshopt que ya trae three (sin dependencia nueva)
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const MAX = { materials: 12, bones: 60, texture: 2048, triangles: 150000 };
const HEIGHT = [0.05, 10]; // metros (escala del modelo; no se comprueba en modelos con huesos: sus límites no son fiables)

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const inputs = args.length ? args.map((a) => resolve(a)) : [join(root, 'client/public/models')];

function* walk(p) {
  if (statSync(p).isDirectory()) for (const f of readdirSync(p)) yield* walk(join(p, f));
  else if (p.endsWith('.glb')) yield p;
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
let nWarn = 0, nErr = 0, n = 0;

for (const file of inputs.flatMap((p) => [...walk(p)])) {
  n++;
  const name = relative(root, file).split(sep).join('/');
  try {
    const doc = await io.read(file);
    const r = doc.getRoot();
    const bones = new Set(r.listSkins().flatMap((s) => s.listJoints())).size;
    let tris = 0;
    for (const m of r.listMeshes()) for (const p of m.listPrimitives()) {
      const c = p.getIndices()?.getCount() ?? p.getAttribute('POSITION')?.getCount() ?? 0;
      if (p.getMode() === 4) tris += c / 3;
    }
    let maxTex = 0;
    for (const t of r.listTextures()) { const [w, h] = ImageUtils.getSize(t.getImage() ?? new Uint8Array(), t.getMimeType()) ?? [0, 0]; maxTex = Math.max(maxTex, w, h); }
    const b = getBounds(r.getDefaultScene() ?? r.listScenes()[0]);
    const height = b.max[1] - b.min[1];
    const avisos = [];
    if (r.listMaterials().length > MAX.materials) avisos.push(`materiales>${MAX.materials}`);
    if (bones > MAX.bones) avisos.push(`huesos>${MAX.bones}`);
    if (maxTex > MAX.texture) avisos.push(`textura>${MAX.texture}`);
    if (tris > MAX.triangles) avisos.push(`triangulos>${MAX.triangles}`);
    if (!bones && Number.isFinite(height) && (height < HEIGHT[0] || height > HEIGHT[1])) avisos.push(`altura fuera de ${HEIGHT[0]}-${HEIGHT[1]} m`);
    if (avisos.length) nWarn++;
    console.log(`${avisos.length ? 'AVISO' : 'ok   '} ${name}  mat=${r.listMaterials().length} mallas=${r.listMeshes().length} huesos=${bones} skins=${r.listSkins().length} tex=${r.listTextures().length} (max ${maxTex}px) tris=${tris} alto=${height.toFixed(2)} m  ${(statSync(file).size / 1024).toFixed(0)} KB${avisos.length ? '  <- ' + avisos.join(', ') : ''}`);
  } catch (e) {
    nErr++;
    console.error(`ERROR ${name}: ${e.message}`);
  }
}
console.log(`\n${n} modelos, ${nWarn} con aviso, ${nErr} con error de lectura`);
process.exit(nErr ? 1 : 0);
