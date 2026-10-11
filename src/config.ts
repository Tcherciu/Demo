/**
 * Build-time configuration. EXPO_PUBLIC_* variables are inlined by Expo at build time;
 * put them in .env (see .env.example).
 */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  stravaClientId: process.env.EXPO_PUBLIC_STRAVA_CLIENT_ID ?? '',
  /** The metro area the library covers. Browse only lists routes starting inside it. */
  metro: {
    name: process.env.EXPO_PUBLIC_METRO_NAME ?? 'Your City',
    center: {
      lat: Number(process.env.EXPO_PUBLIC_METRO_LAT ?? 39.7392),
      lng: Number(process.env.EXPO_PUBLIC_METRO_LNG ?? -104.9903),
    },
    radiusMiles: Number(process.env.EXPO_PUBLIC_METRO_RADIUS_MI ?? 40),
  },
};

export const isBackendConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
