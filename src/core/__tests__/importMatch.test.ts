import { findCourseAttempts } from '../importMatch.ts';
import { timed, walk } from './helpers.ts';

const SQUARE: [number, number][] = [[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]];
const course = walk(SQUARE, 20);
const T0 = 1_900_000_000_000;

describe('findCourseAttempts', () => {
  it('finds a lap after a warm-up, timed from leaving the start', () => {
    // 300 m warm-up approaching the start from the west, then one lap at 4 m/s.
    const track = timed(walk([[-300, 0], ...SQUARE], 3), 4, T0);
    const found = findCourseAttempts(course, track);
    expect(found).toHaveLength(1);
    // Clock runs from leaving the 20 ft start circle to entering the 50 ft finish circle.
    expect(found[0].elapsedS).toBeGreaterThan(390);
    expect(found[0].elapsedS).toBeLessThanOrEqual(400);
    // 300 m warm-up plus 20 ft to the edge of the start circle, at 4 m/s.
    expect(found[0].startedAt - T0).toBeCloseTo(75_000 + 6096 / 4, -2);
  });

  it('counts each of several laps', () => {
    const laps = [...SQUARE, ...SQUARE.slice(1), ...SQUARE.slice(1)];
    const found = findCourseAttempts(course, timed(walk(laps, 3), 4, T0));
    expect(found).toHaveLength(3);
    expect(found[1].startedAt).toBeGreaterThanOrEqual(found[0].finishedAt);
  });

  it('works with sparse "smart recording" fixes that skip the start circle', () => {
    // A fix every ~25 m: none is guaranteed within 20 ft (6 m) of the start.
    const sparse = timed(walk([[-310, 3], [-10, 3], ...SQUARE.slice(1), [-40, 0]], 25), 3, T0);
    const found = findCourseAttempts(course, sparse);
    expect(found).toHaveLength(1);
  });

  it('finds nothing when the track never reaches the start or cuts the course', () => {
    expect(findCourseAttempts(course, timed(walk([[100, 100], [300, 300]], 3), 3, T0))).toEqual([]);
    expect(findCourseAttempts(course, timed(walk([[0, 0], [400, 0], [0, 0.5]], 3), 3, T0))).toEqual([]);
  });
});
