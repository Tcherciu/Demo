import { feetToMeters, milesToMeters } from './units';

/**
 * Product rules, in one place so the app, the tracker and the tests agree.
 * The same thresholds are mirrored in supabase/migrations (route visibility).
 */
export const RULES = {
  /** A finished free run is saved as a new route only if it is at least this long. */
  minRouteMiles: 3,
  /** A route becomes public once it is this long... */
  publicMinMiles: 10,
  /** ...or once it has been completed this many times (valid attempts, creator's included). */
  publicMinCompletions: 5,
  /** Runner must be within this distance of the start point to begin a course attempt. */
  startRadiusFt: 20,
  /** Travelling this far off course pauses the attempt. */
  maxDeviationMiles: 0.2,
  /** After a pause, the runner must come back within this distance of the course to resume. */
  rejoinRadiusFt: 20,
  /** Finishing: within this distance of the end point... */
  finishRadiusFt: 50,
  /** ...having covered at least this fraction of the course in order. */
  finishMinProgress: 0.97,
} as const;

export const START_RADIUS_M = feetToMeters(RULES.startRadiusFt);
export const REJOIN_RADIUS_M = feetToMeters(RULES.rejoinRadiusFt);
export const FINISH_RADIUS_M = feetToMeters(RULES.finishRadiusFt);
export const MAX_DEVIATION_M = milesToMeters(RULES.maxDeviationMiles);
export const MIN_ROUTE_M = milesToMeters(RULES.minRouteMiles);
export const PUBLIC_MIN_M = milesToMeters(RULES.publicMinMiles);

export function isLongEnoughToSave(distanceM: number): boolean {
  return distanceM >= MIN_ROUTE_M;
}

export function isRoutePublic(distanceM: number, completions: number): boolean {
  return distanceM >= PUBLIC_MIN_M || completions >= RULES.publicMinCompletions;
}

/** Human-readable progress toward going public, or null when already public. */
export function publicProgressLabel(distanceM: number, completions: number): string | null {
  if (isRoutePublic(distanceM, completions)) return null;
  const left = RULES.publicMinCompletions - completions;
  return `${left} more completion${left === 1 ? '' : 's'} to go public`;
}
