import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyStore } from '@/domain/seed';
import { sourceRecipes, sourceFromRecipe } from '@/domain/source-catalog';
import { readStore, transaction } from '@/server/database';
import { collectSource } from '@/server/collectors';
import { candidate, type ParsedPage } from '@/server/acquisition/parsers';
import { collectionPlan } from '@/domain/collection';
const processor = vi.hoisted(() => vi.fn());
vi.mock('@/server/acquisition/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/acquisition/providers')>()),
  pageProcessor: () => processor,
}));
beforeAll(() => {
  process.env.SQLITE_PATH = path.join(
    mkdtempSync(path.join(tmpdir(), 'radar-collector-')),
    'test.sqlite',
  );
  process.env.DATABASE_URL = '';
});
beforeEach(async () => {
  vi.stubEnv('COLLECTOR_ENABLED', 'true');
  processor.mockReset();
  await transaction((s) => {
    Object.assign(s, emptyStore());
    const source = sourceFromRecipe(sourceRecipes.find((r) => r.id === 'ochre')!);
    Object.assign(source, {
      enabled: true,
      permission: 'approved',
      permissionEvidence: 'Test fixture only',
    });
    s.sources = [source];
  });
});
afterEach(() => vi.unstubAllEnvs());
const result = (n: number, more = true): ParsedPage => ({
  recognised: true,
  candidates: [candidate('Registrar', 'Cairns Hospital locum ' + n, String(n), null, 'ochre')],
  links: more ? [{ kind: 'detail', url: 'https://ochrerecruitment.com/job/' + (n + 1) }] : [],
});
describe('durable collector checkpoints', () => {
  it('resumes an unfinished scan immediately, then observes the daily refresh interval', async () => {
    let index = 0;
    processor.mockImplementation(async () => result(++index, index < 4));
    const first = await collectSource('ochre');
    expect(first.status).toBe('partial');
    expect(first.pages).toBe(3);
    expect(first.remaining).toBe(1);
    expect(collectionPlan(await readStore(), true).ready).toBe(1);
    expect((await collectSource('ochre')).status).toBe('success');
    const saved = await readStore();
    expect(saved.documents).toHaveLength(4);
    expect(saved.reviews).toHaveLength(4);
    expect(saved.opportunities).toHaveLength(0);
    expect(saved.sources[0].crawl?.leaseOwner).toBeUndefined();
    expect((await collectSource('ochre')).status).toBe('skipped');
  });
  it('resumes a record-capped page without losing the unprocessed candidates', async () => {
    await transaction((s) => {
      s.sources[0].collector!.maxRecords = 1;
    });
    processor.mockResolvedValue({
      recognised: true,
      candidates: [result(1).candidates[0], result(2).candidates[0]],
      links: [],
    });
    expect((await collectSource('ochre')).limited).toBe(true);
    expect((await readStore()).documents).toHaveLength(1);
    await transaction((s) => {
      s.sources[0].collector!.maxRecords = 10;
    });
    expect((await collectSource('ochre')).status).toBe('success');
    expect((await readStore()).documents).toHaveLength(2);
  });
  it('records page failure without discarding previously captured evidence', async () => {
    processor.mockResolvedValueOnce(result(1)).mockRejectedValueOnce(new Error('HTTP 503'));
    const run = await collectSource('ochre');
    expect(run.status).toBe('partial');
    expect((await readStore()).documents).toHaveLength(1);
    expect((await readStore()).sources[0].lastSuccess).toBeNull();
  });
  it('does not claim an active lease and can reclaim an expired one', async () => {
    processor.mockResolvedValue(result(1, false));
    await collectSource('ochre');
    await transaction((s) => {
      const c = s.sources[0].crawl!;
      c.complete = false;
      c.queue = [{ kind: 'detail', url: 'https://ochrerecruitment.com/job/2' }];
      c.leaseOwner = 'other';
      c.leaseUntil = new Date(Date.now() + 60000).toISOString();
    });
    expect((await collectSource('ochre')).status).toBe('skipped');
    await transaction((s) => {
      s.sources[0].crawl!.leaseUntil = '2000-01-01T00:00:00Z';
    });
    expect((await collectSource('ochre')).status).toBe('success');
  });
  it('backs off after rate limiting without consuming the failed page', async () => {
    processor.mockRejectedValue(new Error('Source rate-limited collection; wait before retrying'));
    expect((await collectSource('ochre')).status).toBe('partial');
    expect((await readStore()).sources[0].crawl?.pages).toBe(0);
    expect(collectionPlan(await readStore(), true).waiting).toBe(1);
    expect((await collectSource('ochre')).status).toBe('skipped');
    expect(processor).toHaveBeenCalledTimes(1);
  });
  it('does not persist a fetched message if its source was disabled while fetching', async () => {
    processor.mockImplementation(async () => {
      await transaction((s) => {
        s.sources[0].enabled = false;
      });
      return result(1);
    });
    expect((await collectSource('ochre')).status).toBe('failed');
    const saved = await readStore();
    expect(saved.documents).toHaveLength(0);
    expect(saved.sources[0].crawl?.queue).toHaveLength(1);
  });
  it('keeps provider and dynamic-pagination warnings as partial coverage', async () => {
    processor.mockResolvedValue({
      ...result(1, false),
      warnings: ['Dynamic pagination needs review'],
    });
    expect((await collectSource('ochre')).status).toBe('partial');
    expect((await readStore()).sources[0].lastSuccess).toBeNull();
  });
  it('reports a cumulative scan total rather than just the last batch', async () => {
    let index = 0;
    processor.mockImplementation(async () => result(++index, index < 4));
    await collectSource('ochre');
    const last = await collectSource('ochre');
    expect(last.count).toBe(1);
    expect(last.scanCount).toBe(4);
    expect(last.message).toContain('4 adverts added or updated in this scan');
  });
  it('reuses unchanged recent details, but fetches changed summaries and aged details', async () => {
    const url = 'https://ochrerecruitment.com/job/known';
    const indexPage = (signature: string): ParsedPage => ({
      recognised: true,
      candidates: [],
      links: [{ kind: 'detail', url, signature }],
    });
    processor.mockResolvedValueOnce(indexPage('a')).mockResolvedValueOnce({
      ...result(1, false),
      candidates: [{ ...result(1, false).candidates[0], url }],
    });
    await collectSource('ochre');
    const reset = () =>
      transaction((s) => {
        s.sources[0].lastAttempt = null;
      });
    await reset();
    processor.mockReset();
    processor.mockResolvedValue(indexPage('a'));
    const cached = await collectSource('ochre');
    expect(processor).toHaveBeenCalledTimes(1);
    expect(cached.scanCount).toBe(0);
    expect(cached.message).toContain('1 unchanged adverts reused');
    await reset();
    processor.mockReset();
    processor.mockResolvedValueOnce(indexPage('b')).mockResolvedValueOnce({
      ...result(1, false),
      candidates: [{ ...result(1, false).candidates[0], url }],
    });
    await collectSource('ochre');
    expect(processor).toHaveBeenCalledTimes(2);
    await reset();
    await transaction((s) => {
      s.sources[0].detailChecks![url].checkedAt = '2000-01-01T00:00:00Z';
    });
    processor.mockReset();
    processor.mockResolvedValueOnce(indexPage('b')).mockResolvedValueOnce(result(1, false));
    await collectSource('ochre');
    expect(processor).toHaveBeenCalledTimes(2);
  });
});

