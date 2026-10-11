export interface LatLng {
  lat: number;
  lng: number;
}

export interface TrackPoint extends LatLng {
  /** Elevation in meters, if known. */
  ele?: number | null;
  /** Unix epoch milliseconds. */
  t?: number;
  /** Horizontal accuracy radius in meters, as reported by the device. */
  acc?: number | null;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a polyline in meters. */
export function pathLength(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return total;
}

/** cumulative[i] = distance in meters from points[0] to points[i] along the path. */
export function cumulativeDistances(points: readonly LatLng[]): number[] {
  const out = new Array<number>(points.length);
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += haversine(points[i - 1], points[i]);
    out[i] = total;
  }
  return out;
}

/**
 * Projects `p` onto segment a→b using a local flat-earth approximation, which is
 * accurate to well under a meter at running-route scales.
 * Returns the distance to the segment and the fraction t ∈ [0,1] along it.
 */
export function projectOntoSegment(p: LatLng, a: LatLng, b: LatLng): { distance: number; t: number } {
  const mPerDegLat = 111_132.954;
  const mPerDegLng = mPerDegLat * Math.cos(toRad(p.lat));
  const ax = (a.lng - p.lng) * mPerDegLng;
  const ay = (a.lat - p.lat) * mPerDegLat;
  const bx = (b.lng - p.lng) * mPerDegLng;
  const by = (b.lat - p.lat) * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : -(ax * dx + ay * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { distance: Math.hypot(cx, cy), t };
}

export interface CourseMatch {
  /** Distance in meters from the point to the course. */
  distance: number;
  /** How far along the course (meters from start) the nearest point lies. */
  along: number;
}

/**
 * Finds the nearest point on the course to `p`, considering only the part of the
 * course between `fromAlong` and `toAlong` meters. Restricting the window is what
 * keeps self-crossing loops and out-and-backs from matching the wrong section.
 */
export function nearestOnCourse(
  p: LatLng,
  course: readonly LatLng[],
  cumulative: readonly number[],
  fromAlong = 0,
  toAlong = Infinity,
): CourseMatch | null {
  let best: CourseMatch | null = null;
  for (let i = 1; i < course.length; i++) {
    const segStart = cumulative[i - 1];
    const segEnd = cumulative[i];
    if (segEnd < fromAlong || segStart > toAlong) continue;
    const { distance, t } = projectOntoSegment(p, course[i - 1], course[i]);
    const along = segStart + t * (segEnd - segStart);
    if (along < fromAlong || along > toAlong) {
      // The perpendicular foot is outside the window; clamp to the window edge.
      const edge = along < fromAlong ? fromAlong : toAlong;
      const pt = pointAtAlong(course, cumulative, edge);
      const d = haversine(p, pt);
      if (!best || d < best.distance) best = { distance: d, along: edge };
      continue;
    }
    if (!best || distance < best.distance) best = { distance, along };
  }
  if (!best && course.length === 1) best = { distance: haversine(p, course[0]), along: 0 };
  return best;
}

/** The point `along` meters from the start of the course. */
export function pointAtAlong(course: readonly LatLng[], cumulative: readonly number[], along: number): LatLng {
  if (along <= 0) return course[0];
  for (let i = 1; i < course.length; i++) {
    if (cumulative[i] >= along) {
      const span = cumulative[i] - cumulative[i - 1];
      const t = span === 0 ? 0 : (along - cumulative[i - 1]) / span;
      return {
        lat: course[i - 1].lat + t * (course[i].lat - course[i - 1].lat),
        lng: course[i - 1].lng + t * (course[i].lng - course[i - 1].lng),
      };
    }
  }
  return course[course.length - 1];
}

/** Douglas–Peucker simplification with a tolerance in meters. Keeps elevation on kept points. */
export function simplify<T extends LatLng>(points: readonly T[], toleranceM: number): T[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxDist = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = projectOntoSegment(points[i], points[first], points[last]).distance;
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceM) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

export function boundingBox(points: readonly LatLng[]) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return { minLat, maxLat, minLng, maxLng };
}
