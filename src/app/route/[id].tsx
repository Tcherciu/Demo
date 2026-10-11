import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, Polyline } from 'react-native-maps';

import { climbDensityFtPerMile } from '../../core/difficulty';
import { estimateAllTiers, estimateSeconds } from '../../core/estimates';
import { boundingBox, haversine } from '../../core/geo';
import { courseStats } from '../../core/records';
import { publicProgressLabel, RULES, START_RADIUS_M } from '../../core/rules';
import { formatDuration, metersToFeet, metersToMiles } from '../../core/units';
import { currentUserId, fetchLeaderboard, fetchRoute, type LeaderboardEntry, type RouteDetail } from '../../data/api';
import { savedStore, toggleSaved, usePaceModel } from '../../hooks/useAppData';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { activeRun, ensurePermissions, startCourseRun } from '../../run/session';
import { Button, Card, DifficultyBadge, SectionTitle, Stat, StarsText } from '../../ui/components';
import { colors, space } from '../../ui/theme';

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const saved = savedStore.use().has(id);
  const { model, personal } = usePaceModel();
  const { point } = useCurrentLocation();
  const running = activeRun.use()?.status === 'recording';

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchRoute(id), fetchLeaderboard(id, 200), currentUserId()])
      .then(([r, b, u]) => {
        if (cancelled) return;
        setRoute(r);
        setBoard(b);
        setUserId(u);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <Text style={{ padding: space.lg, color: colors.bad }}>{error}</Text>;
  if (!route) return <ActivityIndicator style={{ marginTop: 64 }} />;

  const tiers = estimateAllTiers(route.equivalentFlatM);
  const mine = estimateSeconds(route.equivalentFlatM, model);
  // The leaderboard already holds each runner's best, so stats over it give the right PB and record.
  const stats = courseStats(board, userId);
  const toStartM = point ? haversine(point, route.path[0]) : null;
  const atStart = toStartM != null && toStartM <= START_RADIUS_M;
  const bbox = boundingBox(route.path);
  const progress = publicProgressLabel(route.distanceM, route.completions);

  async function start() {
    if (!point || !route) return;
    setStarting(true);
    const permError = await ensurePermissions();
    if (permError) {
      setStarting(false);
      Alert.alert('Location needed', permError);
      return;
    }
    const err = await startCourseRun(route, point);
    setStarting(false);
    if (err) Alert.alert('Not at the start yet', err);
    else router.push('/run/active');
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: route.name,
          headerRight: () => (
            <Pressable hitSlop={12} onPress={() => toggleSaved(route.id).catch(() => {})}>
              <Ionicons name={saved ? 'heart' : 'heart-outline'} size={24} color={saved ? colors.primary : colors.text} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <MapView
          style={s.map}
          initialRegion={{
            latitude: (bbox.minLat + bbox.maxLat) / 2,
            longitude: (bbox.minLng + bbox.maxLng) / 2,
            latitudeDelta: (bbox.maxLat - bbox.minLat) * 1.4 + 0.005,
            longitudeDelta: (bbox.maxLng - bbox.minLng) * 1.4 + 0.005,
          }}
          showsUserLocation
        >
          <Polyline coordinates={route.path.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor={colors.primary} strokeWidth={4} />
          <Circle
            center={{ latitude: route.path[0].lat, longitude: route.path[0].lng }}
            radius={START_RADIUS_M}
            fillColor="rgba(18,183,106,0.25)"
            strokeColor={colors.good}
          />
          <Marker coordinate={{ latitude: route.path[0].lat, longitude: route.path[0].lng }} title="Start" pinColor="green" />
        </MapView>

        <View style={{ padding: space.lg }}>
          <View style={s.row}>
            <DifficultyBadge score={route.difficulty} />
            <StarsText rating={route.avgRating} count={route.ratingCount} />
          </View>
          {progress && <Text style={s.private}>🔒 Only you can see this route — {progress} (or make it 10+ mi).</Text>}

          <Card style={{ marginTop: space.md }}>
            <View style={s.row}>
              <Stat label="miles" value={metersToMiles(route.distanceM).toFixed(2)} />
              <Stat label="ft gain" value={String(Math.round(metersToFeet(route.elevationGainM)))} />
              <Stat label="ft / mi" value={String(Math.round(climbDensityFtPerMile(route)))} />
              <Stat label="flat-equiv mi" value={metersToMiles(route.equivalentFlatM).toFixed(1)} />
            </View>
          </Card>

          <SectionTitle>Estimated time</SectionTitle>
          <Card>
            <View style={s.row}>
              <Stat label="Beginner" value={formatDuration(tiers.beginner)} />
              <Stat label="Intermediate" value={formatDuration(tiers.intermediate)} />
              <Stat label="Advanced" value={formatDuration(tiers.advanced)} />
            </View>
            {personal && (
              <Text style={s.personal}>
                For you (from your Strava runs): <Text style={{ fontWeight: '800' }}>{formatDuration(mine)}</Text>
              </Text>
            )}
          </Card>

          <SectionTitle>Course times</SectionTitle>
          <Card>
            <View style={s.row}>
              <Stat label="Average" value={stats.completions ? formatDuration(route.averageS ?? 0) : '—'} />
              <Stat label="Your best" value={stats.personalBest ? formatDuration(stats.personalBest.elapsedS) : '—'} highlight />
              <Stat label={stats.courseRecord ? `Record · ${stats.courseRecord.displayName}` : 'Record'} value={stats.courseRecord ? formatDuration(stats.courseRecord.elapsedS) : '—'} />
            </View>
          </Card>

          {board.length > 0 && (
            <>
              <SectionTitle>Leaderboard</SectionTitle>
              <Card>
                {board.map((e, i) => ({ e, i })).filter(({ e, i }) => i < 10 || e.userId === userId).map(({ e, i }) => (
                  <View key={e.userId} style={[s.boardRow, e.userId === userId && { backgroundColor: '#FFF4ED' }]}>
                    <Text style={s.rank}>{i === 0 ? '🏆' : i + 1}</Text>
                    <Text style={{ flex: 1, color: colors.text }}>{e.displayName}</Text>
                    <Text style={s.time}>{formatDuration(e.elapsedS)}</Text>
                  </View>
                ))}
              </Card>
            </>
          )}
          <Text style={s.rules}>
            Start within {RULES.startRadiusFt} ft of the green start point. If you get more than {RULES.maxDeviationMiles} mi off course
            your run pauses until you're back within {RULES.rejoinRadiusFt} ft of the course; the clock keeps running.
          </Text>
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Text style={s.toStart}>
          {toStartM == null
            ? 'Finding your location…'
            : atStart
              ? "You're at the start."
              : `${toStartM > 1609 ? `${metersToMiles(toStartM).toFixed(1)} mi` : `${Math.round(metersToFeet(toStartM))} ft`} from the start — get within ${RULES.startRadiusFt} ft`}
        </Text>
        <Button big title={running ? 'A run is in progress' : 'Start run'} disabled={!atStart || running} loading={starting} onPress={start} />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  map: { height: 260, width: '100%' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  private: { marginTop: space.md, color: colors.muted },
  personal: { marginTop: space.md, textAlign: 'center', color: colors.text },
  boardRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, borderRadius: 8 },
  rank: { width: 32, textAlign: 'center', color: colors.muted, fontWeight: '700' },
  time: { fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.text },
  rules: { color: colors.muted, fontSize: 12, marginTop: space.xl, lineHeight: 18 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: space.xl,
    backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border,
  },
  toStart: { textAlign: 'center', color: colors.muted, marginBottom: space.sm },
});
