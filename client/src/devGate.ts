/*
 * Atajos y asas de depuración (window.__*, ?god, ?seed, ?pool...): solo con el servidor de desarrollo de Vite Y abierto desde esta misma máquina.
 * `import.meta.env.DEV` solo no basta: un túnel (devtunnels) delante de `vite dev` también sirve el cliente en modo DEV, y desde fuera
 * no es localhost. En una build de producción (`vite build` / `preview`) DEV es false y todo esto desaparece.
 * Nota: nada de esto es una barrera de seguridad (el cliente es del jugador); la autoridad está en el servidor.
 */
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
export const DEV_LOCAL: boolean = import.meta.env.DEV && typeof location !== 'undefined' && LOCAL.has(location.hostname);

export const DEV_PARKING = DEV_LOCAL || (import.meta.env.DEV && import.meta.env.VITE_PARKING_PREVIEW === '1');
