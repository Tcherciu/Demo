import { demProfilePath, fetchDemElevations, resample } from '../elevation.ts';
import { pathLength } from '../geo.ts';
import { parseGpx } from '../gpx.ts';
import { offset, walk } from './helpers.ts';

describe('resample', () => {
  it('spaces points evenly and keeps the ends', () => {
    const path = walk([[0, 0], [1000, 0]], 333);
    const r = resample(path, 25);
    expect(r.length).toBeGreaterThanOrEqual(41);
    expect(r.length).toBeLessThanOrEqual(42);
    expect(r[0]).toEqual(path[0]);
    expect(r[r.length - 1]).toEqual(path[path.length - 1]);
    expect(pathLength(r)).toBeCloseTo(1000, -1);
  });
});

describe('fetchDemElevations', () => {
  it('batches 100 points per request', async () => {
    const urls: string[] = [];
    const fake = async (url: string) => {
      urls.push(url);
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      return { ok: true, status: 200, json: async () => ({ elevation: Array.from({ length: n }, (_, i) => 1600 + i) }) };
    };
    const pts = Array.from({ length: 250 }, (_, i) => offset(i * 10, 0));
    const eles = await fetchDemElevations(pts, fake, 'https://dem.example/v1/elevation');
    expect(urls).toHaveLength(3);
    expect(eles).toHaveLength(250);
    const path = await demProfilePath(walk([[0, 0], [100, 0]]), fake, 'https://dem.example/v1/elevation', 25);
    expect(path[0].ele).toBe(1600);
  });

  it('fails loudly on a bad response', async () => {
    const bad = async () => ({ ok: true, status: 200, json: async () => ({ elevation: [1] }) });
    await expect(fetchDemElevations([offset(0, 0), offset(1, 1)], bad)).rejects.toThrow();
  });
});

describe('parseGpx', () => {
  it('reads track points with elevation and time', () => {
    const gpx = `<?xml version="1.0"?><gpx><metadata><name><![CDATA[Cherry Creek Loop]]></name></metadata>
      <trk><trkseg>
        <trkpt lat="39.7" lon="-104.9"><ele>1600.5</ele><time>2026-01-01T10:00:00Z</time></trkpt>
        <trkpt lon="-104.91" lat="39.71"><ele>1602</ele></trkpt>
        <trkpt lat="39.72" lon="-104.92"/>
      </trkseg></trk></gpx>`;
    const { name, points } = parseGpx(gpx);
    expect(name).toBe('Cherry Creek Loop');
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ lat: 39.7, lng: -104.9, ele: 1600.5, t: Date.parse('2026-01-01T10:00:00Z') });
    expect(points[1]).toMatchObject({ lat: 39.71, lng: -104.91, ele: 1602 });
    expect(points[2].ele).toBeNull();
  });

  it('falls back to route points', () => {
    expect(parseGpx('<gpx><rte><rtept lat="1" lon="2"></rtept></rte></gpx>').points).toHaveLength(1);
  });
});
