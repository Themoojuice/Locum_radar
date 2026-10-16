import { test, expect } from '@playwright/test';
import { demoStore } from '../../src/domain/seed';
import { listingInputSchema } from '../../src/domain/model';
import { emptyStore } from '../../src/domain/seed';
import { collectionPlan } from '../../src/domain/collection';

test('public starter runs without setup and collected adverts appear without inventing a facility', async ({
  page,
}) => {
  const store = emptyStore();
  Object.assign(
    store.sources.find((s) => s.id === 'ochre')!,
    { enabled: true, permission: 'approved', permissionEvidence: 'Fixture' },
  );
  store.reviews.push({
    id: 'public-fixture',
    kind: 'extraction',
    sourceId: 'ochre',
    opportunityId: null,
    candidateId: null,
    resolved: false,
    reason: 'Facility needs confirmation',
    rawText: 'Public locum advert',
    draft: {
      title: 'Public ED registrar fixture',
      url: 'https://ochrerecruitment.com/job/fixture',
      externalId: 'fixture',
      state: 'NT',
      startDate: '2027-01-01',
      endDate: '2027-01-31',
    },
  });
  let attempted = 0;
  const discovered = store.reviews.pop()!;
  await page.route('**/api/collection', (route) =>
    route.fulfill({ json: { ...collectionPlan(store, true), automaticStarter: true } }),
  );
  await page.route('**/api/radar', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { ...store, starterAvailable: true } });
    if (route.request().postDataJSON().command === 'collect') {
      attempted++;
      store.reviews.push(discovered);
      return route.fulfill({
        json: { status: 'success', count: 1, message: 'Public fixture found' },
      });
    }
    return route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Public ED registrar fixture' })).toBeVisible();
  await expect(page.getByLabel('Master opportunity pool')).toContainText('Facility not confirmed');
  await expect.poll(() => attempted).toBe(1);
  await expect(
    page.getByRole('region', { name: 'Source collection progress' }).getByRole('status'),
  ).toContainText('1 succeeded');
});

test('one shared board filters public, Gmail and email adverts without requiring URLs', async ({
  page,
}) => {
  const store = emptyStore();
  for (const [id, sourceId, title, specialty, amount, basis] of [
    ['web', 'ochre', 'Public ED fixture', 'Emergency medicine', 150, 'hour'],
    ['mail', 'email', 'Email psychiatry fixture', 'Psychiatry', 200, 'hour'],
    ['gmail', 'gmail-label', 'Gmail daily fixture', 'Psychiatry', 1500, 'day'],
  ] as const)
    store.reviews.push({
      id,
      sourceId,
      kind: 'extraction',
      opportunityId: null,
      candidateId: null,
      resolved: false,
      reason: 'Unknown facility',
      rawText: title,
      draft: {
        externalId: id,
        title,
        specialty,
        grade: 'Registrar',
        state: 'QLD',
        compensation: { ...demoStore().offers[0].compensation, amount, basis },
        ...(id === 'web' ? { url: 'https://ochrerecruitment.com/job/fixture' } : {}),
      },
    });
  await page.route('**/api/radar', (route) =>
    route.fulfill({ json: { ...store, starterAvailable: true } }),
  );
  await page.route('**/api/collection', (route) =>
    route.fulfill({ json: collectionPlan(store, false) }),
  );
  await page.goto('/');
  await expect(page.locator('.job-card')).toHaveCount(3);
  await expect(page.getByText('FOUND ON PUBLIC JOB BOARDS', { exact: true })).toHaveCount(0);
  await page.getByLabel('Minimum advertised rate').fill('100');
  await expect(page.locator('.job-card')).toHaveCount(2);
  await page.getByLabel('Specialty', { exact: true }).selectOption('Psychiatry');
  await expect(page.locator('.job-card')).toHaveCount(1);
  await expect(page.locator('.job-card')).toContainText('Email psychiatry fixture');
  await page.getByLabel('Pay unit', { exact: true }).selectOption('day');
  await expect(page.locator('.job-card')).toHaveCount(1);
  await expect(page.locator('.job-card')).toContainText('Gmail daily fixture');
  await page.getByLabel('Minimum advertised rate').fill('');
  await page.getByLabel('Filter by source', { exact: true }).selectOption('email');
  await expect(page.locator('.job-card')).toHaveCount(1);
  await expect(page.locator('.job-card')).toContainText('Email psychiatry fixture');
});

