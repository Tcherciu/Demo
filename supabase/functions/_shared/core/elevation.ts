import { cumulativeDistances, pointAtAlong, type LatLng, type TrackPoint } from './geo.ts';

/** Evenly spaced points along a path (endpoints included), for elevation lookups. */
export function resample(path: readonly LatLng[], stepM: number): LatLng[] {
  if (path.length < 2) return path.slice();
  const cum = cumulativeDistances(path);
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.ceil(total / stepM));
  const out: LatLng[] = [];
  for (let i = 0; i <= n; i++) out.push(pointAtAlong(path, cum, (total * i) / n));
  return out;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Terrain elevation from a digital elevation model, via Open-Meteo's elevation API
 * (Copernicus GLO-90). GPS altitude drifts by 5–10 m; a DEM doesn't, so every route
 * gets a consistent climb figure no matter whose phone recorded it.
 *
 * Open-Meteo's free API is for non-commercial use; set ELEVATION_API_URL to a
 * self-hosted instance or paid endpoint with the same interface for production.
 */
export async function fetchDemElevations(
  points: readonly LatLng[],
  fetchFn: FetchLike,
  baseUrl = 'https://api.open-meteo.com/v1/elevation',
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 100) {
    const batch = points.slice(i, i + 100);
    const lat = batch.map((p) => p.lat.toFixed(5)).join(',');
    const lng = batch.map((p) => p.lng.toFixed(5)).join(',');
    const res = await fetchFn(`${baseUrl}?latitude=${lat}&longitude=${lng}`);
    if (!res.ok) throw new Error(`Elevation lookup failed (${res.status})`);
    const body = (await res.json()) as { elevation?: unknown };
    if (!Array.isArray(body.elevation) || body.elevation.length !== batch.length) {
      throw new Error('Elevation lookup returned an unexpected response');
    }
    out.push(...body.elevation.map(Number));
  }
  return out;
}

/** The path resampled every `stepM` meters with DEM elevations, ready for profileRoute(). */
export async function demProfilePath(path: readonly LatLng[], fetchFn: FetchLike, baseUrl?: string, stepM = 25): Promise<TrackPoint[]> {
  const pts = resample(path, stepM);
  const eles = await fetchDemElevations(pts, fetchFn, baseUrl);
  return pts.map((p, i) => ({ ...p, ele: eles[i] }));
}
