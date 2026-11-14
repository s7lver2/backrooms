import { DEV_LOCAL } from '../devGate';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { cosmetic, type Look } from '@backrooms/shared';
import { fit } from './player';
import raw from './pieces.json';

/*
 * Lo que lleva puesto un avatar: el tinte (copias propias de los materiales del hazmat, que son del juego) y los
 * accesorios (sombrero en la cabeza, mochila en la espalda). Los accesorios no cuelgan de los huesos (sus escalas
 * son de Mixamo): se colocan cada fotograma en el mundo, en la posición del hueso y con la orientación del cuerpo.
 * Las medidas de cada pieza viven en pieces.json (el estudio /?anim (pestaña IK) las retoca y las guarda); para añadir una
 * pieza nueva basta con una entrada ahí (más su cosmético en shared/src/progress.ts y su modelo en public/models/cosmetics).
 */
export interface Piece {
  /** En qué hueso va: la cabeza o la espalda. */
  slot: 'head' | 'back';
  /** Lado mayor, en metros, y un factor extra sobre él. */
  size: number;
  scale: number;
  /** Desplazamiento respecto al hueso en el marco del cuerpo: arriba, delante (negativo = detrás) y a un lado. */
  up: number;
  fwd: number;
  side: number;
  /** Giro extra del modelo, en grados. */
  rx: number;
  ry: number;
  rz: number;
}
/** Lo guardado en pieces.json; `PIECES` es la copia viva (la herramienta la modifica y los avatares la leen cada fotograma). */
export const DEFAULT_PIECES = raw as unknown as Record<string, Piece>;
export const PIECES: Record<string, Piece> = structuredClone(DEFAULT_PIECES);
export const BONE = { head: 'mixamorigHead', back: 'mixamorigSpine2' } as const;
const D2R = Math.PI / 180;

