// Server-side run handling shared by the `runs`, `strava` and `strava-webhook` functions.
// Every result is re-derived from the GPS track with the same rules as the app (src/core copy).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { demProfilePath } from './core/elevation.ts';
import { formatDuration } from './core/units.ts';
import { simplify, type TrackPoint } from './core/geo.ts';
import { findCourseAttempts } from './core/importMatch.ts';
import { validateTrack } from './core/validation.ts';
import { buildRoute, verifyAttempt } from './core/verify.ts';
import { pushToUser } from './push.ts';

export type Source = 'app' | 'apple_health' | 'strava' | 'gpx';

/** Sources whose GPS is generally better than a phone's (dedicated watch receivers). */
const WATCH_SOURCES: ReadonlySet<Source> = new Set(['apple_health', 'strava', 'gpx']);
const AUDIT_SIMPLIFY_M = 2;
/** Two results for the same user and route finishing this close together are the same run. */
const SAME_RUN_WINDOW_MS = 10 * 60_000;
const ELEVATION_API_URL = Deno.env.get('ELEVATION_API_URL') ?? undefined;

export type Result<T> = ({ ok: true } & T) | { ok: false; reason: string };

const pathJson = (pts: TrackPoint[]) =>
  pts.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6, p.ele == null ? null : Math.round(p.ele)]);

interface CourseRow {
  id: string;
  name: string;
  path: Array<[number, number]>;
  creator_id: string | null;
  is_public: boolean;
}

/**
 * Records a verified attempt, unless this run is already recorded for this route (e.g. the
 * phone tracked it and now the watch upload arrives). In that case a watch track replaces a
 * phone track — it's the more accurate one — and anything else is left alone.
 */
async function saveAttempt(
  admin: SupabaseClient,
  a: { userId: string; routeId: string; clientRunId: string; source: Source; elapsedS: number; finishedAt: number; pauseCount: number; track: TrackPoint[] },
): Promise<'inserted' | 'upgraded' | 'duplicate'> {
  const { data: existing, error } = await admin
    .from('attempts')
    .select('id, source, client_run_id')
    .eq('user_id', a.userId)
    .eq('route_id', a.routeId)
    .gte('finished_at', new Date(a.finishedAt - SAME_RUN_WINDOW_MS).toISOString())
    .lte('finished_at', new Date(a.finishedAt + SAME_RUN_WINDOW_MS).toISOString())
    .limit(1)
    .maybeSingle();
  if (error) throw error;

  const row = {
    elapsed_s: Math.round(a.elapsedS * 10) / 10,
    pause_count: a.pauseCount,
    finished_at: new Date(a.finishedAt).toISOString(),
    source: a.source,
    track: pathJson(simplify(a.track, AUDIT_SIMPLIFY_M)),
  };
  if (existing) {
    if (existing.source === 'app' && WATCH_SOURCES.has(a.source)) {
      const { error: e } = await admin.from('attempts').update(row).eq('id', existing.id);
      if (e) throw e;
      return 'upgraded';
    }
    return 'duplicate';
  }
  const { error: e } = await admin.from('attempts').upsert(
    { ...row, route_id: a.routeId, user_id: a.userId, client_run_id: a.clientRunId },
    { onConflict: 'user_id,client_run_id', ignoreDuplicates: true },
  );
  if (e) throw e;
  return 'inserted';
}

type AttemptInput = Parameters<typeof saveAttempt>[1];

