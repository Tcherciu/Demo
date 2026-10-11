export const METERS_PER_MILE = 1609.344;
export const METERS_PER_FOOT = 0.3048;

export const milesToMeters = (mi: number) => mi * METERS_PER_MILE;
export const metersToMiles = (m: number) => m / METERS_PER_MILE;
export const feetToMeters = (ft: number) => ft * METERS_PER_FOOT;
export const metersToFeet = (m: number) => m / METERS_PER_FOOT;

/** Formats seconds as h:mm:ss or m:ss. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Formats a pace given in seconds per mile as m:ss /mi. */
export function formatPace(secondsPerMile: number): string {
  return `${formatDuration(secondsPerMile)} /mi`;
}
