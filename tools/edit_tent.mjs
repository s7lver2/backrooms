// Edita la entrada del modelo de la tienda (centímetros del fbx): la puerta más ancha y más alta. node tools/edit_tent.mjs entrada.glb salida.glb [anchoX=1.9] [altoY=1.2]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const [, , inp, out, ax = '1.9', ay = '1.2'] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const d = await io.read(inp);
const m = d.getRoot().listMeshes().find((q) => q.getName() === 'Military_tent_01_0');
const pos = m.listPrimitives()[0].getAttribute('POSITION'), v = [0, 0, 0];
let n = 0;
// el hueco de la lona (z > 235 cm) y la puerta que sale de él: ensancharlo y alzarlo con un fundido suave hacia la lona de alrededor, para que no se rompa
const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v);
  if (v[2] < 235 || v[1] <= 0) continue;
  const wx = 1 - sm(90, 270, Math.abs(v[0])), wy = 1 - sm(240, 340, v[1]), wz = sm(235, 262, v[2]); // (dentro del hueco y su puerta: 1; la lona de alrededor: se apaga)
  const w = wx * wy * wz;
  if (w <= 0) continue;
  v[0] *= 1 + (+ax - 1) * w;
  v[1] *= 1 + (+ay - 1) * wx * wz * (1 - sm(240, 340, v[1]));
  pos.setElement(i, v);
  n++;
}
console.log('vértices movidos', n);
for (const e of d.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_meshopt_compression') e.dispose();
await io.write(out, d);
