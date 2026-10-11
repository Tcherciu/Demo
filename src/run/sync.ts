import { metersToMiles } from '../core/units';
import { runsApi } from '../data/api';
import { getRun, getRunPoints, unsyncedRuns, updateRun, type LocalRun } from '../data/localDb';

export function defaultRouteName(distanceM: number, startedAt: number): string {
  const d = new Date(startedAt);
  return `${metersToMiles(distanceM).toFixed(1)} mi loop · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

export interface SyncResult {
  createdRouteId: string | null;
  /** Server-verified time for a course attempt. */
  verifiedElapsedS: number | null;
  /** Set when the server refused the run; it won't be retried. */
  rejectedReason: string | null;
}

/**
 * Uploads one finished run's GPS track for server-side verification:
 *  - a course attempt the phone judged valid → the server replays it and records the time;
 *  - any finished free run → the server measures it and creates a (private) route if ≥ 3 mi.
 * Abandoned course attempts stay on the device. Throws on network errors (retried later);
 * safe to call repeatedly.
 */
export async function syncRun(run: LocalRun): Promise<SyncResult> {
  const done = { createdRouteId: run.created_route_id, verifiedElapsedS: null, rejectedReason: run.rejected_reason };
  if (run.synced) return done;

  if (run.mode === 'course' && run.valid_attempt && run.route_id) {
    const res = await runsApi.submitAttempt({ routeId: run.route_id, clientRunId: run.id, points: await getRunPoints(run.id) });
    await updateRun(run.id, { synced: 1, rejected_reason: res.ok ? null : res.reason });
    return { ...done, verifiedElapsedS: res.ok ? res.elapsedS : null, rejectedReason: res.ok ? null : res.reason };
  }

  if (run.mode === 'free' && run.status === 'finished' && !run.created_route_id) {
    const res = await runsApi.createRoute({ clientRunId: run.id, points: await getRunPoints(run.id), name: defaultRouteName(run.distance_m, run.started_at) });
    const createdRouteId = res.ok ? res.routeId : null;
    await updateRun(run.id, { synced: 1, created_route_id: createdRouteId, rejected_reason: res.ok ? null : res.reason });
    return { ...done, createdRouteId, rejectedReason: res.ok ? null : res.reason };
  }

  await updateRun(run.id, { synced: 1 });
  return done;
}

export async function syncRunById(id: string): Promise<SyncResult> {
  const run = await getRun(id);
  if (!run) return { createdRouteId: null, verifiedElapsedS: null, rejectedReason: null };
  return syncRun(run);
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
