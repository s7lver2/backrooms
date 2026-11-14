import * as THREE from 'three';

/*
 * La explosión del rifle que revienta: bola de fuego (tres esferas que crecen y se apagan de blanco a rojo), onda de choque en el suelo, humo que sube y chispas
 * que salen disparadas con la gravedad. Solo mallas y puntos sin luces (una luz nueva recompila todos los materiales): `update` devuelve false al acabar.
 */
const LIFE = 3.2;
const add = (c: THREE.Color) => new THREE.MeshBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

export class Explosion {
  readonly root = new THREE.Group();
  private t = 0;
  private balls: { m: THREE.Mesh; s: number; d: THREE.Vector3 }[] = [];
  private puffs: { m: THREE.Mesh; s: number; v: THREE.Vector3 }[] = [];
  private ring: THREE.Mesh;
  private sparks: THREE.Points;
  private vel: Float32Array;

  constructor(at: THREE.Vector3) {
    this.root.position.copy(at);
    const sph = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(sph, add(new THREE.Color(0xffffff)));
      const d = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 1.2);
      this.root.add(m);
      this.balls.push({ m, s: 2.6 + Math.random() * 1.4 - i * 0.5, d });
    }
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: 0x1b1a18, transparent: true, depthWrite: false }));
      m.position.set((Math.random() - 0.5) * 1.6, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.6);
      this.root.add(m);
      this.puffs.push({ m, s: 0.8 + Math.random() * 0.9, v: new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8) });
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), add(new THREE.Color(0xffc070)));
    this.ring.position.y = 0.06 - at.y * 0 + 0.0;
    this.root.add(this.ring);
    const n = 90, pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([0, 1, 0], i * 3);
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7;
      this.vel.set([Math.cos(a) * s, 2 + Math.random() * 7, Math.sin(a) * s], i * 3);
    }
    const g = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffb040, size: 0.14, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.sparks.frustumCulled = false;
    this.root.add(this.sparks);
  }

  update(dt: number) {
    const t = (this.t += dt), k = Math.min(1, t / 0.55), ease = 1 - (1 - k) * (1 - k);
    for (const b of this.balls) {
      b.m.position.copy(b.d).multiplyScalar(0.5 + ease * 0.6);
      b.m.scale.setScalar(Math.max(0.01, b.s * ease));
      (b.m.material as THREE.MeshBasicMaterial).color.setRGB(1, 1 - 0.55 * k, 0.9 - 0.9 * k).multiplyScalar(1.6 * (1 - k * 0.7));
      (b.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - Math.max(0, t - 0.15) / 0.75);
      b.m.visible = t < 0.95;
    }
    const rk = Math.min(1, t / 0.5);
    this.ring.scale.setScalar(0.5 + rk * 5.5);
    (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - rk));
    this.ring.visible = rk < 1;
    for (const p of this.puffs) {
      p.m.position.addScaledVector(p.v, dt);
      p.m.scale.setScalar(p.s * (0.4 + Math.min(1.6, t * 1.3)));
      (p.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.65 * (1 - t / LIFE)) * Math.min(1, t * 4);
    }
    const pos = this.sparks.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      this.vel[i * 3 + 1] -= 9.8 * dt;
      pos.setXYZ(i, pos.getX(i) + this.vel[i * 3] * dt, Math.max(0.02, pos.getY(i) + this.vel[i * 3 + 1] * dt), pos.getZ(i) + this.vel[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    (this.sparks.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t / 1.6);
    if (t < LIFE) return true;
    this.dispose();
    return false;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry.type !== 'SphereGeometry') m.geometry.dispose();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}
