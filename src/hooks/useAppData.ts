import { useEffect } from 'react';

import { TIER_MODELS, type PaceModel, type SkillTier } from '../core/estimates';
import type { RouteSummary } from '../core/filters';
import { fetchProfile, fetchRoutes, fetchSavedIds, setSaved, type Profile } from '../data/api';
import { createStore } from '../data/store';

/**
 * Shared app data. Screens read from these stores so that saving a route on the detail
 * screen immediately shows on Browse, a new record shows up everywhere after a refresh, etc.
 */
export const routesStore = createStore<{ routes: RouteSummary[]; loading: boolean; error: string | null }>({
  routes: [],
  loading: false,
  error: null,
});
export const savedStore = createStore<Set<string>>(new Set());
export const profileStore = createStore<Profile | null>(null);
/** Tier picked by the runner; used when they have no personal (Strava) pace model. */
export const tierStore = createStore<SkillTier>('intermediate');

export async function refreshRoutes() {
  routesStore.set((s) => ({ ...s, loading: true, error: null }));
  try {
    const [routes, saved] = await Promise.all([fetchRoutes(), fetchSavedIds()]);
    routesStore.set({ routes, loading: false, error: null });
    savedStore.set(saved);
  } catch (e) {
    routesStore.set((s) => ({ ...s, loading: false, error: (e as Error).message }));
  }
}

export async function refreshProfile() {
  profileStore.set(await fetchProfile());
}

export async function toggleSaved(routeId: string) {
  const was = savedStore.get().has(routeId);
  const next = new Set(savedStore.get());
  if (was) next.delete(routeId);
  else next.add(routeId);
  savedStore.set(next); // optimistic
  try {
    await setSaved(routeId, !was);
  } catch (e) {
    savedStore.set((s) => {
      const revert = new Set(s);
      if (was) revert.add(routeId);
      else revert.delete(routeId);
      return revert;
    });
    throw e;
  }
}

export function useRoutes() {
  const state = routesStore.use();
  useEffect(() => {
    if (state.routes.length === 0 && !state.loading && !state.error) void refreshRoutes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, refresh: refreshRoutes };
}

/** The pace model estimates should use for this runner: personal if available, else their tier. */
export function usePaceModel(): { model: PaceModel; personal: boolean } {
  const profile = profileStore.use();
  const tier = tierStore.use();
  if (profile?.paceModel) return { model: profile.paceModel, personal: true };
  return { model: TIER_MODELS[tier], personal: false };
}
