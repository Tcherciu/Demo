import { cumulativeDistances, haversine, nearestOnCourse, pathLength, simplify } from '../geo.ts';
import { offset, walk } from './helpers.ts';

describe('geo', () => {
  it('haversine matches local offsets', () => {
    expect(haversine(offset(0, 0), offset(1000, 0))).toBeCloseTo(1000, -1);
    expect(haversine(offset(0, 0), offset(0, 1000))).toBeCloseTo(1000, -1);
  });

  it('measures a 1 km square loop', () => {
    const loop = walk([[0, 0], [250, 0], [250, 250], [0, 250], [0, 0]]);
    expect(pathLength(loop)).toBeCloseTo(1000, -1);
  });

  it('respects the along-course window on self-crossing paths', () => {
    // Out-and-back: the same street is at along≈100 and along≈300.
    const course = walk([[0, 0], [200, 0], [0, 0]]);
    const cum = cumulativeDistances(course);
    const p = offset(100, 3);
    expect(nearestOnCourse(p, course, cum, 0, 150)!.along).toBeCloseTo(100, 0);
    expect(nearestOnCourse(p, course, cum, 250, 400)!.along).toBeCloseTo(300, 0);
  });

  it('simplify drops collinear points and keeps corners', () => {
    const line = walk([[0, 0], [500, 0], [500, 500]], 5);
    const s = simplify(line, 2);
    expect(s).toHaveLength(3);
  });
});
