import { DEV_LOCAL } from './devGate';
import { createRoot } from 'react-dom/client';
import './game/backrooms.css';
import App from './App';
import { installErrLog } from './errlog';

installErrLog(); // lo primero: los shaders que no compilan y los fallos de carga que vengan después se guardan para la consola de admin (errlog.ts)

// desarrollo: /?anim abre la herramienta de animaciones (árbol, bailes, variantes, IK; dev/AnimTool.tsx)
if (DEV_LOCAL && new URLSearchParams(location.search).has('anim')) {
  import('./dev/AnimTool').then(({ default: AnimTool }) => createRoot(document.getElementById('root')!).render(<AnimTool />));
} else createRoot(document.getElementById('root')!).render(<App />);
