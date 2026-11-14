import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { ParkingPoint } from '@backrooms/shared';

const shader = {
  uniforms: { tDiffuse: { value: null }, color: { value: null }, textureMatrix: { value: null } },
  vertexShader: `
    uniform mat4 textureMatrix;
    varying vec4 reflectionUv;
    varying vec2 puddleUv;
    varying vec2 seed;
    #include <fog_pars_vertex>
    void main() {
      reflectionUv = textureMatrix * vec4(position, 1.0);
      puddleUv = uv * 2.0 - 1.0;
      seed = position.xy;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec4 reflectionUv;
    varying vec2 puddleUv;
    varying vec2 seed;
    #include <fog_pars_fragment>
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      float angle = atan(puddleUv.y, puddleUv.x + 0.00001);
      float r = length(puddleUv);
      // la silueta base (la misma que usa wetAt) con un borde irregular que cambia de un charco a otro
      float edge = 0.76 + 0.12 * sin(angle * 3.0) + 0.07 * cos(angle * 7.0) + (vnoise(puddleUv * 5.0 + seed * 3.1) - 0.5) * 0.14;
      float body = 1.0 - smoothstep(edge - 0.26, edge, r);          // el agua: opaca en el centro, se funde hacia el borde
      float halo = (1.0 - smoothstep(edge - 0.05, edge + 0.2, r)) * 0.55; // el asfalto mojado alrededor: oscuro y sin reflejo
      float alpha = max(body, halo);
      if (alpha <= 0.01) discard;
      // el reflejo, ondulado un poco y más fuerte hacia el centro (como un decal de agua, no un espejo recortado)
      vec2 wob = (vec2(vnoise(puddleUv * 7.0 + seed), vnoise(puddleUv * 7.0 - seed)) - 0.5) * 0.012;
      vec4 ruv = reflectionUv; ruv.xy += wob * ruv.w;
      vec3 reflected = texture2DProj(tDiffuse, ruv).rgb;
      float k = smoothstep(0.0, 0.9, body);
      float rim = smoothstep(edge - 0.16, edge - 0.02, r) * body; // un filo claro donde el agua toca el suelo
      vec3 wet = vec3(0.006, 0.009, 0.009);
      vec3 col = wet + reflected * (0.25 + 0.55 * k) + rim * vec3(0.035, 0.04, 0.04);
      gl_FragColor = vec4(col, alpha * (0.3 + 0.6 * k) * 0.95);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
};

/** Coplanar decals share a single reflection pass and target. */
export class ParkingPuddles {
  private readonly reflector: Reflector;
  private readonly floors = new Map<number, { y: number; spots: { x: number; z: number; width: number; depth: number; angle: number }[]; geometry: THREE.BufferGeometry }>();

  constructor(scene: THREE.Scene, anchors: ParkingPoint[], hash: (n: number) => number, low: boolean) {
    for (const [i, anchor] of anchors.entries()) {
      const floor = this.floors.get(anchor.floor) ?? { y: anchor.y, spots: [], geometry: new THREE.BufferGeometry() };
      this.floors.set(anchor.floor, floor);
      floor.spots.push({ x: anchor.x, z: anchor.z, width: 1.8 + hash(i * 13) * 2, depth: 1 + hash(i * 17) * 1.6, angle: hash(i * 19) * Math.PI });
    }
    for (const { geometry, spots } of this.floors.values()) {
      const positions: number[] = [], uvs: number[] = [];
      for (const { x, z, width, depth, angle } of spots) {
        const cos = Math.cos(angle), sin = Math.sin(angle);
        for (const [u, v] of [[0, 1], [0, 0], [1, 1], [0, 0], [1, 0], [1, 1]]) {
          const dx = (u - .5) * width, dz = (v - .5) * depth;
          positions.push(x + dx * cos - dz * sin, -z + dx * sin + dz * cos, 0);
          uvs.push(u, v);
        }
      }
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    }

    this.reflector = new Reflector(this.floors.values().next().value?.geometry, {
      textureWidth: low ? 192 : 384, textureHeight: low ? 108 : 216, multisample: 0, clipBias: .003, shader,
    });
    const material = this.reflector.material as THREE.ShaderMaterial;
    material.transparent = true;
    material.depthWrite = false;
    // The reflected scene already has fog. Fog the surface itself to blend into distant asphalt.
    material.fog = true;
    Object.assign(material.uniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.fog));
    this.reflector.userData.projectedDecal = true;
    this.reflector.name = 'Parking puddle decals';
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.renderOrder = 1;
    this.reflector.visible = false;
    scene.add(this.reflector);
  }

  update(p: ParkingPoint) {
    const floor = this.floors.get(p.floor);
    this.reflector.visible = !!floor?.spots.some(s => Math.hypot(s.x - p.x, s.z - p.z) < 19);
    if (!floor) return;
    this.reflector.geometry = floor.geometry;
    this.reflector.position.y = floor.y + .004;
  }

  wetAt(p: ParkingPoint) {
    const floor = this.floors.get(p.floor);
    if (!floor || Math.abs(p.y - floor.y) > .11) return false;
    return floor.spots.some(({ x, z, width, depth, angle }) => {
      const dx = p.x - x, dz = z - p.z, cos = Math.cos(angle), sin = Math.sin(angle);
      const u = (dx * cos + dz * sin) * 2 / width, v = (-dx * sin + dz * cos) * 2 / depth;
      const a = Math.atan2(v, u);
      return Math.hypot(u, v) < .72 + .12 * Math.sin(a * 3) + .07 * Math.cos(a * 7);
    });
  }

  dispose() {
    this.reflector.removeFromParent();
    this.reflector.geometry.dispose();
    for (const { geometry } of this.floors.values()) if (geometry !== this.reflector.geometry) geometry.dispose();
    this.reflector.dispose();
  }
}
