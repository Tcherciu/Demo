import { difficultyLabel, difficultyScore, equivalentFlatFromTotals, gradeFactor, minettiCost, profileRoute } from '../difficulty.ts';
import { milesToMeters } from '../units.ts';
import { walk } from './helpers.ts';

describe('difficulty', () => {
  it('Minetti cost is 3.6 J/kg/m on the flat and rises uphill', () => {
    expect(minettiCost(0)).toBeCloseTo(3.6);
    expect(gradeFactor(0.1)).toBeGreaterThan(1.4);
    expect(gradeFactor(-0.1)).toBeCloseTo(0.88); // capped downhill benefit
  });

  it('scores flat races on the expected curve', () => {
    expect(difficultyScore(milesToMeters(3.10686))).toBeCloseTo(3.5, 0);
    expect(difficultyScore(milesToMeters(26.2))).toBe(10);
    expect(difficultyScore(milesToMeters(0.2))).toBe(1);
  });

  it('a hilly route scores harder than a flat one of the same length', () => {
    const flat = equivalentFlatFromTotals(milesToMeters(5), 0);
    const hilly = equivalentFlatFromTotals(milesToMeters(5), 250);
    expect(hilly).toBeGreaterThan(flat * 1.1);
    expect(difficultyScore(hilly)).toBeGreaterThan(difficultyScore(flat));
  });

  it('labels', () => {
    expect(difficultyLabel(2)).toBe('Easy');
    expect(difficultyLabel(6)).toBe('Hard');
    expect(difficultyLabel(9)).toBe('Extreme');
  });

  it('profiles a track and ignores GPS altitude jitter', () => {
    const pts = walk([[0, 0], [2000, 0]], 10).map((p, i) => ({
      ...p,
      // 20 m steady climb plus ±3 m alternating noise.
      ele: (i / 200) * 20 + (i % 2 ? 3 : -3),
    }));
    const prof = profileRoute(pts);
    expect(prof.distanceM).toBeCloseTo(2000, -1);
    expect(prof.elevationGainM).toBeGreaterThan(14);
    expect(prof.elevationGainM).toBeLessThan(26); // raw deltas would sum to ~1200 m
    expect(prof.equivalentFlatM).toBeGreaterThan(prof.distanceM);
  });

  it('handles tracks with no elevation', () => {
    const prof = profileRoute(walk([[0, 0], [1000, 0]]));
    expect(prof.elevationGainM).toBe(0);
    expect(prof.equivalentFlatM).toBeCloseTo(prof.distanceM);
  });
});
