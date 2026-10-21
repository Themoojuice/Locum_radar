import { z } from 'zod';
import { credential } from '../credentials';
import {
  assembleEmail,
  draftFromFields,
  emailParts,
  usable,
  type RawEmail,
  type ReadEmail,
} from './recruiter-email';

/*
 * Claude reads emails (and pasted adverts or screenshots) whose layout the
 * built-in readers do not know. It only splits the text into vacancies and
 * copies each field exactly as written; the same date, rate and role code as
 * the built-in readers then turns that text into dates and numbers, so year
 * inference and rate handling behave identically whichever reader ran.
 */
export const CLAUDE_MODEL = 'claude-haiku-5-5';
/** US dollars per million tokens (prompts under 100k tokens), checked October 2026. */
const PRICE = { input: 0.1, output: 0.5 };
const API = 'https://api.anthropic.com/v1/messages';

export const claudeConfigured = () => !!credential('ANTHROPIC_API_KEY');

const vacancySchema = z.object({
  hospital: z.string().max(200).default(''),
  town: z.string().max(100).default(''),
  state: z.string().max(40).default(''),
  role: z.string().max(200).default(''),
  dates: z.string().max(600).default(''),
  rate: z.string().max(300).default(''),
  roster: z.string().max(300).default(''),
  positions: z.number().int().min(1).max(50).nullable().default(null),
  travel_provided: z.boolean().nullable().default(null),
  accommodation_provided: z.boolean().nullable().default(null),
  notes: z.string().max(600).default(''),
  source_text: z.string().max(1200).default(''),
});
export const claudeAnswerSchema = z.object({
  kind: z.enum(['offers', 'link', 'other', 'unparsed']),
  agency: z.string().max(80).default(''),
  summary: z.string().max(300).default(''),
  permanent: z.boolean().default(false),
  transcript: z.string().max(20000).default(''),
  vacancies: z.array(vacancySchema).max(150).default([]),
});
export type ClaudeAnswer = z.infer<typeof claudeAnswerSchema>;

const tool = {
  name: 'record_advert',
  description:
    'Record what a recruitment email or advert for doctors contains: each vacancy with its fields copied exactly as written.',
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['offers', 'link', 'other', 'unparsed'],
        description:
          'offers: lists one or more specific locum/temporary vacancies. link: points to vacancies on a web page without listing them. other: newsletter, reminder, admin, compliance, referral or marketing with no specific vacancy. unparsed: offers work but gives no dates or place to record (e.g. a permanent post, "send me your availability").',
      },
      agency: { type: 'string', description: 'Recruitment agency name, if identifiable.' },
      summary: { type: 'string', description: 'One short sentence describing the message.' },
      permanent: {
        type: 'boolean',
        description: 'True for permanent or fixed-term salaried posts.',
      },
      transcript: {
        type: 'string',
        description: 'Only for images: the full readable text of the image(s). Otherwise empty.',
      },
      vacancies: {
        type: 'array',
        description:
          'One entry per distinct vacancy (place + role + dates). A row offering two grades at different rates ("RMO $150/hr | HMO $180/hr") is two vacancies. Shifts at the same place and role listed separately are ONE vacancy with all dates in "dates".',
        items: {
          type: 'object',
          properties: {
            hospital: {
              type: 'string',
              description:
                'Hospital or health service exactly as written. Empty if only a town, region or state is given. Never guess a hospital from a town.',
            },
            town: { type: 'string', description: 'Town or city if written, else empty.' },
            state: {
              type: 'string',
              description:
                'Australian state/territory as written or as the heading it sits under (e.g. NSW, QLD). Empty if not given.',
            },
            role: {
              type: 'string',
              description:
                'Role exactly as written, including specialty and grade, e.g. "ED SRMO (Nights)".',
            },
            dates: {
              type: 'string',
              description:
                'Dates EXACTLY as written, including any year, "ASAP", or the full list of shifts, e.g. "29 Jan–5 Feb" or "Fri 23 Oct; Wed 28 Oct". Do not convert or add a year.',
            },
            rate: {
              type: 'string',
              description:
                'Pay exactly as written including units and super wording, e.g. "$150 p/h + super". Empty if none.',
            },
            roster: { type: 'string', description: 'Shift pattern or hours if written.' },
            positions: { type: ['integer', 'null'], description: 'Number of posts if stated.' },
            travel_provided: { type: ['boolean', 'null'] },
            accommodation_provided: { type: ['boolean', 'null'] },
            notes: {
              type: 'string',
              description:
                'Requirements or conditions written for this vacancy (PGY level, ALS, minimum commitment).',
            },
            source_text: {
              type: 'string',
              description: 'The line(s) of the message this vacancy was read from, verbatim.',
            },
          },
          required: ['hospital', 'state', 'role', 'dates', 'rate', 'source_text'],
        },
      },
    },
    required: ['kind', 'summary', 'vacancies'],
  },
} as const;

