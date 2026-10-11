import type { TrackPoint } from '../geo.ts';
import { validateTrack } from '../validation.ts';
import { offset, timed, walk } from './helpers.ts';

const NOW = 2_000_000_000_000;
const lap = (speed = 3) => timed(walk([[0, 0], [400, 0], [400, 400], [0, 400], [0, 0]], 3), speed, NOW - 3_600_000);
const codes = (pts: TrackPoint[]) => validateTrack(pts, NOW).map((i) => i.code);

// Deterministic pseudo-random jitter.
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

describe('validateTrack', () => {
  it('accepts a normal run, including fast running and GPS jitter', () => {
    expect(codes(lap(3))).toEqual([]);
    expect(codes(lap(6))).toEqual([]); // ~4:28 /mi
    const jittery = lap(3).map((p) => ({ ...p, ...offset(rand() * 5, rand() * 5, p), acc: 8 }));
    expect(codes(jittery)).toEqual([]);
  });

  it('rejects a stretch on a bike', () => {
    const run = timed(walk([[0, 0], [400, 0]], 3), 3, NOW - 3_600_000);
    const bike = timed(walk([[400, 0], [2400, 0]], 3).slice(1), 9, run[run.length - 1].t! + 1000);
    expect(codes([...run, ...bike])).toContain('too_fast');
  });

  it('rejects a teleport', () => {
    const pts = lap();
    const jumped = [...pts.slice(0, 50), ...pts.slice(50).map((p) => ({ ...p, ...offset(1000, 0, p) }))];
    expect(codes(jumped)).toContain('teleport');
  });

  it('rejects mock locations, bad and future timestamps, and tiny tracks', () => {
    const pts = lap();
    expect(codes(pts.map((p, i) => (i === 10 ? { ...p, mocked: true } : p)))).toContain('mock_location');
    expect(codes(pts.map((p, i) => (i === 10 ? { ...p, t: pts[5].t } : p)))).toEqual(['bad_timestamps']);
    expect(codes(pts.map((p) => ({ ...p, t: p.t! + 7_200_000 })))).toContain('future_timestamps');
    expect(codes(pts.slice(0, 5))).toEqual(['too_few_points']);
  });
});
