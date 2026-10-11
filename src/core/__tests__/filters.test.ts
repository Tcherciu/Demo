import { applyFilter, bayesianRating, type RouteSummary } from '../filters';
import { milesToMeters } from '../units';
import { offset } from './helpers';

const route = (id: string, over: Partial<RouteSummary>): RouteSummary => ({
  id, name: id, creatorId: 'u', distanceM: milesToMeters(5), elevationGainM: 0, equivalentFlatM: milesToMeters(5),
  difficulty: 5, start: offset(0, 0), isPublic: true, completions: 0, avgRating: null, ratingCount: 0,
  averageS: null, recordS: null, recordHolder: null, createdAt: 0, ...over,
});

const routes = [
  route('near-easy', { difficulty: 2, distanceM: milesToMeters(3.2), start: offset(500, 0), avgRating: 4.2, ratingCount: 30 }),
  route('far-hard', { difficulty: 8, distanceM: milesToMeters(12), start: offset(20_000, 0), avgRating: 5, ratingCount: 1, completions: 40 }),
  route('mid', { name: 'River Loop', difficulty: 5, start: offset(5000, 0) }),
  route('out-of-metro', { start: offset(200_000, 0) }),
];

describe('applyFilter', () => {
  const area = { center: offset(0, 0), radiusMiles: 40 };

  it('keeps only routes in the metro area and sorts by nearest', () => {
    expect(applyFilter(routes, { area, near: offset(0, 0) }).map((r) => r.id)).toEqual(['near-easy', 'mid', 'far-hard']);
  });

  it('filters by distance, difficulty, search and saved', () => {
    expect(applyFilter(routes, { area, minMiles: 10 }).map((r) => r.id)).toEqual(['far-hard']);
    expect(applyFilter(routes, { area, maxDifficulty: 4.5 }).map((r) => r.id)).toEqual(['near-easy']);
    expect(applyFilter(routes, { area, query: 'river' }).map((r) => r.id)).toEqual(['mid']);
    expect(applyFilter(routes, { area, savedOnly: true, savedIds: new Set(['mid']) }).map((r) => r.id)).toEqual(['mid']);
  });

  it('ranks many good ratings above a single perfect one', () => {
    expect(bayesianRating(routes[0])).toBeGreaterThan(bayesianRating(routes[1]));
    expect(applyFilter(routes, { area, sort: 'rating' })[0].id).toBe('near-easy');
    expect(applyFilter(routes, { area, sort: 'popular' })[0].id).toBe('far-hard');
  });
});
