import { describe, it, expect } from 'vitest';
import { emptyStore } from '@/domain/seed';
import { applyPublicStarter } from '@/server/public-starter';
import { parseWeb } from '@/server/acquisition/parsers';
import { sourceRecipes } from '@/domain/source-catalog';
const recipe = sourceRecipes.find((r) => r.id === 'ochre')!;
const html = (type = 'Locum', start = '13/10/2026') =>
  `<h1>ED Registrar - Darwin, NT</h1><table class="job-table"><tr><th>ID:</th><td>TEST-1</td></tr><tr><th>Type:</th><td>${type}</td></tr><tr><th>Salary:</th><td>$165 per hour</td></tr><tr><th>Location:</th><td>Northern Territory</td></tr><tr><th>Start:</th><td>${start}</td></tr><tr><th>End:</th><td>31/01/2027</td></tr><tr><th>Published:</th><td>12/10/2026</td></tr></table><div class="job-content"><p>Locum work in Darwin. Hospital name not disclosed.</p></div><aside><h2>Related jobs</h2><p>$999 per day at Cairns Hospital</p></aside>`;
describe('public starter', () => {
  it('keeps Australian locum index links with change fingerprints, excluding permanent and overseas cards', () => {
    const card = (id: string, type: string, state: string, rate = '165') =>
      `<div class="job-summary"><h2 class="job-summary__title"><a href="/job/${id}">Registrar</a></h2><p class="job-summary__meta">${type} <span></span> ${state} <span></span> $${rate} per hour</p></div>`;
    const page =
      card('au', 'Locum', 'Northern Territory') +
      card('nz', 'Locum', 'North Island') +
      card('perm', 'Permanent', 'Queensland');
    const result = parseWeb(page, recipe.url, 'ochre', recipe.config, false);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].url).toContain('/job/au');
    expect(result.links[0].signature).toBeTruthy();
    expect(
      parseWeb(
        card('au', 'Locum', 'Northern Territory', '180'),
        recipe.url,
        'ochre',
        recipe.config,
        false,
      ).links[0].signature,
    ).not.toBe(result.links[0].signature);
  });
  it('enables only the inspected public source and preserves later owner decisions', () => {
    const store = emptyStore();
    applyPublicStarter(store);
    expect(store.sources.filter((s) => s.enabled).map((s) => s.id)).toEqual(['ochre']);
    const source = store.sources.find((s) => s.id === 'ochre')!;
    expect(source.method).toBe('collector');
    source.enabled = false;
    applyPublicStarter(store);
    expect(source.enabled).toBe(false);
    source.permission = 'denied';
    applyPublicStarter(store);
    expect(source.permission).toBe('denied');
  });
  it('extracts placement dates and advertised pay without unrelated roles or invented facilities', () => {
    const result = parseWeb(
      html(),
      'https://ochrerecruitment.com/job/test',
      'ochre',
      recipe.config,
      true,
    );
    const d = result.candidates[0].extractions[0].draft;
    expect(d).toMatchObject({
      externalId: 'TEST-1',
      startDate: '2026-10-13',
      endDate: '2027-01-31',
      state: 'NT',
      grade: 'Registrar',
      facilityName: '',
    });
    expect(d.compensation).toMatchObject({ amount: 165, basis: 'hour' });
    expect(result.candidates[0].publishedAt).toBe('2026-10-12');
  });
  it('excludes permanent roles and leaves malformed dates unknown', () => {
    expect(
      parseWeb(
        html().replace('Northern Territory', 'North Island'),
        recipe.url,
        'ochre',
        recipe.config,
        true,
      ).candidates,
    ).toHaveLength(0);
    expect(
      parseWeb(html('Permanent'), recipe.url, 'ochre', recipe.config, true).candidates,
    ).toHaveLength(0);
    expect(
      parseWeb(html('Locum', '31/02/2027'), recipe.url, 'ochre', recipe.config, true).candidates[0]
        .extractions[0].draft.startDate,
    ).toBeUndefined();
  });
});
