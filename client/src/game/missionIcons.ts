import type { MissionKind } from '@backrooms/shared';

/** Iconos de las misiones en una cuadrícula de 64: trazos de SVG (los usan la pizarra del DOM y la de tiza de la sala). */
const dot = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
export const MISSION_ICONS: Record<MissionKind, string> = {
  photos: `M6 20h38v26H6zM44 28l14-8v26l-14-8M10 14h10${dot(25, 33, 7)}`,
  tapes: `M6 14h52v36H6zM14 38h36v12H14zM22 38l-4 12M42 38l4 12${dot(22, 26, 5)}${dot(42, 26, 5)}`,
  survive: 'M16 6h32M16 58h32M18 6c0 16 28 14 28 26S18 42 18 58M46 6c0 16-28 14-28 26s28 10 28 26M26 52h12',
  soaps: `M8 26h48v22H8zM8 26c0-8 10-10 14-5h20c4-5 14-3 14 5M16 38h16${dot(46, 12, 4)}${dot(54, 6, 3)}`,
  power: 'M6 8h40v48H6zM14 16h24v14H14zM14 38h6M26 38h6M14 46h6M26 46h6M46 20h8l-6 12h8l-10 18',
  order: 'M6 40h52M10 40c0-12 10-20 22-20s22 8 22 20M32 14v6M26 14h12M4 48h56',
  contract: 'M14 8h28l8 8v40H14zM22 24h20M22 34h20M22 44h12',
  climb: 'M6 56h12V44h12V32h12V20h12V8M44 8h12v12',
  eeh: 'M12 8h40v36H12zM18 14h28v12H18zM22 52h20M32 44v8M24 34l4-4 4 4 4-4 4 4',
  tvs: 'M6 18h52v34H6zM12 24h32v22H12zM22 18l-8-10M42 18l8-10M50 28v8M50 42v2M16 52v4M48 52v4',
};
