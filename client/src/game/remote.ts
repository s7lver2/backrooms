import * as THREE from 'three';
import { DEFAULT_LOOK, type Look, type PlayerState } from '@backrooms/shared';
import type { Assets } from './game';
import { Rig } from './rig';
import { build } from './anim/core';
import { fit } from './player';
import { Cosmetics } from './cosmetics';
import { Timeline, Track, type Snap } from './interp';
import { poolPart } from './poolmap';
import { worn, wornModel, placeWorn } from './worn';

/*
 * Otro jugador: el mismo hazmat (clonado) que el propio, con la linterna y lo que lleve en la mano. Se
 * le interpola el estado que llega a 15 Hz; su cuerpo reproduce el clip que manda. Sin luces nuevas (otra
 * luz recompilaría todos los materiales): el haz de la linterna es un cono aditivo.
 */

/** La muerte y los emotes de la sala de espera (1–4) son clips del paquete de animaciones (anim/): saludar, señalar, puño en alto y sentarse (agachado). */
const DEATH = 'Standing React Death Backward';
const EMOTES = ['', 'Cheering', 'Pointing', 'Fist Pump', 'Crouching'];
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const angle = (a: number, b: number) => a + THREE.MathUtils.euclideanModulo(b - a + Math.PI, Math.PI * 2) - Math.PI;

