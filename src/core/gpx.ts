import type { TrackPoint } from './geo.ts';

/**
 * Minimal GPX reader for importing curated routes: track points (<trkpt>) or, failing
 * that, route points (<rtept>), with optional <ele> and <time>, plus the first <name>.
 */
export function parseGpx(xml: string): { name: string | null; points: TrackPoint[] } {
  const name = /<name>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/name>/.exec(xml)?.[1]?.trim() || null;
  const read = (tag: string) => {
    const re = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
    const out: TrackPoint[] = [];
    for (const m of xml.matchAll(re)) {
      const attrs = m[1];
      const body = m[2] ?? '';
      const lat = Number(/\blat\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
      const lng = Number(/\blon\s*=\s*["']([^"']+)["']/.exec(attrs)?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const ele = /<ele>([^<]+)<\/ele>/.exec(body)?.[1];
      const time = /<time>([^<]+)<\/time>/.exec(body)?.[1];
      out.push({
        lat,
        lng,
        ele: ele != null && Number.isFinite(Number(ele)) ? Number(ele) : null,
        t: time ? Date.parse(time) : undefined,
      });
    }
    return out;
  };
  const trk = read('trkpt');
  return { name, points: trk.length ? trk : read('rtept') };
}
