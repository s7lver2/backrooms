/*
 * El vuelo de un objeto lanzado (granada, pokeball): una parábola con rebotes en el suelo, el techo y las paredes. Lo calcula el servidor (lo que pasa
 * de verdad) y el cliente (el arco que se ve mientras se mantiene pulsado): la misma función, así lo que se ve es lo que ocurre.
 */
export interface Flight {
  /** Los puntos del vuelo (x, y, z, x, y, z…), uno cada FLIGHT_DT segundos. */
  pts: number[];
  /** Dónde se queda. */
  end: [number, number, number];
  /** Dónde rebota. */
  bounces: [number, number, number][];
}
export const FLIGHT_DT = 0.04;
/** `solid(x, z)`: hay pared. `from`: la mano (x, y, z); `yaw` y `pitch`, hacia donde se mira (pitch > 0: arriba); `speed`: m/s al salir. */
export function flight(solid: (x: number, z: number) => boolean, from: [number, number, number], yaw: number, pitch: number, speed = 11, ceil = 2.9): Flight {
  const g = 9.8, cp = Math.cos(pitch);
  let [x, y, z] = from;
  let vx = -Math.sin(yaw) * cp * speed, vy = Math.sin(pitch) * speed + 1.5, vz = -Math.cos(yaw) * cp * speed;
  const pts = [x, y, z], bounces: [number, number, number][] = [];
  for (let i = 0; i < 100; i++) {
    vy -= g * FLIGHT_DT;
    let nx = x + vx * FLIGHT_DT, nz = z + vz * FLIGHT_DT, ny = y + vy * FLIGHT_DT;
    if (solid(nx, z)) (vx = -vx * 0.5), (nx = x);
    if (solid(nx, nz)) (vz = -vz * 0.5), (nz = z);
    if (ny > ceil) (ny = ceil), (vy = -vy * 0.3);
    if (ny < 0.12) {
      ny = 0.12;
      if (Math.abs(vy) < 2.2) vy = 0;
      else bounces.push([nx, ny, nz]), (vy = -vy * 0.45);
      (vx *= 0.6), (vz *= 0.6);
    }
    (x = nx), (y = ny), (z = nz);
    pts.push(x, y, z);
    if (y <= 0.12 && vy === 0 && Math.hypot(vx, vz) < 0.7) break;
  }
  return { pts, end: [x, y, z], bounces };
}
