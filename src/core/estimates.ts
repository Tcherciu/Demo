import { equivalentFlatFromTotals } from './difficulty';
import { metersToMiles } from './units';

export type SkillTier = 'beginner' | 'intermediate' | 'advanced';

export interface PaceModel {
  /** Flat pace the runner can hold for a 5K, in seconds per mile. */
  flat5kPaceSecPerMile: number;
  /**
   * Riegel fatigue exponent: T2 = T1 · (D2/D1)^k. 1.06 is the classic value;
   * newer runners slow down more over distance, so they get a larger k.
   */
  fatigueExponent: number;
}

export const TIER_MODELS: Record<SkillTier, PaceModel> = {
  beginner: { flat5kPaceSecPerMile: 12 * 60, fatigueExponent: 1.08 },
  intermediate: { flat5kPaceSecPerMile: 9 * 60 + 30, fatigueExponent: 1.06 },
  advanced: { flat5kPaceSecPerMile: 7 * 60 + 30, fatigueExponent: 1.05 },
};

const FIVE_K_MI = 3.10686;

/** Estimated finishing time in seconds for a route with the given flat-equivalent distance. */
export function estimateSeconds(equivalentFlatM: number, model: PaceModel): number {
  const mi = metersToMiles(equivalentFlatM);
  if (mi <= 0) return 0;
  const fiveKTime = model.flat5kPaceSecPerMile * FIVE_K_MI;
  return fiveKTime * Math.pow(mi / FIVE_K_MI, model.fatigueExponent);
}

export function estimateAllTiers(equivalentFlatM: number): Record<SkillTier, number> {
  return {
    beginner: estimateSeconds(equivalentFlatM, TIER_MODELS.beginner),
    intermediate: estimateSeconds(equivalentFlatM, TIER_MODELS.intermediate),
    advanced: estimateSeconds(equivalentFlatM, TIER_MODELS.advanced),
  };
}

/** A completed run, from Strava or from this app's own history. */
export interface ActivitySummary {
  distanceM: number;
  movingTimeS: number;
  elevationGainM: number;
  /** Unix epoch ms. */
  startedAt: number;
}

/**
 * Builds a personal pace model from a runner's history:
 * 1. turn each run into a flat-equivalent distance (so hilly runs aren't penalised),
 * 2. back out the 5K-equivalent flat pace with Riegel,
 * 3. take the median of the faster half — easy/recovery days shouldn't drag the
 *    estimate down, but one freak GPS-glitched run shouldn't define it either.
 * Returns null when there isn't enough recent data to say anything useful.
 */
export function personalPaceModel(
  activities: readonly ActivitySummary[],
  now = Date.now(),
  opts: { lookbackDays?: number; minRuns?: number; fatigueExponent?: number } = {},
): PaceModel | null {
  const { lookbackDays = 120, minRuns = 3, fatigueExponent = 1.06 } = opts;
  const cutoff = now - lookbackDays * 86_400_000;
  const paces = activities
    .filter((a) => a.startedAt >= cutoff && a.distanceM >= 2000 && a.movingTimeS > 0)
    .map((a) => {
      const eqMi = metersToMiles(equivalentFlatFromTotals(a.distanceM, a.elevationGainM));
      const fiveKTime = a.movingTimeS / Math.pow(eqMi / FIVE_K_MI, fatigueExponent);
      return fiveKTime / FIVE_K_MI;
    })
    // Discard physically implausible paces (GPS glitches, activities logged as runs while cycling).
    .filter((p) => p >= 4 * 60 && p <= 20 * 60)
    .sort((a, b) => a - b);
  if (paces.length < minRuns) return null;
  const fastHalf = paces.slice(0, Math.ceil(paces.length / 2));
  const mid = Math.floor(fastHalf.length / 2);
  const median = fastHalf.length % 2 ? fastHalf[mid] : (fastHalf[mid - 1] + fastHalf[mid]) / 2;
  return { flat5kPaceSecPerMile: median, fatigueExponent };
}

/** Which tier a personal model sits closest to — used for the default filter on Browse. */
export function nearestTier(model: PaceModel): SkillTier {
  const tiers = Object.keys(TIER_MODELS) as SkillTier[];
  return tiers.reduce((best, t) =>
    Math.abs(TIER_MODELS[t].flat5kPaceSecPerMile - model.flat5kPaceSecPerMile) <
    Math.abs(TIER_MODELS[best].flat5kPaceSecPerMile - model.flat5kPaceSecPerMile)
      ? t
      : best,
  );
}
