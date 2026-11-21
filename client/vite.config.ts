import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_PORT = Number(process.env.SERVER_PORT) || 5181; // (SERVER_PORT: otro puerto para pruebas)
const CLIENT_PORT = 5180; // el mismo que shared/src/index.ts (la config no puede importar .ts del workspace)

// solo en desarrollo: el estudio de animación (/?anim) guarda aquí lo que ajusta
// (POST /__grips?file=grips|pieces|worn|tree...: agarres, accesorios, bombona, animaciones)
const SAVEABLE: Record<string, string> = { grips: 'grips.json', pieces: 'pieces.json', worn: 'worn.json', tree: 'anim/tree.json', variants: 'anim/variants.json', dances: 'anim/dances.json', manifest: 'anim/manifest.json' };
const gripsSaver = (): Plugin => ({
  name: 'grips-saver',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__grips', (req, res) => {
      // solo desde esta máquina: por un túnel (devtunnels añade x-forwarded-* y el Host es otro) cualquiera podría reescribir estos archivos
      const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
      if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || !['localhost', '127.0.0.1', '[::1]'].includes(host)) return (res.statusCode = 403), res.end();
      // GET: los modelos de accesorios que hay en public/models/cosmetics (el estudio añade solo los que aún no tienen entrada en pieces.json)
      if (req.method === 'GET') return res.end(JSON.stringify(readdirSync(fileURLToPath(new URL('./public/models/cosmetics', import.meta.url))).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4))));
      if (req.method !== 'POST') return (res.statusCode = 405), res.end();
      const file = SAVEABLE[new URL(req.url ?? '', 'http://x').searchParams.get('file') ?? 'grips'];
      if (!file) return (res.statusCode = 400), res.end('unknown file');
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          JSON.parse(body);
          const data = JSON.parse(body) as Record<string, { slot: string }>;
          writeFileSync(fileURLToPath(new URL('./src/game/' + file, import.meta.url)), body);
          if (file === 'pieces.json') {
            // el slot de cada pieza (gorro/mochila) también va en COSMETICS: se mantiene igual para que el armario coincida
            const p = fileURLToPath(new URL('../shared/src/progress.ts', import.meta.url));
            let s = readFileSync(p, 'utf8');
            for (const [id, v] of Object.entries(data)) s = s.replace(new RegExp(`slot: '(?:head|back)'(, id: '${id}')`), `slot: '${v.slot}'$1`);
            writeFileSync(p, s);
          }
          res.end('ok');
        } catch {
          res.statusCode = 400;
          res.end('bad json');
        }
      });
    });
  },
});

// las animaciones de Mixamo (FBX) se empaquetan solas (tools/anim_pack.mjs, incremental): al compilar antes de empezar y en desarrollo en segundo plano,
// vigilando las carpetas de FBX: soltar uno nuevo basta; Anim Studio recibe el aviso 'anim-pack-updated' y lo recoge sin recargar
const animPack = (): Plugin => {
  const script = fileURLToPath(new URL('../tools/anim_pack.mjs', import.meta.url));
  let build = false;
  const run = () => new Promise<void>((done) => spawn(process.execPath, [script], { stdio: 'inherit' }).on('close', () => done()));
  return {
    name: 'anim-pack',
    configResolved(c) {
      build = c.command === 'build';
    },
    async buildStart() {
      if (build) await run(); // al compilar: antes de empezar (rápido si no hay nada nuevo)
    },
    configureServer(server) {
      let busy = false, again = false, timer: ReturnType<typeof setTimeout> | undefined;
      const go = async () => {
        if (busy) return void (again = true);
        busy = true;
        do (again = false), await run();
        while (again);
        busy = false;
        server.ws.send({ type: 'custom', event: 'anim-pack-updated', data: {} });
      };
      void go(); // (al arrancar: lo que falte, en segundo plano)
      for (const d of ['../assets-src/animations/player', './public/animations/player'].map((p) => fileURLToPath(new URL(p, import.meta.url))))
        if (existsSync(d)) watch(d, { persistent: false }, (_e, f) => f?.toLowerCase().endsWith('.fbx') && (clearTimeout(timer), (timer = setTimeout(go, 1500))));
    },
  };
};

