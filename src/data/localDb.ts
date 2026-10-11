import * as SQLite from 'expo-sqlite';

import type { TrackPoint } from '../core/geo';

/**
 * On-device storage. Every GPS fix is written here as it arrives, so a run survives
 * the app being killed, a dead phone, or no signal — and uploads happen later.
 */
export type RunMode = 'free' | 'course';
export type RunStatus = 'recording' | 'finished' | 'abandoned';

export interface LocalRun {
  id: string;
  mode: RunMode;
  route_id: string | null;
  status: RunStatus;
  started_at: number;
  ended_at: number | null;
  distance_m: number;
  elapsed_s: number | null;
  /** 1 when a course attempt finished validly (on course, start to finish). */
  valid_attempt: number;
  pause_count: number;
  /** Route created from this free run, once uploaded. */
  created_route_id: string | null;
  /** 0 = waiting to upload. */
  synced: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= (async () => {
    const d = await SQLite.openDatabaseAsync('pacepath.db');
    await d.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY NOT NULL,
        mode TEXT NOT NULL,
        route_id TEXT,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        distance_m REAL NOT NULL DEFAULT 0,
        elapsed_s REAL,
        valid_attempt INTEGER NOT NULL DEFAULT 0,
        pause_count INTEGER NOT NULL DEFAULT 0,
        created_route_id TEXT,
        synced INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS run_points (
        run_id TEXT NOT NULL,
        t INTEGER NOT NULL,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        ele REAL,
        acc REAL,
        PRIMARY KEY (run_id, t)
      );
      CREATE TABLE IF NOT EXISTS route_cache (
        id TEXT PRIMARY KEY NOT NULL,
        json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    return d;
  })();
  return dbPromise;
}

export async function insertRun(run: Pick<LocalRun, 'id' | 'mode' | 'route_id' | 'started_at'>) {
  const d = await db();
  await d.runAsync(
    'INSERT INTO runs (id, mode, route_id, status, started_at) VALUES (?, ?, ?, ?, ?)',
    run.id, run.mode, run.route_id, 'recording', run.started_at,
  );
}

export async function appendPoints(runId: string, points: readonly TrackPoint[]) {
  if (points.length === 0) return;
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const p of points) {
      await d.runAsync(
        'INSERT OR IGNORE INTO run_points (run_id, t, lat, lng, ele, acc) VALUES (?, ?, ?, ?, ?, ?)',
        runId, p.t ?? Date.now(), p.lat, p.lng, p.ele ?? null, p.acc ?? null,
      );
    }
  });
}

export async function updateRun(id: string, fields: Partial<Omit<LocalRun, 'id'>>) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  const d = await db();
  await d.runAsync(
    `UPDATE runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...keys.map((k) => fields[k] as string | number | null), id,
  );
}

export async function getRun(id: string): Promise<LocalRun | null> {
  return (await db()).getFirstAsync<LocalRun>('SELECT * FROM runs WHERE id = ?', id);
}

export async function getActiveRun(): Promise<LocalRun | null> {
  return (await db()).getFirstAsync<LocalRun>("SELECT * FROM runs WHERE status = 'recording' ORDER BY started_at DESC LIMIT 1");
}

export async function getRunPoints(runId: string): Promise<TrackPoint[]> {
  const rows = await (await db()).getAllAsync<{ t: number; lat: number; lng: number; ele: number | null; acc: number | null }>(
    'SELECT t, lat, lng, ele, acc FROM run_points WHERE run_id = ? ORDER BY t', runId,
  );
  return rows.map((r) => ({ lat: r.lat, lng: r.lng, ele: r.ele, acc: r.acc, t: r.t }));
}

export async function unsyncedRuns(): Promise<LocalRun[]> {
  return (await db()).getAllAsync<LocalRun>("SELECT * FROM runs WHERE synced = 0 AND status != 'recording'");
}

export async function recentRuns(limit = 50): Promise<LocalRun[]> {
  return (await db()).getAllAsync<LocalRun>(
    "SELECT * FROM runs WHERE status = 'finished' ORDER BY started_at DESC LIMIT ?", limit,
  );
}

export async function cacheRoute(id: string, value: unknown) {
  await (await db()).runAsync(
    'INSERT OR REPLACE INTO route_cache (id, json, updated_at) VALUES (?, ?, ?)', id, JSON.stringify(value), Date.now(),
  );
}

export async function cachedRoute<T>(id: string): Promise<T | null> {
  const row = await (await db()).getFirstAsync<{ json: string }>('SELECT json FROM route_cache WHERE id = ?', id);
  return row ? (JSON.parse(row.json) as T) : null;
}
