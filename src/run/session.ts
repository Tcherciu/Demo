import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

import { CourseTracker, type TrackerEvent, type TrackerSnapshot } from '../core/courseTracker';
import { haversine, type LatLng, type TrackPoint } from '../core/geo';
import { RULES } from '../core/rules';
import { cacheRoute, cachedRoute, getActiveRun, getRunPoints, insertRun, appendPoints, updateRun, type RunMode } from '../data/localDb';
import type { RouteDetail } from '../data/api';
import { createStore } from '../data/store';

export const LOCATION_TASK = 'pacepath-run-location';

export interface ActiveRun {
  runId: string;
  mode: RunMode;
  route: Pick<RouteDetail, 'id' | 'name' | 'path' | 'distanceM'> | null;
  startedAt: number;
  distanceM: number;
  /** Drawn on the live map; thinned so it stays cheap to render. */
  trail: LatLng[];
  last: TrackPoint | null;
  course: TrackerSnapshot | null;
  status: 'recording' | 'finished' | 'abandoned';
  elapsedS: number | null;
}

export const activeRun = createStore<ActiveRun | null>(null);

/** Fixes worse than this don't add to distance — GPS wander would inflate it. */
const MAX_DISTANCE_ACCURACY_M = 25;
const TRAIL_MIN_SPACING_M = 8;

let tracker: CourseTracker | null = null;
let ingestQueue: Promise<void> = Promise.resolve();

export function toTrackPoint(l: Location.LocationObject): TrackPoint {
  return {
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    ele: l.coords.altitude,
    acc: l.coords.accuracy,
    t: l.timestamp,
    mocked: l.mocked === true,
  };
}

export async function ensurePermissions(): Promise<string | null> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'Location access is needed to track your run.';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status !== 'granted') return 'Allow location "Always" so your run keeps recording with the screen off.';
  await Notifications.requestPermissionsAsync();
  return null;
}

async function startUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    activityType: Location.LocationActivityType.Fitness,
    distanceInterval: 3,
    timeInterval: 1000,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'PacePath is recording your run',
      notificationBody: 'Tap to return to your run.',
      killServiceOnDestroy: false,
    },
  });
}

async function stopUpdates() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/** Free run: records a new loop. Saved as a route if it ends up ≥ 3 miles. */
export async function startFreeRun(at: TrackPoint): Promise<void> {
  const runId = Crypto.randomUUID();
  const startedAt = at.t ?? Date.now();
  tracker = null;
  await insertRun({ id: runId, mode: 'free', route_id: null, started_at: startedAt });
  await appendPoints(runId, [at]);
  activeRun.set({
    runId, mode: 'free', route: null, startedAt, distanceM: 0, trail: [at], last: at,
    course: null, status: 'recording', elapsedS: null,
  });
  await startUpdates();
}

/**
 * Course attempt. Refuses to start unless the runner is within 20 ft of the start —
 * the UI disables the button too, but this is the check that counts.
 */
export async function startCourseRun(route: RouteDetail, at: TrackPoint): Promise<string | null> {
  const t = new CourseTracker(route.path);
  const started = t.begin(at);
  if (!started) {
    return `Get within ${RULES.startRadiusFt} ft of the start to begin.`;
  }
  tracker = t;
  const runId = Crypto.randomUUID();
  await cacheRoute(route.id, route);
  await insertRun({ id: runId, mode: 'course', route_id: route.id, started_at: started.at });
  await appendPoints(runId, [at]);
  activeRun.set({
    runId, mode: 'course', route: { id: route.id, name: route.name, path: route.path, distanceM: route.distanceM },
    startedAt: started.at, distanceM: 0, trail: [at], last: at, course: t.snapshot(), status: 'recording', elapsedS: null,
  });
  await startUpdates();
  return null;
}

/** Called by the background location task. Serialised so fixes are processed in order. */
export function ingest(locations: Location.LocationObject[]): Promise<void> {
  ingestQueue = ingestQueue.then(() => ingestNow(locations)).catch((e) => console.warn('ingest failed', e));
  return ingestQueue;
}

