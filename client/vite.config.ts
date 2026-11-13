import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_PORT = Number(process.env.SERVER_PORT) || 5181; // (SERVER_PORT: otro puerto para pruebas)
const CLIENT_PORT = 5180; // el mismo que shared/src/index.ts (la config no puede importar .ts del workspace)

// solo en desarrollo: la herramienta de agarres (/?grips) guarda aquí lo que ajusta
// (POST /__grips?file=grips|pieces: agarres de las manos o medidas de los accesorios)
const SAVEABLE: Record<string, string> = { grips: 'grips.json', pieces: 'pieces.json', worn: 'worn.json', tree: 'anim/tree.json', variants: 'anim/variants.json', dances: 'anim/dances.json', manifest: 'anim/manifest.json' };
const gripsSaver = (): Plugin => ({
  name: 'grips-saver',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__grips', (req, res) => {
      // solo desde esta máquina: por un túnel (devtunnels añade x-forwarded-* y el Host es otro) cualquiera podría reescribir estos archivos
      const host = String(req.headers.host ?? '').replace(/:\d+$/, '');
      if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || !['localhost', '127.0.0.1', '[::1]'].includes(host)) return (res.statusCode = 403), res.end();
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

const proxy = {
  '/socket.io': { target: `http://localhost:${SERVER_PORT}`, ws: true },
  '/status': `http://localhost:${SERVER_PORT}`,
  '/api': `http://localhost:${SERVER_PORT}`,
};

// el juego pregunta por process.env.NODE_ENV (avisos y atajos de desarrollo): se define a mano
export default defineConfig(({ mode }) => ({
  plugins: [react(), gripsSaver(), animPack()],
  define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development') },
  // the game server goes through the same port as the page (one forwarded port or tunnel is enough, no mixed content over https)
  // fs.strict: el servidor de desarrollo (y /@fs) solo sirve archivos del proyecto; no lo desactives mientras haya un túnel abierto
  server: { port: CLIENT_PORT, strictPort: true, host: true, allowedHosts: true, proxy, fs: { strict: true } },
  preview: { port: CLIENT_PORT, strictPort: true, host: true, allowedHosts: true, proxy },
  build: { target: 'es2020', sourcemap: false, minify: 'esbuild', chunkSizeWarningLimit: 1500 },
}));
