/**
 * Imports curated routes into the library from GPX files (e.g. drawn in a route planner
 * or exported from a run). Curated routes are public immediately — they're the hand-picked
 * starting library, before runners have created enough loops of their own.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import:gpx -- loop1.gpx loop2.gpx
 *   npm run import:gpx -- --dry-run loop1.gpx          # print metrics, write nothing
 *   npm run import:gpx -- --no-dem loop1.gpx           # use the GPX's own <ele> values
 *
 * The route name comes from the GPX <name> (override with --name for a single file).
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import { difficultyLabel, difficultyScore, profileRoute } from '../src/core/difficulty.ts';
import { demProfilePath } from '../src/core/elevation.ts';
import { simplify, type TrackPoint } from '../src/core/geo.ts';
import { parseGpx } from '../src/core/gpx.ts';
import { ROUTE_SIMPLIFY_M } from '../src/core/verify.ts';
import { metersToFeet, metersToMiles } from '../src/core/units.ts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const useDem = !args.includes('--no-dem');
const nameIdx = args.indexOf('--name');
const nameOverride = nameIdx >= 0 ? args[nameIdx + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && i !== nameIdx + 1);

if (files.length === 0) {
  console.error('Usage: npm run import:gpx -- [--dry-run] [--no-dem] [--name "Route name"] file.gpx ...');
  process.exit(1);
}

const supabase = dryRun
  ? null
  : createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name} (or use --dry-run).`);
    process.exit(1);
  }
  return v;
}

for (const file of files) {
  const { name: gpxName, points } = parseGpx(readFileSync(file, 'utf8'));
  const name = (files.length === 1 && nameOverride) || gpxName || basename(file, '.gpx');
  if (points.length < 2) {
    console.error(`✗ ${file}: no track points`);
    continue;
  }

  // Planned routes have no timestamps, so there's no track to validate — just geometry.
  const path = simplify(points, ROUTE_SIMPLIFY_M);
  let elevationPath: TrackPoint[] = points;
  let elevationSource: 'dem' | 'gpx' = 'gpx';
  if (useDem) {
    try {
      elevationPath = await demProfilePath(path, fetch, process.env.ELEVATION_API_URL);
      elevationSource = 'dem';
    } catch (e) {
      console.warn(`  ! ${file}: elevation lookup failed (${(e as Error).message}); using GPX elevation`);
    }
  }
  const geom = profileRoute(points.map((p) => ({ ...p, ele: null })));
  const elev = profileRoute(elevationPath);
  const equivalentFlatM = elev.equivalentFlatM * (geom.distanceM / elev.distanceM);
  const difficulty = difficultyScore(equivalentFlatM);

  console.log(
    `${dryRun ? '•' : '✓'} ${name}: ${metersToMiles(geom.distanceM).toFixed(2)} mi, ` +
      `${Math.round(metersToFeet(elev.elevationGainM))} ft gain (${elevationSource}), ` +
      `difficulty ${difficulty} ${difficultyLabel(difficulty)}, ${path.length} points`,
  );
  if (!supabase) continue;

  const { error } = await supabase.from('routes').insert({
    name,
    is_curated: true,
    distance_m: Math.round(geom.distanceM),
    elevation_gain_m: Math.round(elev.elevationGainM),
    equivalent_flat_m: Math.round(equivalentFlatM),
    difficulty,
    start_lat: path[0].lat,
    start_lng: path[0].lng,
    path: path.map((p) => [p.lat, p.lng, p.ele == null ? null : Math.round(p.ele)]),
    elevation_source: elevationSource,
  });
  if (error) console.error(`✗ ${name}: ${error.message}`);
}
