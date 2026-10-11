import {
  isHealthDataAvailable,
  queryWorkoutSamples,
  requestAuthorization,
  WorkoutActivityType,
  WorkoutRouteTypeIdentifier,
  WorkoutTypeIdentifier,
} from '@kingstinct/react-native-healthkit';
import { Platform } from 'react-native';

import type { TrackPoint } from '../core/geo';

/**
 * Apple Health on iOS: runs recorded on an Apple Watch, plus any app that writes workouts
 * with routes to Health — Garmin Connect, COROS, Polar, Suunto, Wahoo, ... — so one
 * integration covers most watches. Watch GPS is generally better than a phone's.
 */
export interface HealthRun {
  id: string;
  startedAt: number;
  durationS: number;
  distanceM: number | null;
  /** Which app or device recorded it ("Apple Watch", "Garmin Connect", ...). */
  sourceName: string;
}

export const appleHealthAvailable = () => Platform.OS === 'ios' && isHealthDataAvailable();

export async function connectAppleHealth(): Promise<boolean> {
  return requestAuthorization({ toRead: [WorkoutTypeIdentifier, WorkoutRouteTypeIdentifier] });
}

async function recentWorkouts(days: number) {
  return queryWorkoutSamples({
    limit: 50,
    ascending: false,
    filter: {
      workoutActivityType: WorkoutActivityType.running,
      date: { startDate: new Date(Date.now() - days * 86_400_000) },
    },
  });
}

export async function recentHealthRuns(days = 30): Promise<HealthRun[]> {
  const workouts = await recentWorkouts(days);
  return workouts.map((w) => ({
    id: w.uuid,
    startedAt: w.startDate.getTime(),
    durationS: (w.endDate.getTime() - w.startDate.getTime()) / 1000,
    distanceM: w.totalDistance ? toMeters(w.totalDistance.quantity, w.totalDistance.unit) : null,
    sourceName: w.sourceRevision?.source?.name ?? w.device?.name ?? 'Apple Health',
  }));
}

/** The workout's GPS route. Empty for treadmill runs or apps that don't share routes. */
export async function healthRunTrack(id: string): Promise<TrackPoint[]> {
  const [workout] = await queryWorkoutSamples({ limit: 1, filter: { uuid: id } });
  if (!workout) return [];
  const routes = await workout.getWorkoutRoutes();
  const points = routes
    .flatMap((r) => r.locations)
    .map((l) => ({
      lat: l.latitude,
      lng: l.longitude,
      ele: l.altitude,
      acc: l.horizontalAccuracy >= 0 ? l.horizontalAccuracy : null,
      t: l.date.getTime(),
    }))
    .sort((a, b) => a.t - b.t);
  return points.filter((p, i) => i === 0 || p.t > points[i - 1].t);
}

function toMeters(quantity: number, unit: string): number {
  if (unit === 'm') return quantity;
  if (unit === 'km') return quantity * 1000;
  if (unit === 'mi') return quantity * 1609.344;
  return quantity;
}
