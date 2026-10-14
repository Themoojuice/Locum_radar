import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectorConfigSchema } from '@/domain/acquisition';
import {
  parseWeb,
  parseFeed,
  candidate,
  matchesPath,
  canonicalUrl,
} from '@/server/acquisition/parsers';
import { parseGmailMessage, seal, unseal } from '@/server/acquisition/gmail';
import { initialFrontier, parseAdzuna, parseSearch } from '@/server/acquisition/providers';
import { recordCandidates } from '@/server/collectors';
import { emptyStore } from '@/domain/seed';
import { PoliteReader, robotsAllows } from '@/server/acquisition/transport';
const config = collectorConfigSchema.parse({
  kind: 'web',
  startUrls: ['https://jobs.example/search'],
  allowedHosts: ['jobs.example'],
  detailPaths: ['/job/*'],
  listingPaths: ['/search*'],
  delayMs: 1000,
});
afterEach(() => vi.unstubAllEnvs());
describe('bounded page discovery and extraction', () => {
  it('follows same-host pagination and detail links, excluding unrelated and external links', () => {
    const result = parseWeb(
      '<a href="/job/one?utm_source=test">one</a><a href="/search?page=2">next</a><a href="https://other.example/job/private">external</a><a href="/login">login</a>',
      config.startUrls[0],
      'manual',
      config,
      false,
    );
    expect(result.links.map((l) => l.url)).toEqual([
      'https://jobs.example/job/one',
      'https://jobs.example/search?page=2',
    ]);
  });
  it('does not count a self-link or an empty detail page as vacancy coverage', () => {
    expect(
      parseWeb('<a href="/search">Jobs</a>', config.startUrls[0], 'manual', config, false)
        .recognised,
    ).toBe(false);
    expect(
      parseWeb(
        '<a href="/job/two">Related</a>',
        'https://jobs.example/job/one',
        'manual',
        config,
        true,
      ).recognised,
    ).toBe(false);
  });
  it('matches literal query punctuation and canonicalises tracking parameters', () => {
    expect(matchesPath('https://jobs.example/search?page=2', ['/search?page=*'])).toBe(true);
    expect(matchesPath('https://jobs.example/searchXpage=2', ['/search?page=*'])).toBe(false);
    expect(canonicalUrl('https://jobs.example/job/1?utm_campaign=x&b=2&a=1#top')).toBe(
      'https://jobs.example/job/1?a=1&b=2',
    );
  });
  it('rejects challenges instead of reporting zero jobs', () => {
    expect(() =>
      parseWeb('<title>Just a moment</title>', config.startUrls[0], 'manual', config, false),
    ).toThrow('challenge');
  });
  it('extracts a detail page without importing related roles or navigation', () => {
    const result = parseWeb(
      '<h1>Emergency medicine Registrar</h1><main><p>Cairns Hospital needs locum cover from 11 - 22 January 2027. Rate: $180 per hour. Contact the recruiter to confirm all dates.</p><nav>USD $999 per hour</nav></main>',
      'https://jobs.example/job/1',
      'manual',
      config,
      true,
    );
    expect(result.candidates[0].extractions[0].draft.compensation?.amount).toBe(180);
    expect(result.candidates[0].extractions[0].draft.startDate).toBe('2027-01-11');
    expect(result.links).toEqual([]);
  });
  it('uses stable JSON-LD identifiers and never uses posting dates as placement dates', () => {
    const result = parseWeb(
      '<script type="application/ld+json">{"@type":"JobPosting","identifier":{"value":"J1"},"title":"Registrar","url":"/job/1","datePosted":"2026-10-14","description":"Locum cover"}</script>',
      'https://jobs.example/job/1',
      'manual',
      config,
      true,
    );
    expect(result.candidates[0].externalId).toBe('J1');
    expect(result.candidates[0].extractions[0].draft.startDate).toBeUndefined();
  });
  it('retains evidence versions without duplicating unchanged review items', () => {
    const store = emptyStore(),
      item = candidate('Registrar', 'Cairns Hospital locum', 'id', null, 'manual');
    expect(recordCandidates(store, 'manual', [item], '2026-10-14')).toBe(1);
    expect(recordCandidates(store, 'manual', [item], '2026-10-15')).toBe(0);
    expect(
      recordCandidates(
        store,
        'manual',
        [candidate('Registrar', 'Updated dates', 'id', null, 'manual')],
        '2026-10-16',
      ),
    ).toBe(1);
    expect(store.documents).toHaveLength(2);
    expect(store.opportunities).toHaveLength(0);
  });
  it('filters nursing titles without discarding the original evidence', () => {
    const item = candidate('Registered Nurse', 'Locum nursing', 'n1', null, 'manual');
    expect(item.extractions).toHaveLength(0);
    expect(item.text).toContain('Registered Nurse');
  });
});
describe('feed and API leads', () => {
  it('reads RSS and Atom as unverified leads, not automatically accepted vacancies', () => {
    const rss = parseFeed(
      '<rss><channel><item><title>Registrar cover</title><guid>job1</guid><link>https://jobs.example/job/1</link><description>Locum at Cairns Hospital</description><pubDate>Wed, 14 Oct 2026 00:00:00 GMT</pubDate></item></channel></rss>',
      config.startUrls[0],
      'manual',
      config,
    );
    expect(rss.candidates[0].externalId).toBe('job1');
    expect(rss.candidates[0].kind).toBe('lead');
    expect(rss.candidates[0].extractions[0].draft.startDate).toBeUndefined();
    const atom = parseFeed(
      '<feed><link rel="next" href="/search?page=2"/><entry><id>abc</id><title>Cover</title><summary>Locum</summary></entry></feed>',
      config.startUrls[0],
      'manual',
      config,
    );
    expect(atom.links).toHaveLength(1);
  });
  it('rejects entity declarations and only discovers allowed job paths from sitemaps', () => {
    expect(() =>
      parseFeed('<!DOCTYPE foo><rss/>', config.startUrls[0], 'manual', config),
    ).toThrow();
    const result = parseFeed(
      '<urlset><url><loc>https://jobs.example/job/1</loc></url><url><loc>https://elsewhere.example/job/2</loc></url></urlset>',
      config.startUrls[0],
      'manual',
      config,
      true,
    );
    expect(result.links).toEqual([{ kind: 'detail', url: 'https://jobs.example/job/1' }]);
  });
  it('does not turn Adzuna salary estimates into locum offer rates', () => {
    const result = parseAdzuna(
      {
        results: [
          {
            id: 'a',
            title: 'Registrar',
            salary_min: 300000,
            salary_is_predicted: '1',
            description: 'Locum cover',
            redirect_url: 'https://jobs.example/job/1',
          },
        ],
      },
      'https://api.adzuna.com/v1/api/jobs/au/search/1',
      'manual',
    );
    expect(result.candidates[0].extractions[0].draft.compensation?.amount).toBeNull();
  });
  it('paginates discovery results while keeping them clearly unverified', () => {
    const result = parseSearch(
      {
        query: { more_results_available: true },
        web: {
          results: [
            {
              title: 'Cover needed',
              description: 'Recent locum post',
              url: 'https://jobs.example/job/1',
            },
          ],
        },
      },
      'https://api.search.brave.com/res/v1/web/search?offset=0',
      'manual',
    );
    expect(result.links[0].url).toContain('offset=1');
    expect(result.candidates[0].kind).toBe('lead');
  });
});
describe('selected Gmail label privacy', () => {
  const payload = {
    mimeType: 'text/plain',
    headers: [{ name: 'Subject', value: 'Registrar cover' }],
    body: {
      data: Buffer.from('Cairns Hospital\n11 - 22 January 2027\n$180 per hour').toString(
        'base64url',
      ),
    },
  };
  it('refuses to start without a label and includes it in every initial list query', () => {
    expect(() => initialFrontier(collectorConfigSchema.parse({ kind: 'gmail' }))).toThrow('label');
    expect(
      initialFrontier(collectorConfigSchema.parse({ kind: 'gmail', labelId: 'Label_7' }))[0].url,
    ).toContain('labelIds=Label_7');
  });
  it('rechecks labels on the fetched message so a removed label cannot leak its body', () => {
    expect(
      parseGmailMessage({ id: 'm1', labelIds: ['OTHER'], payload }, 'Label_7', 'email'),
    ).toEqual([]);
    const result = parseGmailMessage(
      { id: 'm1', labelIds: ['Label_7'], payload },
      'Label_7',
      'email',
    );
    expect(result[0].externalId).toBe('m1:0');
    expect(result[0].extractions[0].draft.compensation?.amount).toBe(180);
  });
  it('flags attachments and does not pretend their content was imported', () => {
    const result = parseGmailMessage(
      {
        id: 'm2',
        labelIds: ['L'],
        payload: {
          ...payload,
          parts: [
            {
              filename: 'vacancies.pdf',
              mimeType: 'application/pdf',
              body: { attachmentId: 'abc' },
            },
          ],
        },
      },
      'L',
      'email',
    );
    expect(result[0].extractions[0].issues.join(' ')).toContain('vacancies.pdf');
  });
  it('encrypts connection data and rejects tampering or a changed secret', () => {
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
    const value = seal({ refresh_token: 'private-test-token' });
    expect(value).not.toContain('private-test-token');
    expect(unseal(value)).toEqual({ refresh_token: 'private-test-token' });
    vi.stubEnv('SESSION_SECRET', 'b'.repeat(40));
    expect(() => unseal(value)).toThrow();
  });
});
describe('path-specific robots and redirects', () => {
  it('allows job paths when only unrelated account paths are disallowed', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /account/', 'https://jobs.example/job/1')).toBe(
      true,
    );
    expect(
      robotsAllows(
        'User-agent: *\nDisallow: /job/\nAllow: /job/public/',
        'https://jobs.example/job/public/1',
      ),
    ).toBe(true);
  });
  it('refuses a redirect outside the source hosts', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.endsWith('robots.txt')
        ? { status: 404, text: '', url }
        : { status: 302, text: '', url, location: 'https://internal.example/job/1' },
    );
    await expect(
      new PoliteReader(config.allowedHosts, 0, fetcher).read(config.startUrls[0]),
    ).rejects.toThrow('scope');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('fails closed on unavailable robots and does not request the vacancy page', async () => {
    const fetcher = vi.fn(async (url: string) => ({ status: 503, text: '', url }));
    await expect(
      new PoliteReader(config.allowedHosts, 0, fetcher).read(config.startUrls[0]),
    ).rejects.toThrow('Robots');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
