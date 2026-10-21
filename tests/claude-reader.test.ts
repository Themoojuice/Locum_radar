import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askClaude, type ClaudeAnswer } from '@/server/email/claude-reader';
import { readEmail, readPasted, saveEmail, unreadIds } from '@/server/email/inbox';
import type { RawEmail } from '@/server/email/recruiter-email';
import { inboxQuery } from '@/domain/inbox';
import { agencies, agencyFor, inboxSettings, searchDomains } from '@/domain/agencies';
import { emptyStore } from '@/domain/seed';

/* Claude is never called for real here: askClaude is given a fake fetch, and the
 * pipeline is given a fake reader. */
const email = (from: string, subject: string, text: string): RawEmail => ({
  id: 'msg' + Math.random().toString(36).slice(2, 10),
  threadId: 't',
  from,
  subject,
  sentAt: new Date('2026-10-20T00:00:00Z'),
  text,
  html: '',
});
const answer = (over: Partial<ClaudeAnswer> = {}): ClaudeAnswer => ({
  kind: 'offers',
  agency: 'Example Locums',
  summary: 'Two ED roles in QLD.',
  permanent: false,
  transcript: '',
  vacancies: [
    {
      hospital: 'Mackay Base Hospital',
      town: 'Mackay',
      state: 'QLD',
      role: 'ED SRMO',
      dates: '3–17 Jan',
      rate: '$165/hr + super',
      roster: '',
      positions: null,
      travel_provided: true,
      accommodation_provided: true,
      notes: 'PGY4+',
      source_text: 'Mackay Base ED SRMO 3–17 Jan $165/hr + super',
    },
    {
      hospital: '',
      town: '',
      state: '',
      role: 'Welcome to our newsletter',
      dates: '',
      rate: '',
      roster: '',
      positions: null,
      travel_provided: null,
      accommodation_provided: null,
      notes: '',
      source_text: '',
    },
  ],
  ...over,
});
const fake = (a: ClaudeAnswer, cost = 0.002) => vi.fn(async () => ({ answer: a, cost }));

describe('agency settings and search', () => {
  it('searches every listed agency by default and adds a label when set', () => {
    const settings = inboxSettings(emptyStore());
    expect(settings.agencies).toHaveLength(agencies.length);
    const domains = searchDomains(settings);
    expect(domains).toContain('medrecruit.com');
    expect(domains).toContain('wave.com.au');
    expect(inboxQuery(30, ['wave.com.au'], 'Locum offers')).toBe(
      '{from:(wave.com.au) label:locum-offers} newer_than:30d -in:trash -in:spam -in:sent -in:drafts',
    );
    expect(inboxQuery(7, ['bad domain', 'cmr.com.au'])).toMatch(/^from:\(cmr\.com\.au\) /);
  });
  it('keeps saved choices and includes agencies added later', () => {
    const store = emptyStore();
    store.settings = [
      {
        ...inboxSettings(store),
        agencies: ['medrecruit'],
        knownAgencies: agencies.filter((a) => a.id !== 'wavelength').map((a) => a.id),
      },
    ];
    expect(inboxSettings(store).agencies.sort()).toEqual(['medrecruit', 'wavelength']);
  });
  it('recognises agency subdomains', () => {
    expect(agencyFor('info@connect.medrecruit.com')?.name).toBe('Medrecruit');
    expect(agencyFor('someone@gmail.com')).toBeNull();
  });
});

