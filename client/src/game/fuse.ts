import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Funde las mallas de `from` (las de materiales de `ok`, salvo lo que cuelgue de `skip`) en una por material, en el espacio de `into`, y las cuelga de `into`:
 * cada malla suelta es un dibujo, y una puerta de las suites eran unas veinte.
 */
export function fuse(from: THREE.Object3D, into: THREE.Object3D, ok: Set<THREE.Material>, skip?: THREE.Object3D) {
  into.updateMatrixWorld(true);
  const inv = into.matrixWorld.clone().invert(), byMat = new Map<THREE.Material, THREE.BufferGeometry[]>(), old: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (o === skip) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && ok.has(mesh.material as THREE.Material)) {
      const g = mesh.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      for (const [k, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
        if (a.array instanceof Float32Array && !a.normalized && !(a as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
        const f = new Float32Array(a.count * a.itemSize), get = [a.getX, a.getY, a.getZ, a.getW];
        for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = get[c].call(a, i);
        g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
      }
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      const mat = mesh.material as THREE.Material;
      byMat.set(mat, [...(byMat.get(mat) ?? []), g.index ? g.toNonIndexed() : g]);
      old.push(mesh);
    }
    for (const c of o.children) walk(c);
  };
  walk(from);
  for (const m of old) m.removeFromParent();
  const made: THREE.Mesh[] = [];
  for (const [mat, gs] of byMat) {
    const geo = mergeGeometries(gs);
    if (!geo) continue;
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    into.add(m);
    made.push(m);
  }
  return made;
}

/** Un modelo quieto (el cartel de salida, 17 mallas) como una malla por material. */
export function fuseAll(o: THREE.Object3D) {
  const ok = new Set<THREE.Material>();
  o.traverse((x) => (x as THREE.Mesh).isMesh && !Array.isArray((x as THREE.Mesh).material) && ok.add((x as THREE.Mesh).material as THREE.Material));
  fuse(o, o, ok);
}

