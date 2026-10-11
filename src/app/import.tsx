import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration, metersToMiles } from '../core/units';
import { runsApi, stravaApi, type ImportOutcome, type VerifyResult } from '../data/api';
import { refreshRoutes } from '../hooks/useAppData';
import { healthRunTrack, recentHealthRuns } from '../integrations/appleHealth';
import { describeImport } from '../integrations/importSummary';
import { colors, space } from '../ui/theme';

type Source = 'health' | 'strava';

interface Row {
  id: string;
  title: string;
  subtitle: string;
}

const IMPORTED_KEY = 'importedRuns';
function loadImported(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(IMPORTED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function saveImported(ids: Set<string>) {
  try { localStorage.setItem(IMPORTED_KEY, JSON.stringify([...ids].slice(-500))); } catch {}
}

/** Pick a recent watch / Strava run to check against the course library. */
export default function ImportScreen() {
  const { source } = useLocalSearchParams<{ source: Source }>();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [imported, setImported] = useState(loadImported);

  useEffect(() => {
    let cancelled = false;
    const load: Promise<Row[]> =
      source === 'strava'
        ? stravaApi.recentRuns().then((runs) =>
            runs.map((r) => ({
              id: `strava:${r.id}`,
              title: r.name,
              subtitle: `${when(r.startedAt)} · ${metersToMiles(r.distanceM).toFixed(2)} mi · ${formatDuration(r.elapsedS)}${r.device ? ` · ${r.device}` : ''}`,
            })),
          )
        : recentHealthRuns().then((runs) =>
            runs.map((r) => ({
              id: `health:${r.id}`,
              title: r.sourceName,
              subtitle: `${when(r.startedAt)}${r.distanceM ? ` · ${metersToMiles(r.distanceM).toFixed(2)} mi` : ''} · ${formatDuration(r.durationS)}`,
            })),
          );
    load.then((r) => !cancelled && setRows(r)).catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [source]);

  async function importRow(row: Row) {
    setBusyId(row.id);
    try {
      let res: VerifyResult<ImportOutcome>;
      const [kind, externalId] = [row.id.slice(0, row.id.indexOf(':')), row.id.slice(row.id.indexOf(':') + 1)];
      if (kind === 'strava') {
        res = await stravaApi.importActivity(externalId);
      } else {
        const points = await healthRunTrack(externalId);
        if (points.length === 0) {
          Alert.alert('No GPS route', 'This workout has no route (treadmill run, or the app that recorded it doesn\'t share routes with Health).');
          return;
        }
        res = await runsApi.importTrack({ source: 'apple_health', externalId, points });
      }
      const { title, body } = describeImport(res);
      Alert.alert(title, body);
      if (res.ok) {
        const next = new Set(imported).add(row.id);
        setImported(next);
        saveImported(next);
        void refreshRoutes();
      }
    } catch (e) {
      Alert.alert("Couldn't import this run", (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: source === 'strava' ? 'Import from Strava' : 'Import from Apple Health' }} />
      {error ? (
        <Text style={s.error}>{error}</Text>
      ) : !rows ? (
        <ActivityIndicator style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: space.lg, gap: space.sm }}
          ListHeaderComponent={
            <Text style={s.hint}>
              Pick a run. We check it against every course whose start it passes — times count if it followed the course
              under the same rules as a run in the app.
            </Text>
          }
          ListEmptyComponent={<Text style={s.hint}>No runs with GPS in the last 30 days.</Text>}
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => importRow(item)} disabled={busyId != null}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{item.title}</Text>
                <Text style={s.sub}>{item.subtitle}</Text>
              </View>
              {busyId === item.id ? <ActivityIndicator /> : <Text style={s.action}>{imported.has(item.id) ? 'Imported ✓' : 'Import'}</Text>}
            </Pressable>
          )}
        />
      )}
    </>
  );
}

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const s = StyleSheet.create({
  hint: { color: colors.muted, marginBottom: space.md, lineHeight: 19 },
  error: { color: colors.bad, padding: space.lg },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12,
    padding: space.md, borderWidth: 1, borderColor: colors.border,
  },
  title: { fontWeight: '700', color: colors.text },
  sub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  action: { color: colors.primary, fontWeight: '700', marginLeft: space.md },
});
