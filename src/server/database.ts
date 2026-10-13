import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { Pool, type PoolClient } from 'pg';
import type { Observation, Store } from '@/domain/model';
import { migrateProfile } from '@/domain/model';
import { emptyStore } from '@/domain/seed';

type Row = Record<string, string>;
interface Connection {
  query(sql: string, params?: (string | number | null)[]): Promise<Row[]>;
}
const tables = [
  ['facilities', 'facilities', ''],
  ['sources', 'sources', ''],
  ['opportunities', 'opportunities', ', facility_id TEXT NOT NULL REFERENCES facilities(id)'],
  [
    'source_listings',
    'listings',
    ', opportunity_id TEXT NOT NULL REFERENCES opportunities(id), source_id TEXT NOT NULL REFERENCES sources(id)',
  ],
  [
    'recruiter_offers',
    'offers',
    ', opportunity_id TEXT NOT NULL REFERENCES opportunities(id), listing_id TEXT NOT NULL REFERENCES source_listings(id), source_id TEXT NOT NULL REFERENCES sources(id)',
  ],
  [
    'user_job_actions',
    'actions',
    ', opportunity_id TEXT NOT NULL UNIQUE REFERENCES opportunities(id)',
  ],
  ['collection_runs', 'runs', ', source_id TEXT NOT NULL REFERENCES sources(id)'],
  ['review_queue', 'reviews', ''],
  ['radar_events', 'events', ', opportunity_id TEXT NOT NULL'],
] as const;
type TableKey = (typeof tables)[number][1];
/**
 * Row payloads as they were loaded, per transaction store. Saves write only rows
 * whose serialised payload changed and delete only rows that disappeared, so a
 * one-field edit costs one statement rather than a rewrite of the workspace.
 */
const snapshots = new WeakMap<Store, Record<TableKey, Map<string, string>>>();
const rowId = (item: unknown) => {
  const obj = item as Record<string, unknown>;
  return String(obj.id ?? obj.opportunityId);
};
const globals = globalThis as unknown as {
  radarSqlite?: DatabaseSync;
  radarStatements?: Map<string, StatementSync>;
  radarPool?: Pool;
  radarReady?: Promise<void>;
  radarQueue?: Promise<unknown>;
};
function sqliteConnection(): Connection {
  if (!globals.radarSqlite) {
    const file = path.resolve(
      /* turbopackIgnore: true */ process.env.SQLITE_PATH || './data/locum-radar.sqlite',
    );
    mkdirSync(path.dirname(file), { recursive: true });
    globals.radarSqlite = new DatabaseSync(file);
    globals.radarSqlite.exec(
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000; PRAGMA synchronous=NORMAL;',
    );
    globals.radarStatements = new Map();
  }
  const db = globals.radarSqlite;
  const cache = (globals.radarStatements ??= new Map());
  return {
    async query(sql, params = []) {
      let stmt = cache.get(sql);
      if (!stmt) {
        stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
        cache.set(sql, stmt);
      }
      if (/^\s*(SELECT|PRAGMA)/i.test(sql)) return stmt.all(...params) as Row[];
      stmt.run(...params);
      return [];
    },
  };
}
function pgConnection(client: PoolClient): Connection {
  return {
    async query(sql, params = []) {
      return (await client.query(sql, params)).rows;
    },
  };
}

async function schema(c: Connection) {
  await c.query(
    'CREATE TABLE IF NOT EXISTS schema_version (id INTEGER PRIMARY KEY, version INTEGER NOT NULL)',
  );
  await c.query(
    'INSERT INTO schema_version (id, version) VALUES (1, 1) ON CONFLICT (id) DO NOTHING',
  );
  const version = await c.query('SELECT version FROM schema_version WHERE id = 1');
  if (Number(version[0].version) !== 1) throw new Error('Unsupported database schema version');
  await c.query(
    'CREATE TABLE IF NOT EXISTS user_profiles (id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
  );
  await c.query(
    "INSERT INTO user_profiles (id, payload) VALUES ('owner', '') ON CONFLICT (id) DO NOTHING",
  );
  for (const [table, , relationships] of tables)
    await c.query(
      `CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, payload TEXT NOT NULL${relationships})`,
    );
  // Observations are append-only history. They are written by saves but read on demand.
  await c.query(
    'CREATE TABLE IF NOT EXISTS source_observations (id TEXT PRIMARY KEY, payload TEXT NOT NULL, listing_id TEXT NOT NULL REFERENCES source_listings(id))',
  );
  await c.query(
    'CREATE INDEX IF NOT EXISTS listings_opportunity_idx ON source_listings(opportunity_id)',
  );
  await c.query(
    'CREATE INDEX IF NOT EXISTS offers_opportunity_idx ON recruiter_offers(opportunity_id)',
  );
  await c.query(
    'CREATE INDEX IF NOT EXISTS observations_listing_idx ON source_observations(listing_id)',
  );
}
async function ready(c: Connection) {
  if (!globals.radarReady)
    globals.radarReady = schema(c).catch((error) => {
      globals.radarReady = undefined;
      throw error;
    });
  await globals.radarReady;
}
/**
 * APPROVED_SOURCES (comma-separated source ids in .env.local) records the
 * owner's permission for sources still marked unreviewed, so a fresh
 * workspace can collect without clicking through Access settings. A decision
 * made in the interface (approved or denied) is never overridden.
 */
