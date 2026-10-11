import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RULES } from '../../core/rules';
import { formatDuration, formatPace, metersToFeet, metersToMiles } from '../../core/units';
import { activeRun, stopRun } from '../../run/session';
import { Button } from '../../ui/components';
import { colors, space } from '../../ui/theme';

export default function ActiveRun() {
  useKeepAwake();
  const run = activeRun.use();
  const [now, setNow] = useState(() => Date.now());
  const lastPhase = useRef(run?.course?.phase);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Course finished (or the run was stopped): go grade it.
  useEffect(() => {
    if (run && run.status !== 'recording') router.replace('/run/finish');
    if (!run) router.back();
  }, [run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const phase = run?.course?.phase;
    if (phase !== lastPhase.current) {
      if (phase === 'paused_off_course') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      if (phase === 'running' && lastPhase.current === 'paused_off_course') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      lastPhase.current = phase;
    }
  }, [run?.course?.phase]);

  if (!run) return null;
  const elapsedS = (now - run.startedAt) / 1000;
  const mi = metersToMiles(run.distanceM);
  const paused = run.course?.phase === 'paused_off_course';
  const course = run.course;
  const pct = course ? Math.min(1, course.progressM / course.courseLengthM) : null;
  const last = run.last;

  return (
    <SafeAreaView style={[s.wrap, paused && { backgroundColor: '#FEF3F2' }]}>
      <Text style={s.mode}>{run.route ? run.route.name : 'Free run · new loop'}</Text>

      {paused && (
        <View style={s.banner}>
          <Text style={s.bannerTitle}>Run paused — off course</Text>
          <Text style={s.bannerBody}>
            Head back to where you left the course. It counts again once you're within {RULES.rejoinRadiusFt} ft.
            {course?.distanceToCourseM != null ? ` You're ${Math.round(metersToFeet(course.distanceToCourseM))} ft away.` : ''}
          </Text>
        </View>
      )}

      <Text style={s.time}>{formatDuration(elapsedS)}</Text>
      <View style={s.row}>
        <Big label="miles" value={mi.toFixed(2)} />
        <Big label="avg pace" value={mi > 0.05 ? formatPace(elapsedS / mi).replace(' /mi', '') : '—'} />
      </View>

      {pct != null && (
        <View style={{ marginTop: space.lg }}>
          <View style={s.track}>
            <View style={[s.fill, { width: `${pct * 100}%` }, paused && { backgroundColor: colors.bad }]} />
          </View>
          <Text style={s.progress}>
            {Math.round(pct * 100)}% of course · {metersToMiles(course!.courseLengthM - course!.progressM).toFixed(2)} mi to go
          </Text>
        </View>
      )}
      {!run.route && mi < RULES.minRouteMiles && (
        <Text style={s.progress}>{(RULES.minRouteMiles - mi).toFixed(2)} mi more to save this as a route</Text>
      )}

      <View style={s.mapWrap}>
        {last && (
          <MapView
            style={StyleSheet.absoluteFill}
            region={{ latitude: last.lat, longitude: last.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 }}
            showsUserLocation
            scrollEnabled={false}
          >
            {run.route && (
              <Polyline coordinates={run.route.path.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor="#98A2B3" strokeWidth={6} />
            )}
            <Polyline coordinates={run.trail.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor={colors.primary} strokeWidth={4} />
          </MapView>
        )}
      </View>

      <Button
        big
        variant="danger"
        title="Hold to finish"
        onPress={() => void Haptics.selectionAsync()}
        onLongPress={() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          void stopRun();
        }}
      />
      {run.route && <Text style={s.hint}>Course attempts finish automatically at the finish line.</Text>}
    </SafeAreaView>
  );
}

function Big({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={s.bigValue}>{value}</Text>
      <Text style={s.bigLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: space.lg, backgroundColor: colors.bg },
  mode: { textAlign: 'center', color: colors.muted, fontWeight: '600' },
  banner: { backgroundColor: colors.bad, borderRadius: 12, padding: space.md, marginTop: space.md },
  bannerTitle: { color: '#fff', fontWeight: '800', fontSize: 17 },
  bannerBody: { color: '#fff', marginTop: 4 },
  time: { fontSize: 72, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'], marginTop: space.lg, color: colors.text },
  row: { flexDirection: 'row' },
  bigValue: { fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'], color: colors.text },
  bigLabel: { color: colors.muted },
  track: { height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10, backgroundColor: colors.good },
  progress: { textAlign: 'center', color: colors.muted, marginTop: space.sm },
  mapWrap: { flex: 1, marginVertical: space.lg, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.border },
  hint: { textAlign: 'center', color: colors.muted, marginTop: space.sm, fontSize: 12 },
});
