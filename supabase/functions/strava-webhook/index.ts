// Strava push subscription: when a connected runner uploads a run (from a Garmin, COROS,
// Apple Watch, phone, ...), import it automatically — no need to open the app.
//
// Deploy without JWT verification (Strava calls it directly):
//   supabase functions deploy strava-webhook --no-verify-jwt
// Then register the subscription once (see README):
//   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
//     -F client_id=$STRAVA_CLIENT_ID -F client_secret=$STRAVA_CLIENT_SECRET \
//     -F callback_url=https://<project>.supabase.co/functions/v1/strava-webhook \
//     -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
//
// Required secrets: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_WEBHOOK_VERIFY_TOKEN
import { createClient } from 'npm:@supabase/supabase-js@2';

import { importTrack } from '../_shared/runService.ts';
import { accessTokenFor, activityTrack, isRun, stravaGet, type StravaActivity } from '../_shared/strava.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

interface StravaEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  updates?: Record<string, string>;
}

async function handle(event: StravaEvent) {
  const { data: conn } = await admin.from('strava_connections').select('user_id').eq('athlete_id', event.owner_id).maybeSingle();
  if (!conn) return;

  // The athlete revoked access from Strava's side.
  if (event.object_type === 'athlete' && event.updates?.authorized === 'false') {
    await admin.from('strava_connections').delete().eq('user_id', conn.user_id);
    return;
  }
  if (event.object_type !== 'activity' || event.aspect_type !== 'create') return;

  const token = await accessTokenFor(admin, conn.user_id);
  const activity = await stravaGet<StravaActivity>(token, `/activities/${event.object_id}`);
  if (!isRun(activity) || !activity.map?.summary_polyline) return;
  const points = await activityTrack(token, activity);
  const res = await importTrack(admin, conn.user_id, {
    source: 'strava',
    externalId: String(activity.id),
    points,
    name: activity.name,
  });
  console.log('strava import', activity.id, JSON.stringify(res));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    // Subscription validation handshake.
    if (url.searchParams.get('hub.verify_token') !== Deno.env.get('STRAVA_WEBHOOK_VERIFY_TOKEN')) {
      return new Response('forbidden', { status: 403 });
    }
    return Response.json({ 'hub.challenge': url.searchParams.get('hub.challenge') });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const event = (await req.json()) as StravaEvent;
  // Strava expects a 200 within 2 s; do the work after responding.
  EdgeRuntime.waitUntil(handle(event).catch((e) => console.error('strava webhook failed', event.object_id, e)));
  return new Response('ok');
});
