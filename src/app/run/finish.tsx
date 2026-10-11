import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { classifyResult, courseStats, type RecordOutcome } from '../../core/records';
import { RULES } from '../../core/rules';
import { formatDuration, metersToMiles } from '../../core/units';
import { currentUserId, fetchLeaderboard, rateRoute, renameRoute } from '../../data/api';
import { refreshRoutes } from '../../hooks/useAppData';
import { activeRun, clearFinishedRun } from '../../run/session';
import { defaultRouteName, syncRunById } from '../../run/sync';
import { Button } from '../../ui/components';
import { colors, space } from '../../ui/theme';

type Feel = -1 | 0 | 1;
const FEELS: { value: Feel; label: string }[] = [
  { value: -1, label: 'Easier' },
  { value: 0, label: 'About right' },
  { value: 1, label: 'Harder' },
];

/**
 * Post-run: show the result, then grade in at most two taps (stars, then feel).
 * Everything is optional; "Done" is always one tap away.
 */
export default function Finish() {
  const run = activeRun.use();
  const [outcome, setOutcome] = useState<RecordOutcome | null>(null);
  const [routeId, setRouteId] = useState<string | null>(run?.route?.id ?? null);
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState(false);
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);
  const [stars, setStars] = useState(0);
  const [name, setName] = useState('');

  const finishedCourse = run?.mode === 'course' && run.status === 'finished';
  const validAttempt = finishedCourse && !rejectedReason;
  // Until the upload answers (or if it can't), go by the live distance; afterwards, by whether a route was created.
  const isNewRoute =
    run?.mode === 'free' &&
    !rejectedReason &&
    (syncing || syncError ? metersToMiles(run.distanceM) >= RULES.minRouteMiles : routeId != null);

  useEffect(() => {
    if (!run) return;
    (async () => {
      try {
        // Read the board *before* this result is uploaded, to tell a new record from a repeat.
        const before =
          validAttempt && run.route
            ? await Promise.all([fetchLeaderboard(run.route.id, 1000), currentUserId()]).then(([b, me]) => courseStats(b, me))
            : null;
        const res = await syncRunById(run.runId);
        if (res.createdRouteId) setRouteId(res.createdRouteId);
        setRejectedReason(res.rejectedReason);
        if (before && res.verifiedElapsedS != null) setOutcome(classifyResult(res.verifiedElapsedS, before));
        void refreshRoutes();
      } catch {
        setSyncError(true); // stays queued locally; retried on next launch
      } finally {
        setSyncing(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!run) return null;

  async function done(feel: Feel | null = null) {
    const id = routeId;
    try {
      if (id && stars > 0) await rateRoute(id, stars, feel);
      if (id && isNewRoute && name.trim().length >= 2) await renameRoute(id, name.trim());
    } catch {
      // Grading is best-effort; never trap the runner on this screen.
    }
    clearFinishedRun();
    router.dismissAll();
    if (id) router.push({ pathname: '/route/[id]', params: { id } });
  }

  const canRate = !!routeId && (validAttempt || isNewRoute);

  return (
    <SafeAreaView style={s.wrap}>
      <Headline
        run={run}
        validAttempt={validAttempt}
        isNewRoute={isNewRoute}
        outcome={outcome}
        syncing={syncing}
        syncError={syncError}
        rejectedReason={rejectedReason}
      />

      {isNewRoute && (
        <TextInput
          style={s.name}
          placeholder={defaultRouteName(run.distanceM, run.startedAt)}
          value={name}
          onChangeText={setName}
          maxLength={80}
          returnKeyType="done"
        />
      )}

      {canRate && (
        <View style={{ marginTop: space.xl }}>
          <Text style={s.ask}>{stars === 0 ? 'How was the route?' : 'How did it feel?'}</Text>
          {stars === 0 ? (
            <View style={s.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                  hitSlop={8}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setStars(n);
                  }}
                >
                  <Text style={s.star}>☆</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={s.feels}>
              {FEELS.map((f) => (
                <Button key={f.value} big variant="secondary" title={f.label} style={{ flex: 1 }} onPress={() => done(f.value)} />
              ))}
            </View>
          )}
        </View>
      )}

      <View style={{ flex: 1 }} />
      <Button big title="Done" onPress={() => done(null)} />
    </SafeAreaView>
  );
}

function Headline(props: {
  run: NonNullable<ReturnType<typeof activeRun.get>>;
  validAttempt: boolean;
  isNewRoute: boolean;
  outcome: RecordOutcome | null;
  syncing: boolean;
  syncError: boolean;
  rejectedReason: string | null;
}) {
  const { run, validAttempt, isNewRoute, outcome, syncing, syncError, rejectedReason } = props;
  const time = formatDuration(run.elapsedS ?? 0);
  const mi = metersToMiles(run.distanceM).toFixed(2);

  let title: string;
  let sub: string;
  if (rejectedReason) {
    title = run.mode === 'course' ? "This run couldn't be verified" : "This run wasn't saved as a route";
    sub = `${rejectedReason} Your GPS track is still saved on your phone.`;
  } else if (run.mode === 'course' && validAttempt) {
    title =
      outcome === 'course_record' ? '🏆 New course record!'
      : outcome === 'personal_best' ? '🔥 Personal best!'
      : syncing ? 'Course complete — verifying…'
      : 'Course complete';
    sub = outcome === 'course_record' ? `Everyone running ${run.route!.name} now chases your time.` : run.route!.name;
  } else if (run.mode === 'course') {
    title = "This run didn't count";
    sub =
      run.course?.phase === 'abandoned' && (run.course.pauseCount ?? 0) > 0
        ? `You were off course when you stopped, so it doesn't count for ${run.route!.name}. Your GPS track is still saved.`
        : `You stopped before the finish of ${run.route!.name}. Your GPS track is still saved.`;
  } else if (isNewRoute) {
    title = 'New route saved';
    sub = `Only you can see it until it's ${RULES.publicMinMiles}+ mi or completed ${RULES.publicMinCompletions} times. Name it (optional):`;
  } else {
    title = 'Run saved';
    sub = `Loops need ${RULES.minRouteMiles}+ miles to become a route.`;
  }

  return (
    <View>
      <Text style={s.title}>{title}</Text>
      <Text style={s.time}>{time}</Text>
      <Text style={s.sub}>{mi} mi · {sub}</Text>
      {syncing && <ActivityIndicator style={{ marginTop: space.sm }} />}
      {syncError && <Text style={s.warn}>No connection — your result is saved and will upload automatically.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, backgroundColor: colors.bg },
  title: { fontSize: 26, fontWeight: '900', textAlign: 'center', marginTop: space.xl, color: colors.text },
  time: { fontSize: 64, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'], color: colors.primary },
  sub: { textAlign: 'center', color: colors.muted, marginTop: space.xs, lineHeight: 20 },
  warn: { textAlign: 'center', color: colors.warn, marginTop: space.sm },
  name: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
    padding: space.md, fontSize: 17, marginTop: space.md,
  },
  ask: { textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  stars: { flexDirection: 'row', justifyContent: 'center', marginTop: space.md },
  star: { fontSize: 52, color: colors.gold, marginHorizontal: 4 },
  feels: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
});
