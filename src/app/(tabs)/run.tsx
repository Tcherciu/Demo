import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { RULES } from '../../core/rules';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { activeRun, ensurePermissions, startFreeRun } from '../../run/session';
import { Button, Card } from '../../ui/components';
import { colors, space } from '../../ui/theme';

/** Free run: record a new loop. Course runs start from a route's page. */
export default function RunTab() {
  const run = activeRun.use();
  const { point, error } = useCurrentLocation();
  const [busy, setBusy] = useState(false);
  const gpsReady = point != null && (point.acc ?? 99) <= 30;

  async function start() {
    setBusy(true);
    const permError = await ensurePermissions();
    if (permError) {
      setBusy(false);
      Alert.alert('Location needed', permError);
      return;
    }
    await startFreeRun(point!);
    setBusy(false);
    router.push('/run/active');
  }

  if (run?.status === 'recording') {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>Run in progress</Text>
        <Button big title="Back to run" onPress={() => router.push('/run/active')} />
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <Text style={s.title}>Create a loop</Text>
      <Card>
        <Text style={s.body}>
          Run anywhere. When you finish, if it's {RULES.minRouteMiles}+ miles it's saved as your route with a difficulty
          score and time estimates.
        </Text>
        <Text style={[s.body, { marginTop: space.sm }]}>
          Other runners see it once it's {RULES.publicMinMiles}+ miles or has been completed {RULES.publicMinCompletions} times.
        </Text>
      </Card>
      <Text style={s.gps}>{error ?? (gpsReady ? 'GPS ready' : 'Waiting for a good GPS signal…')}</Text>
      <Button big title="Start free run" disabled={!gpsReady} loading={busy} onPress={start} />
      <Text style={s.hint}>Want to race an existing route? Pick one on the Routes tab.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, justifyContent: 'center', gap: space.lg },
  title: { fontSize: 28, fontWeight: '900', color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  gps: { textAlign: 'center', color: colors.muted },
  hint: { textAlign: 'center', color: colors.muted, fontSize: 13 },
});
