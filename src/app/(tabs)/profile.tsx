import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Link } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { config } from '../../config';
import { personalPaceModel, TIER_MODELS, type SkillTier } from '../../core/estimates';
import { publicProgressLabel } from '../../core/rules';
import { formatPace, metersToMiles } from '../../core/units';
import { saveProfile, stravaApi } from '../../data/api';
import { supabase } from '../../data/supabase';
import { profileStore, refreshProfile, tierStore, useRoutes } from '../../hooks/useAppData';
import { Button, Card, Chip, SectionTitle } from '../../ui/components';
import { colors, space } from '../../ui/theme';

WebBrowser.maybeCompleteAuthSession();

const stravaDiscovery = {
  authorizationEndpoint: 'https://www.strava.com/oauth/mobile/authorize',
  tokenEndpoint: 'https://www.strava.com/oauth/token',
};

const TIERS: SkillTier[] = ['beginner', 'intermediate', 'advanced'];

async function syncStrava() {
  const activities = await stravaApi.activities();
  const model = personalPaceModel(activities);
  if (!model) {
    Alert.alert('Not enough runs yet', 'We need at least 3 runs of 2+ km from the last 4 months on Strava.');
    return;
  }
  await saveProfile({ paceModel: model });
  await refreshProfile();
}

export default function ProfileTab() {
  const profile = profileStore.use();
  const tier = tierStore.use();
  const { routes } = useRoutes();
  const [busy, setBusy] = useState(false);
  const myRoutes = useMemo(() => routes.filter((r) => r.creatorId === profile?.id), [routes, profile?.id]);

  // Strava requires its scopes comma-separated, so pass them as one string.
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: config.stravaClientId,
      scopes: ['read,activity:read'],
      redirectUri: AuthSession.makeRedirectUri({ scheme: 'pacepath', path: 'localhost' }),
      usePKCE: false,
      extraParams: { approval_prompt: 'auto' },
    },
    stravaDiscovery,
  );

  useEffect(() => {
    if (response?.type !== 'success') return;
    void (async () => {
      setBusy(true);
      try {
        await stravaApi.exchange(response.params.code);
        await syncStrava();
      } catch (e) {
        Alert.alert('Strava', (e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [response]);

  async function resync() {
    setBusy(true);
    try {
      await syncStrava();
    } catch (e) {
      Alert.alert('Strava', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await stravaApi.disconnect();
      await saveProfile({ paceModel: null });
      await refreshProfile();
    } finally {
      setBusy(false);
    }
  }

  function pickTier(t: SkillTier) {
    tierStore.set(t);
    try { localStorage.setItem('tier', t); } catch {}
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg }}>
      <Text style={s.name}>{profile?.displayName}</Text>

      <SectionTitle>Pace for estimates</SectionTitle>
      <Card>
        {profile?.paceModel ? (
          <>
            <Text style={s.body}>
              From your Strava runs: <Text style={{ fontWeight: '800' }}>{formatPace(profile.paceModel.flat5kPaceSecPerMile)}</Text> flat 5K pace.
              Route times are estimated for you from this.
            </Text>
            <View style={s.row}>
              <Button title="Refresh from Strava" variant="secondary" onPress={resync} loading={busy} style={{ flex: 1 }} />
              <Button title="Disconnect" variant="secondary" onPress={disconnect} disabled={busy} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            <View style={{ flexDirection: 'row' }}>
              {TIERS.map((t) => (
                <Chip key={t} label={t[0].toUpperCase() + t.slice(1)} selected={tier === t} onPress={() => pickTier(t)} />
              ))}
            </View>
            <Text style={[s.body, { marginTop: space.sm }]}>
              Estimates assume a {formatPace(TIER_MODELS[tier].flat5kPaceSecPerMile)} flat 5K pace.
            </Text>
            <Button
              title="Connect Strava for personal estimates"
              onPress={() => promptAsync()}
              disabled={!request || !config.stravaClientId}
              loading={busy}
              style={{ marginTop: space.md }}
            />
          </>
        )}
      </Card>

      <SectionTitle>Your routes</SectionTitle>
      {myRoutes.length === 0 && <Text style={s.muted}>Finish a 3+ mile free run to create one.</Text>}
      {myRoutes.map((r) => (
        <Link key={r.id} href={{ pathname: '/route/[id]', params: { id: r.id } }} asChild>
          <Pressable style={s.routeRow}>
            <Text style={{ fontWeight: '700', color: colors.text }}>{r.name}</Text>
            <Text style={s.muted}>
              {metersToMiles(r.distanceM).toFixed(1)} mi · {r.completions} completions ·{' '}
              {publicProgressLabel(r.distanceM, r.completions) ?? 'Public'}
            </Text>
          </Pressable>
        </Link>
      ))}

      <Button title="Sign out" variant="secondary" style={{ marginTop: space.xl }} onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  name: { fontSize: 28, fontWeight: '900', color: colors.text },
  body: { color: colors.text, lineHeight: 20 },
  row: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  muted: { color: colors.muted, marginTop: 2 },
  routeRow: { backgroundColor: colors.card, borderRadius: 12, padding: space.md, marginBottom: space.sm, borderWidth: 1, borderColor: colors.border },
});
