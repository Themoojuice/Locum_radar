import { load } from 'cheerio';
import { classifyRole, parseShortRange, stateFrom } from './email-formats';
import type { CollectContext, CustomAdapter, JsonBlock } from './json-sources';

/**
 * Generic collector for agency sites that publish a sitemap of job pages, each
 * carrying schema.org JobPosting data (WordPress/Bullhorn, SourceFlow, ApplyFlow
 * and similar platforms). One configuration per agency; one parser for all.
 *
 * Routine runs read the sitemap(s), keep job URLs modified within `maxAgeDays`
 * that have not been seen, and fetch at most `detailLimit` job pages, most
 * recently modified first. Pages without usable JobPosting data, permanent
 * roles and non-medical roles are counted and skipped, never guessed.
 */
export interface SitemapConfig {
  sourceId: string;
  hosts: string[];
  robotsUrl: string;
  /** Sitemap or sitemap-index URLs to start from. */
  sitemaps: string[];
  /** Child sitemaps worth reading from an index (others are ignored). */
  childSitemap?: RegExp;
  /** Which URLs are individual job pages. */
  jobUrl: RegExp;
  maxAgeDays?: number;
  detailLimit?: number;
}
export interface SitemapEntry {
  loc: string;
  lastmod: string | null;
}
export function parseSitemap(xml: string): { sitemaps: SitemapEntry[]; urls: SitemapEntry[] } {
  if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) throw new Error('Not a sitemap');
  const $ = load(xml, { xml: true });
  const read = (tag: string) =>
    $(tag)
      .toArray()
      .map((el) => ({
        loc: $(el).children('loc').first().text().trim(),
        lastmod: $(el).children('lastmod').first().text().trim() || null,
      }))
      .filter((e) => /^https:\/\//.test(e.loc));
  return { sitemaps: read('sitemap'), urls: read('url') };
}

type Posting = Record<string, unknown>;
const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
const first = <T>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);
export function findJobPostings(html: string): Posting[] {
  const $ = load(html);
  const out: Posting[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (depth > 12 || !node || typeof node !== 'object' || out.length > 5) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    const r = node as Posting;
    const type = r['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) out.push(r);
    else Object.values(r).forEach((v) => walk(v, depth + 1));
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()));
    } catch {
      /* One malformed block does not hide the others. */
    }
  });
  return out;
}
const textOf = (html: string) => {
  const $ = load(`<div>${html}</div>`);
  $('br').replaceWith('\n');
  $('p, li, div, h1, h2, h3, h4, tr').append('\n');
  return $.root()
    .text()
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
};

const NON_DOCTOR =
  /\b(nurse|nursing|midwi|physio|pharmacist|radiographer|sonographer|psychologist|social worker|occupational therapist|speech patho|dietitian|paramedic|recruitment consultant|receptionist|administrator)\b/i;
const DOCTOR =
  /\b(doctor|medical officer|registrar|consultant|specialist|GP|general practitioner|physician|psychiatrist|an(a)?esthetist|surgeon|obstetrician|paediatrician|RMO|SRMO|CMO|SMO|PHO|HMO|VMO|FACEM|FRACGP|FRANZCP|locum doctor)\b/i;
const LOCUM = /\b(locum|temporary|short[- ]term|fixed[- ]term|contract|relief|cover)\b/i;
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
/**
 * Placement dates from free text, only when exactly one range is stated.
 * Posting and closing dates are not placement dates and are never used.
 */