/** Modelos que traen algo que sobra dentro (el bucket hat viene sobre un busto de maniquí): se quitan los triángulos cuyo centro cae en un cilindro vertical (eje en x,z; radio r; por debajo de y), en el espacio del modelo. */
const STRIP: Record<string, { x: number; z: number; r: number; y: number }> = { bucket_hat: { x: 0.06, z: -0.015, r: 0.19, y: 0.12 } };
function strip(m: THREE.Mesh, s: { x: number; z: number; r: number; y: number }) {
  const g = m.geometry, pa = g.attributes.position, ix = g.index;
  if (!ix) return;
  m.updateWorldMatrix(true, false);
  const keep: number[] = [], p = new THREE.Vector3();
  for (let t = 0; t < ix.count; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) (p.fromBufferAttribute(pa, ix.getX(t + k)).applyMatrix4(m.matrixWorld), (cx += p.x), (cy += p.y), (cz += p.z));
    if (Math.hypot(cx / 3 - s.x, cz / 3 - s.z) < s.r && cy / 3 < s.y) continue;
    keep.push(ix.getX(t), ix.getX(t + 1), ix.getX(t + 2));
  }
  g.setIndex(keep);
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<THREE.Object3D | undefined>>();
/** El modelo de un accesorio (una sola descarga por pieza); undefined si no carga. */
export const model = (id: string) => {
  let p = cache.get(id);
  if (!p)
    cache.set(
      id,
      (p = loader.loadAsync(`/models/cosmetics/${id}.glb`).then(
        (g) => {
          // sin mapa de entorno un metal puro se ve negro: las piezas se quedan con un poco de metal y su color
          g.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            // el bicornio trae un atlas hecho jirones (islas de UV sueltas, sin sentido): se sustituye por fieltro liso
            if (m.isMesh && STRIP[id]) strip(m, STRIP[id]);
            if (id === 'bicorn_hat' && m.isMesh) m.material = new THREE.MeshStandardMaterial({ color: 0x23242e, roughness: 0.92, side: THREE.DoubleSide });
            const k = m.material as THREE.MeshStandardMaterial | undefined;
            if (k?.isMeshStandardMaterial) k.metalness = Math.min(k.metalness, 0.25);
          });
          return g.scene;
        },
        (e) => (console.warn('cosmetic', id, e), undefined),
      )),
    );
  return p;
};

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class Cosmetics {
  /** Donde viven los accesorios: en el mundo, hermano del cuerpo. */
  readonly root = new THREE.Group();
  private mats: THREE.MeshStandardMaterial[] = [];
  private items: Partial<Record<'head' | 'back', { id: string; obj: THREE.Group; inner: THREE.Object3D }>> = {};
  private tok = 0;
  private key = '';

  constructor(private body: THREE.Object3D) {}

  /** El tinte, compartido por los materiales de este avatar: el color elegido y cuánto sustituye al de la textura (0 = el traje de siempre). */
  private tint = { value: new THREE.Color() };
  private tintMix = { value: 0 };

  private ownMaterials() {
    if (this.mats.length) return;
    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const own = (x: THREE.Material) => {
        const c = x.clone();
        if ((c as THREE.MeshStandardMaterial).color) {
          this.mats.push(c as THREE.MeshStandardMaterial);
          // el traje es amarillo: multiplicarlo por azul o rosa solo da verdes turbios. Se toma la luminosidad de la
          // textura (lo oscuro, como botas y correas, sigue oscuro) y se pinta con el color elegido
          c.onBeforeCompile = (s) => {
            s.uniforms.uTint = this.tint;
            s.uniforms.uTintMix = this.tintMix;
            s.fragmentShader = s.fragmentShader
              .replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uTintMix;')
              .replace('#include <map_fragment>', '#include <map_fragment>\n{ float l = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)); diffuseColor.rgb = mix(diffuseColor.rgb, uTint * l * 1.3, uTintMix); }');
          };
          c.customProgramCacheKey = () => 'cos-tint';
        }
        return c;
      };
      m.material = Array.isArray(m.material) ? m.material.map(own) : own(m.material);
    });
  }

  /** Poner este aspecto (si no cambió, no hace nada). Los accesorios llegan cuando se descargan. */
  set(look: Look) {
    // el hueso lo manda pieces.json (el estudio /?anim cambia gorro ↔ mochila): se recolocan las dos piezas por su `slot`
    const want = { head: '', back: '' };
    for (const id of [look.head, look.back]) if (id && PIECES[id]) want[PIECES[id].slot] = id;
    look = { ...look, ...want };
    const key = `${look.color}|${look.head}|${look.back}`;
    if (key === this.key) return;
    this.key = key;
    const tok = ++this.tok;
    const hex = cosmetic('color', look.color)?.hex ?? '#ffffff';
    if (hex !== '#ffffff' || this.mats.length) {
      this.ownMaterials();
      this.tint.value.set(hex);
      this.tintMix.value = hex === '#ffffff' ? 0 : 1;
    }
    for (const slot of ['head', 'back'] as const) {
      const id = look[slot], cur = this.items[slot];
      if (cur?.id === id) continue;
      if (cur) (cur.obj.removeFromParent(), delete this.items[slot]);
      if (!id || !PIECES[id]) continue;
      void model(id).then((src) => {
        if (!src || tok !== this.tok) return;
        // el modelo, a tamaño 1; el tamaño y los giros se aplican en cada update, para que retocarlos se vea al momento
        const holder = new THREE.Group(), f = fit(src.clone(true), 1);
        holder.add(f);
        holder.visible = false; // hasta su primer update: que no aparezca en el origen
        this.root.add(holder);
        this.items[slot] = { id, obj: holder, inner: f };
      });
    }
  }

  /** Tras actualizar el cuerpo: cada pieza, en su hueso, con la orientación del cuerpo (la cabeza, además, sigue la mirada). */
  update(pitch = 0, headVisible = true) {
    this.body.updateWorldMatrix(true, false);
    for (const slot of ['head', 'back'] as const) {
      const it = this.items[slot];
      if (!it) continue;
      const bone = this.body.getObjectByName(BONE[slot]), piece = PIECES[it.id];
      it.obj.visible = !!bone && !!piece && (slot === 'back' || headVisible);
      if (!bone || !piece) continue;
      it.obj.scale.setScalar(piece.size * piece.scale);
      it.inner.rotation.set(piece.rx * D2R, piece.ry * D2R, piece.rz * D2R);
      this.body.getWorldQuaternion(_q);
      if (slot === 'head') _q.multiply(new THREE.Quaternion().setFromEuler(_e.set(-Math.max(-1, Math.min(1, pitch)) * 0.7, 0, 0)));
      bone.getWorldPosition(it.obj.position);
      it.obj.position.add(_p.set(piece.side, piece.up, piece.fwd).applyQuaternion(_q));
      it.obj.quaternion.copy(_q);
    }
  }

  dispose() {
    this.tok++;
    this.root.removeFromParent();
    this.mats.forEach((m) => m.dispose());
    this.mats = [];
  }
}

// desarrollo: __pieces en la consola para ajustar las medidas de cada pieza en la vista previa del armario
if (DEV_LOCAL) Object.assign(window, { __pieces: PIECES });
