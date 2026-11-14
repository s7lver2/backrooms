interface Point {
  x: number;
  y: number;
  z: number;
}

/** Entity yaw faces positive Z at zero. The caller selects the distance used for alignment. */
export function faces(dx: number, dz: number, yaw: number, distance: number, minimumAlignment: number) {
  return Math.sin(yaw) * dx + Math.cos(yaw) * dz > distance * minimumAlignment;
}

/** Beam direction is normalized. Ray occlusion belongs to the terrain adapter. */
export function beamReaches(
  from: Point,
  to: Point,
  direction: Point | null,
  maximumDistance: number,
  minimumAlignment: number,
  alignmentFloor = 0,
  minimumDistance = 1e-6,
) {
  if (!direction) return false;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  return distance >= minimumDistance && distance < maximumDistance
    && direction.x * dx + direction.y * dy + direction.z * dz > Math.max(alignmentFloor, distance) * minimumAlignment;
}

export function withinHearingRange(distance: number, radius: number, hearing: number, minimumDistance = -1) {
  return distance > minimumDistance && distance < radius * hearing;
}
