import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { ingest, LOCATION_TASK } from './session';

// Must run at module load (imported from the root layout) so the task exists
// when the OS wakes the app in the background with new locations.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('location task error', error.message);
    return;
  }
  if (data?.locations?.length) await ingest(data.locations);
});