describe('Claude reader', () => {
  const today = '2026-10-21';
  it('reads unfamiliar agencies, normalising dates and pay with the shared code', async () => {
    const ask = fake(answer());
    const read = await readEmail(
      email('Sam <sam@wave.com.au>', 'ED locums', 'Mackay Base ED SRMO 3–17 Jan $165/hr + super'),
      { claude: true, today, ask },
    );
    expect(ask).toHaveBeenCalledOnce();
    expect(read.reader).toBe('claude');
    expect(read.agency).toBe('Wavelength');
    expect(read.cost).toBe(0.002);
    // The newsletter row has no grade or dates, so it is dropped.
    expect(read.vacancies).toHaveLength(1);
    expect(read.vacancies[0]).toMatchObject({
      hospital: 'Mackay Base Hospital',
      state: 'QLD',
      grade: 'SRMO',
      specialty: 'Emergency medicine',
      start: '2027-01-03',
      end: '2027-01-17',
      amount: 165,
      basis: 'hour',
      super: 'additional',
      flights: 'included',
      missing: [],
    });
    expect(read.vacancies[0].notes.join(' ')).toMatch(/Year inferred/);
    expect(read.vacancies[0].notes.join(' ')).toMatch(/Read by Claude/);
  });
  it('leaves known layouts to the built-in readers', async () => {
    const ask = fake(answer());
    const read = await readEmail(
      email(
        'Jo <info@connect.medrecruit.com>',
        'RMO Jobs',
        '<div><h3>NSW</h3><div><strong>Wattleford</strong> MED RMO | 29 Jan–5 Feb | $150 p/h</div></div>',
      ),
      { claude: true, today, ask },
    );
    expect(ask).not.toHaveBeenCalled();
    expect(read.reader).toBe('rules');
    expect(read.vacancies).toHaveLength(1);
  });
  it('asks Claude when a known agency sends an offer the rules cannot read', async () => {
    const ask = fake(answer({ vacancies: [], kind: 'unparsed', summary: 'Permanent post.' }));
    const read = await readEmail(
      email(
        'Kim <kim@1medical.com.au>',
        '1Medical - Psychiatry Registrar | Permanent role',
        'Seeking a Psychiatry Registrar, permanent. Salary from $125,000.',
      ),
      { claude: true, today, ask },
    );
    expect(ask).toHaveBeenCalledOnce();
    expect(read).toMatchObject({ kind: 'unparsed', summary: 'Permanent post.', reader: 'claude' });
  });
  it('keeps the email for later when Claude fails or is switched off', async () => {
    const raw = email('Sam <sam@wave.com.au>', 'ED locums', 'Mackay ED SRMO 3–17 Jan');
    const failed = await readEmail(raw, {
      claude: true,
      today,
      ask: vi.fn(async () => {
        throw new Error('Claude is rate-limiting requests; try again in a minute.');
      }),
    });
    expect(failed).toMatchObject({ reader: 'rules', claudePending: true });
    expect(failed.notice).toMatch(/rate-limiting/);
    const off = await readEmail(raw, { claude: false, today, ask: fake(answer()) });
    expect(off.reader).toBe('rules');
    // Stored emails waiting for Claude are read again once Claude is available.
    const store = emptyStore();
    saveEmail(store, raw, new Date(), failed);
    expect(unreadIds(store, [raw.id], false, false)).toEqual([]);
    expect(unreadIds(store, [raw.id], false, true)).toEqual([raw.id]);
  });
  it('reads pasted text and screenshots into an inbox record', async () => {
    const ask = fake(answer({ transcript: 'Mackay Base ED SRMO 3–17 Jan $165/hr + super' }));
    const { raw, read } = await readPasted(
      { text: '', images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] },
      new Date('2026-10-21T00:00:00Z'),
      ask,
    );
    expect(ask).toHaveBeenCalledWith('', [{ mediaType: 'image/jpeg', data: 'AAAA' }]);
    expect(raw.id).toMatch(/^paste-/);
    expect(read).toMatchObject({ agency: 'Example Locums', gmailUrl: '', kind: 'offers' });
    expect(read.body).toContain('Mackay Base');
    const store = emptyStore();
    const saved = saveEmail(store, raw, new Date('2026-10-21T00:00:00Z'), read, 'paste');
    expect(saved.email.origin).toBe('paste');
    expect(saved.added).toBe(1);
    expect(store.listings[0]).toMatchObject({
      sourceId: 'email',
      facilityName: 'Mackay Base Hospital',
    });
  });
});

describe('Claude API call', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.RADAR_SECRETS_DIR = mkdtempSync(path.join(tmpdir(), 'radar-secrets-'));
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000000000000000';
  });
  afterEach(() => {
    process.env = { ...env };
  });
  it('forces the recording tool, validates the answer and prices the call', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('claude-haiku-5-5');
      expect(body.tool_choice).toEqual({ type: 'tool', name: 'record_advert' });
      expect((init?.headers as Record<string, string>)['x-api-key']).toMatch(/^sk-ant-/);
      return new Response(
        JSON.stringify({
          content: [{ type: 'tool_use', name: 'record_advert', input: answer() }],
          usage: { input_tokens: 6000, output_tokens: 2000 },
        }),
      );
    });
    const result = await askClaude('advert text', [], fetcher as unknown as typeof fetch);
    expect(result.answer.vacancies).toHaveLength(2);
    expect(result.cost).toBeCloseTo((6000 * 0.1 + 2000 * 0.5) / 1e6);
  });
  it('explains a rejected key and a missing key', async () => {
    const rejected = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 }),
    );
    await expect(askClaude('x', [], rejected as unknown as typeof fetch)).rejects.toThrow(
      /rejected the API key/,
    );
    delete process.env.ANTHROPIC_API_KEY;
    await expect(askClaude('x')).rejects.toThrow(/Anthropic API key/);
  });
});

describe('Claude accuracy check', () => {
  it('compares Claude with the built-in readers vacancy by vacancy', async () => {
    const { checkClaude } = await import('@/server/email/claude-check');
    const raw = email(
      'Jo <info@connect.medrecruit.com>',
      'RMO Jobs',
      '<div><h3>NSW</h3><div><strong>Wattleford</strong> MED RMO | 29 Jan–5 Feb | $150 p/h</div><div>SURG RMO | 21–28 Nov | $110 p/h</div></div>',
    );
    const row = answer().vacancies[0];
    const ask = fake(
      answer({
        vacancies: [
          {
            ...row,
            hospital: '',
            town: 'Wattleford',
            state: 'NSW',
            role: 'MED RMO',
            dates: '29 Jan–5 Feb',
            rate: '$150 p/h',
          },
          {
            ...row,
            hospital: '',
            town: 'Wattleford',
            state: 'NSW',
            role: 'SURG RMO',
            dates: '21–28 Nov',
            rate: '$120 p/h',
          },
        ],
      }),
    );
    const result = await checkClaude([raw], ask);
    expect(result).toMatchObject({ emails: 1, expected: 2, claude: 2, matched: 1 });
    expect(result.problems[0].missed[0]).toMatch(/SURG RMO/);
  });
});
