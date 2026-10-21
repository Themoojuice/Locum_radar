import { load } from 'cheerio';
import { classifyRole, stateFrom } from '../adapters/email-formats';
import { parseDates } from './dates';
import type { EmailKind, EmailVacancy, InboxEmail } from '@/domain/inbox';
import { INBOX_PARSER_VERSION } from '@/domain/inbox';

/*
 * Reads one recruiter email into vacancies, using the layouts Medrecruit and
 * 1Medical actually send (checked against real emails, October 2026):
 *
 *   medrecruit-digest  "<b>Armidale</b> MED RMO | 29 Jan–5 Feb | $150 p/h" under state headings
 *   1medical-table     seven-column table: state, start, end, shifts, hospital, title, pay
 *   labelled-blocks    "Position: / Unit: / Dates: / Rate:" blocks under state headings
 *   seeking-prose      "<Hospital> in <State> are seeking a <role>" + dates + rate
 *   context-lines      role headings, rate lines and date lines (single-hospital campaigns)
 *
 * Every vacancy keeps the email line it came from. Nothing is guessed: a missing
 * hospital, state, grade or date is reported as missing.
 */
export interface RawEmail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  sentAt: Date;
  text: string;
  html: string;
}
type Draft = Omit<EmailVacancy, 'id' | 'missing' | 'opportunityId' | 'ended'>;
type State = NonNullable<ReturnType<typeof stateFrom>>;

const STATE_WORD =
  /\b(NSW|QLD|VIC|WA|SA|NT|TAS|ACT|New South Wales|Queensland|Victoria|Tasmania|Western Australia|South Australia|Northern Territory|Australian Capital Territory)\b/i;
const GRADE = /\b(RMO|SRMO|JMO|HMO|PHO|REG|Registrar|CMO|SMO|Consultant|FACEM|VMO|GP|Resident)\b/i;
const clean = (v: string) =>
  v
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim();

/* ------------------------------------------------------------------ text */

/** Block-structured text lines from HTML (Medrecruit puts HTML in its plain-text part). */
export function htmlLines(html: string) {
  const $ = load(html);
  $('script, style, head, title').remove();
  $('br').replaceWith('\n');
  $('p, div, li, tr, h1, h2, h3, h4, h5, table').each((_, el) => {
    $(el).prepend('\n').append('\n');
  });
  $('td, th').append('\n');
  return $.root().text().split('\n').map(clean).filter(Boolean);
}
const looksHtml = (v: string) => /<(div|p|table|br|strong|span)[\s>/]/i.test(v);
const FOOTER =
  /^(ref:[\w]+|Kind regards|Best regards|Regards,?$|Onboarding by|This information transmitted|View the 1Medical Work Health|Manage subscriptions|\(c\) ?20\d\d)/i;
const NOISE =
  /^(https?:\/\/\S+|To view this email as a web page,? click|here\.|click$|Not displaying properly\?.*|View this email online\.?)$/i;
