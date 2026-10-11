// Verified run uploads. The only way attempts and user-created routes get into the database:
// the server replays the GPS track through the same rules the app uses (shared src/core copy)
// and computes the time, distance and difficulty itself rather than trusting the phone.
//
// Optional secret: ELEVATION_API_URL (defaults to Open-Meteo's public elevation API).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { demProfilePath } from '../_shared/core/elevation.ts';
import type { TrackPoint } from '../_shared/core/geo.ts';
import { simplify } from '../_shared/core/geo.ts';
import { buildRoute, fromWire, verifyAttempt } from '../_shared/core/verify.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ELEVATION_API_URL = Deno.env.get('ELEVATION_API_URL') ?? undefined;
/** Stored with each attempt for audits / disputes; simplified so it stays small. */
const AUDIT_SIMPLIFY_M = 2;
const MAX_POINTS = 60_000; // > 16 h at 1 Hz

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const pathJson = (pts: TrackPoint[]) =>
  pts.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6, p.ele == null ? null : Math.round(p.ele)]);

async function submitAttempt(userId: string, body: Record<string, unknown>) {
  const routeId = String(body.routeId);
  const clientRunId = String(body.clientRunId);
  const points = fromWire(body.points);

  const { data: route, error } = await admin
    .from('routes')
    .select('id, path, creator_id, is_public')
    .eq('id', routeId)
    .maybeSingle();
  if (error) throw error;
  if (!route || !(route.is_public || route.creator_id === userId)) return json({ ok: false, reason: 'Route not found.' });

  const course = (route.path as Array<[number, number]>).map(([lat, lng]) => ({ lat, lng }));
  const verdict = verifyAttempt(course, points);
  if (!verdict.ok) return json({ ok: false, reason: verdict.reason });

  const { error: insertError } = await admin.from('attempts').upsert(
    {
      route_id: routeId,
      user_id: userId,
      elapsed_s: Math.round(verdict.elapsedS * 10) / 10,
      pause_count: verdict.pauseCount,
      finished_at: new Date(verdict.finishedAt).toISOString(),
      client_run_id: clientRunId,
      track: pathJson(simplify(points, AUDIT_SIMPLIFY_M)),
    },
    { onConflict: 'user_id,client_run_id', ignoreDuplicates: true },
  );
  if (insertError) throw insertError;
  return json({ ok: true, elapsedS: verdict.elapsedS });
}

async function createRoute(userId: string, body: Record<string, unknown>) {
  const clientRunId = String(body.clientRunId);
  const points = fromWire(body.points);

  // Retries after a dropped connection must not create a second route.
  const { data: existing } = await admin
    .from('attempts')
    .select('route_id')
    .eq('user_id', userId)
    .eq('client_run_id', clientRunId)
    .maybeSingle();
  if (existing) return json({ ok: true, routeId: existing.route_id });

  const first = buildRoute(points);
  if (!first.ok) return json({ ok: false, reason: first.reason });

  // Score climbing from terrain data; fall back to the phone's GPS altitude if the lookup fails.
  let built = first;
  let elevationSource = 'gps';
  try {
    const elevationPath = await demProfilePath(first.path, fetch, ELEVATION_API_URL);
    const withDem = buildRoute(points, { elevationPath });
    if (withDem.ok) {
      built = withDem;
      elevationSource = 'dem';
    }
  } catch (e) {
    console.warn('DEM lookup failed; using GPS altitude', (e as Error).message);
  }

  const name = typeof body.name === 'string' && body.name.trim().length >= 2 ? body.name.trim().slice(0, 80) : null;
  const { data: routeId, error } = await admin.rpc('create_route_from_run', {
    p_user_id: userId,
    p_name: name ?? `${(built.profile.distanceM / 1609.344).toFixed(1)} mi loop`,
    p_distance_m: Math.round(built.profile.distanceM),
    p_elevation_gain_m: Math.round(built.profile.elevationGainM),
    p_equivalent_flat_m: Math.round(built.profile.equivalentFlatM),
    p_difficulty: built.difficulty,
    p_path: pathJson(built.path),
    p_elapsed_s: Math.round(built.elapsedS * 10) / 10,
    p_client_run_id: clientRunId,
    p_elevation_source: elevationSource,
  });
  if (error) throw error;
  return json({ ok: true, routeId });
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  try {
    const body = await req.json();
    if (!Array.isArray(body.points) || body.points.length > MAX_POINTS) return json({ error: 'bad points' }, 400);
    switch (body.action) {
      case 'submit_attempt':
        return await submitAttempt(user.id, body);
      case 'create_route':
        return await createRoute(user.id, body);
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