async function currentRecord(admin: SupabaseClient, routeId: string) {
  const { data, error } = await admin
    .from('attempts')
    .select('user_id, elapsed_s')
    .eq('route_id', routeId)
    .order('elapsed_s')
    .order('finished_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as { user_id: string; elapsed_s: number } | null;
}

/** Saves the attempt, and tells the previous record holder if it took their course record. */
async function recordAttempt(admin: SupabaseClient, a: AttemptInput) {
  const before = await currentRecord(admin, a.routeId);
  const status = await saveAttempt(admin, a);
  if (status !== 'duplicate' && before && before.user_id !== a.userId && a.elapsedS < Number(before.elapsed_s)) {
    try {
      await notifyRecordBeaten(admin, { routeId: a.routeId, previousHolder: before.user_id, oldS: Number(before.elapsed_s), newS: a.elapsedS, byUserId: a.userId });
    } catch (e) {
      // The new record stands either way; a failed notification must not fail the upload.
      console.warn('record notification failed', (e as Error).message);
    }
  }
  return status;
}

async function notifyRecordBeaten(
  admin: SupabaseClient,
  n: { routeId: string; previousHolder: string; oldS: number; newS: number; byUserId: string },
) {
  const [{ data: route }, { data: by }] = await Promise.all([
    admin.from('routes').select('name').eq('id', n.routeId).single(),
    admin.from('profiles').select('display_name').eq('id', n.byUserId).single(),
  ]);
  const routeName = route?.name ?? 'a course';
  const byName = by?.display_name ?? 'Someone';
  const data = { routeName, byName, newS: Math.round(n.newS), oldS: Math.round(n.oldS) };
  await admin.from('notifications').insert({ user_id: n.previousHolder, kind: 'record_beaten', route_id: n.routeId, data });
  await pushToUser(admin, n.previousHolder, {
    title: `Your record on ${routeName} fell`,
    body: `${byName} ran ${formatDuration(n.newS)}, beating your ${formatDuration(n.oldS)}. Go take it back.`,
    data: { routeId: n.routeId, kind: 'record_beaten' },
  });
}

async function visibleRoute(admin: SupabaseClient, userId: string, routeId: string): Promise<CourseRow | null> {
  const { data, error } = await admin.from('routes').select('id, name, path, creator_id, is_public').eq('id', routeId).maybeSingle();
  if (error) throw error;
  return data && (data.is_public || data.creator_id === userId) ? (data as CourseRow) : null;
}

const toCourse = (r: CourseRow) => r.path.map(([lat, lng]) => ({ lat, lng }));

/** A course attempt recorded in the app: must start at the start (the app enforced that). */
export async function submitAttempt(
  admin: SupabaseClient,
  userId: string,
  p: { routeId: string; clientRunId: string; points: TrackPoint[] },
): Promise<Result<{ elapsedS: number }>> {
  const route = await visibleRoute(admin, userId, p.routeId);
  if (!route) return { ok: false, reason: 'Route not found.' };
  const v = verifyAttempt(toCourse(route), p.points);
  if (!v.ok) return { ok: false, reason: v.reason };
  await recordAttempt(admin, {
    userId, routeId: route.id, clientRunId: p.clientRunId, source: 'app',
    elapsedS: v.elapsedS, finishedAt: v.finishedAt, pauseCount: v.pauseCount, track: p.points,
  });
  return { ok: true, elapsedS: v.elapsedS };
}

/** A free run becomes a route if it's ≥ 3 mi and this run hasn't already made one. */
export async function createRoute(
  admin: SupabaseClient,
  userId: string,
  p: { clientRunId: string; points: TrackPoint[]; name?: string | null },
): Promise<Result<{ routeId: string }>> {
  const { data: existing } = await admin
    .from('attempts').select('route_id').eq('user_id', userId).eq('client_run_id', p.clientRunId).maybeSingle();
  if (existing) return { ok: true, routeId: existing.route_id };

  const first = buildRoute(p.points);
  if (!first.ok) return { ok: false, reason: first.reason };

  // Score climbing from terrain data; fall back to the device's GPS altitude if the lookup fails.
  let built = first;
  let elevationSource = 'gps';
  try {
    const withDem = buildRoute(p.points, { elevationPath: await demProfilePath(first.path, fetch, ELEVATION_API_URL) });
    if (withDem.ok) {
      built = withDem;
      elevationSource = 'dem';
    }
  } catch (e) {
    console.warn('DEM lookup failed; using GPS altitude', (e as Error).message);
  }

  const name = p.name && p.name.trim().length >= 2 ? p.name.trim().slice(0, 80) : `${(built.profile.distanceM / 1609.344).toFixed(1)} mi loop`;
  const { data: routeId, error } = await admin.rpc('create_route_from_run', {
    p_user_id: userId,
    p_name: name,
    p_distance_m: Math.round(built.profile.distanceM),
    p_elevation_gain_m: Math.round(built.profile.elevationGainM),
    p_equivalent_flat_m: Math.round(built.profile.equivalentFlatM),
    p_difficulty: built.difficulty,
    p_path: pathJson(built.path),
    p_elapsed_s: Math.round(built.elapsedS * 10) / 10,
    p_client_run_id: p.clientRunId,
    p_elevation_source: elevationSource,
  });
  if (error) throw error;
  return { ok: true, routeId: routeId as string };
}

export interface ImportOutcome {
  matched: Array<{ routeId: string; routeName: string; elapsedS: number; status: 'inserted' | 'upgraded' | 'duplicate' }>;
  createdRouteId: string | null;
}

/**
 * A run recorded elsewhere (watch, Strava, GPX). Checks it against every course the user can
 * see whose start it passes near and records each valid attempt. If it matches no course and
 * is ≥ 3 mi, it becomes a new route — the same rule as a free run in the app — unless the
 * app already recorded this run.
 */
export async function importTrack(
  admin: SupabaseClient,
  userId: string,
  p: { source: Exclude<Source, 'app'>; externalId: string; points: TrackPoint[]; name?: string | null; createRoute?: boolean },
): Promise<Result<ImportOutcome>> {
  const issues = validateTrack(p.points);
  if (issues.length) return { ok: false, reason: issues[0].message };

  // Candidate courses: starts inside the track's bounding box (+~100 m).
  const pad = 0.001;
  const lats = p.points.map((x) => x.lat);
  const lngs = p.points.map((x) => x.lng);
  const { data: candidates, error } = await admin
    .from('routes')
    .select('id, name, path, creator_id, is_public')
    .gte('start_lat', Math.min(...lats) - pad).lte('start_lat', Math.max(...lats) + pad)
    .gte('start_lng', Math.min(...lngs) - pad).lte('start_lng', Math.max(...lngs) + pad)
    .or(`is_public.eq.true,creator_id.eq.${userId}`)
    .limit(200);
  if (error) throw error;

  const matched: ImportOutcome['matched'] = [];
  for (const route of (candidates ?? []) as CourseRow[]) {
    const attempts = findCourseAttempts(toCourse(route), p.points);
    for (const [i, a] of attempts.entries()) {
      const status = await recordAttempt(admin, {
        userId, routeId: route.id, clientRunId: `${p.source}:${p.externalId}:${route.id}:${i}`, source: p.source,
        elapsedS: a.elapsedS, finishedAt: a.finishedAt, pauseCount: a.pauseCount,
        track: p.points.filter((x) => x.t! >= a.startedAt && x.t! <= a.finishedAt),
      });
      matched.push({ routeId: route.id, routeName: route.name, elapsedS: a.elapsedS, status });
    }
  }

  let createdRouteId: string | null = null;
  if (matched.length === 0 && p.createRoute !== false) {
    // Skip if the phone already uploaded this same run as a free run (it made the route).
    const start = p.points[0].t!;
    const end = p.points[p.points.length - 1].t!;
    const { data: overlap } = await admin
      .from('attempts').select('id').eq('user_id', userId)
      .gte('finished_at', new Date(start).toISOString())
      .lte('finished_at', new Date(end + SAME_RUN_WINDOW_MS).toISOString())
      .limit(1).maybeSingle();
    if (!overlap) {
      const res = await createRoute(admin, userId, { clientRunId: `${p.source}:${p.externalId}`, points: p.points, name: p.name });
      if (res.ok) createdRouteId = res.routeId;
    }
  }
  return { ok: true, matched, createdRouteId };
}
