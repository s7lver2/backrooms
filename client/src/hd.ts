/*
 * Packs de alta definicion (src/packs.ts; los genera tools/make_hd.py):
 *   HIGH-RES TEXTURES (hd)       sustituye las texturas pequenas de los .glb (256-512 px) por las originales (hasta 2048)
 *   HIGH-DETAIL MODELS (hdmodels) devuelve a los materiales el mapa de normales original (los .glb ligeros se hicieron sin ellos)
 * Solo actua si el pack esta instalado (sus indices tex.json / nrm.json estan en su cache) y no se juega en calidad baja. Se engancha a GLTFLoader.load:
 * cuando termina un modelo cambia lo suyo y espera a que las imagenes estan listas (vienen del disco) antes de entregarlo, para que los clones que
 * luego haga el juego (instancias, materiales) ya las lleven.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { settings } from './settings';

type Index = Record<string, Record<string, string>>;
const fromCache = async (url: string): Promise<Index | undefined> => {
  try {
    const r = await caches.match(url);
    return r ? ((await r.json()) as Index) : undefined;
  } catch {
    return undefined;
  }
};
const ready: Promise<{ tex?: Index; nrm?: Index }> =
  typeof caches === 'undefined' || (window as unknown as { __capture?: boolean }).__capture
    ? Promise.resolve({})
    : Promise.all([fromCache('/hd/tex.json'), fromCache('/hd/nrm.json')]).then(([tex, nrm]) => ({ tex, nrm }));

const img = (url: string) =>
  new Promise<HTMLImageElement | null>((done) => {
    const i = new Image();
    i.decoding = 'async';
    i.onload = () => done(i);
    i.onerror = () => done(null);
    i.src = url;
  });

interface Parser {
  json: { textures?: { source?: number; extensions?: { EXT_texture_webp?: { source?: number } } }[] };
  associations: Map<unknown, { textures?: number; materials?: number }>;
}

async function apply(key: string, gltf: { parser: Parser }, idx: { tex?: Index; nrm?: Index }) {
  const p = gltf.parser, jobs: Promise<void>[] = [];
  const tex = idx.tex?.[key], nrm = idx.nrm?.[key];
  for (const [obj, a] of p.associations) {
    if (tex && obj instanceof THREE.Texture && !(obj as THREE.CompressedTexture).isCompressedTexture && a.textures !== undefined) { // (las texturas KTX2 no se sustituyen: el pack HD aún no está adaptado)
      const t = p.json.textures?.[a.textures], src = t?.extensions?.EXT_texture_webp?.source ?? t?.source, hd = src === undefined ? undefined : tex[String(src)];
      if (hd) jobs.push(img('/hd/' + hd).then((i) => void (i && ((obj.image = i), (obj.needsUpdate = true)))));
    } else if (nrm && obj instanceof THREE.MeshStandardMaterial && a.materials !== undefined && !obj.normalMap && nrm[String(a.materials)]) {
      jobs.push(
        img('/hd/' + nrm[String(a.materials)]).then((i) => {
          if (!i) return;
          const n = new THREE.Texture(i);
          n.flipY = false;
          n.wrapS = obj.map?.wrapS ?? THREE.RepeatWrapping;
          n.wrapT = obj.map?.wrapT ?? THREE.RepeatWrapping;
          n.anisotropy = obj.map?.anisotropy ?? 1;
          n.needsUpdate = true;
          obj.normalMap = n;
          obj.needsUpdate = true;
        }),
      );
    }
  }
  await Promise.all(jobs);
}

const load = GLTFLoader.prototype.load;
GLTFLoader.prototype.load = function (this: GLTFLoader, url: string, onLoad: (g: GLTF) => void, ...rest: never[]) {
  const key = /(?:^|\/)models\/([^?]+\.glb)(?:\?|$)/.exec(url)?.[1];
  if (!key) return load.call(this, url, onLoad, ...rest);
  return load.call(
    this,
    url,
    (g: GLTF) => {
      void ready
        .then((idx) => (settings.quality === 1 || (!idx.tex && !idx.nrm) ? undefined : apply(key, g as unknown as { parser: Parser }, idx)))
        .catch(() => undefined) // (si algo falla, el modelo se entrega como estaba)
        .then(() => onLoad(g));
    },
    ...rest,
  );
} as typeof GLTFLoader.prototype.load;
