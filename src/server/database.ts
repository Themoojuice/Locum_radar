import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool, type PoolClient } from 'pg';
import type { Store } from '@/domain/model';
import { emptyStore } from '@/domain/seed';
import { applyPublicStarter, collectionEnabled } from './public-starter';

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
  [
    'source_observations',
    'observations',
    ', listing_id TEXT NOT NULL REFERENCES source_listings(id)',
  ],
  ['collection_runs', 'runs', ', source_id TEXT NOT NULL REFERENCES sources(id)'],
  ['review_queue', 'reviews', ''],
  ['acquisition_documents', 'documents', ', source_id TEXT NOT NULL REFERENCES sources(id)'],
  ['inbox_emails', 'inbox', ''],
] as const;
const globals = globalThis as unknown as {
  radarSqlite?: DatabaseSync;
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
      'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;',
    );
  }
  const db = globals.radarSqlite;
  return {
    async query(sql, params = []) {
      const stmt = db.prepare(sql.replace(/\$\d+/g, '?'));
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
    if (collectionEnabled()) applyPublicStarter(fresh);
    applyEnvironmentApprovals(fresh);
    return fresh;
  }
  const store = { version: 1, profile: JSON.parse(profile[0].payload) } as Store;
  for (const [table, key] of tables)
    (store[key] as unknown[]) = (await c.query(`SELECT payload FROM ${table}`)).map((r) =>
      JSON.parse(r.payload),
    );
  // Sources added to the registry after a workspace was created appear disabled and unreviewed.
  // Registry-owned fields follow the code; permission and enablement stay the owner's.
  for (const seed of emptyStore().sources) {
    const existing = store.sources.find((s) => s.id === seed.id);
    if (!existing) store.sources.push(seed);
    else
      Object.assign(existing, {
        name: seed.name,
        url: seed.url,
        method:
          existing.method === 'collector' && existing.collector ? existing.method : seed.method,
        intervalHours: seed.intervalHours,
      });
  }
  if (collectionEnabled()) applyPublicStarter(store);
  applyEnvironmentApprovals(store);
  return store;
}
async function save(c: Connection, s: Store) {
  await c.query("UPDATE user_profiles SET payload = $1 WHERE id = 'owner'", [
    JSON.stringify(s.profile),
  ]);
  for (const [table, key, relationships] of tables) {
    const columns = [...relationships.matchAll(/, (\w+) TEXT/g)].map((m) => m[1]);
    for (const item of s[key]) {
      const obj = item as unknown as Record<string, unknown>;
      const id = String(obj.id ?? obj.opportunityId);
      const values = [
        id,
        JSON.stringify(item),
        ...columns.map((col) =>
          String(obj[col.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())]),
        ),
      ];
      const names = ['id', 'payload', ...columns];
      await c.query(
        `INSERT INTO ${table} (${names.join(', ')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO UPDATE SET ${names
          .slice(1)
          .map((n) => `${n} = excluded.${n}`)
          .join(', ')}`,
        values,
      );
    }
  }
  for (const [table, key] of [...tables].reverse()) {
    const wanted = new Set(
      s[key].map((item) => String('id' in item ? item.id : item.opportunityId)),
    );
    for (const row of await c.query(`SELECT id FROM ${table}`))
      if (!wanted.has(row.id)) await c.query(`DELETE FROM ${table} WHERE id = $1`, [row.id]);
  }
}
export async function transaction<T>(fn: (s: Store) => T | Promise<T>, write = true): Promise<T> {
  if (process.env.DATABASE_URL) {
    globals.radarPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    const client = await globals.radarPool.connect(),
      c = pgConnection(client);
    try {
      await ready(c);
      await c.query('BEGIN');
      await c.query("SELECT id FROM user_profiles WHERE id = 'owner' FOR UPDATE");
      const state = await load(c);
      const result = await fn(state);
      if (write) await save(c, state);
      await c.query('COMMIT');
      return result;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  // Serialize asynchronous callbacks on one SQLite connection. BEGIN IMMEDIATE also
  // guards against a separate collector process writing to the same database.
  const previous = globals.radarQueue ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(async () => {
      const c = sqliteConnection();
      await ready(c);
      await c.query('BEGIN IMMEDIATE');
      try {
        const state = await load(c);
        const result = await fn(state);
        if (write) await save(c, state);
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
export const readStore = () => transaction((s) => s, false);
