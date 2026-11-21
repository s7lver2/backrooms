// Saca un solo objeto de un .glb con varios (por el nombre del nodo): node tools/split_glb.mjs entrada.glb salida.glb NombreNodo
// Conserva la jerarquía de sus padres (la escala del fbx) y tira lo demás: mallas, materiales y texturas que ya no usa nadie.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
const [, , inp, out, keep] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const d = await io.read(inp);
const has = (n) => n.getName() === keep || n.listChildren().some(has);
const cut = (n) => n.listChildren().forEach((c) => (has(c) ? (c.getName() === keep ? 0 : cut(c)) : (c.listChildren().forEach(function dis(x) { x.listChildren().forEach(dis); x.getMesh()?.dispose(); x.dispose(); }), c.getMesh()?.dispose(), c.dispose())));
d.getRoot().listScenes()[0].listChildren().forEach((n) => cut(n));
const orphan = (p) => p.listParents().every((q) => q.propertyType === 'Root');
for (let i = 0; i < 3; i++) for (const list of [d.getRoot().listMeshes(), d.getRoot().listMaterials(), d.getRoot().listTextures(), d.getRoot().listAccessors()]) for (const p of list) if (orphan(p)) p.dispose();
await io.write(out, d);
