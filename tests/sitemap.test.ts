import { describe, expect, it } from 'vitest';
import {
  jobPageBlock,
  parseSitemap,
  placementDates,
  salaryRate,
  sitemapAdapter,
} from '@/server/adapters/sitemap-jobs';
import { fromLabelledBlock } from '@/server/extraction';
import { listingInputSchema } from '@/domain/model';
import { emptyStore } from '@/domain/seed';

/*
 * Fictional fixtures following schema.org JobPosting and the sitemap protocol.
 * They exercise the parser, not any agency's live markup: each live adapter
 * still needs a qualification run against the real site (see Sources → Test).
 */
const page = (posting: Record<string, unknown>) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    ...posting,
  })}</script></head><body>…</body></html>`;
const locum = {
  title: 'Locum Psychiatry Registrar – Mount Isa QLD',
  description:
    '<p>Our client needs a <strong>locum psychiatry registrar</strong>.</p><ul><li>Dates: 12 – 25 January 2027</li><li>Flights and accommodation are provided</li><li>$165 per hour + super</li></ul>',
  datePosted: '2026-10-10',
  employmentType: 'TEMPORARY',
  identifier: { '@type': 'PropertyValue', name: 'Example', value: 'J-4410' },
  jobLocation: {
    '@type': 'Place',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Mount Isa',
      addressRegion: 'QLD',
      addressCountry: 'AU',
    },
  },
  baseSalary: {
    '@type': 'MonetaryAmount',
    currency: 'AUD',
    value: { '@type': 'QuantitativeValue', value: 165, unitText: 'HOUR' },
  },
};

describe('sitemaps', () => {
  it('reads an index and a urlset', () => {
    const index = parseSitemap(
      '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://agency.example/job-sitemap.xml</loc><lastmod>2026-10-13T04:02:06+00:00</lastmod></sitemap></sitemapindex>',
    );
    expect(index.sitemaps).toEqual([
      { loc: 'https://agency.example/job-sitemap.xml', lastmod: '2026-10-13T04:02:06+00:00' },
    ]);
    const set = parseSitemap(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://agency.example/job/a-1/</loc></url><url><loc>http://insecure.example/x</loc></url></urlset>',
    );
    expect(set.urls).toEqual([{ loc: 'https://agency.example/job/a-1/', lastmod: null }]);
    expect(() => parseSitemap('<html>blocked</html>')).toThrow();
  });
});

describe('JobPosting pages', () => {
  it('turns a locum doctor posting into a valid listing', () => {
    const block = jobPageBlock(page(locum), 'https://agency.example/job/locum-psych-4410/', 'salt');
    if ('skipped' in block) throw new Error(block.skipped);
    expect(block.labelled).toContain('Listing ID: salt-J-4410');
    expect(block.labelled).toContain('Rate: AUD 165/hour');
    expect(block.labelled).toContain('Start: 2027-01-12');
    expect(block.labelled).toContain('End: 2027-01-25');
    expect(block.labelled).toContain('Flights: included');
    expect(block.labelled).toContain('Super: additional');
    const directory = emptyStore().facilities.concat({
      id: 'aihw-mtisa',
      name: 'Mount Isa Hospital',
      aliases: [],
      town: 'Mount Isa',
      state: 'QLD',
      timezone: 'Australia/Brisbane',
      lat: -20.73,
      lon: 139.49,
      adventure: null,
      adventureNote: '',
      coverage: 'unknown',
    });
    const r = fromLabelledBlock(block, 'salt', 'salt-adapter', directory);
    expect(r.draft.specialty).toBe('Psychiatry');
    expect(r.draft.grade).toBe('Registrar');
    expect(r.draft.compensation?.super).toBe('additional');
    expect(listingInputSchema.safeParse(r.draft).success).toBe(true);
  });
  it('skips nursing, permanent and overseas postings rather than guessing', () => {
    expect(
      jobPageBlock(page({ ...locum, title: 'Registered Nurse – Theatre', description: 'Locum nursing cover.' }), 'https://a.example/1', 'salt'),
    ).toEqual({ skipped: 'not a doctor role' });
    expect(
      jobPageBlock(
        page({ ...locum, employmentType: 'FULL_TIME', title: 'Staff Specialist Psychiatrist', description: 'Ongoing role.' }),
        'https://a.example/2',
        'salt',
      ),
    ).toEqual({ skipped: 'permanent role' });
    expect(
      jobPageBlock(
        page({ ...locum, jobLocation: { address: { addressLocality: 'Hamilton', addressCountry: 'NZ' } } }),
        'https://a.example/3',
        'global-medics',
      ),
    ).toEqual({ skipped: 'outside Australia' });
    expect(jobPageBlock('<html><body>No data</body></html>', 'https://a.example/4', 'salt')).toEqual({
      skipped: 'not a job posting',
    });
  });
  it('leaves dates unknown when the text gives several ranges', () => {
    expect(placementDates('Block A: 1-14 March 2027. Block B: 5-18 April 2027.', new Date('2026-10-01'))).toBeNull();
    expect(placementDates('Available from 12-18 October 2026', new Date('2026-10-01'))).toEqual({
      start: '2026-10-12',
      end: '2026-10-18',
    });
    expect(placementDates('Dates 01/12/2026 - 14/12/2026', new Date('2026-10-01'))).toEqual({
      start: '2026-12-01',
      end: '2026-12-14',
    });
    expect(placementDates('Closing date 30 November 2026', new Date('2026-10-01'))).toBeNull();
  });
  it('imports only a single stated AUD hourly or daily rate', () => {
    expect(salaryRate({ currency: 'AUD', value: { minValue: 2000, maxValue: 2000, unitText: 'DAY' } }).rate).toBe('AUD 2000/day');
    expect(salaryRate({ currency: 'AUD', value: { minValue: 150, maxValue: 190, unitText: 'HOUR' } }).note).toMatch(/range/);
    expect(salaryRate({ currency: 'AUD', value: { value: 350000, unitText: 'YEAR' } }).rate).toBeNull();
    expect(salaryRate({ currency: 'NZD', value: { value: 150, unitText: 'HOUR' } }).note).toMatch(/NZD/);
  });
});

describe('sitemap collector', () => {
  it('reads recent unseen job pages, newest first, and remembers skipped pages', async () => {
    const recent = new Date(Date.now() - 2 * 86400000).toISOString();
    const old = new Date(Date.now() - 400 * 86400000).toISOString();
    const responses: Record<string, string> = {
      'https://agency.example/sitemap_index.xml': `<sitemapindex><sitemap><loc>https://agency.example/job-sitemap.xml</loc><lastmod>${recent}</lastmod></sitemap><sitemap><loc>https://agency.example/post-sitemap.xml</loc></sitemap></sitemapindex>`,
      'https://agency.example/job-sitemap.xml': `<urlset>
        <url><loc>https://agency.example/job/psych-1/</loc><lastmod>${recent}</lastmod></url>
        <url><loc>https://agency.example/job/nurse-2/</loc><lastmod>${recent}</lastmod></url>
        <url><loc>https://agency.example/job/ancient-3/</loc><lastmod>${old}</lastmod></url>
        <url><loc>https://agency.example/job/seen-4/</loc><lastmod>${recent}</lastmod></url>
        <url><loc>https://agency.example/about/</loc><lastmod>${recent}</lastmod></url>
      </urlset>`,
      'https://agency.example/job/psych-1/': page(locum),
      'https://agency.example/job/nurse-2/': page({ ...locum, title: 'Registered Nurse', description: 'Locum nurse.' }),
    };
    const requested: string[] = [];
    const marked: string[] = [];
    const adapter = sitemapAdapter({
      sourceId: 'salt',
      hosts: ['agency.example'],
      robotsUrl: 'https://agency.example/robots.txt',
      sitemaps: ['https://agency.example/sitemap_index.xml'],
      childSitemap: /job-sitemap/,
      jobUrl: /\/job\/[^/]+\/$/,
    });
    const blocks = await adapter.collect({
      get: async (url) => {
        requested.push(url);
        return { status: responses[url] ? 200 : 404, text: responses[url] ?? '' };
      },
      pause: async () => {},
      seen: new Set(),
      seenUrls: new Set(['https://agency.example/job/seen-4/']),
      markRead: (urls) => marked.push(...urls),
      relevance: () => 1,
      log: () => {},
      stopped: () => false,
      env: {},
    });
    expect(blocks).toHaveLength(1);
    expect(requested).not.toContain('https://agency.example/post-sitemap.xml');
    expect(requested).not.toContain('https://agency.example/job/ancient-3/');
    expect(requested).not.toContain('https://agency.example/job/seen-4/');
    expect(marked.sort()).toEqual([
      'https://agency.example/job/nurse-2/',
      'https://agency.example/job/psych-1/',
    ]);
  });
});
