import type { ActivitySummary, PaceModel } from '../core/estimates';
import type { RouteSummary } from '../core/filters';
import type { TrackPoint } from '../core/geo';
import { toWire } from '../core/verify';
import { supabase } from './supabase';

export interface RouteDetail extends RouteSummary {
  path: TrackPoint[];
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  elapsedS: number;
  finishedAt: number;
}

export interface Profile {
  id: string;
  displayName: string;
  paceModel: PaceModel | null;
}

type SummaryRow = {
  id: string; name: string; creator_id: string; distance_m: number; elevation_gain_m: number;
  equivalent_flat_m: number; difficulty: number; start_lat: number; start_lng: number;
  is_public: boolean; completions: number; created_at: string; avg_rating: number | null;
  rating_count: number; average_s: number | null; record_s: number | null; record_holder: string | null;
};

function toSummary(r: SummaryRow): RouteSummary {
  return {
    id: r.id,
    name: r.name,
    creatorId: r.creator_id,
    distanceM: Number(r.distance_m),
    elevationGainM: Number(r.elevation_gain_m),
    equivalentFlatM: Number(r.equivalent_flat_m),
    difficulty: Number(r.difficulty),
    start: { lat: r.start_lat, lng: r.start_lng },
    isPublic: r.is_public,
    completions: r.completions,
    avgRating: r.avg_rating == null ? null : Number(r.avg_rating),
    ratingCount: Number(r.rating_count),
    averageS: r.average_s == null ? null : Number(r.average_s),
    recordS: r.record_s == null ? null : Number(r.record_s),
    recordHolder: r.record_holder,
    createdAt: Date.parse(r.created_at),
  };
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Every route this user can see: public ones plus their own private ones. */
export async function fetchRoutes(): Promise<RouteSummary[]> {
  const rows = check(await supabase.from('route_summaries').select('*').limit(1000));
  return (rows as SummaryRow[]).map(toSummary);
}

export async function fetchRoute(id: string): Promise<RouteDetail> {
  const [summary, route] = await Promise.all([
    supabase.from('route_summaries').select('*').eq('id', id).single(),
    supabase.from('routes').select('path').eq('id', id).single(),
  ]);
  const path = (check(route) as { path: [number, number, number | null][] }).path;
  return {
    ...toSummary(check(summary) as SummaryRow),
    path: path.map(([lat, lng, ele]) => ({ lat, lng, ele })),
  };
}

export async function fetchLeaderboard(routeId: string, limit = 20): Promise<LeaderboardEntry[]> {
  const rows = check(
    await supabase.from('route_leaderboard').select('*').eq('route_id', routeId).order('elapsed_s').limit(limit),
  ) as { user_id: string; display_name: string; elapsed_s: number; finished_at: string }[];
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    elapsedS: Number(r.elapsed_s),
    finishedAt: Date.parse(r.finished_at),
  }));
}

export type VerifyResult<T> = ({ ok: true } & T) | { ok: false; reason: string };

/**
 * Results go through the `runs` edge function, which replays the GPS track through the
 * same rules and computes times/metrics itself. `ok: false` means the server rejected the
 * run (don't retry); a thrown error means it couldn't be reached (retry later).
 * Both calls are idempotent per local run id.
 */
async function runs<T>(body: Record<string, unknown>): Promise<VerifyResult<T>> {
  const { data, error } = await supabase.functions.invoke('runs', { body });
  if (error) throw new Error(error.message);
  return data as VerifyResult<T>;
}

export const runsApi = {
  submitAttempt: (a: { routeId: string; clientRunId: string; points: TrackPoint[] }) =>
    runs<{ elapsedS: number }>({ action: 'submit_attempt', routeId: a.routeId, clientRunId: a.clientRunId, points: toWire(a.points) }),
  createRoute: (r: { clientRunId: string; points: TrackPoint[]; name?: string }) =>
    runs<{ routeId: string }>({ action: 'create_route', clientRunId: r.clientRunId, name: r.name, points: toWire(r.points) }),
};

export async function renameRoute(id: string, name: string) {
  check(await supabase.from('routes').update({ name }).eq('id', id));
}

export async function rateRoute(routeId: string, stars: number, feel: -1 | 0 | 1 | null) {
  const userId = await currentUserId();
  check(
    await supabase
      .from('ratings')
      .upsert({ route_id: routeId, user_id: userId, stars, feel, updated_at: new Date().toISOString() }),
  );
}

export async function fetchSavedIds(): Promise<Set<string>> {
  const rows = check(await supabase.from('saved_routes').select('route_id')) as { route_id: string }[];
  return new Set(rows.map((r) => r.route_id));
}

export async function setSaved(routeId: string, saved: boolean) {
  const userId = await currentUserId();
  if (saved) check(await supabase.from('saved_routes').upsert({ user_id: userId, route_id: routeId }));
  else check(await supabase.from('saved_routes').delete().eq('user_id', userId!).eq('route_id', routeId));
}

export async function fetchProfile(): Promise<Profile | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  const row = check(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as
    | { id: string; display_name: string; flat_5k_pace_s: number | null; fatigue_exponent: number | null }
    | null;
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    paceModel:
      row.flat_5k_pace_s != null
        ? { flat5kPaceSecPerMile: Number(row.flat_5k_pace_s), fatigueExponent: Number(row.fatigue_exponent ?? 1.06) }
        : null,
  };
}

export async function saveProfile(p: { displayName?: string; paceModel?: PaceModel | null }) {
  const userId = await currentUserId();
  const row: Record<string, unknown> = { id: userId };
  if (p.displayName !== undefined) row.display_name = p.displayName;
  if (p.paceModel !== undefined) {
    row.flat_5k_pace_s = p.paceModel?.flat5kPaceSecPerMile ?? null;
    row.fatigue_exponent = p.paceModel?.fatigueExponent ?? null;
  }
  check(await supabase.from('profiles').upsert(row));
}

async function strava<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('strava', { body });
  if (error) throw new Error(error.message);
  return data as T;
}

export const stravaApi = {
  exchange: (code: string) => strava<{ connected: boolean; athleteName: string | null }>({ action: 'exchange', code }),
  activities: () => strava<{ activities: ActivitySummary[] }>({ action: 'activities' }).then((r) => r.activities),
  disconnect: () => strava<{ connected: boolean }>({ action: 'disconnect' }),
};
