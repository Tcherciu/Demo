import type { LatLng, TrackPoint } from '../geo.ts';

export const BASE: LatLng = { lat: 40.0, lng: -105.0 };
const M_PER_DEG_LAT = 111_132.954;

/** Point offset from `base` by dx meters east and dy meters north. */
export function offset(dx: number, dy: number, base: LatLng = BASE): LatLng {
  return {
    lat: base.lat + dy / M_PER_DEG_LAT,
    lng: base.lng + dx / (M_PER_DEG_LAT * Math.cos((base.lat * Math.PI) / 180)),
  };
}

/** Densifies a polyline given in local meters into points every `stepM` meters. */
export function walk(cornersM: [number, number][], stepM = 5): LatLng[] {
  const out: LatLng[] = [offset(...cornersM[0])];
  for (let i = 1; i < cornersM.length; i++) {
    const [x0, y0] = cornersM[i - 1];
    const [x1, y1] = cornersM[i];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / stepM));
    for (let k = 1; k <= n; k++) out.push(offset(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n));
  }
  return out;
}

/** Stamps points as a run at a constant pace (meters per second). */
export function timed(points: LatLng[], speed = 3, t0 = 1_000_000, acc = 5): TrackPoint[] {
  const out: TrackPoint[] = [];
  let t = t0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const dx = (points[i].lng - points[i - 1].lng) * M_PER_DEG_LAT * Math.cos((BASE.lat * Math.PI) / 180);
      const dy = (points[i].lat - points[i - 1].lat) * M_PER_DEG_LAT;
      t += (Math.hypot(dx, dy) / speed) * 1000;
    }
    out.push({ ...points[i], t: Math.round(t), acc });
  }
  return out;
}