async function ingestNow(locations: Location.LocationObject[]) {
  if (!activeRun.get()) await rehydrate();
  const run = activeRun.get();
  if (!run || run.status !== 'recording') return;

  const points = locations.map(toTrackPoint).sort((a, b) => a.t! - b.t!);
  await appendPoints(run.runId, points);

  let { distanceM, last, trail } = run;
  const events: TrackerEvent[] = [];
  for (const p of points) {
    if (last && p.t! <= last.t!) continue;
    if (last && (p.acc ?? 0) <= MAX_DISTANCE_ACCURACY_M) distanceM += haversine(last, p);
    if ((p.acc ?? 0) <= MAX_DISTANCE_ACCURACY_M || !last) last = p;
    if (haversine(trail[trail.length - 1], p) >= TRAIL_MIN_SPACING_M) trail = [...trail, p];
    if (tracker) events.push(...tracker.update(p));
  }

  activeRun.set({ ...run, distanceM, last, trail, course: tracker?.snapshot() ?? null });
  await updateRun(run.runId, { distance_m: distanceM, pause_count: tracker?.snapshot().pauseCount ?? 0 });

  for (const e of events) await handleEvent(e);
}

async function handleEvent(e: TrackerEvent) {
  const run = activeRun.get()!;
  switch (e.type) {
    case 'paused':
      await notify(
        'Run paused — off course',
        `You've gone ${RULES.maxDeviationMiles} mi off ${run.route?.name ?? 'the course'}. ` +
          `Get back within ${RULES.rejoinRadiusFt} ft of the course to keep this run counting. The clock is still running.`,
      );
      break;
    case 'resumed':
      await notify('Back on course', 'Your run is counting again.');
      break;
    case 'finished':
      await finishRun(e.elapsedS, e.at);
      await notify('Course complete!', 'Open PacePath to see how you did.');
      break;
  }
}

async function notify(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({ content: { title, body, sound: true }, trigger: null });
}

async function finishRun(elapsedS: number, at: number) {
  const run = activeRun.get()!;
  await stopUpdates();
  await updateRun(run.runId, { status: 'finished', ended_at: at, elapsed_s: elapsedS, valid_attempt: 1 });
  activeRun.set({ ...run, status: 'finished', elapsedS });
}

/**
 * Runner pressed stop. A course attempt that hadn't reached the finish doesn't count
 * for that course (its GPS track is still kept on the device).
 */
export async function stopRun(): Promise<void> {
  const run = activeRun.get();
  if (!run || run.status !== 'recording') return;
  await stopUpdates();
  const now = Date.now();
  const elapsedS = (now - run.startedAt) / 1000;
  if (run.mode === 'course') {
    tracker?.abandon();
    await updateRun(run.runId, { status: 'abandoned', ended_at: now, elapsed_s: elapsedS });
    activeRun.set({ ...run, status: 'abandoned', elapsedS, course: tracker?.snapshot() ?? null });
  } else {
    await updateRun(run.runId, { status: 'finished', ended_at: now, elapsed_s: elapsedS });
    activeRun.set({ ...run, status: 'finished', elapsedS });
  }
}

/**
 * App launched (foreground) with a run still marked as recording — e.g. the OS killed it.
 * Rebuild state and make sure GPS updates are flowing again.
 */
export async function resumeActiveRun(): Promise<void> {
  if (!activeRun.get()) await rehydrate();
  if (activeRun.get()?.status === 'recording') await startUpdates();
}

export function clearFinishedRun() {
  if (activeRun.get()?.status !== 'recording') activeRun.set(null);
  tracker = null;
}

/** If the OS relaunched the app mid-run, rebuild state from what's on disk. */
export async function rehydrate(): Promise<void> {
  const row = await getActiveRun();
  if (!row) return;
  const points = await getRunPoints(row.id);
  if (points.length === 0) return;
  let route: RouteDetail | null = null;
  tracker = null;
  if (row.mode === 'course' && row.route_id) {
    route = await cachedRoute<RouteDetail>(row.route_id);
    if (route) {
      tracker = new CourseTracker(route.path);
      // The first stored point was verified at the start when the run began.
      tracker.begin({ ...route.path[0], t: points[0].t });
      for (const p of points.slice(1)) tracker.update(p);
    }
  }
  let distanceM = 0;
  let last: TrackPoint = points[0];
  for (const p of points.slice(1)) {
    if ((p.acc ?? 0) <= MAX_DISTANCE_ACCURACY_M) {
      distanceM += haversine(last, p);
      last = p;
    }
  }
  activeRun.set({
    runId: row.id,
    mode: row.mode,
    route: route ? { id: route.id, name: route.name, path: route.path, distanceM: route.distanceM } : null,
    startedAt: row.started_at,
    distanceM,
    trail: points.filter((_, i) => i % 5 === 0),
    last,
    course: tracker?.snapshot() ?? null,
    status: 'recording',
    elapsedS: null,
  });
  const snap = tracker?.snapshot();
  if (snap?.phase === 'finished') await finishRun((snap.finishedAt! - snap.startedAt!) / 1000, snap.finishedAt!);
}
