import { DEV_LOCAL } from './devGate';

import { createRoot } from 'react-dom/client';

import './game/backrooms.css';

import App from './App';

import { installErrLog } from './errlog';

import Terms from './Terms';
import GpuNotice from './GpuNotice';

import { initTelemetry } from './telemetry';

import { installCapture } from './dev/capture';
import { autoInstall, registerWorker } from './packs';
import './hd'; // (los packs de alta definicion se enganchan a GLTFLoader: src/hd.ts)



installCapture(); // (solo desarrollo local con /?capture: reloj y semilla congelados, dev/capture.ts)

initTelemetry(); // (solo con DSN y con el permiso de las condiciones: telemetry.ts)

registerWorker(); // (producción: el service worker sirve desde el disco lo que se instaló en SETTINGS > STORAGE; src/packs.ts)

setTimeout(() => void autoInstall(), 20000); // (los paquetes automáticos —core y phoenyx— se guardan en segundo plano, ya con el juego abierto)

installErrLog(); // los shaders que no compilan y los fallos de carga que vengan después se guardan para la consola de admin (errlog.ts)



const root = createRoot(document.getElementById('root')!);

// HMR: al recargar este módulo se desmonta el árbol de React; la limpieza de Backrooms.tsx (BackroomsGame.dispose: rAF, listeners, sala,
// composer, geometrías/materiales/texturas y forceContextLoss) y la del socket (useNet) ya cuelgan del desmontaje, así que no hace falta más
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());

// desarrollo: /?anim abre la herramienta de animaciones (árbol, bailes, variantes, IK; dev/AnimTool.tsx)
if (DEV_LOCAL && new URLSearchParams(location.search).has('anim')) {
  import('./dev/AnimTool').then(({ default: AnimTool }) => root.render(<AnimTool />));
} else if (DEV_LOCAL && new URLSearchParams(location.search).has('mapviewer')) {
  // desarrollo: /?mapviewer&seed=N&level=level0|suites|poolrooms[&floor=N] dibuja el mapa de `shared` en 2D (dev/MapViewer.ts)
  import('./dev/MapViewer');
} else root.render(
  <GpuNotice>
    <Terms>
      <App />
    </Terms>
  </GpuNotice>,
);
