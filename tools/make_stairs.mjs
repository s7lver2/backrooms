// Saca de la escalera "Heathmont Concrete Stairs" (client/public/heathmont_concrete_stairs_-_handrail_setout_v1.zip, CC-BY 4.0, Darren Falconer)
// el módulo de una planta de la escalera de servicio de Las Suites: client/public/models/backrooms/suites/stairs.glb
//   · el modelo original es un fragmento de ~3 plantas en milímetros con piezas sueltas (postes sin textura, cristales, losas que se solapan): se pasa a metros,
//     se quedan los triángulos cuyo centro cae en el módulo (suelo, los dos tramos, el descansillo y la losa de arriba) y se descartan postes y cristales
//   · se funde por material, se sueldan los vértices y se simplifica con meshoptimizer
// Uso: node tools/make_stairs.mjs <carpeta con scene.gltf> [salida.glb]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptSimplifier } from 'meshoptimizer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];
const out = process.argv[3] ?? path.join(root, 'client/public/models/backrooms/suites/stairs.glb');
if (!dir) throw new Error('uso: node tools/make_stairs.mjs <carpeta con scene.gltf> [salida.glb]');

// el módulo (metros, ejes del modelo): del suelo de abajo (la losa acaba en y = -1.813) a la losa de arriba (su cara superior, y = 2.0)
const Y0 = -1.92, Y1 = 2.01, X0 = -1.5, X1 = 1.65, Z0 = -0.85, Z1 = 4.0;
const FLOOR_Y = -1.75; // por debajo: la losa del suelo (su cara de arriba está en y = -1.813)
const DROP = new Set(['254254255', '250250250']); // los postes (morados: sin material) y los cristales
const GRID = 0.006, KEEP_RATIO = 0.1, ERR = 0.01, MAX_TRIS = 3000 // por material: lo que queda es sobre todo tubos de barandilla y postes con cientos de lados;

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const src = await io.read(path.join(dir, 'scene.gltf'));
const sroot = src.getRoot();

const groups = new Map(); // `parte|material` -> { v: [x,y,z,nx,ny,nz,u,v por vértice], mat, part }; parte: 'floor' (la losa del suelo, solo en la planta de abajo) o 'body'
let total = 0, kept = 0;
for (const node of sroot.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const W = node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const mat = p.getMaterial();
    if (DROP.has(mat?.getName())) continue;
    const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL'), uv = p.getAttribute('TEXCOORD_0'), ind = p.getIndices();
    const P = (i) => {
      const v = pos.getElement(i, []);
      return [(W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + W[12]) * 0.001, (W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13]) * 0.001, (W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14]) * 0.001];
    };
    for (let t = 0; t < ind.getCount(); t += 3) {
      total++;
      const ids = [ind.getScalar(t), ind.getScalar(t + 1), ind.getScalar(t + 2)], ps = ids.map(P);
      const cx = (ps[0][0] + ps[1][0] + ps[2][0]) / 3, cy = (ps[0][1] + ps[1][1] + ps[2][1]) / 3, cz = (ps[0][2] + ps[1][2] + ps[2][2]) / 3;
      if (cy < Y0 || cy > Y1 || cx < X0 || cx > X1 || cz < Z0 || cz > Z1) continue;
      kept++;
      const part = cy < FLOOR_Y ? 'floor' : 'body', gk = `${part}|${mat.getName()}`;
      const g = groups.get(gk) ?? { v: [], mat, part };
      groups.set(gk, g);
      ids.forEach((id, k) => {
        const n = nor ? nor.getElement(id, []) : [0, 1, 0], u = uv ? uv.getElement(id, []) : [0, 0];
        g.v.push(...ps[k], ...n, u[0], u[1]);
      });
    }
  }
}
console.log(`triángulos: ${kept} de ${total}`);

