import { estimateAllTiers, nearestTier, personalPaceModel, TIER_MODELS } from '../estimates.ts';
import { milesToMeters } from '../units.ts';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

describe('estimates', () => {
  it('a flat 5K takes exactly the tier 5K pace', () => {
    const t = estimateAllTiers(milesToMeters(3.10686));
    expect(t.intermediate / 3.10686).toBeCloseTo(TIER_MODELS.intermediate.flat5kPaceSecPerMile, 0);
    expect(t.beginner).toBeGreaterThan(t.intermediate);
    expect(t.intermediate).toBeGreaterThan(t.advanced);
  });

  it('pace slows over longer distances (Riegel)', () => {
    const t5 = estimateAllTiers(milesToMeters(5)).intermediate / 5;
    const t13 = estimateAllTiers(milesToMeters(13.1)).intermediate / 13.1;
    expect(t13).toBeGreaterThan(t5);
  });

  it('builds a personal model from recent runs, ignoring old and junk ones', () => {
    const run = (mi: number, paceMin: number, daysAgo: number, gain = 0) => ({
      distanceM: milesToMeters(mi),
      movingTimeS: mi * paceMin * 60,
      elevationGainM: gain,
      startedAt: NOW - daysAgo * DAY,
    });
    const model = personalPaceModel(
      [
        run(3.1, 8, 2), run(3.1, 8, 5), run(3.1, 10, 7), run(3.1, 10, 9), // fast & easy days
        run(3.1, 5, 400), // too old
        run(3.1, 1, 3), // GPS junk (1 min/mi)
      ],
      NOW,
    )!;
    expect(model.flat5kPaceSecPerMile).toBeCloseTo(480, -1);
    expect(nearestTier(model)).toBe('advanced');
  });

  it('returns null without enough data', () => {
    expect(personalPaceModel([], NOW)).toBeNull();
  });
});
