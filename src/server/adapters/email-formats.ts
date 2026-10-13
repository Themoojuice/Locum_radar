import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { grades, specialties, states } from '@/domain/model';

/**
 * Source-specific splitters for recruiter emails that list several vacancies.
 *
 * Each splitter turns one email into labelled blocks that the conservative
 * `extractText` parser already understands. Splitters only restate facts that
 * the email states; anything they derive (a year inferred from the send date,
 * a grade synonym) is recorded as a review note. Unparseable rows are kept as
 * blocks with fewer labels rather than dropped, so they still reach review.
 */

export type EmailFormat = 'medrecruit-digest' | '1medical-table' | '1medical-single';
export interface LabelledBlock {
  labelled: string;
  raw: string;
  notes: string[];
}
export interface EmailParts {
  text: string;
  html?: string;
  from?: string;
  subject?: string;
  sentAt?: Date;
}
type State = (typeof states)[number];
type Specialty = (typeof specialties)[number];
type Grade = (typeof grades)[number];

const stateNames: Record<string, State> = {
  'NEW SOUTH WALES': 'NSW',
  QUEENSLAND: 'QLD',
  VICTORIA: 'VIC',
  'WESTERN AUSTRALIA': 'WA',
  'SOUTH AUSTRALIA': 'SA',
  'NORTHERN TERRITORY': 'NT',
  TASMANIA: 'TAS',
  'AUSTRALIAN CAPITAL TERRITORY': 'ACT',
};
export function stateFrom(value: string): State | null {
  const v = value.trim().toUpperCase();
  if ((states as readonly string[]).includes(v)) return v as State;
  return stateNames[v] ?? null;
}
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthOf = (name: string) => months.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date.toISOString().slice(0, 10)
    : null;
};
const clean = (v: string) =>
  v
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0\s]+/g, ' ')
    .trim();
/** Some senders put HTML markup in the text/plain part; flatten it to lines. */
export function toText(value: string) {
  if (!/<(div|p|br|strong|li|td|tr)[\s>/]/i.test(value)) return value;
  const $ = load(value);
  $('script, style').remove();
  $('br').replaceWith('\n');
  $('p, div, li, tr, h1, h2, h3, h4').append('\n');
  $('td, th').append('\n');
  return $.root().text().replace(/\r/g, '');
}
const stableId = (parts: string[]) =>
  createHash('sha256').update(parts.join('|').toLowerCase()).digest('hex').slice(0, 24);

/** Maps a role phrase to the app's coarse specialty and grade vocabulary. */
export function classifyRole(role: string): {
  specialty: Specialty | null;
  grade: Grade | null;
  minPgy: number | null;
  notes: string[];
} {
  const notes: string[] = [];
  let specialty: Specialty | null = null;
  if (/psych/i.test(role)) specialty = 'Psychiatry';
  else if (/\bICU\b|intensive care/i.test(role)) specialty = 'Intensive care';
  else if (/\bED\b/.test(role) || /emergency/i.test(role)) specialty = 'Emergency medicine';
  else if (/rural generalist/i.test(role)) specialty = 'Rural generalist';
  else if (
    /surg|paed|obstet|\bO&G\b|gynae|oncol|cardio|geriat|rehab|radiat|\bHITH\b|hospital in the home|anaes|palliat|gastro|subacute|orthop|renal|neuro|respir|haemat|infectious|addiction|correctional/i.test(
      role,
    )
  ) {
    specialty = 'Other';
    notes.push(`Specialty mapped to Other from "${role}".`);
  } else if (/\b(gen(?:eral)? ?med(?:icine)?|med|medical|medicine)\b/i.test(role))
    specialty = 'General medicine';
  let grade: Grade | null = null;
  if (/\bSRMO\b|senior RMO|senior resident/i.test(role)) grade = 'SRMO';
  else if (/\bPHO\b|principal house officer/i.test(role)) grade = 'PHO';
  else if (/\bCMO\b|career medical officer/i.test(role)) grade = 'CMO';
  else if (/\bReg(?:istrar)?\b/i.test(role)) grade = 'Registrar';
  else if (/\b(consultant|specialist|FACEM|VMO)\b/i.test(role)) grade = 'Consultant';
  else if (/\bGP\b|general practitioner/i.test(role)) grade = 'GP';
  else if (/\bRMO\b|resident medical officer/i.test(role)) grade = 'RMO';
  else if (/\b(HMO|JMO)\b/.test(role)) {
    grade = 'RMO';
    notes.push('HMO/JMO recorded as RMO; confirm the expected PGY level.');
  }
  const pgy = role.match(/PGY\s?(\d{1,2})/i);
  return { specialty, grade, minPgy: pgy ? Number(pgy[1]) : null, notes };
}

