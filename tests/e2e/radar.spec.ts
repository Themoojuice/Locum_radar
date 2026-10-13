import { test, expect } from '@playwright/test';
import { demoStore } from '../../src/domain/seed';
import { listingInputSchema } from '../../src/domain/model';

test('example workspace: filter, compare, inspect unknowns and navigate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Opening your private workspace…')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Find your next chapter.' })).toBeVisible();
  await expect(page.getByText('Fictional vacancies and a sample doctor profile.')).toBeVisible();
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
