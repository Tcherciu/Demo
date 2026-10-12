import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'loopd',
  slug: 'loopd',
  scheme: 'loopd',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  primaryColor: '#F0571B',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.loopd.app',
    infoPlist: { UIBackgroundModes: ['location'] },
  },
  android: {
    package: 'com.loopd.app',
    adaptiveIcon: {
      backgroundColor: '#0F1C17',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 180,
        backgroundColor: '#0F1C17',
      },
    ],
    'expo-sqlite',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'loopd uses your location to find routes near you and check you are at the start.',
        locationAlwaysAndWhenInUsePermission: 'loopd records your run with the screen off and warns you if you go off course.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        androidForegroundServiceIcon: './assets/notification-icon.png',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#F0571B',
      },
    ],
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'loopd reads your running workouts and their GPS routes (Apple Watch, Garmin and other apps) so they can count on courses.',
        NSHealthUpdateUsageDescription: false,
        background: false,
      },
    ],
    'expo-document-picker',
    [
      'react-native-maps',
      {
        // Android needs a Google Maps key; iOS uses Apple Maps when none is given.
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  // Created by `npx eas-cli@latest init`; needed for push notifications.
  extra: { eas: { projectId: process.env.EAS_PROJECT_ID } },
};

export default config;
