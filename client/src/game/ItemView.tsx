import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { rarity } from '@backrooms/shared';
import type { Assets } from './game';
import type { IconKey } from './invIcons';
import { poolPart } from './poolmap';
import { itemModel } from './itemModels';
import { glow, lootModel, pulse } from './rarityFx';

/*
 * El objeto elegido del inventario en 3D, girando despacio, con una luz y un destello del color de su rareza detrás.
 * Un renderer propio mientras está abierto (se libera al cerrarlo); se pinta solo si la pestaña se ve.
 */

/** El modelo de cada objeto (lo mismo que se fotografía para los iconos). */
function modelOf(assets: Assets, k: IconKey | 'loot', r: number): THREE.Object3D | undefined {
  const g = assets.gltf;
  switch (k) {
    case 'flashlight':
    case 'spare': return g.flashlight.scene;
    case 'camera': return g.camcorder.scene;
    case 'gun':
    case 'ammo': return g.gun.scene;
    case 'tape': return g.vhs.scene;
    case 'water': return g.water.scene;
    case 'caution': return g.duct.scene;
    case 'radar': return g.radar.scene;
    case 'totem': return g.totem.scene;
    case 'loot': return lootModel(r);
    case 'uno': return itemModel('uno');
    case 'monster': return itemModel('monster');
    case 'pokeball':
    case 'grenade':
    case 'nokia':
    case 'bat': return itemModel(k);
    default: return poolPart(k);
  }
}

export default function ItemView({ assets, kind, r }: { assets: Assets; kind: IconKey | 'loot'; r: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const src = modelOf(assets, kind, r);
    if (!el || !src) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.append(renderer.domElement);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block';
    const col = new THREE.Color(rarity(r).color);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff1c4, 0x3a2c0c, 1.5));
    const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
    key.position.set(2, 3, 3);
    scene.add(key);
    const rim = new THREE.PointLight(col, 40, 6);
    rim.position.set(-1.5, 1, -1.5);
    scene.add(rim);
    // el objeto, centrado y con 1,5 de lado mayor, sobre un pivote que gira
    const pivot = new THREE.Group(), obj = clone(src);
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    obj.position.sub(c);
    const holder = new THREE.Group();
    holder.add(obj);
    holder.scale.setScalar(1.5 / Math.max(s.x, s.y, s.z, 1e-3));
    holder.rotation.x = 0.35;
    pivot.add(holder);
    scene.add(pivot);
    const halo = glow(r);
    halo.position.set(0, 0, -1);
    halo.scale.setScalar(3.2 + r * 0.5);
    halo.userData.glow.s = halo.scale.x;
    scene.add(halo);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
    cam.position.set(0, 0.2, 4.2);
    cam.lookAt(0, 0, 0);
    const fit = () => {
      const w = el.clientWidth || 200, h = el.clientHeight || 200;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    let id = 0;
    const loop = (now: number) => {
      id = requestAnimationFrame(loop);
      if (document.hidden) return;
      const t = now / 1000;
      pivot.rotation.y = t * 0.9;
      pivot.position.y = Math.sin(t * 1.6) * 0.04;
      pulse(halo, t);
      renderer.render(scene, cam);
    };
    id = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(id);
      ro.disconnect();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [assets, kind, r]);
  return <div ref={box} className="iv-view" role="img" aria-label="The item, turning" />;
}
