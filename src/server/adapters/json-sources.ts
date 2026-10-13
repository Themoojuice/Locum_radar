import { classifyRole, stateFrom } from './email-formats';

/**
 * Adapters for sources that publish structured JSON. Each adapter only builds
 * request URLs and turns one response page into labelled blocks; network
 * access, permission gates, robots handling and review queueing stay in
 * `collectors.ts`. Adapters never receive or return credentials in labels.
 */
export interface JsonBlock {
  labelled: string;
  raw: string;
  notes: string[];
  url: string | null;
}
interface AdapterBase {
  sourceId: string;
  /** Hosts this adapter may contact. Added to the collector allowlist. */
  hosts: string[];
  /** Documented API (terms govern access) or a site endpoint (robots also applies). */
  access: 'documented-api' | 'site-endpoint';
  robotsUrl: string | null;
  /** Names the configuration a run needs, or null when it is ready. */
  missingConfig?(env: Record<string, string | undefined>): string | null;
}
/** A newest-first paged source: one request per page, one parse per response. */
export interface JsonAdapter extends AdapterBase {
  format?: 'json' | 'html';
  maxPages: number;
  /** Returns null when required configuration (for example an API key) is missing. */
  pageUrl(page: number, env: Record<string, string | undefined>): string | null;
  parse(body: unknown): { blocks: JsonBlock[]; hasMore: boolean };
}
/** Services the collector gives an adapter that needs more than paging. */
export interface CollectContext {
  get(url: string, accept: string): Promise<{ status: number; text: string }>;
  pause(): Promise<void>;
  seen: Set<string>;
  inScope(specialty: string | null, state: string | null): boolean;
  log(text: string, level?: 'info' | 'warn' | 'error'): void;
  stopped(): boolean;
  env: Record<string, string | undefined>;
}
export interface CustomAdapter extends AdapterBase {
  collect(ctx: CollectContext): Promise<JsonBlock[]>;
}
export type SourceAdapter = JsonAdapter | CustomAdapter;

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const strip = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
const label = (fields: [string, string | number | null | undefined][]) =>
  fields
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`)
    .join('\n');
const isoDate = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

interface WaveJob {
  jobId?: string;
  title?: string;
  jobType?: string;
  link?: string;
  location?: string;
  startDate?: string;
  endDate?: string;
  payRate?: string;
  payRateType?: string;
  excerpt?: string;
  locumDetails?: string;
  locumCredentials?: string;
  seniorities?: { title?: string }[];
  specialties?: { title?: string }[];
  subSpecialties?: { title?: string }[];
}
export const wavelength: JsonAdapter = {
  sourceId: 'wavelength',
  hosts: ['cms.wave.com.au', 'wave.com.au'],
  access: 'site-endpoint',
  robotsUrl: 'https://wave.com.au/robots.txt',
  maxPages: 30,
  pageUrl: (page) => `https://cms.wave.com.au/jobs?page=${page}`,
  parse(body) {
    const b = body as {
      results?: WaveJob[];
      pagination?: { currentPage?: number; totalPages?: number };
    };
    if (!b || !Array.isArray(b.results)) throw new Error('Unexpected Wavelength response shape');
    const blocks = b.results
      .filter((r) => /locum/i.test(text(r.jobType)))
      .map((r) => {
        const notes: string[] = [];
        const parts = text(r.title).split(/\s+-\s+/);
        const facility = parts.length >= 3 ? parts[parts.length - 1] : '';
        if (!facility) notes.push('Facility is not named separately in the title.');
        const [town, stateText] = text(r.location).split(/,\s*/);
        const roleText = [
          parts.slice(0, -1).join(' - ') || text(r.title),
          ...(r.seniorities ?? []).map((s) => text(s.title)),
          ...(r.specialties ?? []).map((s) => text(s.title)),
          ...(r.subSpecialties ?? []).map((s) => text(s.title)),
        ].join(' ');
        const role = classifyRole(roleText.replace(/Resident\/JMO/i, 'JMO'));
        notes.push(...role.notes);
        const rate = text(r.payRate).match(/^\$\s?([\d,]+(?:\.\d+)?)\s*per\s+(hour|day|shift)$/i);
        if (r.payRate && !rate) notes.push(`Rate needs review: "${r.payRate}".`);
        notes.push(
          'Wavelength start/end can describe an availability window rather than a continuous block; read the dates line.',
        );
        if (r.locumCredentials)
          notes.push('Credentialing requirements are listed in the raw text; they are not parsed.');
        const url = r.link ? new URL(r.link, 'https://wave.com.au').toString() : null;
        return {
          labelled: label([
            ['Title', r.title],
            ['Hospital', facility],
            ['Town', town],
            ['State', stateFrom(stateText ?? '')],
            ['Specialty', role.specialty],
            ['Grade', role.grade],
            ['Minimum PGY', role.minPgy],
            ['Start', isoDate(r.startDate)],
            ['End', isoDate(r.endDate)],
            ['Rate', rate ? `AUD ${rate[1].replace(/,/g, '')}/${rate[2].toLowerCase()}` : null],
            ['Listing ID', r.jobId ? `wavelength-${r.jobId}` : null],
            ['URL', url],
          ]),
          raw: [
            r.title,
            r.location,
            r.payRate,
            strip(text(r.excerpt)),
            text(r.locumDetails),
            r.locumCredentials ? `Credentials: ${text(r.locumCredentials)}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          notes,
          url,
        };
      });
    const page = b.pagination?.currentPage ?? 1,
      total = b.pagination?.totalPages ?? 1;
    return { blocks, hasMore: page < total };
  },
};

interface AdzunaJob {
  id?: string | number;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string; area?: string[] };
}
export const adzuna: JsonAdapter = {
  sourceId: 'adzuna',
  hosts: ['api.adzuna.com'],
  access: 'documented-api',
  robotsUrl: null,
  maxPages: 4,
  missingConfig: (env) =>
    env.ADZUNA_APP_ID && env.ADZUNA_APP_KEY ? null : 'Add ADZUNA_APP_ID and ADZUNA_APP_KEY',
  pageUrl(page, env) {
    if (!env.ADZUNA_APP_ID || !env.ADZUNA_APP_KEY) return null;
    const q = new URLSearchParams({
      app_id: env.ADZUNA_APP_ID,
      app_key: env.ADZUNA_APP_KEY,
      results_per_page: '50',
      what: 'locum',
      what_or: 'doctor medical registrar RMO SRMO psychiatrist physician consultant',
      max_days_old: '14',
      sort_by: 'date',
      'content-type': 'application/json',
    });
    return `https://api.adzuna.com/v1/api/jobs/au/search/${page}?${q}`;
  },
  parse(body) {
    const b = body as { results?: AdzunaJob[]; count?: number };
    if (!b || !Array.isArray(b.results)) throw new Error('Unexpected Adzuna response shape');
    const blocks = b.results.map((r) => {
      const area = r.location?.area ?? [];
      const state = area.map((a) => stateFrom(a)).find(Boolean) ?? null;
      const role = classifyRole(text(r.title));
      const url = text(r.redirect_url) || null;
      return {
        labelled: label([
          ['Title', r.title],
          ['Town', area.length > 2 ? area[area.length - 1] : null],
          ['State', state],
          ['Specialty', role.specialty],
          ['Grade', role.grade],
          ['Minimum PGY', role.minPgy],
          [
            'Contact',
            r.company?.display_name ? `${r.company.display_name} (via Adzuna)` : 'via Adzuna',
          ],
          ['Listing ID', r.id !== undefined ? `adzuna-${r.id}` : null],
          ['URL', url],
        ]),
        raw: [
          r.title,
          r.company?.display_name,
          r.location?.display_name,
          strip(text(r.description)),
        ]
          .filter(Boolean)
          .join('\n'),
        notes: [
          'Adzuna returns a description excerpt only. Open the advertiser page for dates, rate and requirements.',
          'Adzuna salary fields are not imported because they can be predicted rather than advertised.',
          ...role.notes,
        ],
        url,
      };
    });
    return { blocks, hasMore: blocks.length === 50 };
  },
};