interface Rate {
  amount: number;
  unit: 'hour' | 'day' | 'shift';
}
/** Returns a rate only when the text contains exactly one priced amount with a unit. */
export function singleRate(text: string): Rate | null {
  const matches = [
    ...text.matchAll(
      /\$\s?([\d,]+(?:\.\d+)?)\s*(?:-\s*\$?[\d,.]+\s*)?(p\/?h(?:r)?\b|ph\b|\/\s?h(?:ou)?r\b|per hour|p\/?d\b|pd\b|\/\s?day\b|per day|\/\s?shift\b|per shift)/gi,
    ),
  ];
  if (matches.length !== 1) return null;
  if (/\$?[\d,.]+\s*-\s*\$?[\d,.]+/.test(matches[0][0])) return null;
  const unit = /d/i.test(matches[0][2]) ? 'day' : /shift/i.test(matches[0][2]) ? 'shift' : 'hour';
  return { amount: Number(matches[0][1].replace(/,/g, '')), unit };
}

/** Year-less ranges like "2 Nov – 31 Jan" or "21–27 Oct", anchored to the send date. */
export function parseShortRange(
  value: string,
  anchor: Date,
): { start: string; end: string | null } | null {
  const v = clean(value).replace(/[–—]/g, '-');
  let m = v.match(
    /^(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?\s*-\s*(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?$/,
  );
  let sd: number, sm: number, ed: number | null, em: number | null;
  let sy: number | null, ey: number | null;
  if (m) {
    [sd, sm, ed, em] = [Number(m[1]), monthOf(m[2]), Number(m[4]), monthOf(m[5])];
    sy = m[3] ? Number(m[3]) : null;
    ey = m[6] ? Number(m[6]) : null;
  } else if ((m = v.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?$/))) {
    [sd, ed, sm] = [Number(m[1]), Number(m[2]), monthOf(m[3])];
    em = sm;
    sy = ey = m[4] ? Number(m[4]) : null;
  } else if ((m = v.match(/^(?:from\s+)?(\d{1,2})\s+([A-Za-z]{3,})(?:\s+(\d{4}))?$/i))) {
    [sd, sm, ed, em] = [Number(m[1]), monthOf(m[2]), null, null];
    sy = m[3] ? Number(m[3]) : null;
    ey = null;
  } else return null;
  if (!sm || (em !== null && !em)) return null;
  // Choose the first occurrence that is not more than a month before the email.
  let year = sy ?? anchor.getUTCFullYear();
  if (sy === null) {
    const candidate = iso(year, sm, sd);
    if (candidate && Date.parse(candidate) < anchor.getTime() - 31 * 86400000) year += 1;
  }
  const start = iso(year, sm, sd);
  if (!start) return null;
  if (ed === null || em === null) return { start, end: null };
  const endYear = ey ?? year;
  let end = iso(endYear, em, ed);
  if (ey === null && end && end < start) end = iso(endYear + 1, em, ed);
  return end ? { start, end } : null;
}

/** "Saturday, 3 October 2026" or "16 November 2026" with an optional weekday check. */
export function parseLongDate(value: string): { date: string | null; note: string | null } {
  const m = clean(value).match(/^(?:([A-Za-z]+),?\s+)?(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (!m) return { date: null, note: null };
  const date = iso(Number(m[4]), monthOf(m[3]), Number(m[2]));
  if (!date) return { date: null, note: null };
  if (m[1]) {
    const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', {
      weekday: 'long',
      timeZone: 'UTC',
    });
    if (!weekday.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3)))
      return { date, note: `"${value}" names the wrong weekday for ${date}; confirm the date.` };
  }
  return { date, note: null };
}

