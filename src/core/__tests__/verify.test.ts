import { buildRoute, fromWire, toWire, verifyAttempt } from '../verify.ts';
import { metersToMiles } from '../units.ts';
import { offset, timed, walk } from './helpers.ts';

const NOW = 2_000_000_000_000;
const SQUARE: [number, number][] = [[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]];
const course = walk(SQUARE, 20);

describe('verifyAttempt', () => {
  it('accepts a clean lap and computes the time server-side', () => {
    const v = verifyAttempt(course, timed(walk(SQUARE, 5), 4, NOW - 3_600_000), NOW);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.elapsedS).toBeCloseTo(400, -1);
  });

  it('rejects a start away from the start point', () => {
    const v = verifyAttempt(course, timed(walk([[0, 30], [0, 0], ...SQUARE.slice(1)], 5), 4, NOW - 3_600_000), NOW);
    expect(v).toMatchObject({ ok: false });
  });

  it('rejects a shortcut', () => {
    const v = verifyAttempt(course, timed(walk([[0, 0], [400, 0], [0, 0.5]], 5), 3, NOW - 3_600_000), NOW);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/off course|didn't reach the finish/);
  });

  it('rejects an implausible track even if it follows the course', () => {
    const v = verifyAttempt(course, timed(walk(SQUARE, 5), 11, NOW - 3_600_000), NOW);
    expect(v).toMatchObject({ ok: false });
  });
});

describe('buildRoute', () => {
  // ~3.1 mi: an out-and-back of 2.5 km each way.
  const track = timed(walk([[0, 0], [2500, 0], [2500, 10], [0, 10]], 4), 3, NOW - 7_200_000);

  it('measures, scores and simplifies a free run', () => {
    const r = buildRoute(track, { now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(metersToMiles(r.profile.distanceM)).toBeGreaterThan(3);
    expect(r.path.length).toBeLessThan(10);
    expect(r.difficulty).toBeGreaterThan(3);
  });

  it('takes climbing from the elevation model when given', () => {
    const hilly = walk([[0, 0], [2500, 0], [2500, 10], [0, 10]], 25).map((p, i, a) => ({
      ...p,
      ele: 1600 + 60 * Math.sin((Math.PI * i) / (a.length - 1)),
    }));
    const flat = buildRoute(track, { now: NOW });
    const withDem = buildRoute(track, { now: NOW, elevationPath: hilly });
    expect(flat.ok && withDem.ok).toBe(true);
    if (!flat.ok || !withDem.ok) return;
    expect(withDem.profile.elevationGainM).toBeGreaterThan(50);
    expect(withDem.profile.distanceM).toBeCloseTo(flat.profile.distanceM);
    expect(withDem.difficulty).toBeGreaterThan(flat.difficulty);
  });

  it('rejects runs under 3 miles', () => {
    const short = timed(walk([[0, 0], [1000, 0]], 4), 3, NOW - 3_600_000);
    expect(buildRoute(short, { now: NOW })).toMatchObject({ ok: false });
  });
});

describe('wire format', () => {
  it('round-trips and rejects junk', () => {
    const pts = [{ ...offset(1, 2), t: 5, ele: 1600.04, acc: 4.44, mocked: true }];
    expect(fromWire(toWire(pts))[0]).toMatchObject({ t: 5, ele: 1600, acc: 4.4, mocked: true });
    expect(() => fromWire([[1, 'x', 2]])).toThrow();
    expect(() => fromWire([[1, 95, 2]])).toThrow();
    expect(() => fromWire('nope')).toThrow();
  });
});
