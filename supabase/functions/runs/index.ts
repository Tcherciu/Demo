// Verified run uploads from the app. The only way attempts and user-created routes get into
// the database: the server replays each GPS track through the same rules the app uses and
// computes the time, distance and difficulty itself rather than trusting the phone.
//
//   submit_attempt  — a course run recorded in the app
//   create_route    — a free run recorded in the app (becomes a route if ≥ 3 mi)
//   import_track    — a run recorded elsewhere: Apple Health (Apple Watch, Garmin, ...) or a GPX file
//
// Optional secret: ELEVATION_API_URL (defaults to Open-Meteo's public elevation API).
import { createClient } from 'npm:@supabase/supabase-js@2';

import { fromWire } from '../_shared/core/verify.ts';
import { createRoute, importTrack, submitAttempt } from '../_shared/runService.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MAX_POINTS = 60_000; // > 16 h at 1 Hz
const IMPORT_SOURCES = new Set(['apple_health', 'gpx']);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
    const points = fromWire(body.points);
    switch (body.action) {
      case 'submit_attempt':
        return json(await submitAttempt(admin, user.id, { routeId: String(body.routeId), clientRunId: String(body.clientRunId), points }));
      case 'create_route':
        return json(await createRoute(admin, user.id, { clientRunId: String(body.clientRunId), points, name: body.name ?? null }));
      case 'import_track':
        if (!IMPORT_SOURCES.has(body.source)) return json({ error: 'bad source' }, 400);
        return json(
          await importTrack(admin, user.id, {
            source: body.source,
            externalId: String(body.externalId).slice(0, 200),
            points,
            name: body.name ?? null,
            createRoute: body.createRoute !== false,
          }),
        );
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
