type Point = { x: number; y: number };
export type RasterProfile = {
  kind: string;
  boundary: Point;
  normal: Point;
  expectedPx: number;
  // Actual adjacent body geometry, transformed with its live screen CTM.
  excludedBody?: Point[];
  excludedBodyRadius?: number;
};
type Raster = { width: number; height: number; data: Uint8Array };

function distanceToPolygon(p: Point, polygon: Point[]) {
  if (polygon.length !== 4 || polygon.some((v) => !Number.isFinite(v.x + v.y)))
    throw new Error('Invalid independent body geometry');
  let inside = false;
  let distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!,
      b = polygon[i]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = dx * dx + dy * dy;
    if (!(length > 0)) throw new Error('Degenerate independent body geometry');
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
    distance = Math.min(distance, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return inside ? 0 : distance;
}

export function measureRasterProfile(a: Raster, b: Raster, profile: RasterProfile) {
  const { boundary, normal, expectedPx } = profile;
  if (
    a.width !== b.width ||
    a.height !== b.height ||
    ![boundary.x, boundary.y, normal.x, normal.y, expectedPx].every(Number.isFinite) ||
    expectedPx <= 0 ||
    Math.abs(Math.hypot(normal.x, normal.y) - 1) > 1e-6
  )
    throw new Error('Invalid raster profile');
  if (
    profile.excludedBody &&
    (!Number.isFinite(profile.excludedBodyRadius) || profile.excludedBodyRadius! < 0)
  )
    throw new Error('Invalid actual body paint radius');
  const samples = [];
  const seen = new Set<string>();
  for (let distance = -2; distance <= expectedPx + 3; distance += 0.25) {
    const x = Math.floor(boundary.x + normal.x * distance);
    const y = Math.floor(boundary.y + normal.y * distance);
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (x < 0 || y < 0 || x >= a.width || y >= a.height)
      throw new Error('Raster profile is clipped');
    const center = { x: x + 0.5, y: y + 0.5 };
    const projectedDistance =
      (center.x - boundary.x) * normal.x + (center.y - boundary.y) * normal.y;
    // A whole pixel may contain adjacent body paint even when its centre is clear.
    if (
      projectedDistance > 0 &&
      profile.excludedBody &&
      distanceToPolygon(center, profile.excludedBody) <= profile.excludedBodyRadius! + Math.SQRT1_2
    )
      throw new Error('Ambiguous pin profile intersects adjacent body paint');
    const offset = (y * a.width + x) * 4;
    const original = Array.from(a.data.subarray(offset, offset + 4));
    const selected = Array.from(b.data.subarray(offset, offset + 4));
    if (original.length !== 4 || selected.length !== 4) throw new Error('Incomplete raster pixel');
    const addedBlue =
      original[0]! - selected[0]! > 8 &&
      selected[2]! - selected[0]! > original[2]! - original[0]! + 12 &&
      selected[1]! > selected[0]!;
    samples.push({ distance: projectedDistance, x, y, original, selected, addedBlue });
  }
  samples.sort((a, b) => a.distance - b.distance);
  const exterior = samples.filter((s) => s.distance > 0);
  if (
    exterior.length < 2 ||
    !exterior.some((s) => s.distance <= Math.SQRT2) ||
    exterior.at(-1)!.addedBlue ||
    !exterior.some((s) => s.addedBlue)
  )
    throw new Error('Insufficient independent exterior raster evidence');
  let ended = false;
  for (const sample of exterior) {
    if (!sample.addedBlue) ended = true;
    else if (ended) throw new Error('Disconnected blue paint makes profile ambiguous');
  }
  const blue = exterior.filter((s) => s.addedBlue);
  return {
    ...profile,
    samples,
    exteriorBlue: blue.length,
    lastBlueDistance: blue.at(-1)!.distance,
  };
}
