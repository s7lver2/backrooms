import * as THREE from 'three';
import type { Assets } from './game';
import { CLIPS, entityBody, type Kind } from './entity';
import type { Rig } from './rig';

/*
 * El final de una ronda ganada, igual en todos los niveles (el «prefab» del final, como `ElevatorCab` lo es de la salida): volvemos a aparecer donde
 * estábamos, en fila delante de la cámara, cada jugador con su pose de victoria, y detrás las entidades bailando. Cada nivel solo pone el escenario
 * (dónde se pinta, con qué cámara y dónde hay pared) y los actores (cómo se coloca y se anima el cuerpo de cada jugador).
 */
export interface Stage {
  /** Donde se añaden los bailarines. */
  scene: THREE.Object3D;
  /** La cámara con la que se pinta (el nivel pone el resto: luz, niebla...). */
  camera: THREE.PerspectiveCamera;
  /** ¿Hay pared (o vacío) en (x, z)? */
  solid(x: number, z: number): boolean;
}
export interface Actor {
  /** Se pone en su sitio al empezar. */
  place(at: THREE.Vector3, yaw: number): void;
  /** Cada fotograma (el cuerpo baila su pose). */
  tick(dt: number, at: THREE.Vector3, yaw: number): void;
}
interface Dancer {
  rig: Rig;
  balloon?: THREE.Object3D;
  at: THREE.Vector3;
  yaw: number;
}

const ROW = 1.25;
export class Epilogue {
  /** Los pies de la cámara (de donde se acabó), hacia dónde se mira y el centro de la fila. */
  readonly c: THREE.Vector3;
  readonly face: number;
  readonly g = new THREE.Vector3();
  /** Dónde queda cada actor de la fila. */
  readonly spots: THREE.Vector3[] = [];
  private dancers: Dancer[] = [];
  private t = 0;

  /** `from`: los pies y el yaw de la cámara al acabar; `kinds`: las entidades que bailan detrás (hasta 4). */
  constructor(private stage: Stage, assets: Assets, from: THREE.Vector3, yaw: number, private actors: Actor[], kinds: Kind[]) {
    this.c = from.clone();
    // hacia donde hay sitio: la fila (los pasillos son estrechos) de la cámara hacia dentro, sin paredes
    let face = yaw;
    for (let k = 0; k < 16; k++) {
      const a = yaw + (k * Math.PI) / 8, fx = -Math.sin(a), fz = -Math.cos(a);
      let ok = true;
      for (let d = 0.5; d <= 7 && ok; d += 0.5) ok = !stage.solid(this.c.x + fx * d, this.c.z + fz * d);
      if (ok) {
        face = a;
        break;
      }
    }
    this.face = face;
    const f = this.fwd();
    actors.forEach((a, i) => {
      const at = this.c.clone().addScaledVector(f, 2.4 + i * ROW);
      this.spots.push(at);
      a.place(at, face + Math.PI);
    });
    this.g.copy(this.c).addScaledVector(f, 2.4 + (actors.length - 1) * 0.6);
    // las entidades, a los lados de la fila (alternando izquierda y derecha); donde hay pared, más cerca del centro o detrás
    const side = new THREE.Vector3(-f.z, 0, f.x);
    kinds.slice(0, 4).forEach((kind, i) => {
      const sg = i % 2 ? 1 : -1, depth = 2.4 + ((i >> 1) + 0.5) * ROW;
      const tries = [[sg, 1.5], [sg, 1.0], [-sg, 1.5], [-sg, 1.0], [0, 0]].map(([s, o]) => this.c.clone().addScaledVector(f, depth).addScaledVector(side, s * o));
      const at = tries.find((p) => !stage.solid(p.x, p.z)) ?? tries[0];
      const { rig, balloon } = entityBody(kind, assets);
      const clips = CLIPS[kind].dances;
      rig.root.position.copy(at);
      rig.root.rotation.y = Math.atan2(this.g.x - at.x, this.g.z - at.z);
      rig.play(clips[i % clips.length], 0.3);
      stage.scene.add(rig.root);
      if (balloon) stage.scene.add(balloon);
      this.dancers.push({ rig, balloon, at, yaw: rig.root.rotation.y });
    });
  }

  private fwd() {
    return new THREE.Vector3(-Math.sin(this.face), 0, -Math.cos(this.face));
  }

  /** Un fotograma: los cuerpos bailan y la cámara se mueve despacio de lado a lado mirando a la fila. */
  frame(dt: number) {
    this.t += dt;
    this.actors.forEach((a, i) => a.tick(dt, this.spots[i], this.face + Math.PI));
    for (const d of this.dancers) {
      d.rig.update(dt);
      if (d.balloon) {
        const hand = d.rig.bone('RightHand');
        if (hand) d.balloon.position.copy(hand.getWorldPosition(new THREE.Vector3()));
        d.balloon.rotation.z = Math.sin(this.t * 1.4) * 0.12;
      }
    }
    const f = this.fwd(), side = new THREE.Vector3(-f.z, 0, f.x), cam = this.stage.camera;
    cam.position.copy(this.c).setY(this.c.y + 1.45).addScaledVector(side, Math.sin(this.t * 0.35) * 0.35);
    cam.lookAt(this.g.x, this.c.y + 1.05, this.g.z);
    cam.updateMatrixWorld(true);
  }

  dispose() {
    for (const d of this.dancers) (d.rig.root.removeFromParent(), d.balloon?.removeFromParent());
    this.dancers = [];
  }
}
