import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { removePushToken, savePushToken } from '../data/api';

let registeredToken: string | null = null;

/**
 * Registers this device for "your record was beaten" pushes. Never prompts by itself:
 * the permission is asked for when the runner starts their first run (see ensurePermissions).
 */
export async function registerPushToken(): Promise<void> {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) {
      console.warn('No EAS projectId configured; push notifications are disabled.');
      return;
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await savePushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    registeredToken = token;
  } catch (e) {
    console.warn('push registration failed', e);
  }
}

/** On sign-out the device stops receiving this runner's notifications. */
export async function unregisterPushToken(): Promise<void> {
  if (!registeredToken) return;
  try {
    await removePushToken(registeredToken);
  } catch {
    // The token is cleaned up server-side when Expo reports it dead.
  }
  registeredToken = null;
}

/** Tapping a "record beaten" notification opens that route. */
export function useNotificationTaps(enabled: boolean) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!enabled || !last || last.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const routeId = last.notification.request.content.data?.routeId;
    if (typeof routeId === 'string') router.push({ pathname: '/route/[id]', params: { id: routeId } });
  }, [enabled, last]);
}
