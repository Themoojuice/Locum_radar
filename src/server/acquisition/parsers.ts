import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { extractText, extractJobPostings, plainText, type Extraction } from '../extraction';
import type { CollectorConfig, FrontierItem } from '@/domain/acquisition';
import { safeUrl } from './transport';
import { stateFrom, classifyRole } from '../adapters/email-formats';
export interface Candidate {
  emailScreen?: import('@/domain/email-screening').EmailScreen;
  externalId: string;
  url: string | null;
  title: string;
  text: string;
  publishedAt: string | null;
  kind: 'vacancy' | 'lead' | 'email';
  extractions: Extraction[];
}
export interface ParsedPage {
  links: FrontierItem[];
  candidates: Candidate[];
  recognised: boolean;
  warnings?: string[];
}
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function canonicalUrl(raw: string, base?: string) {
  const url = new URL(raw, base);
  url.hash = '';
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export function matchesPath(url: string, patterns: string[]) {
  const u = new URL(url),
    path = u.pathname + u.search;
  return patterns.some((pattern) => {
    const escaped = pattern
      .split('*')
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp('^' + escaped + '$', 'i').test(path);
  });
}
const irrelevant = (title: string) =>
  /\b(nurs(?:e|ing)|midwi(?:fe|ves|fery)|podiatrist|pharmacist|radiographer|dentist|physiotherapist|occupational therapist|speech therapist)\b/i.test(
    title,
  ) && !/\bdoctor\b/i.test(title);
export function candidate(
  title: string,
  text: string,
  id: string,
  url: string | null,
  sourceId: string,
  kind: Candidate['kind'] = 'vacancy',
  publishedAt: string | null = null,
): Candidate {
  const raw = `Title: ${title}\n${text}`;
  const extracted = extractText(raw, sourceId);
  extracted.draft.url = url;
  extracted.draft.externalId = id;
  if (kind === 'lead')
    extracted.issues.unshift(
      'Unverified discovery lead. Confirm the original advertisement before importing.',
    );
  if (kind === 'email')
    extracted.issues.unshift(
      'Recruiter message: review each date block and confirm the sender and current terms.',
    );
  return {
    title,
    text: raw,
    externalId: id,
    url,
    publishedAt,
    kind,
    extractions: irrelevant(title) ? [] : [extracted],
  };
}
export function parseWeb(
  html: string,
  url: string,
  sourceId: string,
  config: CollectorConfig,
  detail: boolean,
): ParsedPage {
  const $ = load(html);
  if (sourceId === 'ochre' && detail && $('.job-table').length) {
    const fields: Record<string, string> = {};
    $('.job-table tr').each((_, row) => {
      fields[$(row).find('th').text().replace(':', '').trim().toLowerCase()] = $(row)
        .find('td')
        .text()
        .trim();
    });
    if (!/^locum$/i.test(fields.type || '') || !stateFrom(fields.location || ''))
      return { recognised: true, candidates: [], links: [] };
    const iso = (value = '') => {
      const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return null;
      const date = `${m[3]}-${m[2]}-${m[1]}`;
      const time = Date.parse(date);
      return Number.isFinite(time) && new Date(time).toISOString().startsWith(date) ? date : null;
    };
    const title = $('h1').first().text().trim();
    const role = classifyRole(title);
    const body = $('.job-content').first().clone();
    body.find('.job-recuriter, .social-media, form, script, style').remove();
    const text = [
      `Rate: ${fields.salary || ''}`,
      `State: ${stateFrom(fields.location || '') || ''}`,
      `Start: ${iso(fields.start) || ''}`,
      `End: ${iso(fields.end) || ''}`,
      `Specialty: ${role.specialty || ''}`,
      `Grade: ${role.grade || ''}`,
      plainText(body.html() || ''),
    ]
      .filter((line) => !/^[A-Za-z]+:\s*$/.test(line))
      .join('\n');
    const advert = candidate(title, text, fields.id || url, url, sourceId);
    advert.publishedAt = iso(fields.published);
    advert.extractions.forEach((e) =>
      e.issues.unshift(
        'Public advertisement; facility, exact roster and current availability need confirmation.',
      ),
    );
    return { recognised: true, candidates: [advert], links: [] };
  }
  if (
    /just a moment|access denied|verify you are human|checking your browser/i.test(
      $('title').text(),
    )
  )
    throw new Error('Access challenge detected; manual review needed');
  const links: FrontierItem[] = [],
    seen = new Set<string>();
  function add(raw: string | undefined, kind: FrontierItem['kind']) {
    if (!raw) return;
    try {
      const resolved = canonicalUrl(raw, url);
      if (
        resolved === canonicalUrl(url) ||
        !safeUrl(resolved, config.allowedHosts) ||
        /[?&](form=apply|apply=)|\/(apply|login|category|type)\//i.test(resolved) ||
        seen.has(resolved)
      )
        return;
      seen.add(resolved);
      links.push({ url: resolved, kind });
    } catch {
      /* Ignore malformed links, never execute them. */
    }
  }
  $('a[href]').each((_, a) => {
    const raw = $(a).attr('href')!;
    try {
      if (matchesPath(canonicalUrl(raw, url), config.detailPaths)) add(raw, 'detail');
    } catch {
      /* malformed link */
    }
  });
  if (!detail) {
    $(config.nextSelector).each((_, a) => {
      const raw = $(a).attr('href');
      try {
        if (raw && matchesPath(canonicalUrl(raw, url), config.listingPaths)) add(raw, 'listing');
      } catch {
        /* malformed link */
      }
    });
    // Explicit listing links support boards whose first URL is only a search landing page.
    $('a[href]').each((_, a) => {
      const raw = $(a).attr('href');
      try {
        if (raw && matchesPath(canonicalUrl(raw, url), config.listingPaths)) add(raw, 'listing');
      } catch {
        /* malformed link */
      }
    });
  }
  if (sourceId === 'ochre' && !detail) {
    const summaries = new Map<string, { allowed: boolean; signature: string }>();
    $('.job-summary').each((_, element) => {
      const row = $(element),
        href = row.find('.job-summary__title a').attr('href');
      if (!href) return;
      try {
        const metaNode = row.find('.job-summary__meta').clone();
        metaNode.find('span').replaceWith('|');
        const meta = metaNode.text();
        summaries.set(canonicalUrl(href, url), {
          allowed: /^\s*Locum\b/i.test(meta) && !!stateFrom(meta.split('|')[1] || ''),
          signature: hash('ochre-summary-v1:' + row.text().replace(/\s+/g, ' ').trim()),
        });
      } catch {
        /* Invalid source link is ignored. */
      }
    });
    for (let i = links.length - 1; i >= 0; i--) {
      const summary = summaries.get(links[i].url);
      if (summary && !summary.allowed) links.splice(i, 1);
      else if (summary) links[i].signature = summary.signature;
    }
  }
  const structured = extractJobPostings(html, sourceId, url);
  let candidates: Candidate[] = [];
  if (detail || !links.some((l) => l.kind === 'detail')) {
    candidates = structured.map((item, i) => {
      const title = item.draft.title || '';
      const id = item.draft.externalId || (structured.length === 1 ? url : url + '#record-' + i);
      item.draft.externalId = id;
      return {
        externalId: id,
        url: item.draft.url || url,
        title,
        text: item.draft.rawText || '',
        publishedAt: null,
        kind: 'vacancy' as const,
        extractions: irrelevant(title) ? [] : [item],
      };
    });
    if (!candidates.length && detail) {
      const node = $(config.contentSelector).first().clone();
      node.find('nav, footer, header, form, script, style, .related-jobs, .related-posts').remove();
      const title = $('h1').first().text().trim();
      const text = plainText(node.html() || '');
      if (
        title &&
        text.length >= 80 &&
        /locum|registrar|medical officer|general practitioner|consultant|physician/i.test(
          title + ' ' + text,
        )
      )
        candidates = [candidate(title, text, url, url, sourceId)];
    }
  }
  const dynamicNext =
    !detail &&
    $('button:not([disabled])')
      .toArray()
      .some((el) =>
        /next page|load more|show more jobs/i.test(
          ($(el).attr('aria-label') || '') + ' ' + $(el).text(),
        ),
      );
  return {
    links: detail ? [] : links,
    candidates,
    recognised:
      (!detail && (links.length > 0 || (sourceId === 'ochre' && $('.job-summary').length > 0))) ||
      candidates.length > 0,
    warnings:
      dynamicNext && !links.some((l) => l.kind === 'listing')
        ? [
            'Dynamic pagination detected; HTML collection cannot establish full board coverage. Use a qualified rendered adapter or recruiter email.',
          ]
        : [],
  };
}
export function parseFeed(
  xml: string,
  url: string,
  sourceId: string,
  config: CollectorConfig,
  sitemap = false,
): ParsedPage {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('XML declarations with entities are not supported');
  const $ = load(xml, { xmlMode: true });
  const candidates: Candidate[] = [],
    links: FrontierItem[] = [];
  if (sitemap) {
    if (!$('urlset, sitemapindex').length) throw new Error('Not a recognised sitemap');
    $('sitemap > loc, url > loc').each((_, el) => {
      try {
        const next = canonicalUrl($(el).text(), url);
        if (!safeUrl(next, config.allowedHosts)) return;
        if ($(el).parent().is('sitemap')) links.push({ url: next, kind: 'sitemap' });
        else if (matchesPath(next, config.detailPaths)) links.push({ url: next, kind: 'detail' });
      } catch {
        /* Invalid URL */
      }
    });
    return { candidates, links, recognised: true };
  }
  if (!$('rss, feed, rdf\\:RDF').length) throw new Error('Not a recognised RSS or Atom feed');
  $('item, entry').each((_, el) => {
    const item = $(el),
      title = item.find('title').first().text();
    let link: string | null = null;
    try {
      const raw =
        item.find('link[rel="alternate"]').attr('href') ||
        item.find('link').attr('href') ||
        item.find('link').first().text();
      const u = new URL(raw, url);
      if (u.protocol === 'https:' || u.protocol === 'http:') link = canonicalUrl(u.href);
    } catch {
      /* Feed item can remain a lead without a URL */
    }
    const text = plainText(
      item.find('content\\:encoded, description, summary, content').first().text(),
    );
    const id = item.find('guid, id').first().text() || link || hash(title + text);
    const date = item.find('pubDate, published, updated').first().text();
    candidates.push(
      candidate(
        title,
        text,
        id,
        link,
        sourceId,
        'lead',
        date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
      ),
    );
  });
  const next = $('feed > link[rel="next"]').attr('href');
  if (next) {
    const resolved = canonicalUrl(next, url);
    if (safeUrl(resolved, config.allowedHosts)) links.push({ url: resolved, kind: 'feed' });
  }
  return { candidates, links, recognised: true };
}
