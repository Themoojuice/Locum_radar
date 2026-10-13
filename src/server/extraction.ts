import { load } from 'cheerio';
import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';
import {
  emptyCompensation,
  unknownRequirements,
  listingInputSchema,
  specialties,
  grades,
  states,
  type Facility,
  type ListingInput,
} from '@/domain/model';
import { emptyStore } from '@/domain/seed';
import { detectEmailFormat, splitRecruiterEmail, type EmailParts } from './adapters/email-formats';
import { resolveFacility } from './adapters/myhospitals';

export const plainText = (html: string) => {
  const $ = load(html);
  $('script, style, iframe, object, noscript').remove();
  $('br').replaceWith('\n');
  $('p, div, li, tr').append('\n');
  return $.root().text().replace(/\r/g, '').trim();
};
export interface Extraction {
  draft: Partial<ListingInput>;
  issues: string[];
}
/**
 * Runs the conservative parser over labelled fields produced by a source
 * adapter, while keeping the original block as the reviewable raw text.
 */
export function fromLabelledBlock(
  block: { labelled: string; raw: string; notes: string[] },
  sourceId: string,
  evidenceLabel: string,
  facilities?: Facility[],
): Extraction {
  const result = extractText(block.labelled, sourceId, facilities);
  result.draft.rawText = block.raw.trim() || block.labelled;
  result.draft.evidence = {
    adapter: evidenceLabel,
    derivedFields: block.labelled.slice(0, 2000),
  };
  result.issues.push(...block.notes);
  return result;
}
function field(text: string, label: string) {
  return text.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, 'im'))?.[1].trim();
}
function numberField(text: string, label: string) {
  const v = field(text, label);
  return v && /^\d+(\.\d+)?$/.test(v.replace(/,/g, '')) ? Number(v.replace(/,/g, '')) : null;
}
function yesNo(text: string, label: string): boolean | null {
  const v = field(text, label)?.toLowerCase();
  return v === 'yes' ? true : v === 'no' ? false : null;
}
function inclusion(text: string, label: string): ListingInput['flights'] {
  const v = field(text, label)?.toLowerCase();
  return v === 'included' || v === 'yes'
    ? 'included'
    : v === 'not included' || v === 'no'
      ? 'not included'
      : 'unknown';
}
const monthNames = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];
function explicitRange(text: string): [string, string] | null {
  const iso = [
    ...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\s*(?:to|–|—|-)\s*(20\d{2}-\d{2}-\d{2})\b/gi),
  ];
  if (iso.length) return iso.length === 1 ? [iso[0][1], iso[0][2]] : null;
  const ranges = [...text.matchAll(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/g)];
  if (ranges.length !== 1) return null;
  const m = ranges[0],
    month = monthNames.indexOf(m[3].slice(0, 3).toLowerCase()) + 1;
  if (!month) return null;
  const prefix = `${m[4]}-${String(month).padStart(2, '0')}`;
  return [`${prefix}-${m[1].padStart(2, '0')}`, `${prefix}-${m[2].padStart(2, '0')}`];
}
export function extractText(
  rawText: string,
  sourceId: string,
  facilities: Facility[] = emptyStore().facilities,
): Extraction {
  const text = /<(html|body|div|p)[\s>]/i.test(rawText) ? plainText(rawText) : rawText;
  const title =
    field(text, 'Title') ||
    text
      .split('\n')
      .find((v) => v.trim())
      ?.slice(0, 200) ||
    '';
  // A labelled facility is resolved against the directory; free text is only
  // searched for curated facilities, because short directory aliases ("Orange")
  // would match ordinary words.
  const hospitalLabel = field(text, '(?:Facility|Hospital)');
  const labelledState = states.find((v) => v === field(text, 'State')?.toUpperCase()) ?? null;
  const curated = facilities
    .filter((f) => !f.id.startsWith('aihw-'))
    .filter((f) =>
      [f.name, ...f.aliases].some((alias) => text.toLowerCase().includes(alias.toLowerCase())),
    );
  const { facility, note: facilityNote } = hospitalLabel
    ? resolveFacility(hospitalLabel, labelledState, facilities)
    : { facility: curated.length === 1 ? curated[0] : null, note: null };
  const inferredSpecialties = specialties.filter(
    (s) =>
      title.toLowerCase().includes(s.toLowerCase()) ||
      (s === 'Emergency medicine' && /\bED\b/.test(title)),
  );
  const inferredGrades = grades.filter((g) => new RegExp(`\\b${g}\\b`, 'i').test(title));
  const specialtyText =
      field(text, 'Specialty') || (inferredSpecialties.length === 1 ? inferredSpecialties[0] : ''),
    gradeText = field(text, 'Grade') || (inferredGrades.length === 1 ? inferredGrades[0] : ''),
    stateText = field(text, 'State') || facility?.state;
  const specialty = specialties.find((v) => v.toLowerCase() === specialtyText?.toLowerCase());
  const grade = grades.find((v) => v.toLowerCase() === gradeText?.toLowerCase());
  const state = states.find((v) => v === stateText?.toUpperCase());
  const range = explicitRange(text);
  const startDate = field(text, 'Start(?: date)?') || range?.[0],
    endDate = field(text, 'End(?: date)?') || range?.[1];
  const rateMatches = [
    ...text.matchAll(
      /(?:AUD\s*)?\$([\d,]+(?:\.\d+)?)\s*(?:\/|per\s+)(hour|hr|day|shift|placement)\b/gi,
    ),
  ];
  const rateText =
    field(text, '(?:Rate|Pay)') ||
    (rateMatches.length === 1 && !/\b(?:USD|NZD|GBP)\b/.test(text) ? rateMatches[0][0] : undefined);
  const rate = rateText?.match(
    /^(?:AUD\s*)?\$?([\d,]+(?:\.\d+)?)\s*(?:\/|per\s+)(hour|hr|day|shift|placement)\b/i,
  );
  const units = {
    hour: 'hour',
    hr: 'hour',
    day: 'day',
    shift: 'shift',
    placement: 'placement',
  } as const;
  const reg = field(text, 'Registration')?.toLowerCase();
  const registration = reg === 'general' || reg === 'specialist' || reg === 'limited' ? reg : null;
  const superText = field(text, 'Super')?.toLowerCase();
  const onCallText = field(text, 'On.call')?.toLowerCase();
  const arrangement = field(text, 'Arrangement')?.toLowerCase();
  const draft: Partial<ListingInput> = {
    sourceId,
    externalId:
      field(text, '(?:Listing ID|External ID)') ||
      createHash('sha256').update(rawText).digest('hex').slice(0, 24),
    url: field(text, '(?:URL|Link)') || null,
    rawText,
    title,
    facilityName: facility?.name || hospitalLabel || '',
    town: field(text, '(?:Town|City)') || facility?.town || '',
    ...(state ? { state } : {}),
    ...(specialty ? { specialty } : {}),
    ...(grade ? { grade } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    roster: field(text, 'Roster') || '',
    reference: field(text, '(?:Shared reference|Hospital reference)') || '',
    requirements: {
      ...unknownRequirements,
      registration,
      minPgy: numberField(text, 'Minimum PGY'),
      credentials:
        field(text, 'Credentials')
          ?.split(',')
          .map((v) => v.trim())
          .filter(Boolean) || [],
      independentCover: yesNo(text, 'Independent cover'),
      supervisionAvailable: yesNo(text, 'Supervision available'),
      complete: yesNo(text, 'Requirements complete') === true,
    },
    compensation: {
      ...emptyCompensation,
      amount: rate ? Number(rate[1].replace(/,/g, '')) : null,
      basis: rate ? units[rate[2].toLowerCase() as keyof typeof units] : 'unknown',
      paidHours: numberField(text, 'Paid hours'),
      paidDays: numberField(text, 'Paid days'),
      paidShifts: numberField(text, 'Paid shifts'),
      directExpenses: numberField(text, 'Direct expenses'),
      travelHours: numberField(text, 'Travel hours'),
      additionalPay: numberField(text, 'Additional pay'),
      super: superText === 'included' || superText === 'additional' ? superText : 'unknown',
      onCall:
        onCallText === 'none' || onCallText === 'included' || onCallText === 'additional'
          ? onCallText
          : 'unknown',
      arrangement:
        arrangement === 'employee' || arrangement === 'contractor' ? arrangement : 'unknown',
      notes: rateText || '',
    },
    flights: inclusion(text, 'Flights'),
    accommodation: inclusion(text, 'Accommodation'),
    status: 'advertised',
    flexibility: /^flex/i.test(field(text, 'Flexibility') ?? '')
      ? 'flexible'
      : /^fixed/i.test(field(text, 'Flexibility') ?? '')
        ? 'fixed'
        : /\bflexible (?:start|dates?)\b|\bdates? (?:are |is )?(?:flexible|negotiable)\b/i.test(
              text,
            )
          ? 'flexible'
          : 'unknown',
    shifts: [],
    contact: field(text, 'Contact') || '',
    evidence: Object.fromEntries(
      text
        .split('\n')
        .filter((line) => line.includes(':'))
        .slice(0, 80)
        .map((line) => [line.split(':')[0].trim(), line.slice(0, 2000)]),
    ),
  };
  const result = listingInputSchema.safeParse(draft);
  const issues = result.success
    ? []
    : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  if (facilityNote) issues.push(facilityNote);
  if (!rate) issues.push('Rate is absent or ambiguous. It remains unknown until reviewed.');
  if (draft.requirements && !draft.requirements.complete)
    issues.push('Requirements are incomplete; this is not an eligibility confirmation.');
  return { draft, issues };
}
export async function previewImport(
  content: string,
  sourceId: string,
  format: 'text' | 'eml' | 'json',
  facilities?: Facility[],
): Promise<Extraction[]> {
  if (format === 'json') {
    const parsed: unknown = JSON.parse(content),
      list = Array.isArray(parsed) ? parsed : [parsed];
    if (list.length > 100) throw new Error('Import at most 100 records at a time');
    return list.map((v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v))
        throw new Error('Each imported record must be an object');
      const draft = { ...v, sourceId } as Partial<ListingInput>;
      const parsed = listingInputSchema.safeParse(draft);
      return {
        draft,
        issues: parsed.success
          ? []
          : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    });
  }
  let text = content,
    attachmentWarning = '';
  const emailParts: EmailParts = { text: content };
  if (format === 'eml') {
    const message = await simpleParser(content, {
      skipHtmlToText: false,
      skipImageLinks: true,
      skipTextToHtml: true,
    });
    text = message.text || (message.html ? plainText(message.html) : '');
    if (!text.trim())
      throw new Error('No readable email body. Paste the relevant advertisement instead.');
    if (message.attachments.some((a) => !/^image\//.test(a.contentType)))
      attachmentWarning =
        'Email attachments are not extracted in this draft. Import the relevant text separately.';
    Object.assign(emailParts, {
      text,
      html: message.html || undefined,
      from: message.from?.text,
      subject: message.subject,
      sentAt: message.date,
    });
  }
  // Known multi-vacancy recruiter formats are split row by row before parsing.
  const recognised = detectEmailFormat(emailParts);
  if (recognised) {
    const blocks = splitRecruiterEmail(recognised, emailParts);
    if (blocks.length > 100) throw new Error('Import at most 100 advertisements at a time');
    if (blocks.length)
      return blocks.map((b) => {
        const result = fromLabelledBlock(b, sourceId, recognised, facilities);
        if (attachmentWarning) result.issues.push(attachmentWarning);
        return result;
      });
  }
  const parts = text.split(/\n\s*---+\s*\n/).filter((t) => t.trim());
  if (!parts.length || parts.length > 100)
    throw new Error('Import between 1 and 100 advertisements, separated by a line containing ---');
  return parts.map((part) => {
    const result = extractText(part.trim(), sourceId, facilities);
    if (attachmentWarning) result.issues.push(attachmentWarning);
    return result;
  });
}

export function extractJobPostings(
  html: string,
  sourceId: string,
  url: string,
  facilities?: Facility[],
): Extraction[] {
  const $ = load(html),
    postings: Record<string, unknown>[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (depth > 20 || postings.length >= 100 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((x) => walk(x, depth + 1));
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting')))
      postings.push(record);
    else Object.values(record).forEach((v) => walk(v, depth + 1));
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).text()));
    } catch {
      /* One invalid script does not hide the other scripts. */
    }
  });
  return postings.map((record) => {
    const description = plainText(typeof record.description === 'string' ? record.description : '');
    const raw = `Title: ${String(record.title || '')}\nURL: ${url}\n${description}`;
    const result = extractText(raw, sourceId, facilities);
    result.issues.unshift(
      'Review the original advertisement. Posting dates and validThrough are not placement dates.',
    );
    result.draft.evidence = {
      ...result.draft.evidence,
      structuredData: JSON.stringify(record).slice(0, 2000),
    };
    return result;
  });
}
