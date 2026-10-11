import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { SkillTier } from '../core/estimates';
import { saveProfile } from '../data/api';
import { refreshProfile, tierStore } from '../hooks/useAppData';
import { Button, Chip } from '../ui/components';
import { colors, space } from '../ui/theme';

const TIERS: { id: SkillTier; label: string; hint: string }[] = [
  { id: 'beginner', label: 'Beginner', hint: '~12:00 /mi for a 5K' },
  { id: 'intermediate', label: 'Intermediate', hint: '~9:30 /mi for a 5K' },
  { id: 'advanced', label: 'Advanced', hint: '~7:30 /mi for a 5K' },
];

export default function Onboarding() {
  const [name, setName] = useState('');
  const tier = tierStore.use();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function done() {
    setBusy(true);
    try {
      await saveProfile({ displayName: name.trim() });
      try { localStorage.setItem('tier', tier); } catch {}
      await refreshProfile();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.label}>Your name on leaderboards</Text>
      <TextInput style={s.input} value={name} onChangeText={setName} placeholder="e.g. Sam R." maxLength={40} />
      <Text style={s.label}>How do you run?</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {TIERS.map((t) => (
          <Chip key={t.id} label={t.label} selected={tier === t.id} onPress={() => tierStore.set(t.id)} />
        ))}
      </View>
      <Text style={s.hint}>{TIERS.find((t) => t.id === tier)!.hint}. Connect Strava later for estimates based on your own runs.</Text>
      <Button title="Let's run" onPress={done} loading={busy} disabled={name.trim().length < 2} style={{ marginTop: space.xl }} />
      {error && <Text style={{ color: colors.bad, marginTop: space.md }}>{error}</Text>}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: space.xl },
  label: { fontWeight: '700', fontSize: 15, marginBottom: space.sm, marginTop: space.lg },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md, fontSize: 17 },
  hint: { color: colors.muted, marginTop: space.sm },
});
