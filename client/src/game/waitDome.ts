import * as THREE from 'three';
import { WAIT_H, WAIT_HALF } from '@backrooms/shared';
import { bagTex, softTex, type Bag } from './waitKit';

/*
 * La cúpula del centro de la sala de espera: el techo tiene un hueco redondo y encima se levanta una cúpula de cristal con nervios de acero,
 * un cielo pálido (que no debería existir) detrás, un rayo de luz que baja hasta el suelo y un foco frío. Sin colisión; todo se libera con el `Bag`.
 */
export const DOME_R = 3.2;
const H = WAIT_HALF;

/** El techo: el plano de siempre con un agujero redondo (las UV a metros, una repetición cada `per`). */
export function ceilingWithHole(mat: THREE.Material, per: number) {
  const s = new THREE.Shape();
  s.moveTo(-H.x, -H.z), s.lineTo(H.x, -H.z), s.lineTo(H.x, H.z), s.lineTo(-H.x, H.z), s.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, DOME_R, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ShapeGeometry(s, 48), uv = g.getAttribute('uv'), p = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / per, p.getY(i) / per);
  const m = new THREE.Mesh(g, mat);
  m.position.y = WAIT_H;
  m.rotation.x = Math.PI / 2;
  return m;
}

export class Dome {
  readonly group = new THREE.Group();
  private sky: THREE.Mesh;
  private shaft: THREE.Mesh;
  private pool: THREE.Mesh;
  private light: THREE.PointLight;
  /** 0–1: la luz de la cúpula (baja en la alarma de la entrada). */
  power = 1;
  private rays: THREE.Mesh[] = [];
  private dust!: THREE.Points;
  private dustSeed: number[] = [];

