// Strava OAuth token exchange + activity fetch. Runs on Supabase Edge Functions (Deno).
// The client secret lives only here; the app never sees Strava tokens.
//
// Required secrets: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.)
import { createClient } from 'npm:@supabase/supabase-js@2';

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API = 'https://www.strava.com/api/v3';
const LOOKBACK_DAYS = 120;
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string };
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('STRAVA_CLIENT_ID')!,
      client_secret: Deno.env.get('STRAVA_CLIENT_SECRET')!,
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`Strava token request failed (${res.status})`);
  return res.json();
}

async function accessTokenFor(userId: string): Promise<string> {
  const { data, error } = await admin.from('strava_connections').select('*').eq('user_id', userId).single();
  if (error || !data) throw new Error('Strava not connected');
  // Refresh a little early so the token can't expire mid-request.
  if (new Date(data.expires_at).getTime() - 60_000 > Date.now()) return data.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: data.refresh_token });
  await admin
    .from('strava_connections')
    .update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(t.expires_at * 1000).toISOString() })
    .eq('user_id', userId);
  return t.access_token;
}

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
        await admin.from('strava_connections').upsert({
          user_id: user.id,
          athlete_id: t.athlete!.id,
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          expires_at: new Date(t.expires_at * 1000).toISOString(),
        });
        return json({ connected: true, athleteName: t.athlete?.firstname ?? null });
      }
      case 'activities': {
        const token = await accessTokenFor(user.id);
        const after = Math.floor(Date.now() / 1000) - LOOKBACK_DAYS * 86_400;
        const res = await fetch(`${STRAVA_API}/athlete/activities?per_page=100&after=${after}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Strava activities request failed (${res.status})`);
        const activities: Array<Record<string, unknown>> = await res.json();
        return json({
          activities: activities
            .filter((a) => RUN_TYPES.has(String(a.sport_type ?? a.type)))
            .map((a) => ({
              distanceM: a.distance,
              movingTimeS: a.moving_time,
              elevationGainM: a.total_elevation_gain ?? 0,
              startedAt: Date.parse(String(a.start_date)),
            })),
        });
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
