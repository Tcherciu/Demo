import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import type { TrackPoint } from '../core/geo';
import { parseGpx } from '../core/gpx';

/**
 * Any watch or app that can export GPX — Garmin Connect ("Export to GPX"), COROS, Polar,
 * Suunto, ... Only tracks with timestamps can be timed as course attempts.
 */
export async function pickGpxTrack(): Promise<{ name: string; points: TrackPoint[]; fileName: string } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/gpx+xml', 'application/xml', 'text/xml', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  const { name, points } = parseGpx(await new File(asset.uri).text());
  return { name: name ?? asset.name.replace(/\.gpx$/i, ''), points: points.filter((p) => p.t != null && Number.isFinite(p.t)), fileName: asset.name };
}
