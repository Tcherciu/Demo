import '../run/locationTask';

import type { Session } from '@supabase/supabase-js';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { isBackendConfigured } from '../config';
import { supabase } from '../data/supabase';
import { profileStore, refreshProfile, tierStore } from '../hooks/useAppData';
import { registerPushToken, useNotificationTaps } from '../notifications/push';
import { resumeActiveRun } from '../run/session';
import { syncPending } from '../run/sync';
import { colors } from '../ui/theme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

try {
  const tier = localStorage.getItem('tier');
  if (tier === 'beginner' || tier === 'intermediate' || tier === 'advanced') tierStore.set(tier);
} catch {}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  /** User id whose profile has finished loading. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const profile = profileStore.use();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    // Pick up a run that was in progress if the app was killed mid-run.
    resumeActiveRun().catch((e) => console.warn('could not resume run', e));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) {
      profileStore.set(null);
      return;
    }
    refreshProfile()
      .catch((e) => console.warn('profile load failed', e))
      .finally(() => setLoadedFor(userId));
    void syncPending();
    void registerPushToken();
  }, [session?.user.id]);

  const profileLoaded = session === null || (!!session && loadedFor === session.user.id);
  useNotificationTaps(!!session && !!profile);

  if (!isBackendConfigured) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>Backend not configured</Text>
        <Text style={{ marginTop: 8, color: colors.muted }}>
          Copy .env.example to .env and fill in your Supabase project URL and anon key, then restart Expo.
        </Text>
      </View>
    );
  }
  if (session === undefined || !profileLoaded) return null;

  const signedIn = !!session;
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerTintColor: colors.text, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !profile}>
          <Stack.Screen name="onboarding" options={{ title: 'Welcome' }} />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !!profile}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="route/[id]" options={{ title: '' }} />
          <Stack.Screen name="run/active" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="run/finish" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="import" options={{ title: 'Import a run' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}