function block(
  fields: [string, string | number | null | undefined][],
  raw: string,
  notes: string[],
) {
  return {
    labelled: fields
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
    raw,
    notes,
  };
}

export function detectEmailFormat(parts: EmailParts): EmailFormat | null {
  const from = (parts.from ?? '').toLowerCase();
  const text = toText(parts.text);
  const pipeRows = text.split('\n').filter((l) => (l.match(/\|/g) ?? []).length >= 2).length;
  if ((from.includes('medrecruit') || /T&(?:amp;)?A/.test(text)) && pipeRows >= 2)
    return 'medrecruit-digest';
  const tableHeader = /Start Date[\s\S]{0,40}End Date[\s\S]{0,80}Hospital[\s\S]{0,40}Pay rate/i;
  if (tableHeader.test(text) || (parts.html && tableHeader.test(load(parts.html).text())))
    return '1medical-table';
  if (
    (from.includes('1medical') || !from) &&
    /\bin\s+(?:NSW|QLD|VIC|WA|SA|NT|TAS|ACT|New South Wales|Queensland|Victoria|Tasmania|Western Australia|South Australia|Northern Territory)\s+(?:are|is)\s+seeking/i.test(
      text,
    )
  )
    return '1medical-single';
  return null;
}

export function splitRecruiterEmail(format: EmailFormat, input: EmailParts): LabelledBlock[] {
  const parts = { ...input, text: toText(input.text) };
  if (format === 'medrecruit-digest') return medrecruitDigest(parts);
  if (format === '1medical-table') return oneMedicalTable(parts);
  return oneMedicalSingle(parts);
}

function medrecruitDigest({ text: plain, html, sentAt }: EmailParts): LabelledBlock[] {
  // The HTML part keeps one line per element; converted text may be re-wrapped.
  const text = html ? toText(html) : plain;
  const anchor = sentAt ?? new Date();
  const anchorNote = sentAt
    ? `Year inferred from the email's send date (${anchor.toISOString().slice(0, 10)}).`
    : 'Year inferred from the import date because the send date is unknown.';
  const nswPlusSuper = /NSW rates are plus super/i.test(text);
  const othersIncludeSuper = /other hourly rates include super/i.test(text);
  const lines = text.split('\n').map(clean).filter(Boolean);
  const out: { heading: string; state: State | null; row: string; extra: string[] }[] = [];
  let state: State | null = null,
    heading: string | null = null;
  for (const line of lines) {
    if (/reply to apply|refer a friend|kind regards|unsubscribe/i.test(line)) break;
    const s = stateFrom(line);
    if (s) {
      state = s;
      heading = null;
      continue;
    }
    if ((line.match(/\|/g) ?? []).length >= 1 && heading) {
      out.push({ heading, state, row: line, extra: [] });
    } else if (/^[^|]{2,120}\s[–—-]\s[^|]{2,120}$/.test(line) && !/^\d/.test(line)) {
      heading = line;
    } else if (heading && out.length && out[out.length - 1].heading === heading) {
      out[out.length - 1].extra.push(line);
    }
  }
  return out.map(({ heading, state, row, extra }) => {
    const [facility, ...roleParts] = heading.split(/\s[–—-]\s/);
    const role = roleParts.join(' – ');
    const segments = row.split('|').map(clean);
    const notes: string[] = [];
    const dates = parseShortRange(segments[0], anchor);
    if (dates) notes.push(anchorNote);
    if (dates && !dates.end) notes.push('Only a start date is given.');
    if (!dates) notes.push('Dates are a shift list or not stated; read the original block.');
    // Prefer the segment that is only a price; other segments can quote side rates.
    const priced = segments.filter((s, i) => /\$/.test(s) && !(i === 0 && dates));
    const rateSeg =
      priced.find((s) => /^\$/.test(s)) ?? (priced.length === 1 ? priced[0] : priced.join('; '));
    const rate = singleRate(rateSeg);
    if (rateSeg && !rate) notes.push(`Rate needs review: "${rateSeg}".`);
    const ta = segments.find((s) => /T&A|accommodation|travel/i.test(s)) ?? '';
    const roster = segments
      .filter((s, i) => !(i === 0 && dates) && s !== rateSeg && s !== ta)
      .join(' | ');
    let superStatus: string | null = null;
    if (/\+\s?super|plus super/i.test(rateSeg)) superStatus = 'additional';
    else if (rate && state === 'NSW' && nswPlusSuper) superStatus = 'additional';
    else if (rate?.unit === 'hour' && state !== 'NSW' && othersIncludeSuper)
      superStatus = 'included';
    let accommodation: string | null = null,
      flights: string | null = null;
    if (/no T&A/i.test(ta)) {
      accommodation = 'not included';
      flights = 'not included';
    } else if (/T&A provided|accommodation provided/i.test(ta)) {
      accommodation = 'included';
      notes.push('Travel is described as provided; flights are not confirmed.');
    } else if (ta) notes.push(`Travel/accommodation needs review: "${ta}".`);
    const role2 = classifyRole(role || heading);
    notes.push(...role2.notes);
    if (!state) notes.push('No state heading preceded this vacancy.');
    return block(
      [
        ['Title', `${role || heading} – ${facility}`],
        ['Hospital', facility],
        ['State', state],
        ['Specialty', role2.specialty],
        ['Grade', role2.grade],
        ['Minimum PGY', role2.minPgy],
        ['Start', dates?.start],
        ['End', dates?.end],
        ['Rate', rate ? `AUD ${rate.amount}/${rate.unit}` : null],
        ['Super', superStatus],
        ['Accommodation', accommodation],
        ['Flights', flights],
        ['Roster', [roster, ...extra].filter(Boolean).join(' | ').slice(0, 500)],
        [
          'Listing ID',
          `medrecruit-email-${stableId([state ?? '', heading, dates ? segments[0] : extra.join(' ')])}`,
        ],
      ],
      [heading, row, ...extra].join('\n'),
      notes,
    );
  });
}