// los LOD de los modelos (tools/bake_lods.mjs, incremental) se hornean al compilar y al arrancar el servidor de desarrollo; si falla al compilar, falla la compilación
const bakeLods = (): Plugin => {
  const script = fileURLToPath(new URL('../tools/bake_lods.mjs', import.meta.url));
  let build = false;
  const run = () =>
    new Promise<void>((done, fail) =>
      spawn(process.execPath, [script], { stdio: 'inherit' }).on('close', (code) => (code === 0 || !build ? done() : fail(new Error('bake_lods ha fallado')))),
    );
  return {
    name: 'bake-lods',
    configResolved(c) {
      build = c.command === 'build';
    },
    async buildStart() {
      if (build) await run();
    },
    configureServer() {
      void run(); // (al arrancar: lo que falte, en segundo plano)
    },
  };
};

// los paquetes (SETTINGS > STORAGE, src/packs.ts): el manifiesto con los archivos de cada uno se genera al compilar (con los de public/ y los de assets/) y,
// en desarrollo, solo con los de public/. core (todo lo común), phoenyx (el motor, solo en esa variante), la textura HD (aún sin archivos) y uno por nivel
const PACKS: { id: string; name: string; desc: string; auto?: boolean; required?: boolean; soon?: boolean; cover?: string }[] = [
  { id: 'core', name: 'CORE', desc: 'THE MENU, THE LOBBY, ITEMS, COSMETICS AND THE PHOENYX GRAPHICS ENGINE', auto: true, required: true },
  { id: 'hd', name: 'HIGH-RES TEXTURES', desc: 'PROPS AND FURNITURE WITH THEIR ORIGINAL 2K TEXTURES' },
  { id: 'hdmodels', name: 'HIGH-DETAIL MODELS', desc: 'THE ORIGINAL NORMAL MAPS: FABRIC, METAL AND WOOD WITH RELIEF' },
  { id: 'level0', name: 'LEVEL 0 · THE LOBBY', desc: 'THE YELLOW OFFICE MAZE' },
  { id: 'parking', name: 'LEVEL 1 · THE HABITABLE ZONE', desc: 'CONCRETE DECKS AND DARK AISLES' },
  { id: 'poolrooms', name: 'LEVEL 37 · THE POOLROOMS', desc: 'WHITE TILE AND WARM WATER' },
  { id: 'suites', name: 'LEVEL -20 · THE SUITES', desc: 'THE HOTEL: RED WALLPAPER AND NO FACES' },
];
const packOf = (f: string) =>
  f.startsWith('hd/tex') ? 'hd' : f.startsWith('hd/nrm') ? 'hdmodels' : /^assets\/phoenyx/.test(f) ? 'core' : /^assets\/parking/.test(f) || f.startsWith('models/parking/') ? 'parking' : f.startsWith('models/pool/') ? 'poolrooms' : f.startsWith('models/suites/') || f.startsWith('models/backrooms/suites/') ? 'suites' : f.startsWith('models/backrooms/hospital/') ? 'core' : f.startsWith('models/backrooms/') ? 'level0' : 'core';
function packsManifest(dirs: string[]): string {
  const files: string[] = [];
  const walk = (root: string, d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(root, p);
      else files.push(relative(root, p).replaceAll('\\', '/') + '|' + statSync(p).size);
    }
  };
  const seen = new Set<string>();
  const by: Record<string, { files: string[]; bytes: number }> = {};
  for (const d of dirs) walk(d, d);
  for (const entry of files) {
    const [f, size] = entry.split('|');
    // (fuera: la página y el worker, que se piden siempre frescos; los originales .zip y las animaciones FBX sin empaquetar, que el juego no usa; el propio manifiesto)
    if (seen.has(f) || f === 'index.html' || f === 'sw.js' || f.endsWith('.zip') || f.endsWith('.md') || f.startsWith('animations/player/') || f.startsWith('models/packs/')) continue;
    seen.add(f);
    const b = (by[packOf(f)] ??= { files: [], bytes: 0 });
    b.files.push('/' + f);
    b.bytes += Number(size);
  }
  return JSON.stringify({ packs: PACKS.filter((p) => by[p.id] || p.soon).map((p) => ({ ...p, files: by[p.id]?.files ?? [], bytes: by[p.id]?.bytes ?? 0 })) });
}
// el despliegue no lleva los originales: los .zip de modelos fuente de public/ (tools/ los lee de aqui, el juego no) ni los FBX de animaciones sin empaquetar
// (el juego usa animations/player.pack.*; ver animPack). Se quitan de la salida al compilar; public/ no se toca.
const sourceless = (): Plugin => {
  let out = '';
  return {
    name: 'sourceless-dist',
    apply: 'build',
    configResolved(c) {
      out = c.build.outDir;
      if (!out.includes(':') && !out.startsWith('/')) out = join(c.root, out);
    },
    closeBundle() {
      if (!existsSync(join(out, 'index.html'))) return;
      for (const e of readdirSync(out)) if (e.endsWith('.zip')) rmSync(join(out, e));
      rmSync(join(out, 'animations/player'), { recursive: true, force: true });
    },
  };
};
const packs = (): Plugin => {
  let out = '';
  return {
    name: 'packs-manifest',
    configResolved(c) {
      out = c.build.outDir;
      if (!out.includes(':') && !out.startsWith('/')) out = join(c.root, out);
    },
    configureServer(server) {
      server.middlewares.use('/models/packs/manifest.json', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(packsManifest([fileURLToPath(new URL('./public', import.meta.url))]));
      });
    },
    closeBundle() {
      if (!existsSync(join(out, 'index.html'))) return; // (solo al compilar)
      mkdirSync(join(out, 'models/packs'), { recursive: true });
      writeFileSync(join(out, 'models/packs/manifest.json'), packsManifest([out]));
    },
  };
};

