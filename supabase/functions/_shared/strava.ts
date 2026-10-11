// Strava API helpers shared by the `strava` and `strava-webhook` functions.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import type { TrackPoint } from './core/geo.ts';

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
export const STRAVA_API = 'https://www.strava.com/api/v3';
export const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string };
}

export async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
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

export async function accessTokenFor(admin: SupabaseClient, userId: string): Promise<string> {
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

export async function stravaGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${STRAVA_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Strava request failed (${res.status})`);
  return res.json();
}

export interface StravaActivity {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date: string;
  distance: number;
  moving_time: number;
  elapsed_time: number;
  total_elevation_gain?: number;
  map?: { summary_polyline?: string | null };
  device_name?: string;
}

export const isRun = (a: StravaActivity) => RUN_TYPES.has(String(a.sport_type ?? a.type));

/** The full GPS track of an activity: lat/lng, time offsets and altitude streams. */
export async function activityTrack(token: string, activity: StravaActivity): Promise<TrackPoint[]> {
  type Streams = { latlng?: { data: Array<[number, number]> }; time?: { data: number[] }; altitude?: { data: number[] } };
  const s = await stravaGet<Streams>(token, `/activities/${activity.id}/streams?keys=latlng,time,altitude&key_by_type=true`);
  const latlng = s.latlng?.data ?? [];
  const time = s.time?.data ?? [];
  const alt = s.altitude?.data;
  const t0 = Date.parse(activity.start_date);
  const out: TrackPoint[] = [];
  latlng.forEach(([lat, lng], i) => {
    const t = t0 + time[i] * 1000;
    // Streams occasionally repeat a timestamp; keep time strictly increasing.
    if (out.length && t <= out[out.length - 1].t!) return;
    out.push({ lat, lng, t, ele: alt?.[i] ?? null, acc: null });
  });
  return out;
}
