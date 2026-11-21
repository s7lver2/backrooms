import * as THREE from 'three';
import { gltfLoader } from './gltf';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/*
 * La entrada al juego: un cuarto a oscuras con la moqueta y el papel de las backrooms (ya estás dentro,
 * aunque aún no lo sepas), un fluorescente viejo que parpadea en el techo y un televisor de antena en el
 * suelo, encendido y enchufado a la pared. Mientras se descarga todo, la cámara de mano se le acerca; en la
 * pantalla (de cristal curvo, con su reflejo), nieve y la carga de los 90, y el polvo flota en el haz de luz
 * de la tele. Al terminar, la cámara se lanza contra el cristal: se cierra la vista, la cinta se rompe y la
 * nieve se come la imagen. Lo pinta el compositor del juego (game.ts): bloom, grano y la cinta encima.
 */

const TV_W = 0.62; // el ancho de la tele, en metros
const EYE = 1.35;
const START = 2.5, NEAR = 1.05, WALK = 0.6; // de dónde sale la cámara, desde dónde ya se puede meter y a qué paso
const ROOM = { x: 4, y: 2.5, z: 5, cz: 1.5 }; // 4 × 5 m, techo bajo; el centro, en z = 1,5
const DUST = 220;

export class TvRoom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.02, 30);
  private cv = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
  private ctx = this.cv.getContext('2d')!;
  private tex = new THREE.CanvasTexture(this.cv);
  private screenMat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false, fog: false });
  private glow = new THREE.PointLight(0xbcd2ff, 0, 7, 1.2);
  private tube = new THREE.PointLight(0xffecc0, 0, 6, 1.6);
  private tubeMat = new THREE.MeshBasicMaterial({ color: 0x14120c });
  private noise = this.ctx.createImageData(160, 120);
  private small = Object.assign(document.createElement('canvas'), { width: 160, height: 120 });
  private z = START; // la cámara, a z de la tele
  private dived = 0; // 0 → 1 mientras se mete dentro
  private screen = new THREE.Vector3(0, 0.3, 0.2); // el centro del cristal (se mide al cargar la tele)
  private screenH = 0.3;
  private screenW = 0.4;
  private ready = false;
  private dust = new THREE.Points(
    new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: DUST * 3 }, () => Math.random()), 3))
      .setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(DUST * 3), 3)),
    new THREE.PointsMaterial({ size: 0.014, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  private shaft?: THREE.Mesh;
  private glassFx?: THREE.Mesh;
  private born = 0; // cuánto lleva en pantalla (s)
  speed = 1;

  constructor(private reduced: boolean) {
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.Fog(0x000000, 1.5, 6.5);
    const tl = new THREE.TextureLoader(), tile = (url: string, rx: number, ry: number) => {
      const t = tl.load(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    };
    // el cuarto, con las texturas de las backrooms muy apagadas
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x, ROOM.z).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tile('/models/backrooms/tex/carpet.webp', 3, 4), color: 0x6a6252, roughness: 1 }));
    floor.position.z = ROOM.cz;
    const wallMat = new THREE.MeshStandardMaterial({ map: tile('/models/backrooms/tex/wall.webp', 3, 2), color: 0x7a7258, roughness: 0.95, side: THREE.BackSide });
    const room = new THREE.Mesh(new THREE.BoxGeometry(ROOM.x, ROOM.y, ROOM.z), wallMat);
    room.position.set(0, ROOM.y / 2, ROOM.cz);
    // el techo de placas, con su rejilla
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.x, ROOM.z).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: tile('/models/backrooms/tex/ceiling.webp', 3, 4), color: 0x6b6450, roughness: 0.95 }));
    ceil.position.set(0, ROOM.y - 0.002, ROOM.cz);
    this.scene.add(floor, room, ceil, this.glow, this.tube, new THREE.AmbientLight(0x403a30, 0.06), this.dust);
    this.dust.frustumCulled = false;

    // el zócalo, en los cuatro lados
    const base = new THREE.MeshStandardMaterial({ color: 0x2b2216, roughness: 0.7 });
    const skirt = (w: number, d: number, x: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, d), base);
      b.position.set(x, 0.045, z);
      this.scene.add(b);
    };
    skirt(ROOM.x, 0.02, 0, ROOM.cz - ROOM.z / 2 + 0.01);
    skirt(ROOM.x, 0.02, 0, ROOM.cz + ROOM.z / 2 - 0.01);
    skirt(0.02, ROOM.z, -ROOM.x / 2 + 0.01, ROOM.cz);
    skirt(0.02, ROOM.z, ROOM.x / 2 - 0.01, ROOM.cz);

    // el fluorescente del techo: marco y panel; el panel se apaga y se enciende (ver update)
    const fx = 0.5, fz = 1.2, fy = ROOM.y - 0.03;
    const frame = mergeGeometries([
      new THREE.BoxGeometry(1.32, 0.07, 0.05).translate(0, 0, 0.335),
      new THREE.BoxGeometry(1.32, 0.07, 0.05).translate(0, 0, -0.335),
      new THREE.BoxGeometry(0.05, 0.07, 0.62).translate(0.635, 0, 0),
      new THREE.BoxGeometry(0.05, 0.07, 0.62).translate(-0.635, 0, 0),
    ].map((g) => g.toNonIndexed()))!;
    const fixture = new THREE.Mesh(frame, new THREE.MeshStandardMaterial({ color: 0x8e8a7c, roughness: 0.55, metalness: 0.35 }));
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.6), this.tubeMat);
    fixture.position.set(fx, fy - 0.005, fz);
    panel.position.set(fx, fy, fz);
    this.tube.position.set(fx, fy - 0.25, fz);
    this.scene.add(fixture, panel);

    // el cable de la tele, por el suelo hasta un enchufe de la pared izquierda (un tubo, no una línea)
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0.05, 0.05, -0.2), new THREE.Vector3(-0.35, 0.012, -0.38), new THREE.Vector3(-0.9, 0.012, -0.14), new THREE.Vector3(-1.5, 0.012, -0.55), new THREE.Vector3(-1.9, 0.07, -0.5), new THREE.Vector3(-1.985, 0.3, -0.5)]), 80, 0.007, 6),
      new THREE.MeshStandardMaterial({ color: 0x0f0f0e, roughness: 0.55 }),
    );
    const socket = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: 0x8a826c, roughness: 0.6 }));
    socket.position.set(-1.99, 0.3, -0.5);
    this.scene.add(cable, socket);

    // la tele (la de antena de la sala de vigilancia), en el suelo y mirando a la cámara
    const gl = gltfLoader();
    gl.load('/models/surveilance_room/antennatv.glb', (g) => {
      const tv = g.scene;
      tv.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // la simplificación le dejó las normales rotas: suavizadas donde la curva es suave, duras en las aristas
        m.geometry = toCreasedNormals(m.geometry, Math.PI / 5);
        const mat = m.material as THREE.MeshStandardMaterial;
        if (/^TV_Screen_PBR$/.test(mat.name)) m.material = this.screenMat;
        else mat.emissiveIntensity = Math.min(mat.emissiveIntensity ?? 0, 1); // el piloto viene a x50
      });
      tv.rotation.y = -Math.PI / 2; // su frente es +x
      tv.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(tv), s = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3()), k = TV_W / s.x;
      tv.scale.setScalar(k);
      tv.position.set(-c.x * k, -b.min.y * k, -c.z * k);
      this.scene.add(tv);
      tv.updateMatrixWorld(true);
      // dónde está el cristal, para mirarlo y meterse justo en él
      tv.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || m.material !== this.screenMat) return;
        const sb = new THREE.Box3().setFromObject(m);
        sb.getCenter(this.screen);
        this.screen.z = sb.max.z;
        this.screenH = sb.max.y - sb.min.y;
        this.screenW = sb.max.x - sb.min.x;
        m.visible = false; // lo sustituye un cristal curvo, con la misma imagen
      });
      this.buildGlass();
      // la sombra donde apoya (sin luces con sombra: una mancha oscura, suave)
      const blob = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), bx = blob.getContext('2d')!;
      const grad = bx.createRadialGradient(32, 32, 4, 32, 32, 32);
      grad.addColorStop(0, 'rgba(0,0,0,0.85)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      bx.fillStyle = grad;
      bx.fillRect(0, 0, 64, 64);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(TV_W * 1.3, (s.z / s.x) * TV_W * 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(blob), transparent: true, depthWrite: false }));
      shadow.position.y = 0.003;
      this.scene.add(shadow);
      this.glow.position.set(this.screen.x, this.screen.y + 0.1, this.screen.z + 0.5);
      this.ready = true;
    }, undefined, () => {
      // sin tele, al menos su pantalla flotando en lo oscuro: que la entrada no se quede esperando
      this.screenH = 0.35;
      this.screenW = 0.46;
      this.buildGlass();
      this.ready = true;
    });
    if (reduced) this.z = NEAR;
  }

  /** El cristal curvo de la pantalla (abombado hacia fuera), su reflejo y el haz de luz que sale de ella. */
  private buildGlass() {
    const w = this.screenW * 0.98, h = this.screenH * 0.98, bulge = 0.014;
    const g = new THREE.PlaneGeometry(w, h, 24, 18), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const nx = p.getX(i) / (w / 2), ny = p.getY(i) / (h / 2);
      p.setZ(i, bulge * (1 - nx * nx) * (1 - ny * ny));
    }
    g.computeVertexNormals();
    const glass = new THREE.Mesh(g, this.screenMat);
    glass.position.set(this.screen.x, this.screen.y, this.screen.z + 0.002);
    // el reflejo: una ventana lejana y una raya en diagonal, muy tenues
    const rc = Object.assign(document.createElement('canvas'), { width: 128, height: 96 }), rx = rc.getContext('2d')!;
    rx.fillStyle = '#000';
    rx.fillRect(0, 0, 128, 96);
    const streak = rx.createLinearGradient(0, 0, 128, 96);
    streak.addColorStop(0.18, 'rgba(255,255,255,0)');
    streak.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    streak.addColorStop(0.42, 'rgba(255,255,255,0)');
    rx.fillStyle = streak;
    rx.fillRect(0, 0, 128, 96);
    rx.fillStyle = 'rgba(255,244,214,0.35)';
    rx.fillRect(86, 12, 24, 30);
    const fx = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(rc), blending: THREE.AdditiveBlending, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false, fog: false }));
    fx.position.copy(glass.position).z += 0.002;
    this.glassFx = fx;
    // el haz: un cono suave de la pantalla hacia la sala, más claro cerca de ella (colores por vértice, para sumarse)
    const len = 2.4, cone = new THREE.CylinderGeometry(this.screenW * 0.9, this.screenW * 0.5, len, 28, 1, true), cp = cone.getAttribute('position'), col = new Float32Array(cp.count * 3);
    for (let i = 0; i < cp.count; i++) {
      const t = (cp.getY(i) + len / 2) / len; // 0 en la pantalla, 1 lejos
      const v = Math.pow(Math.max(0, 1 - t), 1.6) * 0.045; // (1 - t puede salir -1e-16: pow de un negativo es NaN, y el aditivo lo extiende)
      col.set([v * 0.74, v * 0.84, v], i * 3);
    }
    cone.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cone.rotateX(-Math.PI / 2); // su eje, a lo largo de +z, con la punta ancha hacia la sala
    const shaft = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    shaft.position.set(this.screen.x, this.screen.y, this.screen.z + len / 2);
    this.shaft = shaft;
    this.scene.add(glass, fx, shaft);
  }

  /** La pantalla de la tele: nieve y, encima, la carga en letra blanca con su barra de bloques; al meterse, solo nieve. */
  private draw(t: number, progress: number, failed: boolean, snow: number) {
    const x = this.ctx, d = this.noise.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * (120 + 135 * snow);
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    this.small.getContext('2d')!.putImageData(this.noise, 0, 0);
    x.imageSmoothingEnabled = false;
    x.drawImage(this.small, 0, 0, 320, 240);
    if (snow < 0.5) {
      x.fillStyle = 'rgba(0,0,0,0.55)';
      x.fillRect(0, 0, 320, 240);
      // la señal tiembla un poco de lado a lado
      const j = this.reduced ? 0 : Math.sin(t * 31) * 0.6 + (Math.random() < 0.04 ? (Math.random() - 0.5) * 6 : 0);
      x.fillStyle = '#ecebe4';
      x.font = 'bold 18px monospace';
      x.fillText('BACKROOMS', 22 + j, 50);
      x.font = '11px monospace';
      if (failed) x.fillText('Failed to load. Press any key.', 22 + j, 80);
      else {
        x.fillText('Loading assets...', 22 + j, 80);
        x.fillText('this may take a while.', 22 + j, 96);
        for (let i = 0; i < 20; i++) {
          x.fillStyle = i < Math.floor(progress * 20) ? '#ecebe4' : '#2a2a26';
          x.fillRect(22 + i * 13 + j, 114, 10, 12);
        }
        x.fillStyle = '#8d8b80';
        x.fillText(`${String(Math.round(progress * 100)).padStart(3, ' ')}%`, 22 + j, 146);
      }
    }
    // de vez en cuando, una tira de imagen se desplaza (pérdida de sincronía)
    if (!this.reduced && Math.random() < 0.03 + this.dived * 0.3) {
      const y = (Math.random() * 220) | 0, hh = 4 + ((Math.random() * 14) | 0);
      x.drawImage(this.cv, 0, y, 320, hh, (Math.random() - 0.5) * 40, y, 320, hh);
    }
    // líneas de barrido y la banda de refresco que baja despacio
    x.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = (t * 40) % 3 | 0; y < 240; y += 3) x.fillRect(0, y, 320, 1);
    if (!this.reduced) {
      const by = ((t * 38) % 330) - 45, band = x.createLinearGradient(0, by, 0, by + 45);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, 'rgba(255,255,255,0.07)');
      band.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = band;
      x.fillRect(0, by, 320, 45);
    }
    // el tubo oscurece las esquinas
    const v = x.createRadialGradient(160, 120, 80, 160, 120, 210);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.6)');
    x.fillStyle = v;
    x.fillRect(0, 0, 320, 240);
    this.tex.needsUpdate = true;
  }

  resize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Cuánto lleva metiéndose en la tele (0–1): game.ts rompe la cinta con ello. */
  get progress() {
    return this.dived;
  }

  /** Un fotograma: la cámara se acerca (más deprisa con `speed`) o, tras `dive`, se lanza contra la pantalla. */
  update(dt: number, t: number, progress: number, failed: boolean) {
    this.born += dt;
    // al lanzarse: acelera (sale despacio y llega de golpe)
    const k = this.dived * this.dived * this.dived;
    this.draw(t, progress, failed, Math.min(1, this.dived * 1.8));
    // la tele parpadea con lo que enseña (sin tele aún, nada se ve)
    this.glow.intensity = this.ready ? 3.2 + Math.sin(t * 23) * 0.4 + (Math.random() - 0.5) * 0.7 + k * 6 : 0;
    // el fluorescente: casi siempre muy flojo y a rachas parpadea a saltos, como los de las backrooms
    const burst = !this.reduced && Math.sin(t * 0.43) + Math.sin(t * 1.37 + 1) > 1.1, kk = Math.floor(t * 16), r = Math.abs(Math.sin(kk * 12.9898) * 43758.5453) % 1;
    const lvl = burst && r < 0.5 ? 0.05 : 1;
    this.tube.intensity = lvl * 0.9;
    this.tubeMat.color.setRGB(0.07 + 0.93 * lvl * 0.82, 0.06 + 0.9 * lvl * 0.78, 0.04 + 0.8 * lvl * 0.62);
    if (!this.reduced && this.ready) this.z = Math.max(NEAR, this.z - dt * WALK * this.speed);
    // el reflejo del cristal y el haz respiran con la tele
    if (this.glassFx) (this.glassFx.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(t * 23) * 0.02 + k * 0.1;
    if (this.shaft) (this.shaft.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - k);
    this.moveDust(dt, t);
    // a la distancia en que el cristal llena la vista, y la vista cerrándose
    this.camera.fov = THREE.MathUtils.lerp(50, 30, k) + (this.reduced ? 0 : Math.sin(t * 0.5) * 0.4);
    this.camera.updateProjectionMatrix();
    // al final, la nieve de lado a lado (lo que pida más cerca: el alto o el ancho del cristal)
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const fill = this.screen.z + Math.min(this.screenH / 2 / tan, this.screenW / 2 / (tan * this.camera.aspect)) * 0.8;
    const z = THREE.MathUtils.lerp(this.z, fill, k), y = THREE.MathUtils.lerp(EYE - (START - this.z) * 0.35, this.screen.y, k);
    // cámara de mano: el paso al acercarse (sube y baja), una deriva lenta, y al lanzarse, temblor
    const walking = this.ready && this.z > NEAR + 0.01 ? 1 : 0.25, rm = this.reduced ? 0 : 1;
    const bob = Math.sin(t * 6.2) * 0.008 * walking * rm, sway = (1 - k) * 0.012 * rm, shake = k * 0.006 * rm;
    this.camera.position.set(this.screen.x + Math.sin(t * 0.7) * sway + Math.sin(t * 0.31) * 0.02 * (1 - k) * rm + (Math.random() - 0.5) * shake, y + Math.sin(t * 1.3) * sway + bob, z);
    this.camera.lookAt(this.screen.x, this.screen.y, this.screen.z);
    this.camera.rotateZ(Math.sin(t * 0.9) * 0.012 * (1 - k) * rm + (Math.random() - 0.5) * 0.02 * k * rm);
  }

  /** El polvo a la deriva en la sala; solo se ve dentro del haz de la tele (más cerca de la pantalla, más brillante). */
  private moveDust(dt: number, t: number) {
    const p = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute, c = this.dust.geometry.getAttribute('color') as THREE.BufferAttribute;
    if (!this.seeded) {
      for (let i = 0; i < DUST; i++) p.setXYZ(i, (Math.random() - 0.5) * 1.8, 0.1 + Math.random() * 1.6, this.screen.z + 0.1 + Math.random() * 2.3);
      this.seeded = true;
    }
    for (let i = 0; i < DUST; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (!this.reduced) {
        x += Math.sin(t * 0.3 + i) * 0.02 * dt;
        y += (Math.sin(t * 0.2 + i * 1.7) * 0.02 - 0.01) * dt;
        z += Math.cos(t * 0.25 + i * 0.7) * 0.02 * dt;
        if (y < 0.05) y = 1.7;
      }
      p.setXYZ(i, x, y, z);
      // el haz: un cono desde la pantalla hacia la cámara
      const dz = z - this.screen.z, spread = this.screenW * 0.5 + dz * 0.35, off = Math.hypot(x - this.screen.x, y - this.screen.y * 1.5);
      const lit = dz > 0 ? Math.max(0, 1 - off / spread) * Math.pow(Math.max(0, 1 - dz / 2.6), 0.8) : 0;
      const v = lit * 0.55;
      c.setXYZ(i, v * 0.78, v * 0.88, v);
    }
    p.needsUpdate = c.needsUpdate = true;
  }
  private seeded = false;

  /** Ya está lo bastante cerca para meterse (el paseo hasta la tele siempre se ve). */
  get near() {
    return this.ready && (this.reduced || this.z <= NEAR + 0.01);
  }

  /** Meterse en la tele: avanza `dived` de 0 a 1 en `secs`. */
  dive(dt: number, secs: number) {
    this.dived = Math.min(1, this.dived + dt / secs);
    return this.dived >= 1;
  }

  /** Segundos que lleva la sala en pantalla (para el fundido de entrada). */
  get age() {
    return this.born;
  }

  dispose() {
    this.tex.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        (mat as THREE.MeshStandardMaterial).map?.dispose();
        mat.dispose();
      }
    });
  }
}
