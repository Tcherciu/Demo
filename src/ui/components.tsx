import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { difficultyLabel } from '../core/difficulty';
import { colors, difficultyColor, space } from './theme';

export function Button(props: {
  title: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
  big?: boolean;
}) {
  const { variant = 'primary' } = props;
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.bad : colors.card;
  const fg = variant === 'secondary' ? colors.text : colors.primaryText;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      disabled={props.disabled || props.loading}
      style={({ pressed }) => [
        styles.button,
        props.big && styles.buttonBig,
        { backgroundColor: bg, opacity: props.disabled ? 0.4 : pressed ? 0.8 : 1 },
        variant === 'secondary' && { borderWidth: 1, borderColor: colors.border },
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, props.big && styles.buttonTextBig, { color: fg }]}>{props.title}</Text>
      )}
    </Pressable>
  );
}

export function Chip(props: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      onPress={props.onPress}
      style={[styles.chip, props.selected && { backgroundColor: colors.text, borderColor: colors.text }]}
    >
      <Text style={[styles.chipText, props.selected && { color: '#fff' }]}>{props.label}</Text>
    </Pressable>
  );
}

export function Card(props: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

export function Stat(props: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, props.highlight && { color: colors.primary }]}>{props.value}</Text>
      <Text style={styles.statLabel}>{props.label}</Text>
    </View>
  );
}

export function DifficultyBadge({ score }: { score: number }) {
  return (
    <View style={[styles.badge, { backgroundColor: difficultyColor(score) }]}>
      <Text style={styles.badgeText}>
        {score.toFixed(1)} · {difficultyLabel(score)}
      </Text>
    </View>
  );
}

export function StarsText({ rating, count }: { rating: number | null; count: number }) {
  if (!rating || count === 0) return <Text style={styles.muted}>No ratings yet</Text>;
  return (
    <Text style={styles.muted}>
      ★ {rating.toFixed(1)} ({count})
    </Text>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={styles.section}>{children}</Text>;
}

export const styles = StyleSheet.create({
  button: { paddingVertical: 12, paddingHorizontal: space.lg, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonBig: { paddingVertical: 20, borderRadius: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  buttonTextBig: { fontSize: 20, fontWeight: '700' },
  chip: {
    paddingVertical: 6, paddingHorizontal: space.md, borderRadius: 999, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.card, marginRight: space.sm,
  },
  chipText: { fontSize: 14, color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: space.lg, borderWidth: 1, borderColor: colors.border },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12, color: colors.muted, marginTop: 2 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  muted: { color: colors.muted, fontSize: 13 },
  section: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', marginTop: space.xl, marginBottom: space.sm },
});
