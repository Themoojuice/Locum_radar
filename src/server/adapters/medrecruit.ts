import { classifyRole, stateFrom } from './email-formats';
import type { JsonAdapter, JsonBlock } from './json-sources';

/**
 * Medrecruit's listing pages are server-rendered Next.js pages whose
 * `__NEXT_DATA__` script carries 20 structured jobs per page, newest first.
 * Collection requires the owner's recorded permission (Medrecruit's terms
 * restrict bulk collection without it).
 */
interface MedrecruitJob {
  id?: string;
  jobNumber?: string;
  title?: string;
  grade?: string;
  speciality?: string;
  subspeciality?: string;
  city?: string;
  location?: string;
  country?: string;
  clientNameMessage?: string;
  displayClientName?: boolean;
  descriptionPlainText?: string;
  startDate?: string;
  endDate?: string;
  payRate?: string;
  payInterval?: string;
  workType?: string;
  status?: string;
}
const BASE = 'https://medrecruit.medworld.com';
const slug = (v: string) =>
  v
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
/** "North West Regional Hospital - NWTHS  (Burnie Campus TAS)" → "North West Regional Hospital". */
export function cleanClientName(value: string) {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+-\s+[A-Z0-9&]{2,}\b.*$/, '')
    .replace(
      /\s+(NSW|QLD|VIC|WA|SA|NT|TAS|ACT|New South Wales|Queensland|Victoria|Tasmania|Western Australia|South Australia|Northern Territory)\s*$/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}
export function nextData(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Medrecruit page has no embedded job data; the site may have changed');
  return JSON.parse(m[1]);
}
const iso = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
const label = (fields: [string, string | number | null | undefined][]) =>
  fields
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`)
    .join('\n');

export function parseMedrecruitPage(html: string): { blocks: JsonBlock[]; hasMore: boolean } {
  const data = nextData(html) as {
    props?: {
      pageProps?: {
        jobs?: { data?: MedrecruitJob[]; page?: number; limit?: number; total?: number };
      };
    };
  };
  const jobs = data.props?.pageProps?.jobs;
  if (!jobs || !Array.isArray(jobs.data)) throw new Error('Unexpected Medrecruit page shape');
  const blocks = jobs.data
    .filter(
      (j) =>
        /locum/i.test(j.workType ?? '') && (j.country ?? 'AU') === 'AU' && j.status !== 'closed',
    )
    .map((j): JsonBlock => {
      const notes: string[] = [];
      const description = j.descriptionPlainText ?? '';
      const client =
        j.displayClientName && j.clientNameMessage ? cleanClientName(j.clientNameMessage) : '';
      if (!client)
        notes.push('Medrecruit does not name the hospital; matched by town if possible.');
      const role = classifyRole(`${j.grade ?? ''} ${j.speciality ?? ''} ${j.title ?? ''}`);
      notes.push(...role.notes);
      const amount = /^\d+(\.\d+)?$/.test(j.payRate ?? '') ? Number(j.payRate) : null;
      const unit = /day/i.test(j.payInterval ?? '')
        ? 'day'
        : /hour/i.test(j.payInterval ?? '')
          ? 'hour'
          : /shift/i.test(j.payInterval ?? '')
            ? 'shift'
            : null;
      if (j.payRate && !(amount && unit))
        notes.push(`Rate needs review: "${j.payRate} ${j.payInterval ?? ''}".`);
      const superStatus = /inclusive of superannuation|includes? super/i.test(description)
        ? 'included'
        : /\+\s?super|plus super/i.test(description)
          ? 'additional'
          : null;
      const accommodation = /(travel and )?accommodation (is |are )?(included|provided)/i.test(
        description,
      )
        ? 'included'
        : null;
      if (/required for:/i.test(description))
        notes.push('The advertisement lists separate dates; start and end span the whole set.');
      const url =
        j.grade && j.speciality && j.jobNumber
          ? `${BASE}/jobs/${slug(j.grade)}/${slug(j.speciality)}/${j.jobNumber.toLowerCase()}`
          : null;
      return {
        labelled: label([
          ['Title', `${j.title ?? 'Locum'} – ${client || j.city || ''}`],
          ['Hospital', client || j.city],
          ['Town', j.city],
          ['State', stateFrom(j.location ?? '')],
          ['Specialty', role.specialty],
          ['Grade', role.grade],
          ['Minimum PGY', role.minPgy],
          ['Start', iso(j.startDate)],
          ['End', iso(j.endDate)],
          ['Rate', amount && unit ? `AUD ${amount}/${unit}` : null],
          ['Super', superStatus],
          ['Accommodation', accommodation],
          ['Listing ID', j.jobNumber ? `medrecruit-${j.jobNumber}` : null],
          ['URL', url],
        ]),
        raw: [
          j.title,
          j.clientNameMessage,
          `${j.city ?? ''}, ${j.location ?? ''}`,
          `${j.payRate ?? ''} ${j.payInterval ?? ''}`,
          description,
        ]
          .filter((v) => v && v.trim())
          .join('\n'),
        notes,
        url,
      };
    });
  const pages = Math.ceil((jobs.total ?? 0) / (jobs.limit || 20));
  return { blocks, hasMore: (jobs.page ?? 1) < pages };
}

export const medrecruit: JsonAdapter = {
  sourceId: 'medrecruit',
  hosts: ['medrecruit.medworld.com'],
  access: 'site-endpoint',
  robotsUrl: `${BASE}/robots.txt`,
  format: 'html',
  maxPages: 250,
  pageUrl: (page) => `${BASE}/jobs/listing/locum/australia${page > 1 ? `?page=${page}` : ''}`,
  parse: (body) => parseMedrecruitPage(String(body)),
};
