// Hornea los niveles de detalle (LOD) de los modelos del juego: client/public/models/**.glb -> client/public/models/lods/<ruta>.json + .bin
//   · reproduce lo que hace `instanced()` de world.ts: las mallas del glb se funden por material, sin indexar y con la matriz del nodo aplicada
//   · por cada grupo con trianglos de sobra se simplifican hasta 3 LOD (1/4, 1/16, 1/64 de los triangulos); cada LOD es solo un indice
//     sobre los mismos vertices (el motor los comparte con el LOD 0), y su error se guarda en unidades del modelo
//   · el juego solo usa un grupo si su nombre de material y su numero de vertices coinciden con los horneados
//   · es incremental: se salta el glb cuyo resultado es mas nuevo que el glb
// Uso: node tools/bake_lods.mjs   (en desarrollo y al compilar lo lanza solo el plugin `bakeLods` de client/vite.config.ts)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'client/public/models');
const out = path.join(src, 'lods');
const MIN_TRIS = 600; // por debajo, el LOD no compensa
const RATIOS = [4, 16, 64];

function* walk(p) {
  for (const f of fs.readdirSync(p)) {
    const q = path.join(p, f);
    if (q === out) continue;
    if (fs.statSync(q).isDirectory()) yield* walk(q);
    else if (q.endsWith('.glb')) yield q;
  }
}

await Promise.all([MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
let baked = 0, skipped = 0;

for (const file of walk(src)) {
  const rel = path.relative(src, file).split(path.sep).join('/').slice(0, -4);
  const json = path.join(out, rel + '.json'), bin = path.join(out, rel + '.bin');
  if (fs.existsSync(json) && fs.existsSync(bin) && fs.statSync(json).mtimeMs > fs.statSync(file).mtimeMs) { skipped++; continue; }
  const doc = await io.read(file);
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  // material -> posiciones sin indexar (x,y,z por vertice) en el orden en que three recorre la escena
  const byMat = new Map();
  const visit = (node) => {
    const mesh = node.getMesh();
    if (mesh) {
      const m = node.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        if (p.getMode() !== 4) continue;
        const pos = p.getAttribute('POSITION'), ind = p.getIndices();
        const n = ind ? ind.getCount() : pos.getCount();
        const g = byMat.get(p.getMaterial()) ?? { name: p.getMaterial()?.getName() ?? '', v: [] };
        byMat.set(p.getMaterial(), g);
        const e = [0, 0, 0];
        for (let i = 0; i < n; i++) {
          pos.getElement(ind ? ind.getScalar(i) : i, e);
          g.v.push(m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12], m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13], m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14]);
        }
      }
    }
    node.listChildren().forEach(visit);
  };
  scene.listChildren().forEach(visit);

  const groups = [], chunks = [];
  let off = 0;
  for (const g of byMat.values()) {
    const verts = g.v.length / 3, tris = verts / 3;
    if (tris < MIN_TRIS) continue;
    // soldadura por posicion: los vertices sin indexar pasan a un indice compartido, que es lo que simplifica
    const weld = new Map(), rep = [], idx = new Uint32Array(verts), pos = [];
    for (let i = 0; i < verts; i++) {
      const k = `${g.v[i * 3]},${g.v[i * 3 + 1]},${g.v[i * 3 + 2]}`;
      let w = weld.get(k);
      if (w === undefined) (w = rep.length), weld.set(k, w), rep.push(i), pos.push(g.v[i * 3], g.v[i * 3 + 1], g.v[i * 3 + 2]);
      idx[i] = w;
    }
    const P = new Float32Array(pos), scale = MeshoptSimplifier.getScale(P, 3);
    const lods = [];
    let cur = idx, err = 0;
    for (const r of RATIOS) {
      const target = Math.max(12, Math.floor(tris / r)) * 3;
      const [res, e] = MeshoptSimplifier.simplify(cur, P, 3, target, 1);
      if (res.length >= cur.length * 0.9) break; // ya no se puede (o no merece la pena): sin mas LOD
      err += e * scale;
      cur = res;
      const o = new Uint32Array(res.length);
      for (let i = 0; i < res.length; i++) o[i] = rep[res[i]]; // de vuelta a un vertice sin indexar que tenga esa posicion
      lods.push({ error: err, off, count: o.length });
      chunks.push(Buffer.from(o.buffer));
      off += o.length * 4;
    }
    // diagonal de la caja: el juego escala el error por (su diagonal / esta) cuando coloca el modelo con otra escala
    const lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
    for (let i = 0; i < verts; i++) for (let c = 0; c < 3; c++) (lo[c] = Math.min(lo[c], g.v[i * 3 + c])), (hi[c] = Math.max(hi[c], g.v[i * 3 + c]));
    if (lods.length) groups.push({ mat: g.name, verts, diag: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), lods });
    console.log(`bake_lods: ${rel} ${g.name || '(sin nombre)'} ${tris} tris -> ${lods.map((l) => `${l.count / 3} (err ${l.error.toFixed(4)})`).join(', ')}`);
  }
  fs.mkdirSync(path.dirname(json), { recursive: true });
  fs.writeFileSync(bin, Buffer.concat(chunks));
  fs.writeFileSync(json, JSON.stringify({ groups }));
  baked++;
}
console.log(`bake_lods: ${baked} horneados, ${skipped} al dia`);
