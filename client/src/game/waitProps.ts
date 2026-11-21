import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WAIT_HALF } from '@backrooms/shared';
import type { Assets } from './game';
import { fit } from './hospital';
import { canvasTex, type Bag, type Box } from './waitKit';

/*
 * El mobiliario de la sala de espera que viene de modelos: una fila de sillones de los años 50 contra la pared sur
 * (una sola malla instanciada por pieza), una tele CRT encendida sobre una mesita (frente al sillón de la esquina)
 * y un reloj de pared con la hora real. Los materiales se copian: los del juego llevan el parche del mapa de luz.
 */

const H = WAIT_HALF;
export interface Extra {
  chair?: GLTF;
  tent?: GLTF;
  bench?: GLTF;
  jerry?: GLTF;
  beacon?: GLTF;
  firstaid?: GLTF;
  radio?: GLTF;
  extinguisher?: GLTF;
  rack?: GLTF;
  c64?: GLTF;
  lockerx?: GLTF;
  generator?: GLTF;
  crates?: GLTF;
  skeleton?: GLTF;
  barrels?: GLTF;
  body?: GLTF;
}

/** Copia los materiales de un objeto (y los apunta para liberarlos al salir). */
function own(o: THREE.Object3D, bag: Bag) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    m.userData.shared = true;
    m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
    bag.own.push(...(Array.isArray(m.material) ? m.material : [m.material]));
  });
  return o;
}

/** Repite `src` en cada posición con una InstancedMesh por pieza (las geometrías, ya a su sitio, se liberan solas). */
function instance(src: THREE.Object3D, spots: { x: number; z: number; ry: number }[], bag: Bag) {
  const g = new THREE.Group(), at = new THREE.Matrix4();
  src.updateWorldMatrix(true, true);
  src.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone().applyMatrix4(m.matrixWorld), im = new THREE.InstancedMesh(geo, m.material, spots.length);
    spots.forEach((s, i) => im.setMatrixAt(i, at.compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.ry), new THREE.Vector3(1, 1, 1))));
    im.userData.shared = true;
    bag.own.push(geo);
    g.add(im);
  });
  return g;
}

