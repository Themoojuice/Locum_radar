import { test, expect } from '@playwright/test';
import { demoStore } from '../../src/domain/seed';
import { listingInputSchema } from '../../src/domain/model';
import { emptyStore } from '../../src/domain/seed';
import { collectionPlan } from '../../src/domain/collection';

test('agency feed runs without setup and collected adverts appear without inventing a facility', async ({
  page,
}) => {
  const store = emptyStore();
  Object.assign(
    store.sources.find((s) => s.id === 'medrecruit')!,
    { enabled: true, permission: 'approved', permissionEvidence: 'Fixture' },
  );
  store.reviews.push({
    id: 'public-fixture',
    kind: 'extraction',
    sourceId: 'medrecruit',
    opportunityId: null,
    candidateId: null,
    resolved: false,
    reason: 'Facility needs confirmation',
    rawText: 'Public locum advert',
    draft: {
      title: 'Public ED registrar fixture',
      url: 'https://medrecruit.medworld.com/jobs/fixture',
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
  await expect(page.getByRole('heading', { name: 'Find your next locum job.' })).toBeVisible();
  await expect(page.getByText('Fictional vacancies and a sample doctor profile.')).toBeVisible();
  const coverage = page.getByRole('region', { name: 'Source collection progress' });
  await expect(
    coverage.getByText('0 sources checked / 4 available', { exact: false }),
  ).toBeVisible();
  await expect(coverage.getByRole('button', { name: 'Fetch active vacancies' })).toBeDisabled();
  await coverage.getByText('View all 4 sources and remaining work', { exact: true }).click();
  await expect(coverage.getByText('Medrecruit', { exact: true })).toBeVisible();
  await expect(coverage.getByText('Not successfully scraped yet', { exact: true })).toHaveCount(4);
  await coverage.getByText('View all 4 sources and remaining work', { exact: true }).click();
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
  for (const source of store.sources.filter((s) => ['medrecruit', 'wavelength'].includes(s.id))) {
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
  expect(attempted).toEqual(['medrecruit', 'wavelength']);
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
  for (const source of store.sources.filter((s) => ['medrecruit', 'wavelength'].includes(s.id))) {
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
  await expect(page.getByRole('button', { name: 'Connect Gmail', exact: true })).toBeEnabled();
  expect(saved).toEqual({
    GMAIL_CLIENT_ID: 'fixture.apps.googleusercontent.com',
    GMAIL_CLIENT_SECRET: 'fixture-secret',
  });
  await expect(page.locator('body')).not.toContainText('fixture-secret');
});

test('an agency feed switches on and collects without a permission form', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Manage sources', exact: true }).click();
  const source = page
    .locator('.source-card')
    .filter({ has: page.getByRole('heading', { name: 'Medrecruit', exact: true }) });
  await source.getByLabel('Check Medrecruit automatically').click();
  await expect.poll(() => collected).toBe(true);
  expect(configured).toBe(true);
});

test('old email adverts are hidden by message date and recoverable without hiding public roles', async ({
  page,
}) => {
  const store = emptyStore();
  for (const [id, sourceId, age] of [
    ['old', 'email', 60],
    ['recent', 'email', 2],
    ['public', 'ochre', 60],
  ] as const)
    store.reviews.push({
      id,
      sourceId,
      kind: 'extraction',
      opportunityId: null,
      candidateId: null,
      resolved: false,
      reason: 'Fixture',
      rawText: id,
      draft: { title: id, externalId: id },
      observedAt: new Date().toISOString(),
      publishedAt: new Date(Date.now() - age * 86400000).toISOString(),
    });
  await page.route('**/api/radar', (r) =>
    r.fulfill({ json: { ...store, starterAvailable: true } }),
  );
  await page.route('**/api/collection', (r) => r.fulfill({ json: collectionPlan(store, false) }));
  await page.goto('/');
  await expect(page.locator('.job-card')).toHaveCount(2);
  await expect(
    page
      .locator('.job-card')
      .filter({ has: page.getByRole('heading', { name: 'old', exact: true }) }),
  ).toHaveCount(0);
  await page.getByLabel('Include emails older than 30 days').check();
  await expect(page.locator('.job-card')).toHaveCount(3);
});

test('screened personal emails stay out of the board until explicitly shown', async ({ page }) => {
  const store = emptyStore();
  store.reviews.push({
    id: 'held-personal',
    sourceId: 'email',
    kind: 'extraction',
    opportunityId: null,
    candidateId: null,
    resolved: false,
    reason: 'Screening fixture',
    rawText: 'Personal email fixture',
    draft: { title: 'Personal email fixture' },
    publishedAt: new Date().toISOString(),
    emailScreen: { status: 'ignore', reason: 'No medical vacancy evidence' },
  });
  await page.route('**/api/radar', (r) =>
    r.fulfill({ json: { ...store, starterAvailable: true } }),
  );
  await page.route('**/api/collection', (r) => r.fulfill({ json: collectionPlan(store, false) }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Import from Gmail', exact: true })).toBeVisible();
  await expect(page.locator('.job-card')).toHaveCount(0);
  await page.getByLabel('Show emails held for screening').check();
  await expect(page.locator('.job-card')).toHaveCount(1);
  await expect(page.locator('.job-card')).toContainText('Held for screening');
});

test('recruiter inbox imports offers in batches and lists their vacancies', async ({ page }) => {
  const store = emptyStore();
  const commands: string[] = [];
  const email = {
    id: 'msg-fixture-1',
    threadId: 't1',
    agency: 'Medrecruit',
    recruiter: 'Jo Example',
    fromAddress: 'info@connect.medrecruit.com',
    subject: 'RMO Jobs This Week!',
    receivedAt: '2026-10-19T23:00:00.000Z',
    kind: 'offers',
    summary: '2 vacancies read.',
    permanent: false,
    body: 'Wattleford MED RMO | 29 Jan–5 Feb | $150 p/h',
    links: [],
    gmailUrl: 'https://mail.google.com/mail/u/0/#all/msg-fixture-1',
    parser: 3,
    importedAt: '2026-10-21T00:00:00.000Z',
    status: 'new',
    vacancies: [
      {
        id: 'msg-fixture-1-0',
        hospital: 'Wattleford Hospital',
        town: 'Wattleford',
        state: 'NSW',
        role: 'MED RMO',
        specialty: 'General medicine',
        grade: 'RMO',
        start: '2099-01-29',
        end: '2099-02-05',
        dateText: '29 Jan–5 Feb',
        blocks: [],
        rateText: '$150 p/h',
        amount: 150,
        basis: 'hour',
        super: 'unknown',
        roster: '',
        flights: 'unknown',
        accommodation: 'unknown',
        positions: null,
        minPgy: null,
        excerpt: 'NSW · Wattleford · MED RMO | 29 Jan–5 Feb | $150 p/h',
        notes: [],
        missing: [],
        opportunityId: 'opp-1',
        ended: false,
      },
      {
        id: 'msg-fixture-1-1',
        hospital: '',
        town: '',
        state: 'QLD',
        role: 'PHO – Community',
        specialty: 'Psychiatry',
        grade: 'PHO',
        start: '2099-03-01',
        end: '2099-04-01',
        dateText: '01.03.99 - 01.04.99',
        blocks: [],
        rateText: '$1,025 per day',
        amount: 1025,
        basis: 'day',
        super: 'unknown',
        roster: '',
        flights: 'included',
        accommodation: 'included',
        positions: null,
        minPgy: null,
        excerpt: 'Position: PHO · Unit: Community',
        notes: ['The email names the state and unit, not the hospital.'],
        missing: ['hospital'],
        opportunityId: null,
        ended: false,
      },
    ],
  };
  let imported = false;
  await page.route('**/api/gmail', (r) =>
    r.fulfill({ json: { configured: true, connected: true, labels: [] } }),
  );
  await page.route('**/api/collection', (r) => r.fulfill({ json: collectionPlan(store, false) }));
  await page.route('**/api/radar', async (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({
        json: { ...store, inbox: imported ? [email] : [], starterAvailable: false },
      });
    const body = r.request().postDataJSON();
    commands.push(body.command);
    if (body.command === 'inbox-list')
      return r.fulfill({ json: { total: 1, ids: imported ? [] : ['msg-fixture-1'] } });
    if (body.command === 'inbox-read') {
      imported = true;
      return r.fulfill({ json: { read: 1, offers: 1, vacancies: 2, added: 1 } });
    }
    return r.fulfill({ json: { ok: true } });
  });
  // Opening the workspace imports new recruiter emails in the background.
  await page.goto('/');
  await expect.poll(() => commands.slice(0, 2)).toEqual(['inbox-list', 'inbox-read']);
  await expect(page.getByRole('region', { name: 'Recruiter inbox' })).toContainText(
    '2 current vacancies',
  );
  await page.getByRole('button', { name: /Recruiter inbox/ }).click();
  await expect(page.getByText('Wattleford Hospital')).toBeVisible();
  await expect(page.getByRole('button', { name: /In feed/ })).toBeVisible();
  // A manual import reads only new emails.
  await page.getByRole('button', { name: 'Import offers' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'already read' })).toBeVisible();
  await page.getByRole('button', { name: /Add hospital/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('a pasted advert is read by Claude into the inbox', async ({ page }) => {
  const store = emptyStore();
  const pasted: Record<string, unknown>[] = [];
  await page.route('**/api/gmail', (r) =>
    r.fulfill({ json: { configured: true, connected: false, labels: [] } }),
  );
  await page.route('**/api/setup', (r) =>
    r.fulfill({ json: { configured: { ANTHROPIC_API_KEY: true }, redirectUri: '' } }),
  );
  await page.route('**/api/collection', (r) => r.fulfill({ json: collectionPlan(store, false) }));
  await page.route('**/api/radar', async (r) => {
    if (r.request().method() === 'GET')
      return r.fulfill({ json: { ...store, starterAvailable: true } });
    const body = r.request().postDataJSON();
    if (body.command === 'inbox-paste') {
      pasted.push(body);
      return r.fulfill({
        json: { id: 'paste-1', kind: 'offers', vacancies: 1, added: 1, summary: '', cost: 0.001 },
      });
    }
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add an advert' }).first().click();
  await page
    .getByLabel('Advert text')
    .fill('Mackay Base ED SRMO 3–17 Jan, $165/hr + super, flights and accom provided');
  await page.getByRole('button', { name: 'Read it' }).click();
  await expect.poll(() => pasted.length).toBe(1);
  expect(pasted[0]).toMatchObject({ text: expect.stringContaining('Mackay Base'), images: [] });
  await expect(page.getByText('1 vacancy read; 1 added to your feed.')).toBeVisible();
});
