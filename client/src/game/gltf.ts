import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/*
 * Cargador de los .glb del juego: geometría con meshopt y texturas KTX2/Basis (tools/ktx_convert.mjs de Phoenyx; docs/KTX2.md del motor).
 * El transcodificador elige el formato que admita la GPU (BC7 en escritorio, ASTC/ETC2 en móvil, RGBA8 si no hay compresión).
 * Los modelos se piden antes de que exista un renderer, así que las características se leen del adaptador y `load` espera a eso.
 */
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/');
const support = (async () => {
  const a = await (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu?.requestAdapter();
  const has = (f: string) => !!a?.features.has(f);
  (ktx2 as unknown as { workerConfig: object }).workerConfig = {
    astcSupported: has('texture-compression-astc'),
    etc1Supported: false,
    etc2Supported: has('texture-compression-etc2'),
    dxtSupported: has('texture-compression-bc'),
    bptcSupported: false,
    pvrtcSupported: false,
  };
})();
const load = ktx2.load.bind(ktx2);
ktx2.load = (...args: Parameters<typeof load>) => (void support.then(() => load(...args)), undefined as never);

export const gltfLoader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