const SYSTEM = `You read recruitment messages sent to an Australian junior doctor and record the locum vacancies they contain using the record_advert tool.
Rules:
- Copy fields exactly as written. Do not convert dates, infer years, compute rates or expand abbreviations.
- Include every vacancy, including long digests (every row) and ones that may have ended.
- A heading (state, town, hospital, specialty) applies to the rows beneath it until the next heading.
- If the message only links to a jobs page, use kind "link" with no vacancies.
- Greeting, signature, unsubscribe and referral text are not vacancies.`;

export interface ClaudeImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: string;
}
export interface ClaudeResult {
  answer: ClaudeAnswer;
  cost: number;
}
/** One call to Claude; returns the validated answer and its cost in US dollars. */
export async function askClaude(
  text: string,
  images: ClaudeImage[] = [],
  fetcher: typeof fetch = fetch,
): Promise<ClaudeResult> {
  const key = credential('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Add your Anthropic API key in Recruiter inbox → Settings.');
  const response = await fetcher(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((i) => ({
              type: 'image',
              source: { type: 'base64', media_type: i.mediaType, data: i.data },
            })),
            { type: 'text', text: text.slice(0, 60000) || 'Read the advert in the image(s).' },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(
      response.status === 401
        ? 'Claude rejected the API key. Check it in Recruiter inbox → Settings.'
        : response.status === 429
          ? 'Claude is rate-limiting requests; try again in a minute.'
          : /credit|billing/i.test(message)
            ? 'Your Anthropic account is out of credit (console.anthropic.com → Billing).'
            : `Claude could not read this (${message.slice(0, 160)}).`,
    );
  }
  const use = data.content?.find((c: { type: string }) => c.type === 'tool_use');
  if (!use) throw new Error('Claude returned no reading.');
  const answer = claudeAnswerSchema.parse(use.input);
  const usage = data.usage ?? {};
  const cost =
    ((usage.input_tokens ?? 0) * PRICE.input + (usage.output_tokens ?? 0) * PRICE.output) / 1e6;
  return { answer, cost };
}

/** Turns Claude's answer into the stored email record, via the shared date/rate code. */
export function emailFromAnswer(
  raw: RawEmail,
  answer: ClaudeAnswer,
  today = new Date().toISOString().slice(0, 10),
  body?: string,
): ReadEmail {
  const parts = emailParts(raw);
  const drafts = answer.vacancies
    .map((v) => {
      const draft = draftFromFields(parts, {
        hospital: v.hospital,
        town: v.town,
        state: v.state || null,
        role: v.role,
        dates: v.dates,
        rate: v.rate,
        roster: v.roster,
        positions: v.positions,
        travel: v.travel_provided,
        accommodation: v.accommodation_provided,
        notes: v.notes ? [v.notes] : [],
        excerpt: v.source_text || [v.hospital || v.town, v.role, v.dates, v.rate].join(' · '),
      });
      draft.notes.push('Read by Claude; check against the email line.');
      return draft;
    })
    .filter(usable);
  return assembleEmail(parts, drafts, 'claude', today, {
    kind: answer.kind,
    summary: answer.summary,
    agency: answer.agency && !parts.listed ? answer.agency : undefined,
    permanent: answer.permanent,
    body,
    reader: 'claude',
  });
}

/** Text Claude sees for an email: sender, subject, date and the cleaned body. */
export function emailPrompt(raw: RawEmail) {
  const parts = emailParts(raw);
  return [
    `From: ${raw.from}`,
    `Subject: ${raw.subject}`,
    `Sent: ${raw.sentAt.toISOString().slice(0, 10)}`,
    '',
    parts.lines.join('\n'),
  ].join('\n');
}