const doc = new Document();
const buf = doc.createBuffer();
const scene = doc.createScene('stairs');
const meshes = {};
for (const part of ['body', 'floor']) {
  const node = doc.createNode(part), mesh = doc.createMesh(part);
  scene.addChild(node);
  node.setMesh(mesh);
  meshes[part] = mesh;
}
const texCache = new Map();
let tris = 0;
for (const g of groups.values()) {
  // soldar: un vértice por posición+normal+uv cuantizados
  const map = new Map(), verts = [], index = [];
  const q = (x) => Math.round(x / GRID), textured = !!g.mat.getBaseColorTexture();
  for (let i = 0; i < g.v.length; i += 8) {
    const nx = g.v[i + 3], ny = g.v[i + 4], nz = g.v[i + 5], ax = Math.max(Math.abs(nx), Math.abs(ny), Math.abs(nz));
    const face = ax === Math.abs(nx) ? (nx > 0 ? 0 : 1) : ax === Math.abs(ny) ? (ny > 0 ? 2 : 3) : nz > 0 ? 4 : 5; // (la cara a la que mira: una arista no mezcla las normales de sus dos lados)
    const key = textured ? `${q(g.v[i])},${q(g.v[i + 1])},${q(g.v[i + 2])},${face},${Math.round(g.v[i + 6] * 8)},${Math.round(g.v[i + 7] * 8)}` : `${q(g.v[i])},${q(g.v[i + 1])},${q(g.v[i + 2])}`; // (sin textura: solo la posición, que es lo que deja simplificar los tubos)
    let id = map.get(key);
    if (id === undefined) (id = verts.length / 8), map.set(key, id), verts.push(...g.v.slice(i, i + 8));
    index.push(id);
  }
  const tri = [];
  for (let i = 0; i < index.length; i += 3) if (index[i] !== index[i + 1] && index[i + 1] !== index[i + 2] && index[i] !== index[i + 2]) tri.push(index[i], index[i + 1], index[i + 2]);
  let idx = new Uint32Array(tri);
  const posArr = new Float32Array(verts.length / 8 * 3);
  for (let i = 0; i < verts.length / 8; i++) posArr.set(verts.slice(i * 8, i * 8 + 3), i * 3);
  const target = Math.max(60, Math.floor(Math.min(idx.length * KEEP_RATIO, MAX_TRIS * 3) / 3) * 3);
  const [simp] = MeshoptSimplifier.simplify(idx, posArr, 3, target, ERR, []);
  idx = simp;
  // compactar los vértices que quedan
  const remap = new Map(), pos = [], nor = [], uvs = [], fin = [];
  for (const i of idx) {
    let j = remap.get(i);
    if (j === undefined) {
      j = pos.length / 3;
      remap.set(i, j);
      pos.push(verts[i * 8], verts[i * 8 + 1], verts[i * 8 + 2]);
      nor.push(verts[i * 8 + 3], verts[i * 8 + 4], verts[i * 8 + 5]);
      uvs.push(verts[i * 8 + 6], verts[i * 8 + 7]);
    }
    fin.push(j);
  }
  tris += fin.length / 3;
  console.log(`  ${g.part} ${g.mat.getName()}: ${g.v.length / 24} -> ${fin.length / 3} triángulos`);
  const m = doc.createMaterial(g.mat.getName()).setBaseColorFactor(g.mat.getBaseColorFactor()).setRoughnessFactor(0.95).setMetallicFactor(0);
  const tex = g.mat.getBaseColorTexture();
  if (tex) {
    let t = texCache.get(tex);
    if (!t) texCache.set(tex, (t = doc.createTexture(tex.getName()).setImage(tex.getImage()).setMimeType(tex.getMimeType())));
    m.setBaseColorTexture(t);
  }
  const prim = doc.createPrimitive().setMaterial(m);
  prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buf));
  prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buf));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(fin)).setBuffer(buf));
  meshes[g.part].addPrimitive(prim);
}
await io.write(out, doc);
console.log(`escrito ${out}: ${groups.size} materiales, ${tris} triángulos`);