// RENDERER=phoenyx: `three` se sustituye por Phoenyx (E:/phoenix, motor Rust + WebGPU con la misma API); sin la variable, three de siempre
const PHOENYX = process.env.RENDERER === 'phoenyx';
const PHOENYX_DIR = (process.env.PHOENYX_DIR ?? 'E:/phoenix').replaceAll('\\', '/');
// `three-real`: el three de verdad, siempre (los iconos del inventario se pintan de forma sincrona con un WebGLRenderer pequeño; el renderer de Phoenyx arranca la GPU de forma asincrona)
const REAL_THREE = fileURLToPath(new URL('../node_modules/three/build/three.module.js', import.meta.url)).replaceAll('\\', '/');
const phoenyxAlias = PHOENYX
  ? [
      { find: /^three\/examples\/jsm\/(.*)$/, replacement: `${PHOENYX_DIR}/packages/phoenyx/src/jsm/$1` },
      { find: /^three$/, replacement: `${PHOENYX_DIR}/packages/phoenyx/src/index.ts` },
    ]
  : [];

// la voz del motor (phoenyx-voice): vive en el repo de Phoenyx (con o sin el renderer Phoenyx)
const VOICE = `${PHOENYX_DIR}/packages/phoenyx-voice/src/index.ts`;

const proxy = {
  '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
  '/status': `http://localhost:${SERVER_PORT}`,
  '/api': `http://localhost:${SERVER_PORT}`,
};

// el juego pregunta por process.env.NODE_ENV (avisos y atajos de desarrollo): se define a mano
export default defineConfig(({ mode }) => ({
  plugins: [react(), gripsSaver(), animPack(), packs(), sourceless(), ...(PHOENYX ? [bakeLods()] : [])],
  cacheDir: PHOENYX ? 'node_modules/.vite-phoenyx' : undefined, // (cada variante con su cache: si no, dos servidores a la vez se pisan las dependencias optimizadas)
  resolve: { alias: [{ find: /^@phoenyx\/voice$/, replacement: VOICE }, { find: /^three-real$/, replacement: REAL_THREE }, { find: /^@phoenyx\/collide$/, replacement: PHOENYX ? `${PHOENYX_DIR}/packages/phoenyx/src/collide.ts` : fileURLToPath(new URL('./src/game/collideStub.ts', import.meta.url)).replaceAll('\\', '/') }, ...phoenyxAlias] },
  define: { __PHOENYX__: JSON.stringify(PHOENYX), 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
  // the game server goes through the same port as the page (one forwarded port or tunnel is enough, no mixed content over https)
  // fs.strict: el servidor de desarrollo (y /@fs) solo sirve archivos del proyecto; no lo desactives mientras haya un túnel abierto
  server: { port: CLIENT_PORT, strictPort: true, host: true, allowedHosts: true, proxy, fs: { strict: true, allow: ['..', PHOENYX_DIR] } },
  preview: { port: CLIENT_PORT, strictPort: true, host: true, allowedHosts: true, proxy },
  build: {
    target: 'es2020',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 1500,
    // el motor (Phoenyx o three) y React cambian poco: en fragmentos propios se quedan en la caché entre versiones del juego
    rollupOptions: {
      output: {
        manualChunks(id) {
          const f = id.replaceAll('\\', '/');
          if (/node_modules\/(react|react-dom|scheduler)\//.test(f)) return 'react';
          if (f.includes('/packages/phoenyx/') || f.includes('/node_modules/three/')) return 'engine';
        },
      },
    },
  },
}));