export function applyEnvironmentApprovals(
  store: Store,
  env: Record<string, string | undefined> = process.env,
) {
  const ids = (env.APPROVED_SOURCES ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  for (const source of store.sources)
    if (ids.includes(source.id) && source.permission === 'unreviewed' && source.method !== 'manual')
      Object.assign(source, {
        permission: 'approved',
        permissionEvidence:
          env.APPROVAL_NOTE?.trim() ||
          'Owner recorded permission in APPROVED_SOURCES (.env.local).',
        enabled: true,
      });
}
async function load(c: Connection): Promise<Store> {
  const profile = await c.query("SELECT payload FROM user_profiles WHERE id = 'owner'");
  if (!profile[0]?.payload) {
    const fresh = emptyStore();
    applyEnvironmentApprovals(fresh);
    snapshots.set(fresh, emptySnapshot());
    return fresh;
  }
  const store = { version: 1, profile: JSON.parse(profile[0].payload), observations: [] } as unknown as Store;
  const snapshot = emptySnapshot();
  for (const [table, key] of tables) {
    const rows = await c.query(`SELECT id, payload FROM ${table}`);
    for (const r of rows) snapshot[key].set(r.id, r.payload);
    (store[key] as unknown[]) = rows.map((r) => JSON.parse(r.payload));
  }
  store.profile = migrateProfile(store.profile);
  // Sources added to the registry after a workspace was created appear disabled and unreviewed.
  // Registry-owned fields follow the code; permission and enablement stay the owner's.
  for (const seed of emptyStore().sources) {
    const existing = store.sources.find((s) => s.id === seed.id);
    if (!existing) store.sources.push(seed);
    else
      Object.assign(existing, {
        name: seed.name,
        url: seed.url,
        type: seed.type,
        method: seed.method,
        focus: seed.focus,
        intervalHours: seed.intervalHours,
      });
  }
  applyEnvironmentApprovals(store);
  snapshots.set(store, snapshot);
  return store;
}
const emptySnapshot = () =>
  Object.fromEntries(tables.map(([, key]) => [key, new Map<string, string>()])) as Record<
    TableKey,
    Map<string, string>
  >;
async function save(c: Connection, s: Store) {
  const before = snapshots.get(s) ?? emptySnapshot();
  await c.query("UPDATE user_profiles SET payload = $1 WHERE id = 'owner'", [
    JSON.stringify(s.profile),
  ]);
  // Alert events are short-lived; keep four months and at most 5,000.
  const cutoff = new Date(Date.now() - 120 * 86400000).toISOString();
  s.events = (s.events ?? []).filter((e) => e.at >= cutoff).slice(-5000);
  const wanted = {} as Record<TableKey, Set<string>>;
  for (const [table, key, relationships] of tables) {
    const columns = [...relationships.matchAll(/, (\w+) TEXT/g)].map((m) => m[1]);
    const names = ['id', 'payload', ...columns];
    const sql = `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO UPDATE SET ${names
      .slice(1)
      .map((n) => `${n} = excluded.${n}`)
      .join(', ')}`;
    wanted[key] = new Set();
    for (const item of s[key] as unknown[]) {
      const id = rowId(item);
      wanted[key].add(id);
      const payload = JSON.stringify(item);
      if (before[key].get(id) === payload) continue;
      const obj = item as Record<string, unknown>;
      await c.query(sql, [
        id,
        payload,
        ...columns.map((col) =>
          String(obj[col.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())]),
        ),
      ]);
      before[key].set(id, payload);
    }
  }
  // New observations only: history already in the database is never rewritten.
  for (const o of s.observations ?? [])
    await c.query(
      'INSERT INTO source_observations (id, payload, listing_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [o.id, JSON.stringify(o), o.listingId],
    );
  s.observations = [];
  for (const [table, key] of [...tables].reverse()) {
    for (const id of [...before[key].keys()]) {
      if (wanted[key].has(id)) continue;
      if (key === 'listings')
        await c.query('DELETE FROM source_observations WHERE listing_id = $1', [id]);
      await c.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      before[key].delete(id);
    }
  }
}
/** Observation history for the given listings, oldest first. */
export async function readObservations(listingIds: string[]): Promise<Observation[]> {
  if (!listingIds.length) return [];
  return run(async (c) => {
    const out: Observation[] = [];
    for (const id of listingIds)
      out.push(
        ...(
          await c.query('SELECT payload FROM source_observations WHERE listing_id = $1', [id])
        ).map((r) => JSON.parse(r.payload) as Observation),
      );
    return out.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  });
}
/**
 * Runs `fn` on a connection inside a transaction. PostgreSQL locks the owner row;
 * SQLite serialises callbacks on one connection and uses BEGIN IMMEDIATE, which
 * also guards against a separate collector process writing to the same file.
 */
async function run<T>(fn: (c: Connection) => Promise<T>, write = false): Promise<T> {
  if (process.env.DATABASE_URL) {
    globals.radarPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    const client = await globals.radarPool.connect(),
      c = pgConnection(client);
    try {
      await ready(c);
      await c.query('BEGIN');
      if (write) await c.query("SELECT id FROM user_profiles WHERE id = 'owner' FOR UPDATE");
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const previous = globals.radarQueue ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const c = sqliteConnection();
      await ready(c);
      await c.query(write ? 'BEGIN IMMEDIATE' : 'BEGIN');
      try {
        const result = await fn(c);
        await c.query('COMMIT');
        return result;
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    });
  globals.radarQueue = task.catch(() => {});
  return task;
}
export function transaction<T>(fn: (s: Store) => T | Promise<T>, write = true): Promise<T> {
  return run(async (c) => {
    const state = await load(c);
    const result = await fn(state);
    if (write) await save(c, state);
    return result;
  }, write);
}
export const readStore = () => transaction((s) => s, false);