export function addProps(S: THREE.Scene, assets: Assets, extra: Extra, bag: Bag, boxes: Box[], shadow: (b: Box) => void) {
  const solid = (b: Box) => (boxes.push(b), shadow(b));

  // los sillones, en fila contra la pared sur y de cara a la puerta
  if (extra.chair) {
    const row = [-1.3, -0.45, 0.4].map((x) => ({ x, z: H.z - 0.33, ry: -Math.PI / 2 }));
    S.add(instance(own(fit(extra.chair, 0.8, 'y'), bag), row, bag));
    solid({ x0: -1.65, x1: 0.75, z0: H.z - 0.66, z1: H.z });
  }

  // la tele, en la pared este entre la papelera y el sillón, mirando al cuarto
  const table = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x3a2f20, roughness: 0.7 });
  bag.own.push(wood);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.8), wood);
  top.position.y = 0.55;
  table.add(top);
  for (const [x, z] of [[-0.2, -0.35], [0.2, -0.35], [-0.2, 0.35], [0.2, 0.35]]) table.add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.54, 0.04), wood).translateX(x).translateY(0.27).translateZ(z));
  bag.own.push(...table.children.map((c) => (c as THREE.Mesh).geometry));
  table.position.set(H.x - 0.28, 0, 0.85);
  S.add(table);
  const tv = own(fit(assets.gltf.crt, 0.5, 'x'), bag);
  tv.position.set(H.x - 0.28, 0.57, 0.85);
  tv.rotation.y = -Math.PI / 2;
  S.add(tv);
  solid({ x0: H.x - 0.55, x1: H.x, z0: 0.45, z1: 1.25 });

  // la pantalla de la tele: nieve que baila (se mueve el desplazamiento de un lienzo de ruido)
  const noise = canvasTex(64, 64, (x) => {
    const im = x.createImageData(64, 64);
    for (let i = 0; i < im.data.length; i += 4) (im.data[i] = im.data[i + 1] = im.data[i + 2] = 60 + Math.random() * 170), (im.data[i + 3] = 255);
    x.putImageData(im, 0, 0);
  });
  noise.repeat.set(0.5, 0.5);
  bag.tex.push(noise);
  // la pantalla es la propia malla del cristal del modelo (la que se abomba al frente): se queda con su sitio y se le pone la nieve,
  // con las UV proyectadas de frente (x, y de la tele) para que el ruido ocupe el cristal entero
  tv.updateMatrixWorld(true);
  const scr = tv.getObjectByName('defaultMaterial_4') as THREE.Mesh | undefined;
  if (scr) {
    const g = scr.geometry.clone(), pos = g.attributes.position, to = new THREE.Matrix4().copy(tv.matrixWorld).invert().multiply(scr.matrixWorld), v = new THREE.Vector3();
    const xy = Array.from({ length: pos.count }, (_, i) => (v.fromBufferAttribute(pos, i).applyMatrix4(to), [v.x, v.y]));
    const x0 = Math.min(...xy.map((q) => q[0])), x1 = Math.max(...xy.map((q) => q[0])), y0 = Math.min(...xy.map((q) => q[1])), y1 = Math.max(...xy.map((q) => q[1]));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(xy.flatMap((q) => [(q[0] - x0) / (x1 - x0), (q[1] - y0) / (y1 - y0)]), 2));
    scr.geometry = g;
    scr.material = new THREE.MeshBasicMaterial({ map: noise, color: 0x7f948a });
    bag.own.push(g, scr.material);
  }
  // el reloj de la pared oeste, con la hora de verdad: el aro del modelo, la esfera pintada y dos agujas
  const clock = new THREE.Group(), face = new THREE.Mesh(new THREE.CircleGeometry(0.2, 32), new THREE.MeshBasicMaterial({
    color: 0xcfc8a8,
    map: canvasTex(128, 128, (x) => {
      x.fillStyle = '#e8e2c6';
      x.fillRect(0, 0, 128, 128);
      x.fillStyle = '#2a261a';
      for (let i = 0; i < 12; i++) x.fillRect(62 + 0, 4, 4, i % 3 ? 7 : 12), x.translate(64, 64), x.rotate(Math.PI / 6), x.translate(-64, -64);
    }),
  }));
  face.position.z = 0.05;
  const rim = fit(assets.gltf['hospital/clock'], 0.46, 'x');
  rim.position.y = -0.23; // el modelo se apoya en y = 0: se centra en la esfera
  clock.add(rim, face);
  const hands = [0.11, 0.16].map((len, i) => {
    const pv = new THREE.Group(), h = new THREE.Mesh(new THREE.BoxGeometry(i ? 0.008 : 0.014, len, 0.004), new THREE.MeshBasicMaterial({ color: 0x15130c }));
    h.position.y = len / 2;
    pv.add(h);
    pv.position.z = 0.056 + i * 0.004;
    clock.add(pv);
    bag.own.push(h.geometry, h.material as THREE.Material);
    return pv;
  });
  bag.tex.push((face.material as THREE.MeshBasicMaterial).map!);
  bag.own.push(face.geometry, face.material as THREE.Material);
  clock.position.set(-H.x + 0.03, 2.1, 0.95);
  clock.rotation.y = Math.PI / 2;
  S.add(own(clock, bag));

  let next = 0;
  return (age: number) => {
    if (age > next) (next = age + 0.07), noise.offset.set(Math.random(), Math.random());
    const d = new Date(), m = d.getMinutes() + d.getSeconds() / 60;
    hands[0].rotation.z = -((d.getHours() % 12) + m / 60) * (Math.PI / 6);
    hands[1].rotation.z = -m * (Math.PI / 30);
  };
}
