import * as THREE from 'three';

/**
 * El chorro de la pistola de agua: gotas (Points con su propio shader: redondas, blandas, se encogen y se apagan al morir), recicladas; al caer salpican.
 * Una sola vez para todos los niveles: lo usa el Player; cada mundo dice, con `probe`, dónde está el suelo/agua y dónde hay pared (ver Terrain).
 */
const N = 288;
/** `null`: pared (la gota se pierde); si no, la altura del suelo o del agua en ese punto y si es agua. */
export type JetProbe = (x: number, y: number, z: number) => { gy: number; wet: boolean } | null;

export class WaterJet {
  readonly points: THREE.Points;
  private v = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private max = new Float32Array(N).fill(1);
  private sp = new Uint8Array(N);
  private i = 0;
  private acc = 0;
  private rip = 0;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;

  constructor() {
    const g = this.geo;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3).fill(-999), 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(N), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(N).fill(1), 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uScale: { value: 400 } },
      vertexShader: 'attribute float aLife; attribute float aSize; varying float vA; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vA = aLife; gl_PointSize = clamp(aSize * uScale * 0.1 / max(-mv.z, 0.3) * (0.55 + 0.6 * aLife), 1.0, 40.0); }',
      fragmentShader: 'varying float vA; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float d = dot(p, p); if (d > 1.0) discard; float a = smoothstep(1.0, 0.15, d) * min(1.0, vA * 3.0) * 0.8; gl_FragColor = vec4(mix(vec3(0.5, 0.78, 1.0), vec3(1.0), smoothstep(0.6, 0.0, d) * 0.8), a); }',
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }

  /** Un fotograma. `eye`: de dónde sale (los ojos) y hacia dónde mira, o null si no se dispara. `splash`: una onda en el agua (x, z, fuerza). */
  update(dt: number, eye: THREE.Vector3 | null, yaw: number, pitch: number, probe: JetProbe, splash?: (x: number, z: number, a: number) => void) {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute, al = this.geo.getAttribute('aLife') as THREE.BufferAttribute, sz = this.geo.getAttribute('aSize') as THREE.BufferAttribute;
    this.mat.uniforms.uScale.value = innerHeight / 2;
    const { v, life, max, sp } = this;
    if (eye) {
      this.acc += dt * 135;
      const cp = Math.cos(pitch), fx = -Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp, rx = Math.cos(yaw), rz = -Math.sin(yaw);
      while (this.acc >= 1) {
        this.acc--;
        const k = this.i++ % N, r = () => (Math.random() - 0.5) * 0.5, s = 12 + Math.random() * 3, t = Math.random() * 0.016; // (nacen repartidas a lo largo del fotograma)
        pos.setXYZ(k, eye.x + fx * (0.6 + s * t) + rx * 0.18, eye.y - 0.2 + fy * (0.6 + s * t), eye.z + fz * (0.6 + s * t) + rz * 0.18);
        // el chorro converge en el punto que apunta la mira (a 9 m): sale de la boca (abajo y a la derecha) y va hacia ahí
        const dx = eye.x + fx * 9 - pos.getX(k), dy = eye.y + fy * 9 - pos.getY(k), dz = eye.z + fz * 9 - pos.getZ(k), dl = Math.hypot(dx, dy, dz) || 1;
        v[k * 3] = (dx / dl) * s + r();
        v[k * 3 + 1] = (dy / dl) * s + r() * 0.7 + 0.4;
        v[k * 3 + 2] = (dz / dl) * s + r();
        max[k] = life[k] = 0.5 + Math.random() * 0.3;
        sp[k] = 0;
        sz.setX(k, 0.9 + Math.random() * 1.0);
      }
    } else this.acc = 0;
    this.rip -= dt;
    for (let k = 0; k < N; k++) {
      if (life[k] <= 0) continue;
      life[k] -= dt;
      if (life[k] <= 0) {
        pos.setY(k, -999), al.setX(k, 0);
        continue;
      }
      v[k * 3 + 1] -= (sp[k] ? 9 : 7) * dt;
      const nx = pos.getX(k) + v[k * 3] * dt, ny = pos.getY(k) + v[k * 3 + 1] * dt, nz = pos.getZ(k) + v[k * 3 + 2] * dt, f = probe(nx, ny, nz);
      // contra una pared se pierde; contra el suelo o el agua salpica (unas gotas que saltan y, si es agua, una onda)
      if (!f || (ny < f.gy && !sp[k])) {
        life[k] = 0, pos.setY(k, -999), al.setX(k, 0);
        if (f) {
          for (let n = 0; n < 3; n++) {
            const j = this.i++ % N, a = Math.random() * 6.283, s = 0.6 + Math.random() * 1.2;
            pos.setXYZ(j, nx, f.gy + 0.02, nz), (v[j * 3] = Math.cos(a) * s), (v[j * 3 + 1] = 1.6 + Math.random() * 1.6), (v[j * 3 + 2] = Math.sin(a) * s);
            max[j] = life[j] = 0.25 + Math.random() * 0.2, (sp[j] = 1), sz.setX(j, 0.35 + Math.random() * 0.3);
          }
          if (f.wet && this.rip <= 0) (this.rip = 0.07), splash?.(nx, nz, 0.25);
        }
        continue;
      }
      if (sp[k] && ny < f.gy) (life[k] = 0), pos.setY(k, -999), al.setX(k, 0);
      else pos.setXYZ(k, nx, ny, nz), al.setX(k, life[k] / max[k]);
    }
    pos.needsUpdate = al.needsUpdate = sz.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}
