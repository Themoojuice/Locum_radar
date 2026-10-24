/**
 * Placement dates as recruiters write them in emails, for example:
 *   "29 Jan–5 Feb"   "20–23 Oct"   "13 Nov, 30 Nov"   "ASAP–17 Jan"
 *   "22, 29 Oct; 7, 10–14 Nov"   "Monday, 19 October 2026"
 *   "02.11.26 - 29.01.27"   "31/10/26 - 31/01/27"   "7 Dec 2026 – 17 Jan 2027"
 *
 * Years are often missing; they are inferred from the email's send date
 * (a date more than ~10 weeks before the email belongs to the next year) and
 * the inference is reported, never hidden.
 */
export interface DateBlock {
  start: string;
  end: string;
}
export interface DateSpan {
  start: string;
  end: string;
  blocks: DateBlock[];
  asap: boolean;
  yearInferred: boolean;
  notes: string[];
}
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
interface Part {
  d: number;
  m?: number;
  y?: number;
  asap?: boolean;
}
interface Item {
  from: Part;
  to?: Part;
}
type Token =
  | { t: 'day'; v: number }
  | { t: 'month'; v: number }
  | { t: 'year'; v: number }
  | { t: 'full'; d: number; m: number; y: number }
  | { t: 'asap' }
  | { t: 'dash' }
  | { t: 'sep' };

const iso = (y: number, m: number, d: number) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? date.toISOString().slice(0, 10)
    : null;
};
const DAY = 86400000;

/** Removes money, times, percentages and multipliers so their digits are not read as days. */
export function stripNonDates(text: string) {
  return (
    text
      .replace(/[–—]/g, '-')
      // Weekday names carry no date and their trailing commas would split ranges.
      .replace(
        /\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?:day|nesday|sday|urday)?\b\.?,?/gi,
        ' ',
      )
      .replace(/\$\s*[\d,]+(?:\.\d+)?(?:\s*-\s*\$?\s*[\d,]+(?:\.\d+)?)?/g, ' ')
      .replace(/\b\d+(?:\.\d+)?\s*%/g, ' ')
      .replace(/\bx\s*\d+\b/gi, ' ')
      .replace(/\(\s*\d+\s*shifts?\s*\)/gi, ' ')
      .replace(/\bPGY\s*\d+\+?/gi, ' ')
      .replace(/\b\d{3,4}\s*(?:hrs?|h)?\s*-\s*\d{3,4}(?:\s*\/\s*\d{3,4})?\s*(?:hrs?|h)?\b/gi, ' ')
      .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
      .replace(/\b\d{3,4}\s*hrs?\b/gi, ' ')
      .replace(/\b\d{4}\b(?<!\b20\d{2})/g, ' ')
  );
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  const re =
    /(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b|\bASAP\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|\b(20\d{2})\b|\b(\d{1,2})(?:st|nd|rd|th)?\b|(-|\bto\b|\buntil\b|\btill\b)|([,;&]|\band\b)/gi;
  for (const m of stripNonDates(text).matchAll(re)) {
    if (m[1]) {
      const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
      out.push({ t: 'full', d: Number(m[1]), m: Number(m[2]), y });
    } else if (/^ASAP$/i.test(m[0])) out.push({ t: 'asap' });
    else if (m[4]) out.push({ t: 'month', v: MONTHS[m[4].slice(0, 3).toLowerCase()] });
    else if (m[5]) out.push({ t: 'year', v: Number(m[5]) });
    else if (m[6]) {
      const v = Number(m[6]);
      if (v >= 1 && v <= 31) out.push({ t: 'day', v });
    } else if (m[7]) out.push({ t: 'dash' });
    else if (m[8]) out.push({ t: 'sep' });
  }
  return out;
}

/** Parses every date and date range in a short piece of text. */
export function parseDates(text: string, anchor: Date): DateSpan | null {
  const items: Item[] = [];
  const parts = () => items.flatMap((i) => (i.to ? [i.from, i.to] : [i.from]));
  let dash = false;
  for (const tok of tokens(text)) {
    const last = items.at(-1);
    if (tok.t === 'dash') {
      // A leading "until 30 Oct" means it runs from now until then.
      if (!last) items.push({ from: { d: 0, asap: true } });
      dash = !items.at(-1)!.to;
      continue;
    }
    if (tok.t === 'sep') {
      dash = false;
      continue;
    }
    if (tok.t === 'month' || tok.t === 'year') {
      // Back-fill the month/year onto recent dates that lack one: "22, 29 Oct", "20–23 Oct".
      const key = tok.t === 'month' ? 'm' : 'y';
      const list = parts();
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].asap) continue;
        if (list[i][key] !== undefined) break;
        list[i][key] = tok.v;
      }
      continue;
    }
    const part: Part =
      tok.t === 'full'
        ? { d: tok.d, m: tok.m, y: tok.y }
        : tok.t === 'asap'
          ? { d: 0, asap: true }
          : { d: tok.v };
    if (dash && last && !last.to) last.to = part;
    else items.push({ from: part });
    dash = false;
  }
  const notes: string[] = [];
  let yearInferred = false,
    asap = false;
  const anchorDay = anchor.toISOString().slice(0, 10);
  const resolve = (p: Part, after?: string): string | null => {
    if (p.asap) {
      asap = true;
      return anchorDay;
    }
    if (!p.m) return null;
    if (p.y) return iso(p.y, p.m, p.d);
    yearInferred = true;
    let year = after ? Number(after.slice(0, 4)) : anchor.getUTCFullYear();
    let value = iso(year, p.m, p.d);
    if (!value) return null;
    if (after ? value < after : Date.parse(value) < anchor.getTime() - 75 * DAY) {
      year += 1;
      value = iso(year, p.m, p.d);
    }
    return value;
  };
  const blocks: DateBlock[] = [];
  for (const item of items) {
    // "ASAP" on its own is not a date range.
    if (item.from.asap && !item.to) continue;
    // A year on the end date also applies to its start: "26 Oct – 29 Nov 2026".
    if (item.to?.y && !item.from.y && !item.from.asap) item.from.y = item.to.y;
    if (item.to && !item.to.m && item.from.m) item.to.m = item.from.m;
    const start = resolve(item.from);
    if (!start) continue;
    const end = item.to ? resolve(item.to, item.from.asap ? undefined : start) : start;
    // A range whose end cannot be read ("– JMO 4 –") is not a date.
    if (!end) continue;
    if (end < start) {
      notes.push(
        `The email gives an end date (${end}) before the start (${start}); probably a typo — check the year.`,
      );
      continue;
    }
    blocks.push({ start, end });
  }
  if (!blocks.length) return null;
  blocks.sort((a, b) => a.start.localeCompare(b.start));
  if (asap) notes.push('Starts "ASAP"; shown from the email date.');
  if (yearInferred) notes.push('Year inferred from the email date.');
  const start = blocks[0].start,
    end = blocks
      .map((b) => b.end)
      .sort()
      .at(-1)!;
  if (Date.parse(start) < anchor.getTime() - 120 * DAY)
    notes.push('Start date is months before the email was sent; check the year.');
  return { start, end, blocks, asap, yearInferred, notes };
}