// el haz: dos conos (un núcleo estrecho y una penumbra ancha), la punta en el origen y abiertos hacia -z. El tono se
// desvanece a lo largo, se aclara al borde de la silueta y se agota con la distancia, como el polvo que cruza una linterna.
const cone = (r: number) => new THREE.ConeGeometry(r, 6, 20, 1, true).translate(0, -3, 0).rotateX(Math.PI / 2);
const BEAM = [cone(1.5), cone(0.55)];
const beamMat = (k: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uK: { value: k }, uT: { value: 0 }, uOn: { value: 1 } },
    vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV;
      void main() { vT = -position.z / 6.0; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uK; uniform float uT; uniform float uOn; varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float along = pow(1.0 - vT, 1.7) * smoothstep(0.0, 0.06, vT);
        float dust = 0.88 + 0.12 * sin(vT * 38.0 - uT * 1.7) * sin(vT * 11.0 + uT * 0.9);
        gl_FragColor = vec4(vec3(1.0, 0.93, 0.74) * uK * edge * along * dust * uOn, 1.0);
      }`,
  });
// el brillo de la lente: un punto cálido con caída suave, siempre de cara a la cámara
const GLOW = (() => {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,244,214,1)');
  g.addColorStop(0.25, 'rgba(255,226,160,0.55)');
  g.addColorStop(1, 'rgba(255,200,110,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// la sombra falsa bajo los pies: un punto negro con caída suave
const BLOB = (() => {
  const c = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3();

export class Remote {
  readonly root = new THREE.Group();
  private rig: Rig;
  private cos: Cosmetics;
  private items: Record<'flashlight' | 'camera' | 'gun', THREE.Object3D>;
  /** La bombona del traje de buzo, a la espalda (las Poolrooms; se crea cuando llega el estado con `tank`). */
  private tank?: THREE.Object3D;
  private beam = new THREE.Group();
  private beamMats = [beamMat(0.07), beamMat(0.16)];
  private glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  private clock = 0;
  private label: THREE.Sprite;
  private labelCtx: CanvasRenderingContext2D;
  private bones: Record<'LeftHand' | 'RightHand' | 'Head', THREE.Bone | undefined>;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  light = true;
  /** Poolrooms: ms de «sin señal» del radar que declara este jugador. */
  jam = 0;
  held: PlayerState['held'] = 'none';
  dead = false;
  /** Escondido en un nicho: se ve agachado dentro (el cuerpo achatado y echado hacia el fondo). */
  hiding = false;
  private crouch = 0;
  private wantTank = false;
  id = '';
  name = '';
  private goal = new THREE.Vector3();
  private goalYaw = 0;
  private goalPitch = 0;
  private fresh = true;
  private track = new Track<Snap & { s: PlayerState }>();
  private base?: PlayerState;
  private out: Snap = { t: 0, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  private speed = 0;
  private deadT = 0;
  // la sala de espera: emote (ver PlayerState.emote), sombra falsa y pasos
  emote = 0;
  private duck = false;
  /** Baile de victoria que baila (id de anim/dances.json). */
  dancing = '';
  private emoting = 0;
  floorShadow = false;
  private shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: BLOB, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  onStep?: (r: Remote, run: boolean) => void;
  stepRunSpeed = 2.4;
  private walked = 0;

  constructor(assets: Assets) {
    this.rig = new Rig(assets.gltf.hazmat);
    this.rig.useAnimator();
    this.rig.root.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = true)));
    this.cos = new Cosmetics(this.rig.root);
    this.items = {
      flashlight: fit(assets.gltf.flashlight.scene.clone(true), 0.26, Math.PI),
      camera: fit(assets.gltf.camcorder.scene.clone(true), 0.2, Math.PI / 2),
      gun: fit(assets.gltf.gun.scene.clone(true), 0.72, Math.PI),
    };
    this.items.flashlight.getObjectByName('Circle_6')?.removeFromParent();
    BEAM.forEach((g, i) => {
      const m = new THREE.Mesh(g, this.beamMats[i]);
      m.frustumCulled = false;
      m.renderOrder = 2;
      this.beam.add(m);
    });
    this.glow.scale.setScalar(0.34);
    this.bones = { LeftHand: this.rig.bone('LeftHand'), RightHand: this.rig.bone('RightHand'), Head: this.rig.bone('Head') };
    // el nombre flotante: un sprite con el texto pintado en un lienzo pequeño
    const cv = Object.assign(document.createElement('canvas'), { width: 256, height: 64 });
    this.labelCtx = cv.getContext('2d')!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    this.label.scale.set(1, 0.25, 1);
    this.root.add(this.rig.root, ...Object.values(this.items), this.beam, this.glow, this.label, this.shadow, this.cos.root);
  }

  /** Reutilizar este clon para otro jugador. */
  reset(id: string, name: string) {
    this.id = id;
    this.name = name;
    this.dead = false;
    this.hiding = false;
    this.crouch = 0;
    this.rig.root.scale.set(1, 1, 1);
    this.fresh = true;
    this.track = new Track(); // un jugador nuevo en este clon: otro reloj, otro buffer
    this.base = undefined;
    this.deadT = 0;
    this.cos.set(DEFAULT_LOOK);
    this.rig.root.rotation.set(0, 0, 0);
    this.rig.animator?.stopOver();
    this.emoting = 0;
    const x = this.labelCtx;
    x.clearRect(0, 0, 256, 64);
    x.font = 'bold 30px ui-monospace, Consolas, monospace';
    x.textAlign = 'center';
    x.lineWidth = 6;
    x.strokeStyle = '#000';
    x.fillStyle = '#f2f1ea';
    const t = name.toUpperCase();
    x.strokeText(t, 128, 42);
    x.fillText(t, 128, 42);
    (this.label.material.map as THREE.Texture).needsUpdate = true;
  }

  /** Su aspecto (color, sombrero, mochila): lo da la sala, validado por el servidor. */
  setLook(l: Look) {
    this.cos.set(l);
  }

  /** Un estado nuevo del servidor: se guarda con la hora del emisor (los repetidos o viejos se descartan); se aplica en `update`, algo en el pasado. */
  set(s: PlayerState) {
    // sin hora (el estado inicial que pone el servidor antes de que el jugador mande el suyo): no entra al buffer, que mezclaría relojes
    if (!s.t) return void (this.base = s);
    this.track.push({ t: s.t, x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch, s }, performance.now());
  }

  /** Ping de este jugador: lo que se retrasa el que más y el retraso con el que se le dibuja (ms). */
  get net() {
    return { jitter: Math.round(this.track.tl.jitter), delay: Math.round(this.track.tl.delay) };
  }

  /** Atrapado (o caído): el cuerpo cae y se queda en el suelo. */
  die() {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.rig.animator?.playOver(build({ type: 'clip', clip: DEATH, loop: false }), { fadeIn: 0.1, hold: true });
  }

  /** Vuelve a la partida (el Tótem de la vida): de pie otra vez, en el sitio que diga el siguiente estado. */
  revive() {
    this.dead = false;
    this.deadT = 0;
    this.fresh = true;
    this.track = new Track();
    this.base = undefined;
  }

  /** La cabeza se esconde mientras se mira por sus ojos. */
  setFirstPerson(on: boolean) {
    this.bones.Head?.scale.setScalar(on ? 0.001 : 1);
  }

  update(dt: number) {
    // lo que toca dibujar ahora: interpolado entre estados ya recibidos (ver interp.ts), con lo discreto del anterior
    let s = this.track.sample(performance.now(), this.out)?.s;
    if (!s && this.base) (s = this.base), Object.assign(this.out, { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch });
    if (s) {
      this.goal.set(this.out.x, this.out.y, this.out.z);
      this.goalYaw = this.out.yaw;
      this.goalPitch = this.out.pitch;
      this.light = s.light;
      this.jam = Math.max(0, (s.jam ?? 0) - this.track.tl.delay); // su «sin señal» menos lo que ya tiene el paquete
      this.held = s.held;
      this.hiding = !!s.hiding;
      this.wantTank = !!s.tank;
      this.emote = s.emote ?? 0;
      this.duck = !!s.duck;
      const A = this.rig.animator;
      if (A) {
        if ((s.variant ?? '') !== A.variant) A.setVariant(s.variant ?? '');
        if (!this.dead && !this.dancing && this.emote !== this.emoting) {
          this.emoting = this.emote;
          if (this.emote) A.playOverClip(EMOTES[this.emote], 1);
          else A.stopOver();
        }
        if ((s.dance ?? '') !== this.dancing) {
          this.dancing = s.dance ?? '';
          if (this.dancing) A.playOver(this.dancing, { hold: true });
          else A.stopOver();
        }
      }
      if (this.fresh) (this.fresh = false), this.pos.copy(this.goal), (this.yaw = this.goalYaw), (this.pitch = this.goalPitch);
    }
    // ya viene suave: solo un pulido corto (y, si de verdad se ha ido lejos, se corta)
    const k = 1 - Math.exp(-dt * 30), prev = _v.copy(this.pos);
    Timeline.follow(this.pos, this.goal, dt, k); // con tope de velocidad: tras un atasco se recupera corriendo, no a saltos
    this.pos.y += (this.goal.y - this.pos.y) * (Math.abs(this.goal.y - this.pos.y) > 3 ? 1 : k); // (un teletransporte o una caída de planta: sin deslizar)
    // la mirada (cabeza) con un filtro más lento y tope de velocidad: el ratón de quien juega tiembla y a veces da
    // saltos, y la cabeza no debe latiguear ni vibrar con eso
    const kh = 1 - Math.exp(-dt * 12), cap = dt * 12;
    this.yaw += THREE.MathUtils.clamp((angle(this.yaw, this.goalYaw) - this.yaw) * kh, -cap, cap);
    this.pitch += THREE.MathUtils.clamp((this.goalPitch - this.pitch) * kh, -cap, cap);
    // el clip, a la velocidad a la que se mueve de verdad
    const sp = dt > 0 ? this.pos.distanceTo(prev) / dt : 0;
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    const A = this.rig.animator;
    if (A) {
      // los parámetros del árbol: la velocidad a la que se mueve de verdad (los pasos casan solos) y el resto, de su último estado
      A.p.speed = this.speed > 0.15 ? this.speed : 0;
      A.p.crouch = this.duck ? 1 : 0;
      A.p.air = Math.abs(this.goal.y - this.pos.y) > 0.4 ? 1 : 0;
      A.p.vy = this.goal.y - this.pos.y;
      A.p.hold += ((this.held !== 'none' || this.light) && !this.dancing ? 1 - A.p.hold : -A.p.hold) * Math.min(1, dt * 12);
    }
    const body = this.rig.root;
    body.position.copy(this.pos);
    this.crouch += ((this.hiding && !this.dead ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    body.scale.set(1, 1 - 0.4 * this.crouch, 1);
    body.position.x += Math.sin(this.yaw) * 0.3 * this.crouch;
    body.position.z += Math.cos(this.yaw) * 0.3 * this.crouch;
    if (this.dead) {
      this.deadT += dt;
      body.rotation.set(0, this.yaw + Math.PI, 0);
    } else body.rotation.set(0, this.yaw + Math.PI, 0);
    this.rig.update(dt);
    // la cabeza sigue a la mirada (hacia arriba o abajo)
    if (this.bones.Head && !this.dead) this.bones.Head.rotation.x -= THREE.MathUtils.clamp(this.pitch, -1, 1) * 0.7;
    body.updateMatrixWorld(true);
    this.cos.update(this.pitch, !this.bones.Head || this.bones.Head.scale.x > 0.5);
    const live = !this.dead;
    if (this.wantTank && !this.tank && poolPart('tank')) {
      this.tank = wornModel(poolPart('tank')!);
      this.root.add(this.tank);
    }
    if (this.tank) {
      const sp = this.rig.bone('Spine2');
      this.tank.visible = live && this.wantTank && !!sp;
      if (this.tank.visible) placeWorn(this.tank, worn.tank, this.rig.root, sp!); // (sitio y tamaño: worn.json, editable en Anim Studio)
    }
    // lo que lleva: en las manos, apuntando hacia donde mira
    _q.setFromEuler(_e.set(this.pitch, this.yaw, 0, 'YXZ'));
    const place = (it: THREE.Object3D, bone: THREE.Bone | undefined, on: boolean, fwd: number) => {
      it.visible = on && !!bone;
      if (!it.visible) return;
      bone!.getWorldPosition(it.position);
      it.position.addScaledVector(_v.set(0, 0, -1).applyQuaternion(_q), fwd);
      it.quaternion.copy(_q);
    };
    place(this.items.flashlight, this.bones.LeftHand, live && this.held !== 'gun', 0.1);
    place(this.items.camera, this.bones.RightHand, live && this.held === 'camera', 0.12);
    // el rifle: al pecho y un poco a la derecha, apuntando adonde mira (en la mano quedaba a la altura de la cadera y de lado)
    const chest = this.rig.bone('Spine2'), gun = this.items.gun;
    gun.visible = live && this.held === 'gun' && !!chest;
    if (gun.visible) {
      _e.set(0, this.yaw, 0, 'YXZ');
      chest!.getWorldPosition(gun.position).addScaledVector(_a.set(0, 0, -1).applyEuler(_e), 0.42).addScaledVector(_b.set(1, 0, 0).applyEuler(_e), 0.17);
      gun.position.y -= 0.05;
      gun.quaternion.copy(_q);
    }
    // el haz sale de la linterna
    this.clock += dt;
    // (con el rifle en la mano la linterna no se dibuja: la luz sale entonces del rifle, no de donde quedó la linterna)
    const src = this.items.flashlight.visible ? this.items.flashlight : this.items.gun;
    this.beam.visible = this.glow.visible = live && this.light && src.visible;
    if (this.beam.visible) {
      (this.beam.position.copy(src.position), this.beam.quaternion.copy(_q));
      this.glow.position.copy(src.position).addScaledVector(_v.set(0, 0, -1).applyQuaternion(_q), 0.12);
      for (const m of this.beamMats) m.uniforms.uT.value = this.clock;
    }
    this.shadow.visible = this.floorShadow && live;
    this.shadow.position.set(this.pos.x, this.pos.y + 0.012, this.pos.z);
    if (live && this.onStep && !this.emote && this.speed > 0.3) {
      this.walked += this.speed * dt;
      const running = this.speed > this.stepRunSpeed;
      const len = running ? 1.1 : 0.7;
      if (this.walked > len) (this.walked -= len), this.onStep(this, running);
    }
    this.label.visible = live;
    this.label.position.set(this.pos.x, this.pos.y + 2.15 - 0.85 * this.crouch, this.pos.z);
  }

  dispose() {
    this.rig.mixer.stopAllAction();
    this.cos.dispose();
    this.root.removeFromParent();
  }
}
