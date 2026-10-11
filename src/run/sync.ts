import { difficultyScore, profileRoute } from '../core/difficulty';
import { simplify } from '../core/geo';
import { isLongEnoughToSave } from '../core/rules';
import { metersToMiles } from '../core/units';
import { createRouteFromRun, submitAttempt } from '../data/api';
import { getRun, getRunPoints, unsyncedRuns, updateRun, type LocalRun } from '../data/localDb';

/** Route geometry is simplified to this tolerance before upload. */
const SIMPLIFY_TOLERANCE_M = 3;

export function defaultRouteName(distanceM: number, startedAt: number): string {
  const d = new Date(startedAt);
  return `${metersToMiles(distanceM).toFixed(1)} mi loop · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

/**
 * Uploads one finished run:
 *  - a valid course attempt → an attempt row (updates averages, records, visibility);
 *  - a free run of ≥ 3 miles → a new (private) route, with this run as its first completion.
 * Anything else stays on the device only. Safe to call repeatedly.
 */
export async function syncRun(run: LocalRun, routeName?: string): Promise<{ createdRouteId: string | null }> {
  if (run.synced) return { createdRouteId: run.created_route_id };
  let createdRouteId: string | null = run.created_route_id;

  if (run.mode === 'course' && run.valid_attempt && run.route_id && run.elapsed_s) {
    await submitAttempt({
      routeId: run.route_id,
      elapsedS: run.elapsed_s,
      pauseCount: run.pause_count,
      clientRunId: run.id,
      finishedAt: run.ended_at ?? Date.now(),
    });
  } else if (run.mode === 'free' && run.status === 'finished' && !createdRouteId) {
    const points = (await getRunPoints(run.id)).filter((p) => (p.acc ?? 0) <= 25);
    const profile = profileRoute(points);
    if (isLongEnoughToSave(profile.distanceM) && run.elapsed_s) {
      const path = simplify(points, SIMPLIFY_TOLERANCE_M);
      createdRouteId = await createRouteFromRun({
        name: routeName ?? defaultRouteName(profile.distanceM, run.started_at),
        distanceM: profile.distanceM,
        elevationGainM: profile.elevationGainM,
        equivalentFlatM: profile.equivalentFlatM,
        difficulty: difficultyScore(profile.equivalentFlatM),
        path,
        elapsedS: run.elapsed_s,
        clientRunId: run.id,
      });
      await updateRun(run.id, { created_route_id: createdRouteId });
    }
  }
  await updateRun(run.id, { synced: 1 });
  return { createdRouteId };
}

export async function syncRunById(id: string, routeName?: string) {
  const run = await getRun(id);
  return run ? syncRun(run, routeName) : { createdRouteId: null };
}

/** Retries uploads that failed (no signal at the end of a run, app killed, ...). */
export async function syncPending(): Promise<void> {
  for (const run of await unsyncedRuns()) {
    try {
      await syncRun(run);
    } catch (e) {
      console.warn('sync failed; will retry', run.id, e);
    }
  }
}
