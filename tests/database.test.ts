import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { transaction, readStore, readObservations } from '@/server/database';
import { demoStore } from '@/domain/seed';
import { ingest } from '@/domain/ingestion';
import { listingInputSchema } from '@/domain/model';
import { POST, GET } from '@/app/api/radar/route';
beforeAll(() => {
  process.env.SQLITE_PATH = path.join(
    mkdtempSync(path.join(tmpdir(), 'radar-test-')),
    'test.sqlite',
  );
  process.env.DATABASE_URL = '';
  process.env.APP_PASSWORD = '';
  process.env.APP_ORIGIN = 'http://127.0.0.1:3000';
});
describe('transactional persistence and HTTP boundary', () => {
  it('starts empty without inventing a doctor profile', async () => {
    const store = await readStore();
    expect(store.profile.registration).toBe('unknown');
    expect(store.opportunities).toHaveLength(0);
  });
  it('persists an import through independent reads', async () => {
    await transaction((s) =>
      ingest(s, listingInputSchema.parse({ ...demoStore().listings[0], sourceId: 'manual' })),
    );
    const s = await readStore();
    expect(s.opportunities).toHaveLength(1);
    expect(s.offers).toHaveLength(1);
    // History is read on demand rather than loaded with every transaction.
    expect(await readObservations(s.listings.map((l) => l.id))).toHaveLength(1);
  });
  it('rolls back all data when a transaction fails', async () => {
    await expect(
      transaction((s) => {
        s.profile.name = 'Should not persist';
        throw new Error('Simulated interruption');
      }),
    ).rejects.toThrow();
    expect((await readStore()).profile.name).toBe('My profile');
  });
  it('serialises simultaneous writes without losing updates', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        transaction(async (s) => {
          await new Promise((r) => setTimeout(r, 5));
          s.profile.credentials.push(`test-${i}`);
        }),
      ),
    );
    expect((await readStore()).profile.credentials).toHaveLength(5);
  });
  it('rejects cross-origin mutations before touching stored data', async () => {
    const r = await POST(
      new Request('http://127.0.0.1:3000/api/radar', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
        body: JSON.stringify({ command: 'profile', profile: demoStore().profile }),
      }),
    );
    expect(r.status).toBe(400);
    expect((await readStore()).profile.name).toBe('My profile');
  });
  it('rejects invalid input atomically', async () => {
    const r = await POST(
      new Request('http://127.0.0.1:3000/api/radar', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000' },
        body: JSON.stringify({ command: 'import', listings: [{ title: 'Broken' }] }),
      }),
    );
    expect(r.status).toBe(400);
    expect((await readStore()).listings).toHaveLength(1);
  });
  it('returns private no-store data', async () => {
    const r = await GET(new Request('http://127.0.0.1:3000/api/radar'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
  });
  it('deletes related imported content without dangling records', async () => {
    const s = await readStore();
    const listingIds = s.listings.map((l) => l.id);
    const r = await POST(
      new Request('http://127.0.0.1:3000/api/radar', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000' },
        body: JSON.stringify({ command: 'delete', opportunityId: s.opportunities[0].id }),
      }),
    );
    expect(r.status).toBe(200);
    const after = await readStore();
    expect(after.opportunities).toHaveLength(0);
    expect(after.listings).toHaveLength(0);
    expect(after.offers).toHaveLength(0);
    expect(await readObservations(listingIds)).toHaveLength(0);
  });
});
