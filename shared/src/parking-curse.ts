export function parkingCurseTier(count: number) {
  if (count >= 8) return 2;
  if (count >= 3) return 1;
  return 0;
}
