import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { config } from '../../config';
import { estimateSeconds, type SkillTier } from '../../core/estimates';
import { applyFilter, TIER_DIFFICULTY, type RouteSummary, type SortKey } from '../../core/filters';
import { haversine } from '../../core/geo';
import { formatDuration, metersToFeet, metersToMiles } from '../../core/units';
import { useCurrentLocation } from '../../hooks/useCurrentLocation';
import { savedStore, toggleSaved, usePaceModel, useRoutes } from '../../hooks/useAppData';
import { Chip, DifficultyBadge, StarsText } from '../../ui/components';
import { colors, space } from '../../ui/theme';

const DISTANCES: { id: string; label: string; min?: number; max?: number }[] = [
  { id: 'any', label: 'Any distance' },
  { id: 'short', label: '3–5 mi', min: 3, max: 5 },
  { id: 'mid', label: '5–10 mi', min: 5, max: 10 },
  { id: 'long', label: '10+ mi', min: 10 },
];
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'nearest', label: 'Nearest' },
  { id: 'rating', label: 'Top rated' },
  { id: 'popular', label: 'Most run' },
  { id: 'difficulty_asc', label: 'Easiest' },
  { id: 'difficulty_desc', label: 'Hardest' },
  { id: 'newest', label: 'Newest' },
];
const LEVELS: { id: SkillTier | 'all'; label: string }[] = [
  { id: 'all', label: 'All levels' },
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
];

export default function Browse() {
  const { routes, loading, error, refresh } = useRoutes();
  const saved = savedStore.use();
  const { point } = useCurrentLocation();
  const { model } = usePaceModel();
  const [query, setQuery] = useState('');
  const [distance, setDistance] = useState('any');
  const [level, setLevel] = useState<SkillTier | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('nearest');
  const [savedOnly, setSavedOnly] = useState(false);

  const filtered = useMemo(() => {
    const d = DISTANCES.find((x) => x.id === distance)!;
    const [minD, maxD] = level === 'all' ? [undefined, undefined] : TIER_DIFFICULTY[level];
    return applyFilter(routes, {
      query,
      minMiles: d.min,
      maxMiles: d.max,
      minDifficulty: minD,
      maxDifficulty: maxD,
      savedOnly,
      savedIds: saved,
      near: point ?? config.metro.center,
      area: config.metro,
      sort,
    });
  }, [routes, query, distance, level, sort, savedOnly, saved, point]);

  return (
    <FlatList
      data={filtered}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
      ListHeaderComponent={
        <View>
          <Text style={s.metro}>{config.metro.name}</Text>
          <TextInput style={s.search} placeholder="Search routes" value={query} onChangeText={setQuery} clearButtonMode="while-editing" />
          <FilterRow>
            <Chip label={savedOnly ? '♥ Saved' : '♡ Saved'} selected={savedOnly} onPress={() => setSavedOnly((v) => !v)} />
            {LEVELS.map((l) => <Chip key={l.id} label={l.label} selected={level === l.id} onPress={() => setLevel(l.id)} />)}
          </FilterRow>
          <FilterRow>
            {DISTANCES.map((d) => <Chip key={d.id} label={d.label} selected={distance === d.id} onPress={() => setDistance(d.id)} />)}
          </FilterRow>
          <FilterRow>
            {SORTS.map((o) => <Chip key={o.id} label={o.label} selected={sort === o.id} onPress={() => setSort(o.id)} />)}
          </FilterRow>
          {error && <Text style={{ color: colors.bad }}>{error}</Text>}
        </View>
      }
      ListEmptyComponent={
        !loading ? (
          <Text style={s.empty}>
            No routes match. Go for a 3+ mile run from the Run tab — it becomes a route you can race.
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <RouteCard
          route={item}
          saved={saved.has(item.id)}
          estimateS={estimateSeconds(item.equivalentFlatM, model)}
          awayMi={point ? metersToMiles(haversine(point, item.start)) : null}
        />
      )}
    />
  );
}

function FilterRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: space.sm }}>
      {children}
    </ScrollView>
  );
}

function RouteCard({ route, saved, estimateS, awayMi }: { route: RouteSummary; saved: boolean; estimateS: number; awayMi: number | null }) {
  return (
    <Link href={{ pathname: '/route/[id]', params: { id: route.id } }} asChild>
      <Pressable style={s.card}>
        <View style={s.row}>
          <Text style={s.name} numberOfLines={1}>{route.name}</Text>
          <Pressable hitSlop={12} onPress={() => toggleSaved(route.id).catch(() => {})}>
            <Ionicons name={saved ? 'heart' : 'heart-outline'} size={22} color={saved ? colors.primary : colors.muted} />
          </Pressable>
        </View>
        <View style={[s.row, { marginTop: space.xs }]}>
          <DifficultyBadge score={route.difficulty} />
          <StarsText rating={route.avgRating} count={route.ratingCount} />
        </View>
        <Text style={s.meta}>
          {metersToMiles(route.distanceM).toFixed(1)} mi · {Math.round(metersToFeet(route.elevationGainM))} ft gain · ~{formatDuration(estimateS)} for you
          {awayMi != null ? ` · ${awayMi.toFixed(1)} mi away` : ''}
        </Text>
        <Text style={s.meta}>
          {route.recordS != null ? `🏆 ${formatDuration(route.recordS)} by ${route.recordHolder}` : 'No record yet'}
          {route.averageS != null ? ` · avg ${formatDuration(route.averageS)}` : ''} · {route.completions} run{route.completions === 1 ? '' : 's'}
          {!route.isPublic ? ' · 🔒 only you' : ''}
        </Text>
      </Pressable>
    </Link>
  );
}

const s = StyleSheet.create({
  metro: { fontSize: 13, color: colors.muted, fontWeight: '600', marginBottom: space.sm },
  search: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: space.md, fontSize: 16, marginBottom: space.md,
  },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 17, fontWeight: '700', flex: 1, marginRight: space.sm, color: colors.text },
  meta: { color: colors.muted, marginTop: space.sm, fontSize: 13 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: space.xl, lineHeight: 20 },
});
