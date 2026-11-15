import { DEV_LOCAL } from './devGate';
import { createRoot } from 'react-dom/client';
import './game/backrooms.css';
import App from './App';
import { installErrLog } from './errlog';
import Terms from './Terms';
import { initTelemetry } from './telemetry';

initTelemetry(); // (solo con DSN y con el permiso de las condiciones: telemetry.ts)
installErrLog(); // lo primero: los shaders que no compilan y los fallos de carga que vengan después se guardan para la consola de admin (errlog.ts)

// desarrollo: /?anim abre la herramienta de animaciones (árbol, bailes, variantes, IK; dev/AnimTool.tsx)
if (DEV_LOCAL && new URLSearchParams(location.search).has('anim')) {
  import('./dev/AnimTool').then(({ default: AnimTool }) => createRoot(document.getElementById('root')!).render(<AnimTool />));
} else if (DEV_LOCAL && new URLSearchParams(location.search).has('mapviewer')) {
  // desarrollo: /?mapviewer&seed=N&level=level0|suites|poolrooms[&floor=N] dibuja el mapa de `shared` en 2D (dev/MapViewer.ts)
  import('./dev/MapViewer');
} else createRoot(document.getElementById('root')!).render(
  <Terms>
    <App />
  </Terms>,
);
