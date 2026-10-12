// Account deletion, as the App Store requires for apps with sign-up.
// Deleting the auth user cascades through the database (see the account-deletion migration):
// profile, attempts, ratings, saved routes, private routes, push tokens, notifications and
// Strava tokens. Public routes the runner created stay for everyone else, unattributed.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { accessTokenFor } from '../_shared/strava.ts';

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

  const body = await req.json().catch(() => ({}));
  if (body.action !== 'delete' || body.confirm !== 'DELETE') return json({ error: 'confirmation required' }, 400);

  // Revoke loopd's access on Strava's side too (best effort; the tokens are deleted regardless).
  try {
    const token = await accessTokenFor(admin, user.id);
    await fetch('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: token }),
    });
  } catch {
    // Not connected to Strava, or Strava unreachable.
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json({ error: error.message }, 500);
  return json({ deleted: true });
});
