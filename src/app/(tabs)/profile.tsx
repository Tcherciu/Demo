import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Link, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { config } from '../../config';
import { personalPaceModel, TIER_MODELS, type SkillTier } from '../../core/estimates';
import { publicProgressLabel } from '../../core/rules';
import { formatPace, metersToMiles } from '../../core/units';
import { runsApi, saveProfile, stravaApi } from '../../data/api';
import { supabase } from '../../data/supabase';
import { profileStore, refreshProfile, refreshRoutes, tierStore, useRoutes } from '../../hooks/useAppData';
import { appleHealthAvailable, connectAppleHealth } from '../../integrations/appleHealth';
import { pickGpxTrack } from '../../integrations/gpxFile';
import { describeImport } from '../../integrations/importSummary';
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
  const [stravaConnected, setStravaConnected] = useState<boolean | null>(null);
  const myRoutes = useMemo(() => routes.filter((r) => r.creatorId === profile?.id), [routes, profile?.id]);

  // Strava requires its scopes comma-separated, so pass them as one string.
  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: config.stravaClientId,
      // activity:read_all so runs marked "Only you" on Strava can be imported too.
      scopes: ['read,activity:read_all'],
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
        setStravaConnected(true);
        await syncStrava();
      } catch (e) {
        Alert.alert('Strava', (e as Error).message);
      } finally {
        setBusy(false);
      }
    })();
  }, [response]);

  useEffect(() => {
    let cancelled = false;
    stravaApi.status().then((c) => !cancelled && setStravaConnected(c)).catch(() => !cancelled && setStravaConnected(false));
    return () => {
      cancelled = true;
    };
  }, []);

  async function importGpx() {
    try {
      const picked = await pickGpxTrack();
      if (!picked) return;
      if (picked.points.length < 2) {
        Alert.alert('No timed track', 'This GPX file has no timestamps, so it can\'t be timed as a run.');
        return;
      }
      setBusy(true);
      const res = await runsApi.importTrack({
        source: 'gpx',
        externalId: `${picked.fileName}:${picked.points[0].t}`,
        points: picked.points,
        name: picked.name,
      });
      const { title, body } = describeImport(res);
      Alert.alert(title, body);
      if (res.ok) void refreshRoutes();
    } catch (e) {
      Alert.alert("Couldn't import this file", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openAppleHealth() {
    try {
      await connectAppleHealth();
      router.push({ pathname: '/import', params: { source: 'health' } });
    } catch (e) {
      Alert.alert('Apple Health', (e as Error).message);
    }
  }

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
      setStravaConnected(false);
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
            <Text style={[s.muted, { marginTop: space.xs }]}>Connect Strava below for estimates based on your own runs.</Text>
          </>
        )}
      </Card>

      <SectionTitle>Watches & apps</SectionTitle>
      <Card>
        <Text style={s.body}>
          A watch's GPS is usually more accurate than a phone's. Import watch runs and they're checked against every
          course they pass — same rules as the app. If you also tracked the run on your phone, the watch's track
          replaces it.
        </Text>

        {Platform.OS === 'ios' && appleHealthAvailable() && (
          <View style={s.device}>
            <Text style={s.deviceName}>Apple Health</Text>
            <Text style={s.muted}>Apple Watch, plus Garmin, COROS, Polar and others that sync to Health.</Text>
            <Button title="Import a run from Apple Health" variant="secondary" onPress={openAppleHealth} style={{ marginTop: space.sm }} />
          </View>
        )}

        <View style={s.device}>
          <Text style={s.deviceName}>Strava</Text>
          {stravaConnected ? (
            <>
              <Text style={s.muted}>Connected. New runs you upload to Strava are imported automatically.</Text>
              <Button
                title="Import a Strava run"
                variant="secondary"
                onPress={() => router.push({ pathname: '/import', params: { source: 'strava' } })}
                style={{ marginTop: space.sm }}
              />
              <View style={s.row}>
                <Button title="Refresh pace" variant="secondary" onPress={resync} loading={busy} style={{ flex: 1 }} />
                <Button title="Disconnect" variant="secondary" onPress={disconnect} disabled={busy} style={{ flex: 1 }} />
              </View>
            </>
          ) : (
            <>
              <Text style={s.muted}>Personal time estimates, and automatic import from any watch that syncs to Strava.</Text>
              <Button
                title="Connect Strava"
                onPress={() => promptAsync()}
                disabled={!request || !config.stravaClientId || stravaConnected == null}
                loading={busy}
                style={{ marginTop: space.sm }}
              />
            </>
          )}
        </View>

        <View style={s.device}>
          <Text style={s.deviceName}>Garmin</Text>
          <Text style={s.muted}>
            In the Garmin Connect app, turn on sharing to {Platform.OS === 'ios' ? 'Apple Health or ' : ''}Strava and your runs
            arrive through it. Or export a run as GPX and import the file.
          </Text>
        </View>

        <View style={s.device}>
          <Text style={s.deviceName}>GPX file</Text>
          <Text style={s.muted}>Any watch or app that can export GPX.</Text>
          <Button title="Import a GPX file" variant="secondary" onPress={importGpx} loading={busy} style={{ marginTop: space.sm }} />
        </View>
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
  device: { marginTop: space.lg, paddingTop: space.md, borderTopWidth: 1, borderColor: colors.border },
  deviceName: { fontWeight: '800', fontSize: 15, color: colors.text, marginBottom: 2 },
  routeRow: { backgroundColor: colors.card, borderRadius: 12, padding: space.md, marginBottom: space.sm, borderWidth: 1, borderColor: colors.border },
});
