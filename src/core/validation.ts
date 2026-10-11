import { haversine, type TrackPoint } from './geo.ts';

/**
 * Plausibility checks on a recorded GPS track, run on the server before a time is
 * accepted. They're aimed at the cheap cheats — riding a bike, driving a stretch,
 * spoofing GPS, hand-editing a track — while tolerating normal GPS noise.
 */
export type TrackIssueCode =
  | 'too_few_points'
  | 'bad_timestamps'
  | 'future_timestamps'
  | 'mock_location'
  | 'teleport'
  | 'too_fast';

export interface TrackIssue {
  code: TrackIssueCode;
  message: string;
}

export const VALIDATION = {
  minPoints: 10,
  /** Faster than any human sprints (Bolt's peak was ~12.4 m/s). */
  teleportSpeedMps: 12.5,
  /** Jumps shorter than this are ordinary GPS wobble, whatever their speed. */
  teleportMinJumpM: 25,
  /** Distance covered at teleport speed before the track is rejected: this much, or this fraction of the run. */
  maxTeleportM: 200,
  maxTeleportFraction: 0.02,
  /** Sustained-speed check: no rolling window of this length may average more than... */
  windowS: 60,
  /** ...this speed. 8 m/s ≈ 3:21 /mi held for a full minute — beyond recreational runners, with headroom for elites. */
  maxWindowSpeedMps: 8,
  /** Thin fixes to at least this far apart in time before the window check, so GPS jitter doesn't add distance. */
  windowSampleS: 10,
  /** Fixes worse than this are ignored by the speed checks. */
  maxAccuracyM: 50,
  clockSkewMs: 5 * 60_000,
};

export function validateTrack(points: readonly TrackPoint[], now = Date.now()): TrackIssue[] {
  const issues: TrackIssue[] = [];
  if (points.length < VALIDATION.minPoints) {
    return [{ code: 'too_few_points', message: 'Not enough GPS data was recorded.' }];
  }
  for (let i = 0; i < points.length; i++) {
    const t = points[i].t;
    if (t == null || !Number.isFinite(t) || (i > 0 && t <= points[i - 1].t!)) {
      return [{ code: 'bad_timestamps', message: 'The GPS track has missing or out-of-order timestamps.' }];
    }
  }
  if (points[points.length - 1].t! > now + VALIDATION.clockSkewMs) {
    issues.push({ code: 'future_timestamps', message: 'The GPS track is dated in the future.' });
  }
  if (points.some((p) => p.mocked)) {
    issues.push({ code: 'mock_location', message: 'A mock-location app was active during this run.' });
  }

  const good = points.filter((p) => (p.acc ?? 0) <= VALIDATION.maxAccuracyM);
  let totalM = 0;
  let teleportM = 0;
  for (let i = 1; i < good.length; i++) {
    const d = haversine(good[i - 1], good[i]);
    const dt = (good[i].t! - good[i - 1].t!) / 1000;
    totalM += d;
    if (d > VALIDATION.teleportMinJumpM && d / dt > VALIDATION.teleportSpeedMps) teleportM += d;
  }
  if (teleportM > Math.max(VALIDATION.maxTeleportM, totalM * VALIDATION.maxTeleportFraction)) {
    issues.push({ code: 'teleport', message: `The GPS jumped ${Math.round(teleportM)} m faster than anyone can run.` });
  }

  // Rolling window over time: catches a few minutes on a bike or in a car.
  const thin: TrackPoint[] = [];
  for (const p of good) {
    if (!thin.length || p.t! - thin[thin.length - 1].t! >= VALIDATION.windowSampleS * 1000) thin.push(p);
  }
  const cum = [0];
  for (let i = 1; i < thin.length; i++) cum.push(cum[i - 1] + haversine(thin[i - 1], thin[i]));
  let lo = 0;
  for (let hi = 1; hi < thin.length; hi++) {
    while (lo + 1 < hi && thin[hi].t! - thin[lo + 1].t! >= VALIDATION.windowS * 1000) lo++;
    const dt = (thin[hi].t! - thin[lo].t!) / 1000;
    if (dt >= VALIDATION.windowS && (cum[hi] - cum[lo]) / dt > VALIDATION.maxWindowSpeedMps) {
      issues.push({ code: 'too_fast', message: 'Part of this run was faster than running pace (bike or car?).' });
      break;
    }
  }
  return issues;
}
