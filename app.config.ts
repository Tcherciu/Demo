import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'PacePath',
  slug: 'pacepath',
  scheme: 'pacepath',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.pacepath.app',
    infoPlist: { UIBackgroundModes: ['location'] },
  },
  android: {
    package: 'com.pacepath.app',
    adaptiveIcon: {
      backgroundColor: '#FFF4ED',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-sqlite',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'PacePath uses your location to find routes near you and check you are at the start.',
        locationAlwaysAndWhenInUsePermission: 'PacePath records your run with the screen off and warns you if you go off course.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    'expo-notifications',
    [
      '@kingstinct/react-native-healthkit',
      {
        NSHealthShareUsageDescription:
          'PacePath reads your running workouts and their GPS routes (Apple Watch, Garmin and other apps) so they can count on courses.',
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
};

export default config;