interface TableRow {
  state: string;
  start: string;
  end: string;
  shifts: string;
  hospital: string;
  title: string;
  pay: string;
}
const tableColumns: [keyof TableRow, RegExp][] = [
  ['state', /^state$/i],
  ['start', /^start/i],
  ['end', /^end/i],
  ['shifts', /^shift/i],
  ['hospital', /^hospital|^facility/i],
  ['title', /^job|^role|^position/i],
  ['pay', /^pay|^rate/i],
];
function tableRowsFromHtml(html: string): TableRow[] {
  const $ = load(html);
  const rows: TableRow[] = [];
  $('table').each((_, table) => {
    let index: Partial<Record<keyof TableRow, number>> | null = null;
    $(table)
      .find('tr')
      .each((__, tr) => {
        const cells = $(tr)
          .find('td,th')
          .toArray()
          .map((c) => clean($(c).text()));
        if (!index) {
          const found: Partial<Record<keyof TableRow, number>> = {};
          for (const [key, re] of tableColumns) {
            const i = cells.findIndex((c) => re.test(c));
            if (i >= 0) found[key] = i;
          }
          if (found.start !== undefined && found.hospital !== undefined && found.pay !== undefined)
            index = found;
          return;
        }
        if (cells.length < 4) return;
        const pick = (k: keyof TableRow) =>
          index![k] !== undefined ? (cells[index![k]!] ?? '') : '';
        rows.push({
          state: pick('state'),
          start: pick('start'),
          end: pick('end'),
          shifts: pick('shifts'),
          hospital: pick('hospital'),
          title: pick('title'),
          pay: pick('pay'),
        });
      });
  });
  return rows;
}
function tableRowsFromText(text: string): TableRow[] {
  const lines = text.split('\n').map(clean).filter(Boolean);
  const header = lines.findIndex(
    (l, i) =>
      /^state$/i.test(l) &&
      /^start date$/i.test(lines[i + 1] ?? '') &&
      /^pay rate$/i.test(lines[i + 6] ?? ''),
  );
  if (header < 0) return [];
  const rows: TableRow[] = [];
  let i = header + 7;
  while (i < lines.length) {
    const line = lines[i];
    if (stateFrom(line) && line.length > 3) {
      i += 1; // section heading such as NEW SOUTH WALES
      continue;
    }
    if (!stateFrom(line) || i + 6 >= lines.length) break;
    const [state, start, end, shifts, hospital, title, pay] = lines.slice(i, i + 7);
    rows.push({ state, start, end, shifts, hospital, title, pay });
    i += 7;
  }
  return rows;
}
function oneMedicalTable({ text, html }: EmailParts): LabelledBlock[] {
  const rows = (html ? tableRowsFromHtml(html) : []).filter((r) => r.hospital);
  const list = rows.length ? rows : tableRowsFromText(text);
  return list.map((r) => {
    const notes: string[] = [];
    const state = stateFrom(r.state);
    const start = parseLongDate(r.start),
      end = parseLongDate(r.end);
    if (/asap/i.test(r.start)) notes.push('Start is "ASAP"; confirm the start date.');
    for (const n of [start.note, end.note]) if (n) notes.push(n);
    if (start.date && end.date && end.date < start.date)
      notes.push(
        'The source lists an end date before the start date (probably a year typo); confirm with the recruiter.',
      );
    const rate = singleRate(r.pay);
    if (!rate) notes.push(`Rate needs review: "${r.pay}".`);
    const role = classifyRole(r.title);
    notes.push(...role.notes);
    return block(
      [
        ['Title', `${r.title} – ${r.hospital}`],
        ['Hospital', r.hospital],
        ['State', state],
        ['Specialty', role.specialty],
        ['Grade', role.grade],
        ['Minimum PGY', role.minPgy],
        ['Start', start.date],
        ['End', end.date],
        ['Rate', rate ? `AUD ${rate.amount}/${rate.unit}` : null],
        ['Super', /\+\s?super|plus super/i.test(r.pay) ? 'additional' : null],
        ['Roster', r.shifts],
        [
          'Listing ID',
          `1medical-email-${stableId([r.state, r.hospital, r.title, r.start, r.end])}`,
        ],
      ],
      Object.values(r).join(' | '),
      notes,
    );
  });
}

