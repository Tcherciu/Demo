import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import type { TrackPoint } from '../core/geo';
import { toTrackPoint } from '../run/session';

/** Foreground GPS, e.g. for "you're 140 ft from the start" before a run begins. */
export function useCurrentLocation(enabled = true): { point: TrackPoint | null; error: string | null } {
  const [point, setPoint] = useState<TrackPoint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission is off.');
        return;
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1, timeInterval: 1000 },
        (l) => setPoint(toTrackPoint(l)),
      );
      if (cancelled) sub.remove();
    })().catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return { point, error };
}
