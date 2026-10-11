import { isLongEnoughToSave, isRoutePublic, publicProgressLabel } from '../rules';
import { milesToMeters } from '../units';

describe('rules', () => {
  it('saves runs of 3 miles or more', () => {
    expect(isLongEnoughToSave(milesToMeters(2.99))).toBe(false);
    expect(isLongEnoughToSave(milesToMeters(3))).toBe(true);
  });

  it('goes public at 10 miles or 5 completions', () => {
    expect(isRoutePublic(milesToMeters(9.9), 4)).toBe(false);
    expect(isRoutePublic(milesToMeters(10), 1)).toBe(true);
    expect(isRoutePublic(milesToMeters(4), 5)).toBe(true);
    expect(publicProgressLabel(milesToMeters(4), 3)).toBe('2 more completions to go public');
    expect(publicProgressLabel(milesToMeters(4), 4)).toBe('1 more completion to go public');
    expect(publicProgressLabel(milesToMeters(12), 0)).toBeNull();
  });
});
