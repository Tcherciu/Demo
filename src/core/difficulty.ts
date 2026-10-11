import { haversine, type TrackPoint } from './geo';
import { metersToFeet, metersToMiles } from './units';

/**
 * Grade-adjusted effort, built on Minetti et al. (2002), "Energy cost of walking and
 * running at extreme uphill and downhill slopes". Cost of running in J/kg/m at grade i
 * (rise/run, so 0.1 = 10%):
 *
 *   C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6
 *
 * C(i)/C(0) is how many flat meters one meter at grade i "costs". Raw Minetti says a
 * moderate downhill is ~40% cheaper, but runners can't turn all of that into speed
 * (braking, footing), so the downhill benefit is capped — the same compromise
 * grade-adjusted pace models make in practice.
 */
const FLAT_COST = 3.6;
const MAX_GRADE = 0.45; // Minetti's measured range
const MIN_FACTOR = 0.88; // cap downhill benefit at 12%

export function minettiCost(grade: number): number {
  const i = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Multiplier from real distance to flat-equivalent distance at a given grade. */
export function gradeFactor(grade: number): number {
  return Math.max(MIN_FACTOR, minettiCost(grade) / FLAT_COST);
}

export interface RouteProfile {
  distanceM: number;
  elevationGainM: number;
  elevationLossM: number;
  /** Flat distance that takes the same effort as this route. */
  equivalentFlatM: number;
}

/**
 * GPS altitude is noisy (±5–10 m), and summing raw deltas wildly overstates climbing.
 * Smooth with a distance-based moving average, then only count climbs once they
 * exceed a small hysteresis threshold.
 */
export function smoothElevations(points: readonly TrackPoint[], windowM = 60): number[] {
  const n = points.length;
  const eles = points.map((p) => p.ele ?? NaN);
  const along = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) along[i] = along[i - 1] + haversine(points[i - 1], points[i]);
  const out = new Array<number>(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    while (hi < n && along[hi] - along[i] <= windowM / 2) {
      if (!Number.isNaN(eles[hi])) { sum += eles[hi]; count++; }
      hi++;
    }
    while (along[i] - along[lo] > windowM / 2) {
      if (!Number.isNaN(eles[lo])) { sum -= eles[lo]; count--; }
      lo++;
    }
    out[i] = count > 0 ? sum / count : NaN;
  }
  return out;
}

export function profileRoute(points: readonly TrackPoint[], hysteresisM = 2): RouteProfile {
  const smoothed = smoothElevations(points);
  const hasElevation = smoothed.some((e) => !Number.isNaN(e));
  let distanceM = 0;
  let equivalentFlatM = 0;
  let gain = 0;
  let loss = 0;
  let anchor = hasElevation ? smoothed.find((e) => !Number.isNaN(e))! : 0;

  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1], points[i]);
    distanceM += d;
    const e0 = smoothed[i - 1];
    const e1 = smoothed[i];
    const grade = d > 0 && !Number.isNaN(e0) && !Number.isNaN(e1) ? (e1 - e0) / d : 0;
    equivalentFlatM += d * gradeFactor(grade);
    if (!Number.isNaN(e1)) {
      if (e1 - anchor >= hysteresisM) { gain += e1 - anchor; anchor = e1; }
      else if (anchor - e1 >= hysteresisM) { loss += anchor - e1; anchor = e1; }
    }
  }
  return { distanceM, elevationGainM: gain, elevationLossM: loss, equivalentFlatM };
}

/**
 * Flat-equivalent distance when only totals are known (e.g. a Strava activity summary).
 * Assumes a loop: the climb and descent are spread evenly over half the distance each.
 */
export function equivalentFlatFromTotals(distanceM: number, gainM: number, lossM = gainM): number {
  if (distanceM <= 0) return 0;
  const half = distanceM / 2;
  const up = half * gradeFactor(gainM / half);
  const down = half * gradeFactor(-lossM / half);
  return up + down;
}

/**
 * Difficulty on a 1–10 scale, from flat-equivalent miles on a log curve:
 * a flat 5K ≈ 3.5, a flat 10 mi ≈ 6.8, a flat marathon = 10. Climbing raises the
 * score because it raises the flat-equivalent distance.
 */
const MARATHON_MI = 26.2;
export function difficultyScore(equivalentFlatM: number): number {
  const mi = metersToMiles(equivalentFlatM);
  const raw = (10 * Math.log1p(mi / 2)) / Math.log1p(MARATHON_MI / 2);
  return Math.round(Math.max(1, Math.min(10, raw)) * 10) / 10;
}

export type DifficultyLabel = 'Easy' | 'Moderate' | 'Hard' | 'Very hard' | 'Extreme';

export function difficultyLabel(score: number): DifficultyLabel {
  if (score < 3) return 'Easy';
  if (score < 5) return 'Moderate';
  if (score < 7) return 'Hard';
  if (score < 8.5) return 'Very hard';
  return 'Extreme';
}

/** Feet of climbing per mile — shown alongside the score so "hilly" is visible at a glance. */
export function climbDensityFtPerMile(p: Pick<RouteProfile, 'distanceM' | 'elevationGainM'>): number {
  const mi = metersToMiles(p.distanceM);
  return mi > 0 ? metersToFeet(p.elevationGainM) / mi : 0;
}
