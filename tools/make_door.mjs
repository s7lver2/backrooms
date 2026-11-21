// Saca de "Double Door" (client/public/double_door.zip, CC-BY 4.0, adventurer) la puerta doble del vestíbulo de Las Suites: client/public/models/backrooms/suites/gdoor.glb
//   · el original va en centímetros: el marco exterior (gris liso) es la malla `02` y las hojas, con sus molduras, la `01`: se pasa a metros y se parte en `frame`, `leafL` y `leafR`
//     (cada hoja con su origen en el gozne, para girarla); el ancho va en z, el grosor en x y la altura en y
//   · la textura se reduce a 512 px (`--tex` es el png ya reducido; python: Pillow) y se dejan fuera el mapa de normales y el de rugosidad
// Uso: node tools/make_door.mjs <carpeta con scene.gltf> <textura hojas 512 px .png> [salida.glb]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [dir, texPath, outArg] = process.argv.slice(2);
if (!dir || !texPath) throw new Error('uso: node tools/make_door.mjs <carpeta con scene.gltf> <textura hojas 512 px .png> [salida.glb]');
const out = outArg ?? path.join(root, 'client/public/models/backrooms/suites/gdoor.glb');

const SY = 2.68 / 2.724, SZ = 3 / 2.7; // se estira al hueco de Las Suites (3 m de ancho y 2,7 de alto): se hornea en los vértices para que las hojas giren sin deformarse
const LEAF_Z = 1.2, LEAF_TOP = 2.62, LEAF_X = -0.075; // la hoja: dentro del hueco (|z| < 1,2 m), bajo el dintel y por delante de la moldura del marco (x > -0,075)
const src = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path.join(dir, 'scene.gltf'));
const node = src.getRoot().listNodes().find((n) => n.getName() === '01_01_0');
const prim = node.getMesh().listPrimitives()[0];
const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0'), ind = prim.getIndices();
const V = (i) => ({ p: pos.getElement(i, []).map((v) => v * 0.01), n: nor.getElement(i, []), t: uv.getElement(i, []) });

const parts = { frame: [], leafL: [], leafR: [] };
for (let t = 0; t < ind.getCount(); t += 3) {
  const vs = [0, 1, 2].map((k) => V(ind.getScalar(t + k)));
  const cx = (vs[0].p[0] + vs[1].p[0] + vs[2].p[0]) / 3, cy = (vs[0].p[1] + vs[1].p[1] + vs[2].p[1]) / 3, cz = (vs[0].p[2] + vs[1].p[2] + vs[2].p[2]) / 3;
  const leaf = Math.abs(cz) < LEAF_Z && cy < LEAF_TOP && cy > 0.03 && cx > LEAF_X;
  // los pestillos del suelo (quedaban sueltos con las hojas abiertas)
  if (!leaf && cy < 0.12 && Math.abs(cz) < 0.6) { continue; }
  parts[leaf ? (cz < 0 ? 'leafL' : 'leafR') : 'frame'].push(...vs);
}
// el marco grande (malla 02): sus triángulos, con su matriz de mundo, en otro material
const fnode = src.getRoot().listNodes().find((n) => n.getName() === '02_02_0'), fprim = fnode.getMesh().listPrimitives()[0], W = fnode.getWorldMatrix();
const fpos = fprim.getAttribute('POSITION'), fnor = fprim.getAttribute('NORMAL'), fuv = fprim.getAttribute('TEXCOORD_0'), find = fprim.getIndices();
const bigFrame = [];
for (let t = 0; t < find.getCount(); t++) {
  const i = find.getScalar(t), v = fpos.getElement(i, []);
  bigFrame.push({ p: [(W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + W[12]) * 0.01, (W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13]) * 0.01, (W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14]) * 0.01], n: fnor.getElement(i, []), t: fuv.getElement(i, []) });
}
console.log(Object.entries(parts).map(([k, v]) => `${k}: ${v.length / 3} triángulos`).join(', '));

const doc = new Document();
const buf = doc.createBuffer(), scene = doc.createScene('gdoor');
const tex = doc.createTexture('door').setImage(fs.readFileSync(texPath)).setMimeType('image/png');
const mat = doc.createMaterial('door').setBaseColorTexture(tex).setRoughnessFactor(0.55).setMetallicFactor(0.35);
const mat2 = doc.createMaterial('frame').setBaseColorFactor([0.1, 0.1, 0.1, 1]).setRoughnessFactor(0.6).setMetallicFactor(0.5); // la textura original del marco es un gris liso
const add = (name, groups, hz) => {
  const mesh = doc.createMesh(name);
  for (const [vs, m] of groups) {
    const P = new Float32Array(vs.length * 3), N = new Float32Array(vs.length * 3), T = new Float32Array(vs.length * 2);
    vs.forEach((v, i) => {
      P.set([v.p[0], v.p[1] * SY, (v.p[2] - hz) * SZ], i * 3);
      N.set(v.n, i * 3);
      T.set(v.t, i * 2);
    });
    mesh.addPrimitive(doc.createPrimitive().setMaterial(m)
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(P).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(T).setBuffer(buf)));
  }
  scene.addChild(doc.createNode(name).setMesh(mesh).setTranslation([0, 0, hz * SZ]));
};
// las hojas con el origen en el gozne (z = ±1,2 m, el borde exterior del hueco)
add('frame', [[parts.frame, mat], [bigFrame, mat2]], 0);
add('leafL', [[parts.leafL, mat]], -LEAF_Z);
add('leafR', [[parts.leafR, mat]], LEAF_Z);
await new NodeIO().registerExtensions(ALL_EXTENSIONS).write(out, doc);
console.log('escrito', out, fs.statSync(out).size, 'bytes');
