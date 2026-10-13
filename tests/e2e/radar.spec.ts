import { test, expect } from '@playwright/test';
import { demoStore } from '../../src/domain/seed';
import { listingInputSchema } from '../../src/domain/model';
import { emptyStore } from '../../src/domain/seed';
import { collectionPlan } from '../../src/domain/collection';

const webSources = emptyStore().sources.filter(
  (s) => s.type === 'agency' || s.type === 'government',
).length;

test('example workspace: filter, compare, inspect unknowns and navigate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find your next chapter.' })).toBeVisible();
  await expect(page.getByText('Fictional vacancies and a sample doctor profile.')).toBeVisible();
  const coverage = page.getByRole('region', { name: 'Source collection progress' });
  await expect(coverage.getByText(`0 / ${webSources}`, { exact: true })).toBeVisible();
  await expect(coverage.getByRole('button', { name: 'Fetch active vacancies' })).toBeDisabled();
  await coverage
    .getByText(`View all ${webSources} sources and remaining work`, { exact: true })
    .click();
  await expect(coverage.getByText('Medrecruit', { exact: true })).toBeVisible();
  await expect(coverage.getByText('Not successfully scraped yet', { exact: true })).toHaveCount(
    webSources,
  );
  await coverage
    .getByText(`View all ${webSources} sources and remaining work`, { exact: true })
    .click();
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
  await page.getByRole('navigation').getByRole('button', { name: 'Planner', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for the right work.' })).toBeVisible();
  await expect(page.locator('.plan-steps li').first()).toBeVisible();
  await expect(page.locator('.av-band.av-negotiable').first()).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Review queue/ })
    .click();
  await expect(page.getByRole('heading', { name: 'A few things to verify.' })).toBeVisible();
  await expect(page.getByText('Confirm your registration category.')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'Discover', exact: true }).click();
  await page.getByRole('button', { name: 'Map view', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Map of vacancies' })).toBeVisible();
  await expect(page.locator('.map-jobs li').first()).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Coverage', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'How much of the market can you see?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Alerts/ }).click();
  await expect(page.getByRole('complementary', { name: 'Alerts' })).toContainText('Rate change');
  await page.getByRole('button', { name: 'Close alerts' }).click();
  await page.screenshot({ path: 'test-results/explorer-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('bulk search attempts every ready source and continues after a failure', async ({ page }) => {
  const store = emptyStore();
  for (const source of store.sources.filter((s) => ['medrecruit', 'salt'].includes(s.id))) {
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
    '2 of 2 attempted · 1 succeeded · 1 failed',
  );
  expect(attempted).toEqual(['medrecruit', 'salt']);
  await expect(coverage.getByText('Fixture failure', { exact: false }).first()).toBeVisible();
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
  await expect(page.locator('.job-card')).toContainText('Verify eligibility');
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
  for (const source of store.sources.filter((s) => ['medrecruit', 'salt'].includes(s.id))) {
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
  await coverage.getByRole('button', { name: 'Stop after this source' }).click();
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
  for (const view of ['Planner', 'Coverage', 'Map']) {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await page
      .getByRole('navigation')
      .getByRole('button', { name: new RegExp(`^${view}`) })
      .click();
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${view} fits a phone screen`,
    ).toBe(true);
  }
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await page.getByRole('button', { name: 'My profile & preferences', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make this radar yours.' })).toBeVisible();
});
