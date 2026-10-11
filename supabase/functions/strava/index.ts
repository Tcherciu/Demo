// Strava: OAuth token exchange, activity history for personal pace estimates, and importing
// runs (with their full GPS track) as verified course attempts. Garmin, COROS, Polar, Suunto
// and Apple Watch users who auto-sync to Strava come in through here too.
// The client secret lives only here; the app never sees Strava tokens.
//
// Required secrets: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2';

import { importTrack } from '../_shared/runService.ts';
import { accessTokenFor, activityTrack, isRun, stravaGet, tokenRequest, type StravaActivity } from '../_shared/strava.ts';

const LOOKBACK_DAYS = 120;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

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
    switch (body.action) {
      case 'exchange': {
        const t = await tokenRequest({ grant_type: 'authorization_code', code: String(body.code) });
        const { error } = await admin.from('strava_connections').upsert({
          user_id: user.id,
          athlete_id: t.athlete!.id,
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: new Date(t.expires_at * 1000).toISOString(),
        });
        if (error) throw error;
        return json({ connected: true, athleteName: t.athlete?.firstname ?? null });
      }
      case 'status': {
        const { data } = await admin.from('strava_connections').select('athlete_id').eq('user_id', user.id).maybeSingle();
        return json({ connected: !!data });
      }
      case 'activities': {
        const token = await accessTokenFor(admin, user.id);
        const after = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86_400;
        const activities = await stravaGet<StravaActivity[]>(token, `/athlete/activities?per_page=100&after=${after}`);
        return json({
          activities: activities.filter(isRun).map((a) => ({
            distanceM: a.distance,
            movingTimeS: a.moving_time,
            elevationGainM: a.total_elevation_gain ?? 0,
            startedAt: Date.parse(a.start_date),
          })),
        });
      }
      case 'recent_runs': {
        const token = await accessTokenFor(admin, user.id);
        const activities = await stravaGet<StravaActivity[]>(token, '/athlete/activities?per_page=30');
        return json({
          runs: activities
            .filter((a) => isRun(a) && a.map?.summary_polyline)
            .map((a) => ({
              id: String(a.id),
              name: a.name,
              startedAt: Date.parse(a.start_date),
              distanceM: a.distance,
              elapsedS: a.elapsed_time,
              device: a.device_name ?? null,
            })),
        });
      }
      case 'import': {
        const token = await accessTokenFor(admin, user.id);
        const activity = await stravaGet<StravaActivity>(token, `/activities/${encodeURIComponent(String(body.activityId))}`);
        if (!isRun(activity)) return json({ ok: false, reason: "That Strava activity isn't a run." });
        const points = await activityTrack(token, activity);
        if (points.length === 0) return json({ ok: false, reason: 'That activity has no GPS track.' });
        return json(
          await importTrack(admin, user.id, {
            source: 'strava',
            externalId: String(activity.id),
            points,
            name: activity.name,
            createRoute: body.createRoute !== false,
          }),
        );
      }
      case 'disconnect': {
        await admin.from('strava_connections').delete().eq('user_id', user.id);
        return json({ connected: false });
      }
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