function oneMedicalSingle({ text }: EmailParts): LabelledBlock[] {
  const head = text.match(
    /^\s*(?:Hi[^\n]*\n+)?\s*(.+?)\s+in\s+(NSW|QLD|VIC|WA|SA|NT|TAS|ACT|New South Wales|Queensland|Victoria|Tasmania|Western Australia|South Australia|Northern Territory)\s+(?:are|is)\s+seeking\s+(?:an?\s+)?(.+)$/im,
  );
  if (!head) return [];
  const [, facility, stateText, role] = head.map(clean);
  const notes: string[] = [];
  const longDates = [
    ...text.matchAll(
      /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi,
    ),
  ].map((m) => iso(Number(m[3]), monthOf(m[2]), Number(m[1])));
  const dates = longDates.length === 2 ? longDates : [null, null];
  if (longDates.length !== 2) notes.push('Placement dates need review.');
  const rate = singleRate(text);
  if (!rate) notes.push('Rate is absent or ambiguous.');
  const roleInfo = classifyRole(role);
  notes.push(...roleInfo.notes);
  const hours = text.match(/\b(\d{4})\s*hrs?\s*-\s*(\d{4})\s*hrs?\b/i);
  const accommodation = /travel and accommodation (?:are |is )?(?:provided|included)/i.test(text)
    ? 'included'
    : null;
  if (accommodation) notes.push('Travel is described as provided; flights are not confirmed.');
  const raw = text.slice(head.index ?? 0, (head.index ?? 0) + 1500);
  return [
    block(
      [
        ['Title', `${role} – ${facility}`],
        ['Hospital', facility],
        ['State', stateFrom(stateText)],
        ['Specialty', roleInfo.specialty],
        ['Grade', roleInfo.grade],
        ['Minimum PGY', roleInfo.minPgy],
        ['Start', dates[0]],
        ['End', dates[1]],
        ['Rate', rate ? `AUD ${rate.amount}/${rate.unit}` : null],
        ['Super', /super on top|\+\s?super|plus super/i.test(text) ? 'additional' : null],
        ['Accommodation', accommodation],
        ['Roster', hours ? `${hours[1]}-${hours[2]}` : ''],
        [
          'Listing ID',
          `1medical-email-${stableId([facility, role, dates[0] ?? '', dates[1] ?? ''])}`,
        ],
      ],
      raw,
      notes,
    ),
  ];
}
