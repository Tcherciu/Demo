import { CourseTracker } from './courseTracker.ts';
import { projectOntoSegment, type LatLng, type TrackPoint } from './geo.ts';
import { START_RADIUS_M } from './rules.ts';

/**
 * Finds course attempts inside a track recorded elsewhere (a watch, Strava, a GPX file).
 *
 * Unlike a run started in the app, an imported track wasn't started at the course start:
 * the runner may have warmed up first, run several laps, or recorded with "smart"
 * sampling (a fix every few seconds) that never lands inside the 20 ft start circle.
 * So instead of requiring a fix at the start, look for every moment the track *passes*
 * within 20 ft of it — interpolating between fixes — and replay the course rules from
 * there. Uses the same CourseTracker as live runs, so the 0.2 mi / rejoin rules apply.
 */
export interface FoundAttempt {
  elapsedS: number;
  startedAt: number;
  finishedAt: number;
  pauseCount: number;
}

interface StartCrossing {
  point: TrackPoint;
  /** Index of the first real fix after the crossing. */
  nextIndex: number;
}

/**
 * Crossings of the start circle. Consecutive segments inside the circle are one visit;
 * the attempt starts when the runner leaves it (the last crossing of the visit), the
 * same way a stopwatch is started when you set off rather than when you arrive.
 */
function startCrossings(start: LatLng, points: readonly TrackPoint[]): StartCrossing[] {
  const out: StartCrossing[] = [];
  let lastHitSegment = -2;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const { distance, t } = projectOntoSegment(start, a, b);
    if (distance > START_RADIUS_M) continue;
    const crossing: StartCrossing = {
      point: {
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
        ele: a.ele != null && b.ele != null ? a.ele + t * (b.ele - a.ele) : (a.ele ?? null),
        acc: Math.max(a.acc ?? 0, b.acc ?? 0) || null,
        t: Math.round(a.t! + t * (b.t! - a.t!)),
      },
      nextIndex: i + 1,
    };
    if (i === lastHitSegment + 1 && out.length) out[out.length - 1] = crossing;
    else out.push(crossing);
    lastHitSegment = i;
  }
  return out;
}

/** All non-overlapping valid attempts in the track, in order. Assumes validateTrack passed. */
export function findCourseAttempts(course: readonly LatLng[], points: readonly TrackPoint[]): FoundAttempt[] {
  const found: FoundAttempt[] = [];
  let notBefore = -Infinity;
  for (const c of startCrossings(course[0], points)) {
    if (c.point.t! < notBefore) continue;
    const tracker = new CourseTracker(course);
    if (!tracker.begin(c.point)) continue;
    let done: FoundAttempt | null = null;
    for (let i = c.nextIndex; i < points.length && !done; i++) {
      // Skip the sliver of segment between the crossing and the next fix.
      if (points[i].t! <= c.point.t!) continue;
      for (const e of tracker.update(points[i])) {
        if (e.type === 'finished') {
          done = { elapsedS: e.elapsedS, startedAt: c.point.t!, finishedAt: e.at, pauseCount: tracker.snapshot().pauseCount };
        }
      }
    }
    if (done) {
      found.push(done);
      notBefore = done.finishedAt;
    }
  }
  return found;
}