export function placementDates(text: string, anchor: Date): { start: string; end: string } | null {
  const found = new Set<string>();
  const numeric = [
    ...text.matchAll(
      /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\s*(?:-|–|—|to|until)\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/gi,
    ),
  ];
  for (const m of numeric) {
    const iso = (d: string, mo: string, y: string) =>
      `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    found.add(`${iso(m[1], m[2], m[3])}|${iso(m[4], m[5], m[6])}`);
  }
  const worded = new RegExp(
    `\\b(\\d{1,2}(?:st|nd|rd|th)?(?:\\s+(?:${MONTHS})[a-z]*(?:\\s+20\\d{2})?)?\\s*(?:-|–|—|to|until)\\s*\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*(?:\\s+20\\d{2})?)\\b`,
    'gi',
  );
  for (const m of text.matchAll(worded)) {
    const r = parseShortRange(
      m[1].replace(/(\d)(st|nd|rd|th)/g, '$1').replace(/\s+(?:to|until)\s+/i, ' - '),
      anchor,
    );
    if (r?.end) found.add(`${r.start}|${r.end}`);
  }
  const valid = [...found].map((v) => v.split('|')).filter(([s, e]) => s <= e);
  return valid.length === 1 ? { start: valid[0][0], end: valid[0][1] } : null;
}
/** A single advertised rate from schema.org baseSalary, or null with a note. */
export function salaryRate(salary: unknown): { rate: string | null; note: string | null } {
  const s = first(salary as Posting | Posting[]);
  if (!s || typeof s !== 'object') return { rate: null, note: null };
  const currency = str(s.currency) || 'AUD';
  const value = (s.value ?? s) as Posting;
  const unit = str(value.unitText || s.unitText).toUpperCase();
  const min = Number(value.minValue ?? value.value),
    max = Number(value.maxValue ?? value.value);
  const unitName = unit === 'HOUR' ? 'hour' : unit === 'DAY' ? 'day' : null;
  if (currency !== 'AUD') return { rate: null, note: `Salary is in ${currency}; not imported.` };
  if (!unitName)
    return {
      rate: null,
      note: unit ? `Salary unit "${unit}" is not an hourly or daily rate.` : null,
    };
  if (!Number.isFinite(min) || min <= 0) return { rate: null, note: null };
  if (Number.isFinite(max) && max !== min)
    return {
      rate: null,
      note: `Rate is a range ($${min}–$${max} per ${unitName}); confirm the actual rate.`,
    };
  return { rate: `AUD ${min}/${unitName}`, note: null };
}

export type SkipReason =
  'not a job posting' | 'not a doctor role' | 'permanent role' | 'outside Australia';
/** Turns one job page into a labelled block, or explains why it was skipped. */
export function jobPageBlock(
  html: string,
  url: string,
  sourceId: string,
  now = new Date(),
): JsonBlock | { skipped: SkipReason } {
  const posting = findJobPostings(html)[0];
  if (!posting) return { skipped: 'not a job posting' };
  const title = textOf(str(posting.title));
  const description = textOf(str(posting.description));
  const location = first(posting.jobLocation as Posting | Posting[]);
  const address = (location?.address ?? {}) as Posting;
  const countryField = address.addressCountry;
  const country =
    countryField && typeof countryField === 'object'
      ? str((countryField as Posting).name)
      : str(countryField);
  if (country && !/^(AU|AUS|Australia)$/i.test(country)) return { skipped: 'outside Australia' };
  const role = classifyRole(`${title} ${str(posting.occupationalCategory)}`);
  const everything = `${title}\n${description}`;
  if (!role.specialty && !role.grade && !DOCTOR.test(everything))
    return { skipped: 'not a doctor role' };
  if (NON_DOCTOR.test(title) && !DOCTOR.test(title)) return { skipped: 'not a doctor role' };
  const types = [posting.employmentType].flat().map(str).join(' ');
  if (!/TEMPORARY|CONTRACT|PER_DIEM/i.test(types) && !LOCUM.test(everything))
    return { skipped: 'permanent role' };
  const notes: string[] = [...role.notes];
  const town = str(address.addressLocality);
  const state =
    stateFrom(str(address.addressRegion)) ??
    stateFrom(title.match(/\b(NSW|QLD|VIC|WA|SA|NT|TAS|ACT)\b/)?.[1] ?? '');
  if (!town) notes.push('The posting gives no town; the facility needs confirming.');
  const posted = Date.parse(str(posting.datePosted));
  const dates = placementDates(description, Number.isFinite(posted) ? new Date(posted) : now);
  if (!dates)
    notes.push(
      'Placement dates were not found as a single range in the description; read the advertisement.',
    );
  const { rate, note } = salaryRate(posting.baseSalary);
  if (note) notes.push(note);
  const identifier = str((posting.identifier as Posting)?.value ?? posting.identifier);
  const tail = url.replace(/\/+$/, '').split('/').pop() ?? url;
  const flights =
    /\b(?:flights?|airfares?|return travel)\b[^.\n]{0,40}\b(?:included|provided|covered|paid)\b/i.test(
      description,
    );
  const stay = /\baccommodation\b[^.\n]{0,30}\b(?:included|provided|covered|paid)\b/i.test(
    description,
  );
  const superPlus = /\+\s?super|plus super/i.test(description),
    superIn = /inc(?:l\.?|luding|lusive of)?\s+super/i.test(description);
  notes.push(
    `${sourceId} usually names the town, not the hospital; the facility is matched by town.`,
  );
  const labelled = [
    ['Title', title],
    ['Hospital', town],
    ['Town', town],
    ['State', state],
    ['Specialty', role.specialty],
    ['Grade', role.grade],
    ['Minimum PGY', role.minPgy],
    ['Start', dates?.start],
    ['End', dates?.end],
    ['Rate', rate],
    ['Super', superPlus ? 'additional' : superIn ? 'included' : null],
    ['Flights', flights ? 'included' : null],
    ['Accommodation', stay ? 'included' : null],
    [
      'Flexibility',
      /\bflexible (?:start|dates?)\b|\bdates? (?:are |is )?(?:flexible|negotiable)\b/i.test(
        description,
      )
        ? 'flexible'
        : null,
    ],
    ['Listing ID', `${sourceId}-${identifier || tail}`.slice(0, 200)],
    ['URL', url],
  ]
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`)
    .join('\n');
  return {
    labelled,
    raw: `${title}\n${town}${state ? `, ${state}` : ''}\n\n${description}`.slice(0, 20000),
    notes,
    url,
  };
}

