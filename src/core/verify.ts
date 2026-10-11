import { CourseTracker } from './courseTracker.ts';
import { difficultyScore, profileRoute, type RouteProfile } from './difficulty.ts';
import { simplify, type LatLng, type TrackPoint } from './geo.ts';
import { isLongEnoughToSave, RULES } from './rules.ts';
import { validateTrack, type TrackIssue } from './validation.ts';

/**
 * Server-side checks. The phone decides on/off course live so it can warn the runner,
 * but the result only counts if the server, replaying the same GPS track through the
 * same rules, agrees.
 */
export type Verdict<T> = ({ ok: true } & T) | { ok: false; reason: string; issues?: TrackIssue[] };

/** GPS fixes worse than this are left out of route geometry and distance. */
export const ROUTE_MAX_ACCURACY_M = 25;
/** Route geometry is simplified to this tolerance before it's stored. */
export const ROUTE_SIMPLIFY_M = 3;

export function verifyAttempt(
  course: readonly LatLng[],
  points: readonly TrackPoint[],
  now = Date.now(),
): Verdict<{ elapsedS: number; finishedAt: number; pauseCount: number }> {
  const issues = validateTrack(points, now);
  if (issues.length) return { ok: false, reason: issues[0].message, issues };

  const tracker = new CourseTracker(course);
  if (!tracker.begin(points[0])) {
    return { ok: false, reason: `The run didn't start within ${RULES.startRadiusFt} ft of the course start.` };
  }
  for (const p of points.slice(1)) {
    for (const e of tracker.update(p)) {
      if (e.type === 'finished') {
        return { ok: true, elapsedS: e.elapsedS, finishedAt: e.at, pauseCount: tracker.snapshot().pauseCount };
      }
    }
  }
  const snap = tracker.snapshot();
  return {
    ok: false,
    reason:
      snap.phase === 'paused_off_course'
        ? 'The run ended while off course.'
        : `The run didn't reach the finish (covered ${Math.round((100 * snap.progressM) / snap.courseLengthM)}% of the course).`,
  };
}

export interface BuiltRoute {
  path: TrackPoint[];
  profile: RouteProfile;
  difficulty: number;
  elapsedS: number;
}

/**
 * Turns a free run into a route: validated, measured, simplified. Pass `elevationPath`
 * (DEM-resampled) to score climbing from terrain data instead of GPS altitude.
 */
export function buildRoute(
  points: readonly TrackPoint[],
  opts: { now?: number; elevationPath?: readonly TrackPoint[] } = {},
): Verdict<BuiltRoute> {
  const issues = validateTrack(points, opts.now);
  if (issues.length) return { ok: false, reason: issues[0].message, issues };
  const usable = points.filter((p) => (p.acc ?? 0) <= ROUTE_MAX_ACCURACY_M);
  const gpsProfile = profileRoute(usable);
  if (!isLongEnoughToSave(gpsProfile.distanceM)) {
    return { ok: false, reason: `Routes need to be at least ${RULES.minRouteMiles} miles.` };
  }
  let profile = gpsProfile;
  if (opts.elevationPath) {
    // Keep the GPS distance (it follows the actual line run); take climbing from the DEM.
    const dem = profileRoute(opts.elevationPath);
    const scale = gpsProfile.distanceM / dem.distanceM;
    profile = {
      distanceM: gpsProfile.distanceM,
      elevationGainM: dem.elevationGainM,
      elevationLossM: dem.elevationLossM,
      equivalentFlatM: dem.equivalentFlatM * scale,
    };
  }
  return {
    ok: true,
    path: simplify(usable, ROUTE_SIMPLIFY_M),
    profile,
    difficulty: difficultyScore(profile.equivalentFlatM),
    elapsedS: (points[points.length - 1].t! - points[0].t!) / 1000,
  };
}

/** Compact wire format for tracks: [t, lat, lng, ele, acc, mocked]. */
export type WirePoint = [number, number, number, number | null, number | null, 0 | 1];

export function toWire(points: readonly TrackPoint[]): WirePoint[] {
  return points.map((p) => [
    p.t!,
    Math.round(p.lat * 1e6) / 1e6,
    Math.round(p.lng * 1e6) / 1e6,
    p.ele == null ? null : Math.round(p.ele * 10) / 10,
    p.acc == null ? null : Math.round(p.acc * 10) / 10,
    p.mocked ? 1 : 0,
  ]);
}

export function fromWire(wire: unknown): TrackPoint[] {
  if (!Array.isArray(wire)) throw new Error('points must be an array');
  return wire.map((w) => {
    if (!Array.isArray(w) || w.length < 3) throw new Error('bad point');
    const [t, lat, lng, ele, acc, mocked] = w;
    if (![t, lat, lng].every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Error('bad point');
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('bad point');
    return {
      t,
      lat,
      lng,
      ele: typeof ele === 'number' ? ele : null,
      acc: typeof acc === 'number' ? acc : null,
      mocked: mocked === 1,
    };
  });
}
