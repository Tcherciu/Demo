import { Redirect } from 'expo-router';

/** Strava's OAuth redirect (pacepath://localhost) can land here on Android; send it back to the profile. */
export default function StravaRedirect() {
  return <Redirect href="/profile" />;
}
