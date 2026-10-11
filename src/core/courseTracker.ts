import { cumulativeDistances, haversine, nearestOnCourse, type LatLng, type TrackPoint } from './geo';
import { FINISH_RADIUS_M, MAX_DEVIATION_M, REJOIN_RADIUS_M, RULES, START_RADIUS_M } from './rules';

export type TrackerPhase = 'awaiting_start' | 'running' | 'paused_off_course' | 'finished' | 'abandoned';

export type TrackerEvent =
  | { type: 'started'; at: number }
  | { type: 'paused'; at: number; offCourseM: number }
  | { type: 'resumed'; at: number }
  | { type: 'finished'; at: number; elapsedS: number };

export interface TrackerSnapshot {
  phase: TrackerPhase;
  startedAt: number | null;
  finishedAt: number | null;
  /** Meters of the course covered, in order. Shortcuts don't count. */
  progressM: number;
  courseLengthM: number;
  /** Distance travelled since last on course; pauses the attempt past the limit. */
  offCourseM: number;
  /** Latest distance from the runner to the expected section of the course. */
  distanceToCourseM: number | null;
  pauseCount: number;
}

/** Points worse than this are still recorded, but not used to judge on/off course. */
const MAX_USABLE_ACCURACY_M = 50;
/** Extra headroom for GPS noise beyond the 20 ft rule, never more than this. */
const MAX_ACCURACY_ALLOWANCE_M = 15;
/** How far ahead of the current progress a fix may land and still count (noise, sparse fixes). */
const FORWARD_SLACK_M = 50;
/** On rejoin, how far behind the pause point the runner may come back onto the course. */
const REJOIN_BACKTRACK_M = 200;

/**
 * Judges one attempt at a course from a stream of GPS fixes.
 *
 * Rules (see RULES):
 *  - The attempt can only start within 20 ft of the course's start point.
 *  - Progress only advances along the course in order, and only by about as much as
 *    the runner actually travelled, so cutting across a loop earns nothing.
 *  - Travelling more than 0.2 mi without being on course pauses the attempt.
 *  - A paused attempt resumes once the runner is back within 20 ft of the course near
 *    where they left it. The clock keeps running while paused — pausing must never
 *    be faster than staying on course.
 *  - It finishes near the end point once ≥97% of the course has been covered.
 *    Stopping while paused (or before finishing) leaves the attempt invalid.
 */
export class CourseTracker {
  private readonly cumulative: number[];
  private readonly lengthM: number;
  private phase: TrackerPhase = 'awaiting_start';
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private progressM = 0;
  private offCourseM = 0;
  private distanceToCourseM: number | null = null;
  private pauseCount = 0;
  private last: TrackPoint | null = null;

  constructor(private readonly course: readonly LatLng[]) {
    if (course.length < 2) throw new Error('A course needs at least two points');
    this.cumulative = cumulativeDistances(course);
    this.lengthM = this.cumulative[this.cumulative.length - 1];
  }

  get start(): LatLng {
    return this.course[0];
  }

  distanceToStartM(p: LatLng): number {
    return haversine(p, this.course[0]);
  }

  canStart(p: LatLng): boolean {
    return this.phase === 'awaiting_start' && this.distanceToStartM(p) <= START_RADIUS_M;
  }

  /** Begins the attempt. Returns null (and stays idle) if the runner isn't at the start. */
  begin(p: TrackPoint): TrackerEvent | null {
    if (!this.canStart(p)) return null;
    const at = p.t ?? Date.now();
    this.phase = 'running';
    this.startedAt = at;
    this.last = p;
    this.distanceToCourseM = this.distanceToStartM(p);
    return { type: 'started', at };
  }

  update(p: TrackPoint): TrackerEvent[] {
    if (this.phase !== 'running' && this.phase !== 'paused_off_course') return [];
    const last = this.last!;
    const at = p.t ?? Date.now();
    if (last.t != null && p.t != null && p.t <= last.t) return [];
    const travelled = haversine(last, p);
    this.last = p;
    if (p.acc != null && p.acc > MAX_USABLE_ACCURACY_M) return [];

    const tolerance = REJOIN_RADIUS_M + Math.min(p.acc ?? 0, MAX_ACCURACY_ALLOWANCE_M);
    const events: TrackerEvent[] = [];

    if (this.phase === 'running') {
      const match = nearestOnCourse(
        p,
        this.course,
        this.cumulative,
        Math.max(0, this.progressM - FORWARD_SLACK_M),
        this.progressM + this.offCourseM + travelled + FORWARD_SLACK_M,
      );
      this.distanceToCourseM = match?.distance ?? null;
      if (match && match.distance <= tolerance) {
        this.offCourseM = 0;
        this.progressM = Math.max(this.progressM, match.along);
      } else {
        this.offCourseM += travelled;
        if (this.offCourseM > MAX_DEVIATION_M) {
          this.phase = 'paused_off_course';
          this.pauseCount++;
          events.push({ type: 'paused', at, offCourseM: this.offCourseM });
        }
      }
    } else {
      const match = nearestOnCourse(
        p,
        this.course,
        this.cumulative,
        Math.max(0, this.progressM - REJOIN_BACKTRACK_M),
        this.progressM + FORWARD_SLACK_M,
      );
      this.distanceToCourseM = match?.distance ?? null;
      if (match && match.distance <= tolerance) {
        this.phase = 'running';
        this.offCourseM = 0;
        this.progressM = Math.max(this.progressM, match.along);
        events.push({ type: 'resumed', at });
      }
    }

    if (
      this.phase === 'running' &&
      this.progressM >= this.lengthM * RULES.finishMinProgress &&
      haversine(p, this.course[this.course.length - 1]) <= FINISH_RADIUS_M
    ) {
      this.phase = 'finished';
      this.finishedAt = at;
      events.push({ type: 'finished', at, elapsedS: (at - this.startedAt!) / 1000 });
    }
    return events;
  }

  /** Runner stopped before finishing. The attempt won't count for this course. */
  abandon(): void {
    if (this.phase !== 'finished') this.phase = 'abandoned';
  }

  snapshot(): TrackerSnapshot {
    return {
      phase: this.phase,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      progressM: this.progressM,
      courseLengthM: this.lengthM,
      offCourseM: this.offCourseM,
      distanceToCourseM: this.distanceToCourseM,
      pauseCount: this.pauseCount,
    };
  }
}
