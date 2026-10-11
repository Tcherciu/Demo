import { haversine, type LatLng } from './geo';
import type { SkillTier } from './estimates';
import { metersToMiles } from './units';

export interface RouteSummary {
  id: string;
  name: string;
  creatorId: string;
  distanceM: number;
  elevationGainM: number;
  equivalentFlatM: number;
  difficulty: number;
  start: LatLng;
  isPublic: boolean;
  completions: number;
  avgRating: number | null;
  ratingCount: number;
  averageS: number | null;
  recordS: number | null;
  recordHolder: string | null;
  createdAt: number;
}

export type SortKey = 'nearest' | 'rating' | 'difficulty_asc' | 'difficulty_desc' | 'distance' | 'popular' | 'newest';

export interface RouteFilter {
  query?: string;
  minMiles?: number;
  maxMiles?: number;
  minDifficulty?: number;
  maxDifficulty?: number;
  minRating?: number;
  /** Only routes starting inside this circle (the metro area the library covers). */
  area?: { center: LatLng; radiusMiles: number };
  /** The runner's position, for "nearest" sorting. */
  near?: LatLng;
  savedOnly?: boolean;
  savedIds?: ReadonlySet<string>;
  sort?: SortKey;
}

/** Difficulty bands that read naturally as "what's right for me" on the Browse screen. */
export const TIER_DIFFICULTY: Record<SkillTier, [number, number]> = {
  beginner: [1, 4.5],
  intermediate: [3, 7],
  advanced: [5, 10],
};

export function applyFilter(routes: readonly RouteSummary[], f: RouteFilter): RouteSummary[] {
  const q = f.query?.trim().toLowerCase();
  const out = routes.filter((r) => {
    const mi = metersToMiles(r.distanceM);
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (f.minMiles != null && mi < f.minMiles) return false;
    if (f.maxMiles != null && mi > f.maxMiles) return false;
    if (f.minDifficulty != null && r.difficulty < f.minDifficulty) return false;
    if (f.maxDifficulty != null && r.difficulty > f.maxDifficulty) return false;
    if (f.minRating != null && (r.avgRating ?? 0) < f.minRating) return false;
    if (f.savedOnly && !f.savedIds?.has(r.id)) return false;
    if (f.area && metersToMiles(haversine(f.area.center, r.start)) > f.area.radiusMiles) return false;
    return true;
  });

  const sort = f.sort ?? (f.near ? 'nearest' : 'rating');
  const near = f.near;
  const cmp: Record<SortKey, (a: RouteSummary, b: RouteSummary) => number> = {
    nearest: (a, b) => (near ? haversine(near, a.start) - haversine(near, b.start) : 0),
    // Bayesian average so one 5★ rating doesn't outrank fifty 4.8★ ratings.
    rating: (a, b) => bayesianRating(b) - bayesianRating(a),
    difficulty_asc: (a, b) => a.difficulty - b.difficulty,
    difficulty_desc: (a, b) => b.difficulty - a.difficulty,
    distance: (a, b) => a.distanceM - b.distanceM,
    popular: (a, b) => b.completions - a.completions,
    newest: (a, b) => b.createdAt - a.createdAt,
  };
  return out.sort(cmp[sort]);
}

const PRIOR_MEAN = 3.5;
const PRIOR_WEIGHT = 5;
export function bayesianRating(r: Pick<RouteSummary, 'avgRating' | 'ratingCount'>): number {
  const sum = (r.avgRating ?? 0) * r.ratingCount;
  return (sum + PRIOR_MEAN * PRIOR_WEIGHT) / (r.ratingCount + PRIOR_WEIGHT);
}