const DAY = 86400000;
export function sitemapAdapter(cfg: SitemapConfig): CustomAdapter {
  return {
    sourceId: cfg.sourceId,
    hosts: cfg.hosts,
    access: 'site-endpoint',
    robotsUrl: cfg.robotsUrl,
    robotsPaths: cfg.sitemaps.map((u) => new URL(u).pathname),
    async collect(ctx: CollectContext) {
      const maxAge = (cfg.maxAgeDays ?? 45) * DAY,
        limit = Number(
          ctx.env[`${cfg.sourceId.toUpperCase().replace(/\W/g, '_')}_DETAIL_LIMIT`] ??
            cfg.detailLimit ??
            120,
        );
      const pending = [...cfg.sitemaps],
        visited = new Set<string>(),
        jobs = new Map<string, string | null>();
      while (pending.length && visited.size < 30 && !ctx.stopped()) {
        const url = pending.shift()!;
        if (visited.has(url)) continue;
        if (visited.size) await ctx.pause();
        visited.add(url);
        const res = await ctx.get(url, 'application/xml,text/xml');
        if (res.status !== 200) throw new Error(`Sitemap ${url} returned HTTP ${res.status}`);
        const map = parseSitemap(res.text);
        for (const child of map.sitemaps)
          if (!cfg.childSitemap || cfg.childSitemap.test(child.loc))
            if (!child.lastmod || Date.now() - Date.parse(child.lastmod) < maxAge)
              pending.push(child.loc);
        for (const u of map.urls)
          if (cfg.jobUrl.test(u.loc) && (!u.lastmod || Date.now() - Date.parse(u.lastmod) < maxAge))
            jobs.set(u.loc, u.lastmod);
      }
      const seenUrls = ctx.seenUrls ?? new Set<string>();
      const fresh = [...jobs.entries()]
        .filter(([loc]) => !seenUrls.has(loc))
        .sort((a, b) => (b[1] ?? '').localeCompare(a[1] ?? ''));
      ctx.log(
        `${visited.size} sitemap(s): ${jobs.size} recent job pages, ${fresh.length} not yet read; reading up to ${limit}.`,
      );
      const blocks: JsonBlock[] = [];
      const skipped: Record<string, number> = {};
      for (const [loc] of fresh.slice(0, limit)) {
        if (ctx.stopped()) break;
        await ctx.pause();
        let res;
        try {
          res = await ctx.get(loc, 'text/html');
        } catch (error) {
          ctx.log(`${loc}: ${(error as Error).message}; skipped.`, 'warn');
          continue;
        }
        if (res.status !== 200) {
          skipped[`HTTP ${res.status}`] = (skipped[`HTTP ${res.status}`] ?? 0) + 1;
          continue;
        }
        const result = jobPageBlock(res.text, loc, cfg.sourceId);
        if ('skipped' in result) skipped[result.skipped] = (skipped[result.skipped] ?? 0) + 1;
        else blocks.push(result);
      }
      const summary = Object.entries(skipped)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ');
      ctx.log(
        `${blocks.length} locum doctor postings read${summary ? `; skipped ${summary}` : ''}.`,
      );
      ctx.markRead?.(fresh.slice(0, limit).map(([loc]) => loc));
      if (fresh.length > limit)
        ctx.log(`${fresh.length - limit} job pages remain for the next runs.`, 'warn');
      return blocks;
    },
  };
}

/** Agencies whose sitemaps and job pages were inspected on 13 October 2026. */
export const salt = sitemapAdapter({
  sourceId: 'salt',
  hosts: ['saltmedics.com'],
  robotsUrl: 'https://saltmedics.com/robots.txt',
  sitemaps: ['https://saltmedics.com/sitemap_index.xml'],
  childSitemap: /job-sitemap\d*\.xml$/,
  jobUrl: /^https:\/\/saltmedics\.com\/job\/[^/]+\/?$/,
});
export const globalMedics = sitemapAdapter({
  sourceId: 'global-medics',
  hosts: ['apac.globalmedics.com'],
  robotsUrl: 'https://apac.globalmedics.com/robots.txt',
  sitemaps: ['https://apac.globalmedics.com/sitemap.xml'],
  jobUrl: /^https:\/\/apac\.globalmedics\.com\/jobs\/\d+-[^/]+\/?$/,
});
export const dna = sitemapAdapter({
  sourceId: 'dna',
  hosts: ['www.dnamedicalrecruitment.com.au'],
  robotsUrl: 'https://www.dnamedicalrecruitment.com.au/robots.txt',
  sitemaps: ['https://www.dnamedicalrecruitment.com.au/sitemaps.xml'],
  childSitemap: /jobs-sitemap\.php$/,
  jobUrl: /\/jobview\/[^/]+\/[^/]+\/?$/,
});
export const jps = sitemapAdapter({
  sourceId: 'jps',
  hosts: ['www.jpsmedical.com.au'],
  robotsUrl: 'https://www.jpsmedical.com.au/robots.txt',
  sitemaps: ['https://www.jpsmedical.com.au/sitemaps.xml'],
  childSitemap: /jobs-sitemap\.php$/,
  jobUrl: /\/jobview\/[^/]+\/[^/]+\/?$/,
});