  constructor(S: THREE.Scene, bag: Bag, reduced: boolean) {
    const g = this.group, own = <T extends THREE.Material>(m: T) => (bag.own.push(m), m);
    g.position.y = WAIT_H;
    S.add(g);
    const RISE = 2.7;
    const steelTex = bagTex(bag, 128, 128, (x) => {
      x.fillStyle = '#6a6f72';
      x.fillRect(0, 0, 128, 128);
      for (let n = 0; n < 700; n++) ((x.fillStyle = `rgba(${n % 3 ? '30,32,34' : '150,155,158'},${0.05 + ((n * 37) % 10) / 100})`), x.fillRect((n * 53) % 128, (n * 29) % 128, 1 + (n % 7), 1));
      x.strokeStyle = 'rgba(20,22,24,0.45)';
      for (let i = 0; i < 128; i += 32) (x.beginPath(), x.moveTo(0, i), x.lineTo(128, i), x.stroke());
    });
    steelTex.wrapS = steelTex.wrapT = THREE.RepeatWrapping;
    const steel = own(new THREE.MeshStandardMaterial({ color: 0x8a9094, roughness: 0.38, metalness: 0.85, map: steelTex }));
    const brass = own(new THREE.MeshStandardMaterial({ color: 0x9a7a3c, roughness: 0.35, metalness: 0.9 }));
    const lamp = own(new THREE.MeshBasicMaterial({ color: 0xf4f0d4, toneMapped: false, fog: false }));
    const glass = own(new THREE.MeshStandardMaterial({ color: 0x9fc4c2, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    // el cielo: un degradado pálido (verdoso en el borde, casi blanco en el cénit) que gira muy despacio
    const skyTex = bagTex(bag, 256, 256, (x) => {
      const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, '#f4f7e6'), gr.addColorStop(0.45, '#cfd9b4'), gr.addColorStop(1, '#6f7a55');
      x.fillStyle = gr, x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 34; i++) {
        const cx = 128 + Math.sin(i * 12.9) * 100, cy = 128 + Math.cos(i * 7.7) * 100, r = 14 + ((i * 37) % 30), c = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        c.addColorStop(0, 'rgba(255,255,255,0.22)'), c.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = c, x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
    });
    const skyM = own(new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, toneMapped: false, fog: false }));
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(DOME_R + 0.25, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), skyM);
    this.sky.scale.y = (RISE + 0.5) / (DOME_R + 0.25);
    g.add(this.sky);
    // el cristal
    const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.scale.y = RISE / DOME_R;
    dome.renderOrder = 3;
    g.add(dome);
    // los nervios (meridianos) y los aros (paralelos)
    const MER = 12, tube = 0.06;
    for (let i = 0; i < MER; i++) {
      const arm = new THREE.Group(), m = new THREE.Mesh(new THREE.TorusGeometry(DOME_R, tube, 6, 28, Math.PI), steel);
      m.scale.y = RISE / DOME_R;
      arm.rotation.y = (i / MER) * Math.PI;
      arm.add(m);
      g.add(arm);
    }
    for (const a of [0.0, 0.42, 0.82, 1.2]) {
      const r = DOME_R * Math.cos(a), y = RISE * Math.sin(a), ring = new THREE.Mesh(new THREE.TorusGeometry(r, a ? 0.035 : 0.09, 6, 40), steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      g.add(ring);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.45, 0.36, 16), steel);
    cap.position.y = RISE + 0.04;
    g.add(cap);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), brass);
    finial.position.y = RISE + 0.28;
    g.add(finial);
    // el collar del hueco: una chapa ancha contra el techo con una moldura de latón y tornillos
    const collar = new THREE.Mesh(new THREE.RingGeometry(DOME_R - 0.02, DOME_R + 0.5, 48, 1), steel);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.02;
    g.add(collar);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(DOME_R + 0.5, 0.04, 6, 56), brass);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = -0.05;
    g.add(trim);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 6), brass);
      bolt.position.set(Math.cos(a) * (DOME_R + 0.26), -0.04, Math.sin(a) * (DOME_R + 0.26));
      g.add(bolt);
    }
    // la luz propia de la cúpula: un aro luminoso por dentro de la base (en vez de lámparas sueltas)
    const glowRing = new THREE.Mesh(new THREE.TorusGeometry(DOME_R - 0.12, 0.03, 6, 56), lamp);
    glowRing.rotation.x = Math.PI / 2;
    glowRing.position.y = 0.1;
    g.add(glowRing);
    // el rayo de luz: un cono abierto con degradado vertical, y el charco de luz en el suelo
    const shaftTex = bagTex(bag, 8, 128, (x) => {
      const gr = x.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, 'rgba(255,255,235,0.55)'), gr.addColorStop(1, 'rgba(255,255,235,0)');
      x.fillStyle = gr, x.fillRect(0, 0, 8, 128);
    });
    const shaftM = own(new THREE.MeshBasicMaterial({ map: shaftTex, color: 0xdfe8c8, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(DOME_R * 0.95, DOME_R * 1.5, WAIT_H, 40, 1, true), shaftM);
    this.shaft.position.y = -WAIT_H / 2;
    this.shaft.renderOrder = 2;
    g.add(this.shaft);
    const poolM = own(new THREE.MeshBasicMaterial({ map: softTex(bag, 0.9, 0.5), color: 0xe6edcf, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(DOME_R * 3.4, DOME_R * 3.4), poolM);
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.y = -WAIT_H + 0.02;
    g.add(this.pool);
    // rayos de luz: láminas finas en abanico dentro del cono que se mecen y parpadean despacio
    const rayTex = bagTex(bag, 32, 128, (x) => {
      const gv = x.createLinearGradient(0, 0, 0, 128);
      gv.addColorStop(0, 'rgba(255,255,235,0.9)'), gv.addColorStop(0.6, 'rgba(255,255,235,0.25)'), gv.addColorStop(1, 'rgba(255,255,235,0)');
      x.fillStyle = gv, x.fillRect(0, 0, 32, 128);
      x.globalCompositeOperation = 'destination-in';
      const gh = x.createLinearGradient(0, 0, 32, 0);
      gh.addColorStop(0, 'rgba(0,0,0,0)'), gh.addColorStop(0.5, 'rgba(0,0,0,1)'), gh.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gh, x.fillRect(0, 0, 32, 128);
    });
    for (let i = 0; i < 9; i++) {
      const a2 = (i / 9) * Math.PI * 2, r = DOME_R * (0.25 + ((i * 37) % 10) / 14);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.35 + (i % 3) * 0.2, WAIT_H * 0.98), own(new THREE.MeshBasicMaterial({ map: rayTex, color: 0xeef2d4, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })));
      m.position.set(Math.cos(a2) * r, -WAIT_H / 2, Math.sin(a2) * r);
      m.rotation.set(0, a2 + Math.PI / 2, 0.04 * Math.cos(a2 * 2));
      m.renderOrder = 2;
      m.userData.ph = i * 1.7;
      this.rays.push(m);
      g.add(m);
    }
    // motas de polvo que suben por el rayo
    const N = reduced ? 50 : 140, dp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a3 = ((i * 2.399) % (Math.PI * 2)), r = DOME_R * 1.2 * Math.sqrt(((i * 0.618) % 1));
      dp[i * 3] = Math.cos(a3) * r, dp[i * 3 + 1] = -((i * 0.37) % 1) * WAIT_H, dp[i * 3 + 2] = Math.sin(a3) * r;
      this.dustSeed.push(i);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    bag.own.push(dg);
    this.dust = new THREE.Points(dg, own(new THREE.PointsMaterial({ map: softTex(bag, 0.8, 0.3), color: 0xf4f2d8, size: 0.032, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false })));
    this.dust.frustumCulled = false;
    g.add(this.dust);
    this.light = new THREE.PointLight(0xe8f0d0, reduced ? 3 : 5, 14, 1.6);
    this.light.position.y = -0.6;
    g.add(this.light);
    // con Phoenyx (Lux): además, un foco que baja por la cúpula con sombras (el cielo ilumina y los muebles proyectan), en vez de solo el punto
    if (__PHOENYX__) {
      const spot = new THREE.SpotLight(0xe8f0d0, reduced ? 40 : 90, WAIT_H * 2.2, Math.atan((DOME_R * 1.5) / WAIT_H), 0.7, 1.5);
      spot.position.set(0, 0.4, 0);
      spot.target.position.set(0, -WAIT_H, 0);
      spot.castShadow = !reduced;
      g.add(spot, spot.target);
      this.light.intensity *= 0.4; // (el punto queda de relleno)
    }
  }

  update(t: number) {
    for (const m of this.rays) (m.material as THREE.MeshBasicMaterial).opacity = (0.07 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.5 + m.userData.ph))) * this.power, (m.rotation.z = 0.05 * Math.sin(t * 0.3 + m.userData.ph));
    const dp = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < dp.count; i++) {
      let y = dp.getY(i) + 0.05 * (0.4 + (i % 5) * 0.15) * 0.016 * 60 * 0.016;
      if (y > 0) y = -WAIT_H;
      dp.setY(i, y);
      dp.setX(i, dp.getX(i) + Math.sin(t * 0.7 + i) * 0.0006);
    }
    dp.needsUpdate = true;
    this.sky.rotation.y = t * 0.02;
    (this.shaft.material as THREE.MeshBasicMaterial).opacity = (0.3 + Math.sin(t * 0.6) * 0.05) * this.power;
    this.pool.scale.setScalar(1 + Math.sin(t * 0.6) * 0.02);
    this.light.intensity = (this.light.userData.base ??= this.light.intensity) * this.power * (0.95 + Math.sin(t * 0.9) * 0.03 + (Math.sin(t * 41) > 0.995 ? -0.25 : 0));
  }
}