it('reports Gmail findings even when already stored and counts skipped messages', async () => {
  await transaction((s) => {
    const source = sourceFromRecipe(sourceRecipes.find((r) => r.id === 'gmail-label')!);
    Object.assign(source, {
      enabled: true,
      permission: 'approved',
      permissionEvidence: 'Test fixture',
    });
    source.collector!.gmailMode = 'search';
    source.collector!.query = 'locum';
    source.collector!.delayMs = 1000;
    s.sources = [source];
  });
  const offer = candidate(
    'Registrar offer',
    'Locum registrar at Example Hospital $180 per hour',
    'message:0',
    null,
    'gmail-label',
    'email',
  );
  offer.emailScreen = { status: 'offer', reason: 'Fixture' };
  processor
    .mockResolvedValueOnce({
      recognised: true,
      candidates: [],
      links: [
        { kind: 'message', url: '/gmail/v1/users/me/messages/1' },
        { kind: 'message', url: '/gmail/v1/users/me/messages/2' },
      ],
    })
    .mockResolvedValueOnce({ recognised: true, candidates: [offer], links: [] })
    .mockResolvedValueOnce({ recognised: true, candidates: [], links: [] });
  const run = await collectSource('gmail-label');
  expect(run.gmailFindings?.[0].title).toBe('Registrar offer');
  expect(run.gmailSkipped).toBe(1);
  await transaction((s) => {
    delete s.sources[0].crawl;
    s.sources[0].lastAttempt = null;
  });
  processor
    .mockResolvedValueOnce({
      recognised: true,
      candidates: [],
      links: [{ kind: 'message', url: '/gmail/v1/users/me/messages/1' }],
    })
    .mockResolvedValueOnce({ recognised: true, candidates: [offer], links: [] });
  const repeat = await collectSource('gmail-label');
  expect(repeat.count).toBe(0);
  expect(repeat.gmailFindings).toHaveLength(1);
}, 15000);
