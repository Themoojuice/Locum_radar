import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { emptyStore } from '@/domain/seed';
import { readStore, transaction } from '@/server/database';
import { collectSource } from '@/server/collectors';
import { collectionPlan } from '@/domain/collection';
import { requestStop } from '@/server/progress';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/server/acquisition/transport', async (original) => ({
  ...(await original<typeof import('@/server/acquisition/transport')>()),
  requestPage: request,
}));
beforeAll(() => {
  process.env.SQLITE_PATH = path.join(
    mkdtempSync(path.join(tmpdir(), 'radar-native-')),
    'test.sqlite',
  );
  process.env.DATABASE_URL = '';
});
beforeEach(async () => {
  vi.stubEnv('COLLECTOR_ENABLED', 'true');
  vi.stubEnv('COLLECTOR_PAGE_DELAY_MS', '0');
  requestStop(false);
  request.mockReset();
  await transaction((s) => {
    Object.assign(s, emptyStore());
    Object.assign(
      s.sources.find((v) => v.id === 'medrecruit')!,
      {
        enabled: true,
        permission: 'approved',
        permissionEvidence: 'Synthetic test only',
      },
    );
  });
});
afterEach(() => vi.unstubAllEnvs());
const html = (total: number) =>
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: {
      pageProps: {
        jobs: {
          data: [
            {
              jobNumber: 'JN900',
              title: 'Registrar - Psychiatry',
              grade: 'Registrar',
              speciality: 'Psychiatry',
              city: 'Cairns',
              location: 'Queensland',
              country: 'AU',
              clientNameMessage: 'Cairns Hospital',
              displayClientName: true,
              descriptionPlainText: 'Locum cover required.',
              startDate: '2027-01-11',
              endDate: '2027-01-22',
              payRate: '1500',
              payInterval: 'per day',
              workType: 'Locum',
              status: 'open',
            },
          ],
          page: 1,
          limit: 20,
          total,
        },
      },
    },
  })}</script>`;
function responses(total = 1) {
  request
    .mockResolvedValueOnce({ status: 200, text: 'User-agent: *\nAllow: /' })
    .mockResolvedValueOnce({ status: 200, text: html(total) });
}
it('retains the native adapter, imports valid records and enforces its refresh interval', async () => {
  responses();
  expect((await collectSource('medrecruit')).status).toBe('success');
  const store = await readStore();
  expect(store.sources.find((s) => s.id === 'medrecruit')!.method).toBe('json-api');
  expect(store.listings).toHaveLength(1);
  expect((await collectSource('medrecruit')).status).toBe('skipped');
  expect(request).toHaveBeenCalledTimes(2);
});
it('reports an early seen-page exit as partial and preserves existing vacancies', async () => {
  responses();
  await collectSource('medrecruit');
  await transaction((s) => {
    s.sources.find((v) => v.id === 'medrecruit')!.lastAttempt = null;
  });
  responses(100);
  expect((await collectSource('medrecruit')).status).toBe('partial');
  const store = await readStore();
  expect(store.listings).toHaveLength(1);
  expect(collectionPlan(store, true).sources.find((s) => s.id === 'medrecruit')!.partial).toBe(
    true,
  );
});
it('does not save native results if the source is disabled during its request', async () => {
  request.mockResolvedValueOnce({ status: 200, text: 'User-agent: *\nAllow: /' });
  request.mockImplementationOnce(async () => {
    await transaction((s) => {
      s.sources.find((v) => v.id === 'medrecruit')!.enabled = false;
    });
    return { status: 200, text: html(1) };
  });
  expect((await collectSource('medrecruit')).status).toBe('failed');
  expect((await readStore()).listings).toHaveLength(0);
});
