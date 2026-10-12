// Expo push notifications (works for both APNs and FCM through Expo's push service).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Sends to every device the user is signed in on; prunes tokens Expo reports as dead. */
export async function pushToUser(admin: SupabaseClient, userId: string, msg: PushMessage): Promise<void> {
  const { data: rows } = await admin.from('push_tokens').select('token').eq('user_id', userId);
  const tokens = (rows ?? []).map((r) => r.token as string);
  if (tokens.length === 0) return;

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(tokens.map((to) => ({ to, sound: 'default', title: msg.title, body: msg.body, data: msg.data ?? {} }))),
  });
  if (!res.ok) {
    console.warn('push send failed', res.status, await res.text());
    return;
  }
  const { data: tickets } = (await res.json()) as { data: Array<{ status: string; details?: { error?: string } }> };
  const dead = tokens.filter((_, i) => tickets?.[i]?.status === 'error' && tickets[i].details?.error === 'DeviceNotRegistered');
  if (dead.length) await admin.from('push_tokens').delete().in('token', dead);
}
