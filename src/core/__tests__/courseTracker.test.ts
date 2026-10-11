import { CourseTracker, type TrackerEvent } from '../courseTracker.ts';
import type { TrackPoint } from '../geo.ts';
import { offset, timed, walk } from './helpers.ts';

// A 1.6 km square loop, counter-clockwise from the origin.
const SQUARE: [number, number][] = [[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]];
const course = walk(SQUARE, 20);

function run(tracker: CourseTracker, pts: TrackPoint[]): TrackerEvent[] {
  const events: TrackerEvent[] = [];
  const started = tracker.begin(pts[0]);
  if (started) events.push(started);
  for (const p of pts.slice(1)) events.push(...tracker.update(p));
  return events;
}

describe('CourseTracker', () => {
  it('only starts within 20 ft of the start point', () => {
    const t = new CourseTracker(course);
    expect(t.canStart(offset(10, 0))).toBe(false); // ~33 ft
    expect(t.begin({ ...offset(10, 0), t: 0 })).toBeNull();
    expect(t.canStart(offset(4, 3))).toBe(true); // 5 m ≈ 16 ft
  });

  it('finishes a clean lap with the elapsed time', () => {
    const t = new CourseTracker(course);
    const events = run(t, timed(walk(SQUARE, 5), 4));
    const finished = events.find((e) => e.type === 'finished');
    expect(finished).toBeDefined();
    expect((finished as { elapsedS: number }).elapsedS).toBeCloseTo(400, -1);
    expect(t.snapshot().pauseCount).toBe(0);
  });

  it('tolerates GPS jitter of a few meters', () => {
    const t = new CourseTracker(course);
    const pts = timed(walk(SQUARE, 5)).map((p, i) => ({ ...p, ...offset(0, i % 2 ? 6 : -6, p), acc: 10 }));
    pts[0] = { ...pts[0], ...offset(0, 0) };
    const events = run(t, pts);
    expect(events.map((e) => e.type)).toEqual(['started', 'finished']);
  });

  it('does not credit a shortcut across the loop', () => {
    const t = new CourseTracker(course);
    // First side, then cut diagonally straight back to the start/finish.
    const events = run(t, timed(walk([[0, 0], [400, 0], [0, 0.5]], 5)));
    expect(events.some((e) => e.type === 'finished')).toBe(false);
    expect(t.snapshot().progressM).toBeLessThan(450);
  });

  it('allows a short detour without pausing', () => {
    const t = new CourseTracker(course);
    const path = walk([[0, 0], [200, 0], [200, 100], [210, 100], [210, 0], ...SQUARE.slice(1)], 5);
    const events = run(t, timed(path));
    expect(events.map((e) => e.type)).toEqual(['started', 'finished']);
  });

  it('pauses after 0.2 mi off course and resumes on returning to where they left', () => {
    const t = new CourseTracker(course);
    // Leave the course at x=200 and run 250 m out (500 m off course in total).
    const path = walk([[0, 0], [200, 0], [200, -250], [200, 0], ...SQUARE.slice(1)], 5);
    const events = run(t, timed(path));
    expect(events.map((e) => e.type)).toEqual(['started', 'paused', 'resumed', 'finished']);
    const paused = events[1] as Extract<TrackerEvent, { type: 'paused' }>;
    expect(paused.offCourseM).toBeGreaterThan(321.8);
    expect(paused.offCourseM).toBeLessThan(335);
    expect(t.snapshot().pauseCount).toBe(1);
  });

  it('keeps the clock running while paused', () => {
    const clean = new CourseTracker(course);
    const cleanEvents = run(clean, timed(walk(SQUARE, 5)));
    const detour = new CourseTracker(course);
    const detourEvents = run(detour, timed(walk([[0, 0], [200, 0], [200, -250], [200, 0], ...SQUARE.slice(1)], 5)));
    const time = (ev: TrackerEvent[]) => (ev.find((e) => e.type === 'finished') as { elapsedS: number }).elapsedS;
    expect(time(detourEvents)).toBeGreaterThan(time(cleanEvents) + 100);
  });

  it('does not resume if the runner rejoins far ahead of where they left', () => {
    const t = new CourseTracker(course);
    // Leave at x=100, go wide, come back onto the course on the third side.
    const path = walk([[0, 0], [100, 0], [100, -300], [600, -300], [600, 300], [400, 300], [200, 400], [0, 400], [0, 250]], 5);
    const events = run(t, timed(path));
    expect(events.map((e) => e.type)).toEqual(['started', 'paused']);
    t.abandon();
    expect(t.snapshot().phase).toBe('abandoned');
  });

  it('ignores very inaccurate fixes', () => {
    const t = new CourseTracker(course);
    t.begin({ ...offset(0, 0), t: 0, acc: 5 });
    expect(t.update({ ...offset(50, 500), t: 1000, acc: 200 })).toEqual([]);
    expect(t.snapshot().offCourseM).toBe(0);
  });
});
