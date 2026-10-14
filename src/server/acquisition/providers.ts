import type { CollectorConfig, FrontierItem } from '@/domain/acquisition';
import { candidate, parseFeed, parseWeb, type ParsedPage } from './parsers';
import { gmailLabels, gmailRequest, parseGmailMessage, type GmailPart } from './gmail';
import { PoliteReader, requestPage } from './transport';
export function initialFrontier(config: CollectorConfig): FrontierItem[] {
  if (config.kind === 'gmail') {
    if (!config.labelId) throw new Error('Select a Gmail label before collecting');
    const params = new URLSearchParams({
      labelIds: config.labelId,
      maxResults: '25',
      q: 'newer_than:' + config.lookbackDays + 'd',
    });
    return [{ kind: 'api', url: '/gmail/v1/users/me/messages?' + params }];
  }
  if (config.kind === 'adzuna')
    return [{ kind: 'api', url: 'https://api.adzuna.com/v1/api/jobs/au/search/1' }];
  if (config.kind === 'search')
    return [{ kind: 'api', url: 'https://api.search.brave.com/res/v1/web/search?offset=0' }];
  const kind = config.kind === 'feed' ? 'feed' : config.kind === 'sitemap' ? 'sitemap' : 'listing';
  return config.startUrls.map((url) => ({ url, kind }));
}
function publicLink(value: unknown): string | null {
  try {
    const u = new URL(String(value));
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
export function parseAdzuna(
  data: { results?: Record<string, unknown>[]; count?: number },
  url: string,
  sourceId: string,
): ParsedPage {
  if (!Array.isArray(data.results)) throw new Error('Unrecognised Adzuna response');
  const page = Number(new URL(url).pathname.split('/').at(-1));
  const candidates = data.results.map((row) =>
    candidate(
      String(row.title || 'Job search result'),
      String(row.description || ''),
      String(row.id || publicLink(row.redirect_url)),
      publicLink(row.redirect_url),
      sourceId,
      'lead',
      typeof row.created === 'string' && Number.isFinite(Date.parse(row.created))
        ? new Date(row.created).toISOString()
        : null,
    ),
  );
  const more = data.results.length === 50 && (data.count === undefined || page * 50 < data.count);
  return {
    candidates,
    recognised: true,
    links: more ? [{ kind: 'api', url: url.replace(/\/\d+$/, '/' + (page + 1)) }] : [],
  };
}
export function parseSearch(
  data: {
    query?: { more_results_available?: boolean };
    web?: { results?: { title?: string; description?: string; url?: string; page_age?: string }[] };
  },
  url: string,
  sourceId: string,
): ParsedPage {
  if (!data.web || !Array.isArray(data.web.results))
    throw new Error('Unrecognised search response; coverage not established');
  const candidates = data.web.results.map((row) =>
    candidate(
      row.title || 'Discovery lead',
      row.description || '',
      publicLink(row.url) || row.title || '',
      publicLink(row.url),
      sourceId,
      'lead',
      row.page_age && Number.isFinite(Date.parse(row.page_age))
        ? new Date(row.page_age).toISOString()
        : null,
    ),
  );
  const next = new URL(url),
    offset = Number(next.searchParams.get('offset') || 0) + 1;
  next.searchParams.set('offset', String(offset));
  const more = data.query?.more_results_available;
  return {
    candidates,
    recognised: true,
    links: more && offset <= 9 ? [{ kind: 'api', url: next.href }] : [],
    warnings:
      more && offset > 9
        ? ['Search provider pagination cap reached; refine the query for further coverage']
        : [],
  };
}
export function pageProcessor(
  config: CollectorConfig,
  sourceId: string,
  reader = new PoliteReader(config.allowedHosts, config.delayMs),
) {
  let gmailLabelChecked = false;
  return async (item: FrontierItem): Promise<ParsedPage> => {
    if (config.kind === 'gmail') {
      if (!gmailLabelChecked) {
        if (!(await gmailLabels()).some((l) => l.id === config.labelId))
          throw new Error('Selected Gmail label no longer exists; collection stopped');
        gmailLabelChecked = true;
      }
      if (item.kind === 'message') {
        const data = await gmailRequest<{
          id: string;
          labelIds?: string[];
          internalDate?: string;
          payload?: GmailPart;
        }>(item.url);
        return {
          candidates: parseGmailMessage(data, config.labelId, sourceId),
          links: [],
          recognised: true,
        };
      }
      const data = await gmailRequest<{ messages?: { id: string }[]; nextPageToken?: string }>(
        item.url,
      );
      const links: FrontierItem[] = (data.messages || []).map((m) => ({
        kind: 'message',
        url: '/gmail/v1/users/me/messages/' + encodeURIComponent(m.id) + '?format=full',
      }));
      if (data.nextPageToken) {
        const next = new URL(item.url, 'https://gmail.googleapis.com');
        next.searchParams.set('pageToken', data.nextPageToken);
        links.push({ kind: 'api', url: next.pathname + next.search });
      }
      return { candidates: [], links, recognised: true };
    }
    if (config.kind === 'adzuna') {
      if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_APP_KEY)
        throw new Error('Adzuna API credentials are missing');
      const url = new URL(item.url);
      if (
        url.origin !== 'https://api.adzuna.com' ||
        !/^\/v1\/api\/jobs\/au\/search\/\d+$/.test(url.pathname)
      )
        throw new Error('Invalid Adzuna cursor');
      url.search = new URLSearchParams({
        app_id: process.env.ADZUNA_APP_ID,
        app_key: process.env.ADZUNA_APP_KEY,
        what: config.query,
        results_per_page: '50',
        sort_by: 'date',
        max_days_old: String(config.lookbackDays),
        'content-type': 'application/json',
      }).toString();
      const response = await requestPage(url.href, ['api.adzuna.com']);
      if (response.status !== 200) throw new Error('Adzuna HTTP ' + response.status);
      return parseAdzuna(JSON.parse(response.text), item.url, sourceId);
    }
    if (config.kind === 'search') {
      if (!process.env.BRAVE_SEARCH_API_KEY) throw new Error('Brave Search API key is missing');
      const url = new URL(item.url);
      if (url.origin !== 'https://api.search.brave.com' || url.pathname !== '/res/v1/web/search')
        throw new Error('Invalid search cursor');
      url.searchParams.set('q', config.query);
      url.searchParams.set('count', '20');
      url.searchParams.set('country', 'AU');
      const end = new Date().toISOString().slice(0, 10),
        start = new Date(Date.now() - config.lookbackDays * 86400000).toISOString().slice(0, 10);
      url.searchParams.set('freshness', start + 'to' + end);
      const response = await requestPage(url.href, ['api.search.brave.com'], {
        'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY,
      });
      if (response.status !== 200) throw new Error('Search API HTTP ' + response.status);
      return parseSearch(JSON.parse(response.text), item.url, sourceId);
    }
    const response = await reader.read(item.url);
    if (item.kind === 'feed' || item.kind === 'sitemap')
      return parseFeed(response.text, response.url, sourceId, config, item.kind === 'sitemap');
    return parseWeb(response.text, response.url, sourceId, config, item.kind === 'detail');
  };
}