export function bodyLines(raw: RawEmail, prefer: 'html' | 'text' = 'html') {
  const source =
    prefer === 'html' && raw.html && looksHtml(raw.html) ? raw.html : raw.text || raw.html;
  const lines = (looksHtml(source) ? htmlLines(source) : source.split(/\r?\n/).map(clean))
    .map((l) => l.replace(/^ref:[\w]+(?=Kind regards)/i, ''))
    .filter((l) => l && !NOISE.test(l));
  const end = lines.findIndex((l, i) => i > 2 && FOOTER.test(l));
  return end > 0 ? lines.slice(0, end) : lines;
}
function usefulLinks(raw: RawEmail) {
  const html = raw.html || raw.text;
  const out: { label: string; url: string }[] = [];
  const $ = load(looksHtml(html) ? html : '');
  $('a[href]').each((_, a) => {
    const url = $(a).attr('href') || '';
    if (!/^https:\/\//.test(url)) return;
    if (
      /click\.|unsubscribe|privacy|terms|refer|facebook|instagram|linkedin|mailto|handbook|medrecruit\.medworld\.com\/terms/i.test(
        url,
      )
    )
      return;
    const text = clean($(a).text());
    const label =
      text && text.length < 60
        ? text
        : /hot ?jobs/i.test(url)
          ? 'Hot jobs page'
          : new URL(url).hostname.replace(/^www\./, '');
    if (!out.some((l) => l.url === url)) out.push({ label, url });
  });
  return out.slice(0, 4);
}

/* ------------------------------------------------------------------ facts */

const UNIT =
  /(p\/?\s?h(?:r|our)?\b|ph\b|\/\s?h(?:ou)?r\b|per\s+hour|an?\s+hour|hourly|p\/?\s?d(?:ay)?\b|\/\s?day\b|per\s+day|a\s+day|daily|per\s+shift|\/\s?shift\b|a\s+shift)/i;
const AMOUNT = String.raw`(\d{1,3}(?:,\s?\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const RATE = new RegExp(
  String.raw`\$\s?${AMOUNT}\+?\s*(?:(?:-|–|to)\s*\$?\s?${AMOUNT}\+?)?\s*` + UNIT.source,
  'i',
);
const num = (whole: string, cents?: string) =>
  Number(whole.replace(/[,\s]/g, '') + (cents ? '.' + cents : ''));
export function parseRate(text: string) {
  const m = text.match(RATE);
  if (!m) return null;
  const low = num(m[1], m[2]),
    high = m[3] ? num(m[3], m[4]) : null;
  const unit = m[5].toLowerCase();
  const basis: 'hour' | 'day' | 'shift' = /d/.test(unit.replace(/hour/, ''))
    ? 'day'
    : /shift/.test(unit)
      ? 'shift'
      : 'hour';
  // Shorthand "$170 -180 p/h" means 170 to 180; a high figure below the low one is not a range.
  const range = high !== null && high > low ? high : null;
  return { amount: low, high: range, basis, text: m[0].trim() };
}
function superFrom(text: string): 'included' | 'additional' | 'unknown' {
  if (/\+\s*super|plus super|super(?:annuation)?\s+on top|with super on top/i.test(text))
    return 'additional';
  if (/incl(?:\.|uding|usive of)?\s+(?:\d+(?:\.\d+)?%\s+)?super/i.test(text)) return 'included';
  return 'unknown';
}
const provided = (what: RegExp, text: string) =>
  new RegExp(
    what.source + String.raw`[^.\n]{0,60}\b(provided|included|reimbursed|covered|paid)\b`,
    'i',
  ).test(text);
const EXPAND: [RegExp, string][] = [
  [/\bMENTAL HEALTH\b|\bMH\b/i, 'psychiatry'],
  [/\bGERI\b/i, 'geriatrics'],
  [/\bPALL\b/i, 'palliative'],
  [/\bORTHO\b/i, 'orthopaedics'],
  [/\bPLASTICS\b/i, 'plastic surgery'],
  [/\bSTROKE\b/i, 'neurology stroke'],
  [/\bAGED CARE\b/i, 'geriatrics'],
  [/\bCCS\b/i, 'critical care services'],
];
export function readRole(role: string, hint = '') {
  let text = role.replace(/([a-z])(S?RMO|JMO|HMO|PHO|CMO)\b/g, '$1 $2');
  for (const [re, word] of EXPAND) if (re.test(text)) text += ' ' + word;
  const r = classifyRole(text);
  // The subject often carries the specialty when a row only gives the grade.
  if (!r.specialty && hint) {
    let h = hint;
    for (const [re, word] of EXPAND) if (re.test(h)) h += ' ' + word;
    const s = classifyRole(h).specialty;
    if (s && s !== 'Other') r.specialty = s;
  }
  if (!r.grade && /PGY\s?[23](?:\/[23])?\b/i.test(role + ' ' + hint)) {
    r.grade = 'RMO';
    r.notes.push('Grade inferred as RMO from PGY2/3.');
  }
  return r;
}
/**
 * "ED RMO & PHO/REG" or "Surgical RMO or HMO" name two jobs with different
 * rates; split them, carrying the specialty words to each. Slash-joined grades
 * ("CMO/SRMO") are one interchangeable role and stay together.
 */
export function splitRoles(role: string): string[] {
  const parts = role.split(/\s+(?:&|and|or)\s+/i).map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => !GRADE.test(p))) return [role];
  const prefix = parts[0]
    .replace(GRADE, '')
    .replace(/[\s/]+$/, '')
    .trim();
  return parts.map((p, i) => (i > 0 && prefix && !readRole(p).specialty ? `${prefix} ${p}` : p));
}
/** The part of a rate line that belongs to a grade: "$150/hr for RMO | $180/hr for HMO". */
function rateForGrade(rateLine: string, role: string) {
  const grade = role.match(GRADE)?.[0];
  if (!grade) return rateLine;
  const part = rateLine
    .split(/\||;|\/(?=\s*\$)/)
    .find((p) => new RegExp(String.raw`\b${grade}\b`, 'i').test(p) && /\$/.test(p));
  return part ?? rateLine;
}

/* ------------------------------------------------------------- vacancies */

interface Context {
  anchor: Date;
  subject: string;
  superRule: (state: string | null) => 'included' | 'additional' | 'unknown';
  travel: boolean;
  stay: boolean;
}
function vacancy(
  ctx: Context,
  v: {
    hospital: string;
    town?: string;
    state: string | null;
    role: string;
    dateText: string;
    rateText?: string;
    roster?: string;
    excerpt: string;
    notes?: string[];
    positions?: number | null;
  },
): Draft {
  // "Tweed Heads QLD – Relief RMO Locum Vacancy" → "Relief RMO".
  const place = v.role.match(/^(.{3,60}?)\s+[–-]\s+(.+)$/);
  let roleText = v.role;
  if (
    place &&
    GRADE.test(place[2]) &&
    (STATE_WORD.test(place[1]) ||
      (v.hospital && place[1].toLowerCase().includes(v.hospital.toLowerCase().split(' ')[0])))
  )
    roleText = place[2];
  roleText = roleText
    .replace(/\b(locum|vacanc(?:y|ies)|available)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  v = { ...v, role: roleText };
  const role = readRole(v.role, ctx.subject);
  const span = parseDates(v.dateText, ctx.anchor);
  const rate = v.rateText ? parseRate(v.rateText) : null;
  const notes = [...(v.notes ?? []), ...role.notes, ...(span?.notes ?? [])];
  if (rate?.high)
    notes.push(
      `Advertised as a range (${v.rateText?.trim()}); the lower figure is used for comparisons.`,
    );
  if (v.rateText && !rate && /\$/.test(v.rateText))
    notes.push(`Rate "${v.rateText.trim()}" could not be read as one hourly, daily or shift rate.`);
  const sup = v.rateText ? superFrom(v.rateText) : 'unknown';
  const town =
    v.town ??
    v.hospital
      .replace(
        /\b(Base|District|Regional|Referral|General|University)?\s*(Hospital|Health Service|Health|Campus)\b.*$/i,
        '',
      )
      .trim();
  const shown =
    v.role.length > 48 && role.grade
      ? `${role.specialty && role.specialty !== 'Other' ? role.specialty + ' ' : ''}${role.grade}`
      : v.role.trim();
  return {
    hospital: v.hospital.trim(),
    town: town || v.hospital.trim(),
    state: v.state,
    role: shown,
    specialty: role.specialty ?? (role.grade ? 'Other' : null),
    grade: role.grade,
    start: span?.start ?? null,
    end: span?.end ?? null,
    dateText: v.dateText.trim(),
    blocks: span && span.blocks.length > 1 ? span.blocks : [],
    rateText: (v.rateText ?? '').trim(),
    amount: rate?.amount ?? null,
    basis: rate?.basis ?? 'unknown',
    super: sup !== 'unknown' ? sup : rate ? ctx.superRule(v.state) : 'unknown',
    roster: (v.roster ?? '').trim(),
    flights: ctx.travel ? 'included' : 'unknown',
    accommodation: ctx.stay ? 'included' : 'unknown',
    positions: v.positions ?? null,
    minPgy: role.minPgy,
    excerpt: v.excerpt.slice(0, 600),
    notes: [
      ...new Set(
        role.specialty || !role.grade
          ? notes
          : [...notes, 'Specialty not stated; recorded as Other.'],
      ),
    ],
  };
}

/**
 * Medrecruit weekly digest: "Town ROLE | dates | rate" rows under state
 * headings. The town is either bold at the start of the row or on its own bold
 * line above it; rows without a town continue the previous one.
 */
export function medrecruitDigest(html: string, ctx: Context): Draft[] {
  if (!looksHtml(html) || !/\|/.test(html)) return [];
  const $ = load(html);
  const out: Draft[] = [];
  let state: State | null = null,
    town = '';
  $('h1, h2, h3, h4, div, p, li').each((_, el) => {
    const node = $(el);
    const text = clean(node.text());
    if (/^h\d$/i.test(el.tagName)) {
      state = stateFrom(text) ?? state;
      return;
    }
    if (node.find('div, p, li').length || !text) return;
    const lead = clean(node.children('strong, b').first().text());
    if (!text.includes('|')) {
      // A bold line on its own naming a place: "Bathurst", "Riverland / Berri".
      if (lead && lead === text && text.length < 50 && !/\d|[?!]/.test(text) && !GRADE.test(text))
        town = text;
      return;
    }
    if (text.length > 300) return;
    const segments = text.split('|').map(clean);
    let role = segments[0];
    if (lead && role.startsWith(lead) && clean(role.slice(lead.length))) {
      town = lead;
      role = clean(role.slice(lead.length));
    }
    const dated = !!parseDates(segments[1] ?? '', ctx.anchor);
    if (!town || !dated) return;
    out.push(
      vacancy(ctx, {
        hospital: town,
        town: town.replace(/\s+Hospital$/i, ''),
        state,
        role: role.replace(/\bx\s*\d+\b/i, '').trim(),
        dateText: segments[1],
        rateText: segments.slice(2).join(' '),
        roster: /night/i.test(text) ? 'Nights' : '',
        excerpt: `${state ? state + ' · ' : ''}${town} · ${text.startsWith(town) ? text.slice(town.length).trim() : text}`,
        notes: ['Medrecruit lists the town; confirm which hospital before applying.'],
        positions: Number(text.match(/\bx\s*(\d+)\b/i)?.[1]) || null,
      }),
    );
  });
  return out;
}

const TABLE_STATE = /^(NSW|QLD|VIC|WA|SA|NT|TAS|ACT)$/;
/** 1Medical seven-column table, flattened one cell per line. */
export function oneMedicalTable(lines: string[], ctx: Context): Draft[] {
  const header = lines.findIndex(
    (l, i) =>
      /^Pay rate$/i.test(l) &&
      lines.slice(Math.max(0, i - 6), i).some((v) => /^Hospital$/i.test(v)),
  );
  if (header < 0) return [];
  const out: Draft[] = [];
  for (let i = header + 1; i < lines.length; i++) {
    if (!TABLE_STATE.test(lines[i])) continue;
    const [code, startText, endText, shifts, hospital, title, pay] = lines.slice(i, i + 7);
    if (!pay || TABLE_STATE.test(hospital ?? '')) continue;
    const state = stateFrom(code);
    // "Monday, 28 December 2026 – Saturday, 31 January 2026": the end year is a typo.
    let end = endText;
    const typo: string[] = [];
    const from = parseDates(startText, ctx.anchor),
      to = parseDates(endText, ctx.anchor);
    if (from && to && to.start < from.start) {
      const fixed = endText.replace(/\b(20\d{2})\b/, (y) => String(Number(y) + 1));
      const read = parseDates(fixed, ctx.anchor);
      if (fixed !== endText && read && read.start >= from.start) {
        end = fixed;
        typo.push(
          `The email gives the end as "${endText}", before the start; read as ${read.start}.`,
        );
      }
    }
    out.push(
      vacancy(ctx, {
        hospital,
        state,
        role: title,
        dateText: `${startText} - ${end}`,
        rateText: pay,
        roster: shifts,
        excerpt: [code, startText, endText, shifts, hospital, title, pay].join(' · '),
        positions: Number(title.match(/\bx\s*(\d+)\b/i)?.[1]) || null,
        notes: [...typo, ...(/enquire/i.test(pay) ? ['Rate on enquiry.'] : [])],
      }),
    );
    i += 6;
  }
  return out;
}

const STATE_HEADING = new RegExp('^' + STATE_WORD.source + String.raw`(?:\s*[-–]\s*.+)?$`, 'i');
const field = (line: string, name: string) =>
  line.match(new RegExp(`^${name}\\s*:\\s*(.+)$`, 'i'))?.[1].trim();
/** 1Medical "Position: / Unit: / Dates: / Rate:" blocks under state headings. */
export function labelledBlocks(lines: string[], ctx: Context): Draft[] {
  if (lines.filter((l) => /^Position\s*:/i.test(l)).length < 1) return [];
  const out: Draft[] = [];
  let state: State | null = null;
  let block: {
    position: string;
    unit: string;
    dates: string[];
    schedule: string;
    rate: string;
    extras: string[];
    lines: string[];
  } | null = null;
  const flush = () => {
    if (!block?.position) return;
    const travel = block.extras.some((e) => /flight/i.test(e) && /included/i.test(e));
    const stay = block.extras.some((e) => /accommodation/i.test(e) && /included/i.test(e));
    const local = { ...ctx, travel: ctx.travel || travel, stay: ctx.stay || stay };
    for (const d of block.dates.length ? block.dates : ['']) {
      out.push(
        vacancy(local, {
          hospital: '',
          town: '',
          state,
          role: `${block.position}${block.unit ? ` – ${block.unit}` : ''}`,
          dateText: d,
          rateText: block.rate,
          roster: block.schedule,
          excerpt: block.lines.join(' · '),
          notes: ['The email names the state and unit, not the hospital.'],
        }),
      );
    }
    block = null;
  };
  for (const line of lines) {
    if (STATE_HEADING.test(line) && line.length < 40) {
      flush();
      state = stateFrom(line.match(STATE_WORD)![0]);
      continue;
    }
    const position = field(line, 'Position');
    if (position) {
      flush();
      block = { position, unit: '', dates: [], schedule: '', rate: '', extras: [], lines: [line] };
      continue;
    }
    if (!block) continue;
    block.lines.push(line);
    block.unit = field(line, 'Unit') ?? block.unit;
    const dates = field(line, 'Dates?');
    if (dates) block.dates.push(dates);
    block.schedule = field(line, 'Work schedule') ?? block.schedule;
    block.rate = field(line, 'Rate') ?? block.rate;
    if (/accommodation|flights|car hire/i.test(line)) block.extras.push(line);
    if (/^If you are|^I look forward/i.test(line)) flush();
  }
  flush();
  return out;
}

const STATE_NAME =
  'NSW|QLD|VIC|WA|SA|NT|TAS|ACT|New South Wales|Queensland|Victoria|Tasmania|Western Australia|South Australia|Northern Territory';
/** "<Hospital> in <State> are seeking a <role>" with dates and a rate nearby. */
export function seekingProse(lines: string[], ctx: Context): Draft[] {
  const text = lines.join('\n');
  const m = text.match(
    new RegExp(
      String.raw`(?:^|\n)([A-Z][^\n]{2,80}?)\s+in\s+(${STATE_NAME})\s+(?:are|is)\s+seeking\s+(?:an?\s+|two\s+|several\s+)?([^\n]+?)(?:\s+for the following dates:?)?\s*(?:\n|$)`,
    ),
  );
  if (!m) return [];
  const [, hospital, stateText, roleRaw] = m;
  const state = stateFrom(stateText);
  const role = roleRaw.replace(/\s*-?\s*\((PGY\s*\d+\+?)\)/i, ' $1').trim();
  const dateLines = lines.filter(
    (l) =>
      /^(Vacancy\s*\d+|Period|Dates?)\s*:/i.test(l) ||
      (/\b20\d{2}\b/.test(l) && l.length < 160 && !!parseDates(l, ctx.anchor)),
  );
  const rateLine =
    lines.find((l) => /^Rates?\s*:/i.test(l) && /\$/.test(l)) ??
    (lines.findIndex((l) => /^Rates?\s*:?$/i.test(l)) >= 0
      ? lines[lines.findIndex((l) => /^Rates?\s*:?$/i.test(l)) + 1]
      : undefined) ??
    lines.find((l) => RATE.test(l)) ??
    '';
  const vacancyLines = dateLines.filter((l) => /^Vacancy\s*\d+/i.test(l));
  const use = vacancyLines.length ? vacancyLines : dateLines.slice(0, 1);
  return splitRoles(role).flatMap((r) =>
    use.map((d) =>
      vacancy(ctx, {
        hospital,
        state,
        role: r,
        dateText: d.replace(/^(Vacancy\s*\d+|Period|Dates?)\s*:/i, ''),
        rateText: rateForGrade(rateLine, r).replace(/^Rates?\s*:/i, ''),
        roster: d.match(/\b\d{4}\s*hrs?\s*-\s*\d{4}\s*hrs?\b/i)?.[0] ?? '',
        excerpt: [m[0].trim(), d, rateLine].filter(Boolean).join(' · '),
      }),
    ),
  );
}

const WEEKDAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?\s+\d/i;
const LEAD_DATE =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\.?,?\s+)?\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s+20\d{2})?/i;
/** Capitalised section headings: "MENTAL HEALTH", "RURAL RELIEF - MED/ED hybrid". */
const SECTION = /^[A-Z]{3,}(?:[ &/-]+[A-Z]{2,})+\b/;
const TIME_RANGE = /\b\d{4}\s*[-–]\s*\d{4}\b/;
const HOSPITAL_NAME =
  /([A-Z][A-Za-z'’./-]+(?:\s+[A-Z][A-Za-z'’./-]+){0,4}\s+(?:Base\s+|District\s+|Regional\s+|General\s+|University\s+)?(?:Hospital|Health Service|Health Campus))/;
/**
 * Single-hospital campaigns and mixed lists: role headings, rate lines and date
 * lines read in order, the most recent heading giving the context. Rosters of
 * single days ("Fri 23 Oct: 1400–2400", "2 Oct – GANDHI – 0800–1630") become
 * one vacancy per role with its list of shifts.
 */
export function contextLines(lines: string[], ctx: Context): Draft[] {
  const intro = lines.slice(0, 8).join(' \n ');
  const named = intro.match(HOSPITAL_NAME)?.[1] ?? '';
  const placeLine = lines
    .slice(0, 8)
    .map((l) =>
      l.match(/^([A-Z][A-Za-z'/ ]{2,40}?),?\s+(QLD|NSW|VIC|SA|WA|NT|TAS|ACT)\s*[–-]\s*(.+)$/),
    )
    .find(Boolean);
  const hospital = named || (placeLine ? placeLine[1] : '');
  let state: State | null =
    stateFrom(placeLine?.[2] ?? '') ??
    stateFrom(intro.match(/(?:,|\bin)\s*(QLD|NSW|VIC|SA|WA|NT|TAS|ACT)\b/)?.[1] ?? '') ??
    stateFrom(
      intro.match(
        /\b(Queensland|New South Wales|Victoria|Tasmania|Western Australia|South Australia|Northern Territory)\b/,
      )?.[1] ?? '',
    );
  const firstGradeLine = lines.find((l) => GRADE.test(l) && l.length < 160 && !RATE.test(l));
  // Rates can come after the dates they price ("Dates: … / RMO: $849 per shift").
  const allRates = lines
    .filter((l) => l.length <= 200 && parseRate(l))
    .map((l) => ({ key: l.split(/[:–]|\s-\s/)[0], text: l }));
  const gradeRate = (list: typeof allRates, r: string) => {
    const grade = r.match(GRADE)?.[0]?.toUpperCase();
    return grade
      ? list.find((x) =>
          x.key
            .toUpperCase()
            .split(/[\s/]+/)
            .includes(grade),
        )
      : undefined;
  };
  const fallbackRole = placeLine?.[3] ?? firstGradeLine ?? ctx.subject;
  const rates: { key: string; text: string }[] = [];
  const out: Draft[] = [];
  let shifts: { line: string; date: string }[] = [];
  let role = placeLine?.[3] ?? '',
    section = '',
    detail = '';
  const flushShifts = () => {
    if (!shifts.length) return;
    const dates = [...new Set(shifts.map((s) => s.date))].sort();
    const roleText = role || fallbackRole;
    const hourly = rates
      .map((r) => parseRate(r.text))
      .filter((r): r is NonNullable<ReturnType<typeof parseRate>> => !!r);
    const own = rates.filter((r) => GRADE.test(r.key) && r.text === role);
    const rateText = own.length ? own[0].text : rates.map((r) => r.text).join(' · ');
    const draft = vacancy(ctx, {
      hospital,
      state,
      role: roleText.split(/\s*[–-]?\s*(?:Up to\s+)?\$/i)[0].trim(),
      dateText: shifts.map((s) => s.line.split(/[:|]|\s[–-]\s/)[0]).join(', '),
      rateText,
      roster: `${shifts.length} listed shift${shifts.length === 1 ? '' : 's'}`,
      excerpt: [
        role,
        ...shifts.slice(0, 6).map((s) => s.line),
        shifts.length > 6 ? `… ${shifts.length - 6} more` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      notes: [
        `${shifts.length} individual shifts from ${dates[0]} to ${dates.at(-1)}; pick the ones you can do.`,
      ],
    });
    if (!own.length && hourly.length > 1) {
      draft.amount = Math.min(...hourly.map((r) => r.amount));
      draft.basis = hourly[0].basis;
      draft.notes.push('Rates vary by shift; the lowest is used for comparisons.');
    }
    out.push(draft);
    shifts = [];
  };
  for (const line of lines) {
    if (line.length > 200) continue;
    if (STATE_HEADING.test(line) && line.length < 40) {
      state = stateFrom(line.match(STATE_WORD)![0]) ?? state;
      continue;
    }
    const rate = parseRate(line);
    const dates = /\d/.test(line) ? parseDates(line.replace(/^Dates?\s*:/i, ''), ctx.anchor) : null;
    if (!dates) {
      if (rate) {
        rates.push({ key: line.split(/[:–]|\s-\s/)[0], text: line });
        if (GRADE.test(line) && line.length < 90) {
          flushShifts();
          role = line;
        }
      } else if (GRADE.test(line) && line.length < 70 && !/[.?!]$/.test(line)) {
        flushShifts();
        role = line;
        detail = '';
      } else if (SECTION.test(line) && line.length < 50 && !/\d/.test(line)) {
        section = line;
        role = '';
        detail = '';
      } else if (
        line.length < 60 &&
        role &&
        !/[.?!:]$/.test(line) &&
        !/\||\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b/i.test(line) &&
        !TIME_RANGE.test(line)
      )
        detail = line;
      continue;
    }
    // A roster line starts with one date and adds times or a ward: "14 Nov – JMO 4 – 0700–1500".
    const lead = line.match(LEAD_DATE)?.[0];
    const rest = lead ? line.slice(lead.length) : '';
    const shiftLine =
      !!lead &&
      !parseDates(rest, ctx.anchor) &&
      (WEEKDAY.test(line) || TIME_RANGE.test(line) || /^\s*[|:–-]/.test(rest));
    if (shiftLine && /\bOFF\b/.test(rest)) continue;
    if (shiftLine) {
      const day = parseDates(lead!, ctx.anchor);
      if (day) shifts.push({ line, date: day.start });
      continue;
    }
    const single = dates.blocks.length === 1 && dates.start === dates.end;
    if (single && /\bOFF\b/.test(line)) continue;
    if (single && (WEEKDAY.test(line) || TIME_RANGE.test(line) || /\|/.test(line))) {
      shifts.push({ line, date: dates.start });
      continue;
    }
    const roleText = role || fallbackRole;
    for (const r of splitRoles(roleText)) {
      const grade = r.match(GRADE)?.[0];
      const matched = grade ? (gradeRate(rates, r) ?? gradeRate(allRates, r)) : undefined;
      const rateText = rate?.text ?? matched?.text ?? rates[0]?.text ?? allRates[0]?.text ?? '';
      out.push(
        vacancy(ctx, {
          hospital: detail && !hospital ? detail : hospital,
          state,
          role: `${r}${section && !r.toLowerCase().includes(section.toLowerCase().slice(0, 5)) ? ` (${section.toLowerCase()})` : ''}`,
          dateText: line.replace(/^Dates?\s*:/i, ''),
          rateText,
          roster: /night/i.test(r) ? 'Nights' : '',
          excerpt: [section, role, detail, line].filter(Boolean).join(' · '),
          positions: Number(line.match(/\bx\s*(\d+)\b/i)?.[1]) || null,
          notes: [
            ...(detail ? [`Location detail: ${detail}.`] : []),
            ...(!rate && !matched && rates.length > 1
              ? [`Several rates are listed: ${rates.map((x) => x.text).join('; ')}`]
              : []),
          ],
        }),
      );
    }
  }
  flushShifts();
  return out;
}

/* ------------------------------------------------------------------ email */

const AGENCIES: [RegExp, string][] = [
  [/medrecruit/i, 'Medrecruit'],
  [/1medical/i, '1Medical'],
];
export function readRecruiterEmail(raw: RawEmail, today = new Date().toISOString().slice(0, 10)) {
  const address = (raw.from.match(/<([^<>]+)>/)?.[1] || raw.from).trim().toLowerCase();
  const display = clean(raw.from.replace(/<[^<>]*>/, '').replace(/"/g, ''));
  const agency =
    AGENCIES.find(([re]) => re.test(address))?.[1] ?? address.split('@')[1] ?? 'Recruiter';
  const html = raw.html && looksHtml(raw.html) ? raw.html : looksHtml(raw.text) ? raw.text : '';
  const lines = bodyLines(raw);
  const whole = lines.join('\n');
  const nswPlus = /NSW rates are plus super/i.test(whole),
    othersInc = /other (?:hourly )?rates include super/i.test(whole),
    allInc =
      /\brates?\b[^.\n]{0,40}\b(?:are\s+)?(?:inclusive of|include|including)\s+(?:\d+(?:\.\d+)?%\s+)?super/i.test(
        whole,
      ),
    allPlus = /\brates?\b[^.\n]{0,40}\b(?:are\s+)?(?:plus|\+)\s*super/i.test(whole);
  const ctx: Context = {
    anchor: raw.sentAt,
    subject: raw.subject.replace(/^(1Medical|Medrecruit)\s*[-–:]\s*/i, ''),
    superRule: (s) =>
      nswPlus && s === 'NSW'
        ? 'additional'
        : othersInc && s !== 'NSW'
          ? 'included'
          : allInc
            ? 'included'
            : allPlus
              ? 'additional'
              : 'unknown',
    travel: provided(/\b(travel|flights?|airfares?)\b/, whole),
    stay: provided(/\baccom(?:modation)?\b/, whole),
  };
  const parsers: [string, () => Draft[]][] = [
    ['medrecruit-digest', () => medrecruitDigest(html, ctx)],
    ['1medical-table', () => oneMedicalTable(lines, ctx)],
    ['labelled-blocks', () => labelledBlocks(lines, ctx)],
    ['seeking-prose', () => seekingProse(lines, ctx)],
    ['context-lines', () => contextLines(lines, ctx)],
  ];
  let drafts: Draft[] = [],
    format = '';
  const attempt = (list: [string, () => Draft[]][]) => {
    for (const [name, run] of list) {
      drafts = run().filter((d) => d.grade || (d.start && d.hospital));
      if (drafts.length) {
        format = name;
        return;
      }
    }
  };
  attempt(parsers);
  // HTML layouts can bury a table in wrappers; the plain-text part is the fallback.
  const plain = raw.text && raw.html && looksHtml(raw.html) && !looksHtml(raw.text);
  if (!drafts.length && plain) {
    const textLines = bodyLines(raw, 'text');
    attempt([
      ['1medical-table', () => oneMedicalTable(textLines, ctx)],
      ['labelled-blocks', () => labelledBlocks(textLines, ctx)],
      ['seeking-prose', () => seekingProse(textLines, ctx)],
      ['context-lines', () => contextLines(textLines, ctx)],
    ]);
  }
  // A context-only read with no dates at all is not a vacancy list.
  if (format === 'context-lines' && !drafts.some((d) => d.start)) drafts = [];
  const vacancies: EmailVacancy[] = drafts.map((d, i) => {
    const missing = [
      !d.hospital || /on enquiry/i.test(d.hospital) ? 'hospital' : '',
      !d.state ? 'state' : '',
      !d.grade ? 'grade' : '',
      !d.start || !d.end ? 'dates' : '',
    ].filter(Boolean);
    return {
      ...d,
      id: `${raw.id}-${i}`,
      missing,
      opportunityId: null,
      ended: !!d.end && d.end < today,
    };
  });
  const links = usefulLinks(raw);
  const offerish =
    GRADE.test(raw.subject + ' ' + whole.slice(0, 1500)) &&
    /\b(seeking|vacanc|locum|opportunit|positions?|roles?|shifts? available)\b/i.test(
      raw.subject + ' ' + whole.slice(0, 1500),
    ) &&
    (RATE.test(whole) ||
      /\b(salary|remuneration)\b/i.test(whole) ||
      /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(whole));
  let kind: EmailKind, summary: string;
  if (vacancies.length) {
    kind = 'offers';
    const live = vacancies.filter((v) => !v.ended).length;
    summary = `${vacancies.length} vacanc${vacancies.length === 1 ? 'y' : 'ies'} read${live < vacancies.length ? ` (${vacancies.length - live} already ended)` : ''}.`;
  } else if (
    links.some((l) => /hot ?jobs|netlify/i.test(l.url + l.label)) ||
    /hot jobs/i.test(whole)
  ) {
    kind = 'link';
    summary = 'The vacancies are on a linked page, not in the email itself.';
  } else if (offerish) {
    kind = 'unparsed';
    summary = 'Looks like an offer, but no dated vacancy could be read. Check the email.';
  } else {
    kind = 'other';
    summary = 'No vacancy details: a newsletter, reminder or admin email.';
  }
  const body = lines
    .filter((l, i) => !(i === 0 && /^Hi\b/i.test(l) && l.length < 30))
    .join('\n')
    .slice(0, 8000);
  return {
    id: raw.id,
    threadId: raw.threadId,
    agency,
    recruiter: display && !/^info$/i.test(display) ? display : agency,
    fromAddress: address,
    subject: raw.subject || '(no subject)',
    receivedAt: raw.sentAt.toISOString(),
    kind,
    summary,
    permanent: /\bpermanent\b/i.test(raw.subject + ' ' + whole.slice(0, 600)),
    vacancies,
    body,
    links,
    gmailUrl: `https://mail.google.com/mail/u/0/#all/${raw.id}`,
    parser: INBOX_PARSER_VERSION,
    format,
  } satisfies Omit<InboxEmail, 'importedAt' | 'status'> & { format: string };
}