test('example workspace: filter, compare, inspect unknowns and navigate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find your next chapter.' })).toBeVisible();
  await expect(page.getByText('Fictional vacancies and a sample doctor profile.')).toBeVisible();
  const coverage = page.getByRole('region', { name: 'Source collection progress' });
  await expect(coverage.getByText('0 / 14', { exact: true })).toBeVisible();
  await expect(coverage.getByRole('button', { name: 'Fetch active vacancies' })).toBeDisabled();
  await coverage.getByText('View all 14 sources and remaining work', { exact: true }).click();
  await expect(coverage.getByText('Medrecruit', { exact: true })).toBeVisible();
  await expect(coverage.getByText('Not successfully scraped yet', { exact: true })).toHaveCount(14);
  await coverage.getByText('View all 14 sources and remaining work', { exact: true }).click();
  await page.screenshot({ path: 'test-results/radar-desktop.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Search opportunities' }).fill('Cairns');
  await expect(page.locator('.job-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cairns Hospital', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('2 recruiter offers');
  await expect(page.getByRole('dialog')).toContainText('Example recruiter A');
  await expect(page.getByRole('dialog')).toContainText('Example recruiter B');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('textbox', { name: 'Search opportunities' }).fill('');
  await page
    .locator('.job-card')
    .nth(0)
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await page
    .locator('.job-card')
    .nth(1)
    .getByRole('button', { name: 'Compare', exact: true })
    .click();
  await page.getByRole('button', { name: 'Compare opportunities', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveCount(3);
  await page.getByRole('navigation').getByRole('button', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'January 2027' })).toBeVisible();
  await expect(page.locator('.placement-bar.overlap').first()).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Review queue/ })
    .click();
  await expect(page.getByRole('heading', { name: 'A few things to verify.' })).toBeVisible();
  await expect(page.getByText('Confirm your registration category.')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('button', { name: 'Map view', exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'Schematic map of Australian facilities' }),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/explorer-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('bulk search attempts every ready source and continues after a failure', async ({ page }) => {
  const store = emptyStore();
  for (const source of store.sources.filter((s) => ['medrecruit', 'ochre'].includes(s.id))) {
    source.enabled = true;
    source.permission = 'approved';
    source.permissionEvidence = 'Mock only';
  }
  const plan = collectionPlan(store, true);
  const attempted: string[] = [];
  await page.route('**/api/collection', (route) => route.fulfill({ json: plan }));
  await page.route('**/api/radar', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    if (body.command !== 'collect') return route.continue();
    attempted.push(body.sourceId);
    await route.fulfill({
      json: {
        status: attempted.length === 1 ? 'failed' : 'success',
        message: attempted.length === 1 ? 'Fixture failure' : 'Fixture review record',
        count: 1,
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  if (await page.getByRole('button', { name: 'Open my workspace', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open my workspace', exact: true }).click();
  const coverage = page.getByRole('region', { name: 'Source collection progress' });
  await coverage.getByRole('button', { name: 'Fetch active vacancies' }).click();
  await expect(coverage.getByRole('status')).toContainText(
    '2 of 2 attempted · 1 succeeded · 0 partial · 1 failed',
  );
  expect(attempted).toEqual(['medrecruit', 'ochre']);
  await expect(
    coverage.getByText('Medrecruit (failed: Fixture failure)', { exact: true }),
  ).toBeVisible();
});

test('real workspace: import two sources, preserve offers, save notes and reload', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open my workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Import opportunities', exact: true }).click();
  const sample = listingInputSchema.parse({
    ...demoStore().listings[0],
    sourceId: 'manual',
    externalId: 'e2e-1',
    rawText: 'TEST FIXTURE ONLY — not an actual advertised vacancy',
  });
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('json');
  await page.getByLabel('Advertisement text').fill(JSON.stringify(sample));
  await page.getByRole('button', { name: 'Extract & review' }).click();
  await page.getByRole('checkbox', { name: /I reviewed all/ }).check();
  await page.getByRole('button', { name: 'Import 1 advertisement', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.job-card')).toHaveCount(1);
  await expect(page.locator('.job-card')).toContainText('Needs verification');
  await page.getByRole('button', { name: 'Save Cairns Hospital', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Unsave Cairns Hospital', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Cairns Hospital', exact: true }).click();
  await page.getByLabel('Private notes').fill('Confirm supervision and travel before committing.');
  await page.getByRole('button', { name: 'Save tracker & notes' }).click();
  await expect(page.getByText('Tracker updated', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Import opportunities', exact: true }).click();
  await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('email');
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('json');
  await page.getByLabel('Advertisement text').fill(
    JSON.stringify({
      ...sample,
      externalId: 'e2e-2',
      compensation: { ...sample.compensation, amount: 190 },
    }),
  );
  await page.getByRole('button', { name: 'Extract & review' }).click();
  await page.getByRole('checkbox', { name: /I reviewed all/ }).check();
  await page.getByRole('button', { name: 'Import 1 advertisement', exact: true }).click();
  await expect(page.locator('.job-card')).toHaveCount(1);
  await expect(page.locator('.job-card')).toContainText('2 offers');
  await page.reload();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Shortlist/ })
    .click();
  await expect(page.locator('.job-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cairns Hospital', exact: true }).click();
  await expect(page.getByLabel('Private notes')).toHaveValue(
    'Confirm supervision and travel before committing.',
  );
  await expect(page.getByRole('dialog')).toContainText('$190 / hour');
  await page.getByRole('button', { name: 'Close dialog' }).click();
});

test('bulk search can stop after the active source without starting another', async ({ page }) => {
  const store = emptyStore();
  for (const source of store.sources.filter((s) => ['medrecruit', 'ochre'].includes(s.id))) {
    Object.assign(source, {
      enabled: true,
      permission: 'approved',
      permissionEvidence: 'Mock only',
    });
  }
  const attempted: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/collection', (route) =>
    route.fulfill({ json: collectionPlan(store, true) }),
  );
  await page.route('**/api/radar', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON();
    if (body.command !== 'collect') return route.continue();
    attempted.push(body.sourceId);
    await pending;
    await route.fulfill({ json: { status: 'success', message: 'Fixture completed', count: 0 } });
  });
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  if (await page.getByRole('button', { name: 'Open my workspace', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open my workspace', exact: true }).click();
  const coverage = page.getByRole('region', { name: 'Source collection progress' });
  await coverage.getByRole('button', { name: 'Fetch active vacancies' }).click();
  await expect.poll(() => attempted.length).toBe(1);
  await coverage.getByRole('button', { name: 'Stop after this batch' }).click();
  release();
  await expect(coverage.getByRole('status')).toContainText('Stopped: 1 of 2 attempted');
  expect(attempted).toEqual(['medrecruit']);
});

test('mobile layout stays within the viewport and navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  if (await page.getByRole('button', { name: 'Explore examples', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Explore examples', exact: true }).click();
  await expect(page.locator('.job-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/radar-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'My profile & preferences', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make this radar yours.' })).toBeVisible();
});

test('Discover drains resumable batches and reports a limited source as partial', async ({
  page,
}) => {
  const store = emptyStore();
  Object.assign(
    store.sources.find((s) => s.id === 'medrecruit')!,
    {
      enabled: true,
      permission: 'approved',
      permissionEvidence: 'Fixture',
    },
  );
  await page.route('**/api/collection', (route) =>
    route.fulfill({ json: collectionPlan(store, true) }),
  );
  let batches = 0;
  await page.route('**/api/radar', async (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().command !== 'collect')
      return route.continue();
    batches++;
    await route.fulfill({
      json: {
        status: 'partial',
        remaining: 5,
        limited: batches === 2,
        message: batches === 2 ? 'Scan budget reached' : '3 pages checked',
        count: 1,
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  if (await page.getByRole('button', { name: 'Open my workspace', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open my workspace', exact: true }).click();
  const coverage = page.getByRole('region', { name: 'Source collection progress' });
  await coverage.getByRole('button', { name: 'Fetch active vacancies' }).click();
  await expect(coverage.getByRole('status')).toContainText('0 succeeded · 1 partial');
  expect(batches).toBe(2);
});

test('source catalog exposes label-only Gmail setup and saves a custom feed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  if (await page.getByRole('button', { name: 'Open my workspace', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Open my workspace', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Add / update collector recipes' }).click();
  await expect(
    page.getByRole('heading', { name: 'Gmail recruitment label', exact: true }),
  ).toBeVisible();
  const installed = await (await page.request.get('/api/radar')).json();
  for (const id of ['medrecruit', '1medical', 'wavelength', 'adzuna']) {
    expect(installed.sources.find((source: { id: string }) => source.id === id).method).toBe(
      'json-api',
    );
  }
  const gmail = page
    .locator('.source-card')
    .filter({ has: page.getByRole('heading', { name: 'Gmail recruitment label', exact: true }) });
  await gmail.getByRole('button', { name: 'Set up source' }).click();
  await page.getByText('Advanced page and search settings', { exact: true }).click();
  await expect(page.getByLabel('Import only this Gmail label')).toHaveValue('');
  await expect(page.getByLabel('Maximum pages / messages per scan')).toHaveValue('200');
  await page.screenshot({ path: 'test-results/gmail-settings.png' });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Add a custom source' }).click();
  await page.getByLabel('Source name', { exact: true }).fill('Fixture feed');
  await page
    .getByLabel('Starting URLs (one per line)')
    .fill('https://example.com/jobs.xml\nhttps://example.com/other.xml');
  await page.getByLabel('Allowed website hosts (one per line)').fill('example.com');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const feed = page
    .locator('.source-card')
    .filter({ has: page.getByRole('heading', { name: 'Fixture feed', exact: true }) });
  await feed.getByRole('button', { name: 'Set up source' }).click();
  await page.getByText('Advanced page and search settings', { exact: true }).click();
  await expect(page.getByLabel('Starting URLs (one per line)')).toHaveValue(
    'https://example.com/jobs.xml\nhttps://example.com/other.xml',
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.screenshot({ path: 'test-results/acquisition-sources.png' });
});

test('Gmail guided import searches all history and drains batches into the board', async ({
  page,
}) => {
  const store = emptyStore();
  let collected = 0;
  let settings: Record<string, unknown> | undefined;
  await page.route('**/api/gmail', (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: true,
        labels: [{ id: 'Label_jobs', name: 'Recruitment' }],
      },
    }),
  );
  await page.route('**/api/collection', (route) =>
    route.fulfill({ json: collectionPlan(store, false) }),
  );
  await page.route('**/api/radar', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { ...store, starterAvailable: true } });
    const body = route.request().postDataJSON();
    if (body.command === 'source') settings = body;
    if (body.command === 'collect') {
      collected++;
      return route.fulfill({
        json:
          collected === 1
            ? { status: 'partial', remaining: 1, message: 'First email imported' }
            : { status: 'success', remaining: 0, message: 'All matching emails processed' },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import from Gmail', exact: true }).click();
  await expect(page.getByLabel('Emails to import')).toHaveValue('search');
  await expect(page.getByLabel('Search all email history')).toBeChecked();
  await page.getByRole('button', { name: 'Import from Gmail', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('All matching emails processed');
  expect(collected).toBe(2);
  expect(settings?.enabled).toBe(true);
  expect(settings?.collector).toMatchObject({
    kind: 'gmail',
    gmailMode: 'search',
    gmailAllHistory: true,
    labelId: '',
  });
  await page.getByLabel('Emails to import').selectOption('label');
  await page.getByLabel('Gmail label', { exact: true }).selectOption('Label_jobs');
  await page.getByRole('button', { name: 'Import from Gmail', exact: true }).click();
  await expect
    .poll(() => settings?.collector)
    .toMatchObject({ gmailMode: 'label', labelId: 'Label_jobs' });
});
test('Google setup saves credentials through a form without exposing them in status', async ({
  page,
}) => {
  const store = emptyStore();
  let saved: Record<string, string> | undefined;
  let configured = false;
  await page.route('**/api/radar', (route) =>
    route.fulfill({ json: { ...store, starterAvailable: true } }),
  );
  await page.route('**/api/collection', (route) =>
    route.fulfill({ json: collectionPlan(store, false) }),
  );
  await page.route('**/api/gmail', (route) =>
    route.fulfill({ json: { configured, connected: false, labels: [] } }),
  );
  await page.route('**/api/setup', (route) => {
    if (route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      configured = true;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      json: { configured: {}, redirectUri: 'http://127.0.0.1:3100/api/gmail/callback' },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import from Gmail', exact: true }).click();
  await page
    .getByLabel('Google client ID', { exact: true })
    .fill('fixture.apps.googleusercontent.com');
  await page.getByLabel('Google client secret', { exact: true }).fill('fixture-secret');
  await page.getByRole('button', { name: 'Save connection settings' }).click();
  await expect(page.getByRole('button', { name: 'Connect Gmail with Google' })).toBeEnabled();
  expect(saved).toEqual({
    GMAIL_CLIENT_ID: 'fixture.apps.googleusercontent.com',
    GMAIL_CLIENT_SECRET: 'fixture-secret',
  });
  await expect(page.locator('body')).not.toContainText('fixture-secret');
});

test('public source setup enables and collects without a generic permission form', async ({
  page,
}) => {
  const store = emptyStore();
  let configured = false;
  let collected = false;
  await page.route('**/api/collection', (route) =>
    route.fulfill({ json: collectionPlan(store, false) }),
  );
  await page.route('**/api/gmail', (route) =>
    route.fulfill({ json: { configured: false, connected: false, labels: [] } }),
  );
  await page.route('**/api/setup', (route) =>
    route.fulfill({
      json: { configured: {}, redirectUri: 'http://127.0.0.1:3100/api/gmail/callback' },
    }),
  );
  await page.route('**/api/radar', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { ...store, starterAvailable: true } });
    const body = route.request().postDataJSON();
    if (body.command === 'source')
      configured = body.enabled && body.permission === 'approved' && !!body.permissionEvidence;
    if (body.command === 'collect') {
      collected = true;
      return route.fulfill({
        json: { status: 'success', remaining: 0, message: 'Source checked successfully' },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import from Gmail', exact: true }).click();
  const source = page
    .locator('.source-card')
    .filter({ has: page.getByRole('heading', { name: 'Medrecruit', exact: true }) });
  await source.getByRole('button', { name: 'Set up source' }).click();
  await expect(page.getByRole('dialog')).toContainText('no login or API key');
  await page.getByRole('button', { name: 'Save & collect now' }).click();
  await expect.poll(() => collected).toBe(true);
  expect(configured).toBe(true);
});
