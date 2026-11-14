import * as THREE from 'three';

/*
 * Una taquilla de chapa con la puerta en una bisagra (el hijo `door`): de frente, +z. Se abre de verdad (Pickups.openLocker gira `door`).
 * Mide 0,5 × 1,8 × 0,5 m, con el hueco hacia delante para que las piezas queden dentro.
 */
export function lockerMesh() {
  const steel = new THREE.MeshStandardMaterial({ color: 0x59636b, roughness: 0.55, metalness: 0.6 }), dark = new THREE.MeshStandardMaterial({ color: 0x15181a, roughness: 0.9 });
  const g = new THREE.Group(), box = (w: number, h: number, d: number, x: number, y: number, z: number, m = steel, to: THREE.Object3D = g) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    to.add(b);
    return b;
  };
  box(0.5, 1.8, 0.02, 0, 0.9, -0.24, dark); // el fondo
  box(0.02, 1.8, 0.5, -0.24, 0.9, 0); // los lados
  box(0.02, 1.8, 0.5, 0.24, 0.9, 0);
  box(0.5, 0.02, 0.5, 0, 1.79, 0); // el techo y el suelo
  box(0.5, 0.02, 0.5, 0, 0.01, 0);
  const door = new THREE.Group(); // la bisagra, en el borde izquierdo
  door.name = 'door';
  door.position.set(-0.25, 0, 0.25);
  box(0.5, 1.76, 0.025, 0.25, 0.9, 0, steel, door);
  for (let i = 0; i < 4; i++) box(0.3, 0.015, 0.03, 0.25, 1.5 + i * 0.05, 0.002, dark, door); // las rejillas
  box(0.03, 0.14, 0.04, 0.43, 0.95, 0.03, dark, door); // el tirador
  g.add(door);
  return g;
}
