import * as THREE from 'three';
import { RARITIES, rarity } from '@backrooms/shared';

/*
 * Lo que se ve de la rareza de un objeto en el suelo (un brillito de su color que late) y la pieza de botín (el «artifact»: no hay modelo,
 * son tres primitivas doradas). Lo usan el nivel 0 (items.ts), las Poolrooms (poolmap.ts) y la sala de espera (game.ts).
 */

let tex: THREE.Texture | undefined;
/** Un destello: halo blando con un núcleo blanco y cuatro rayos largos y finos (más cortos en las diagonales); se tiñe con el color de cada rareza. */
function spark() {
  if (tex) return tex;
  const S = 128, h = S / 2, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!, g = x.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.globalCompositeOperation = 'lighter';
  // un rayo es un rombo muy estrecho: largo `len`, ángulo `a`
  const ray =(a: number, len: number, w: number, o: number) => {
    x.save();
    x.translate(h, h);
    x.rotate(a);
    const l = x.createLinearGradient(-len, 0, len, 0);
    l.addColorStop(0, 'rgba(255,255,255,0)');
    l.addColorStop(0.5, `rgba(255,255,255,${o})`);
    l.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = l;
    x.beginPath();
    x.moveTo(-len, 0), x.lineTo(0, -w), x.lineTo(len, 0), x.lineTo(0, w);
    x.fill();
    x.restore();
  };
  ray(0, h, 2.2, 0.95), ray(Math.PI / 2, h, 2.2, 0.95);
  ray(Math.PI / 4, h * 0.55, 1.6, 0.6), ray(-Math.PI / 4, h * 0.55, 1.6, 0.6);
  return (tex = new THREE.CanvasTexture(c));
}

/** El brillo de un objeto de rareza `r`, para colgarlo de él: más grande y más vivo cuanto más raro. Late y centellea con `pulse`. */
export function glow(r: number) {
  const k = Math.max(0, Math.min(RARITIES.length - 1, r | 0));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spark(), color: rarity(k).color, transparent: true, opacity: 0.45 + k * 0.13, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  s.scale.setScalar(0.36 + k * 0.11);
  s.userData.glow = { k, o: s.material.opacity, s: s.scale.x };
  s.renderOrder = 3;
  return s;
}
/** El latido del brillo (t en segundos): respira, el destello gira despacio y, cuanto más raro, centellea más. */
export function pulse(s: THREE.Object3D | undefined, t: number) {
  const g = s?.userData.glow as { k: number; o: number; s: number } | undefined;
  if (!g) return;
  const ph = g.s * 40, w = 0.5 + 0.5 * Math.sin(t * (1.8 + g.k * 0.5) + ph);
  const tw = Math.max(0, Math.sin(t * (7 + g.k * 2) + ph * 1.7)) ** 6 * (0.15 + g.k * 0.1); // un destello breve de vez en cuando
  const m = (s as THREE.Sprite).material;
  m.opacity = Math.min(1, g.o * (0.6 + 0.4 * w) + tw);
  m.rotation = t * (0.25 + g.k * 0.08) + ph;
  s!.scale.setScalar(g.s * (0.88 + 0.24 * w + tw));
}

/** Una pieza de botín: un ídolo dorado sobre su peana, del color de su rareza. */
export function lootModel(r = 0) {
  const g = new THREE.Group(), col = new THREE.Color(rarity(r).color);
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a531, roughness: 0.3, metalness: 0.9, emissive: 0x4a3205 });
  const gem = new THREE.MeshStandardMaterial({ color: col, roughness: 0.15, metalness: 0.2, emissive: col, emissiveIntensity: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.03, 8), gold);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.045, 0.08, 8), gold);
  body.position.y = 0.055;
  const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), gem);
  top.position.y = 0.14;
  g.add(base, body, top);
  return g;
}

const icons: Record<number, string> = {};
/** El icono del botín para el inventario (data URL), con la gema del color de su rareza. */
export function lootIcon(r = 0) {
  if (icons[r]) return icons[r];
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d')!, col = '#' + new THREE.Color(rarity(r).color).getHexString();
  x.fillStyle = '#d9a531';
  x.beginPath();
  x.moveTo(30, 84), x.lineTo(66, 84), x.lineTo(60, 72), x.lineTo(54, 72), x.lineTo(52, 50), x.lineTo(44, 50), x.lineTo(42, 72), x.lineTo(36, 72);
  x.fill();
  x.fillStyle = col;
  x.beginPath();
  x.moveTo(48, 12), x.lineTo(68, 34), x.lineTo(48, 56), x.lineTo(28, 34);
  x.fill();
  x.fillStyle = 'rgba(255,255,255,0.45)';
  x.beginPath();
  x.moveTo(48, 12), x.lineTo(58, 34), x.lineTo(48, 34);
  x.fill();
  return (icons[r] = c.toDataURL());
}
