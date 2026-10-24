import { describe, expect, it } from 'vitest';
import { parseDates } from '@/server/email/dates';
import { readRecruiterEmail, type RawEmail } from '@/server/email/recruiter-email';
import { saveEmail, vacancyKey } from '@/server/email/inbox';
import { inboxQuery, linkInboxImports } from '@/domain/inbox';
import { emptyStore } from '@/domain/seed';

/*
 * Fictional emails that copy the layouts Medrecruit and 1Medical send
 * (names, places and figures changed). Each layout has its own parser.
 */
const mr = 'Jo Example <info@connect.medrecruit.com>';
const one = (n: string) => `${n} <${n.split(' ')[0].toLowerCase()}@1medical.com.au>`;
const mrFoot =
  '\n\nref:0038u000XYZKind regards,\n\nJo Example\n\nhttps://click.connect.medrecruit.com/?qs=x\nManage subscriptions or unsubscribe';
const head =
  ' To view this email as a web page, click\nhttps://click.connect.medrecruit.com/?qs=x\nhere.\nHi Sam,\n\n';
const sig =
  '\n\nKind regards,\n\nOnboarding by\nAlex Example\nThis information transmitted is intended';
const email = (
  id: string,
  from: string,
  subject: string,
  sentAt: string,
  text: string,
): RawEmail => ({
  id,
  threadId: id,
  from,
  subject,
  sentAt: new Date(sentAt),
  text,
  html: '',
});
const read = (e: RawEmail) => readRecruiterEmail(e, '2026-10-21');

const digest = email(
  'digest00001',
  mr,
  'RMO Jobs This Week!',
  '2026-10-19T23:00:00Z',
  head +
    `<div><h3><strong>NSW</strong></h3><div><strong>Wattleford</strong> MED RMO | 29 Jan–5 Feb | $150 p/h</div><div>SURG RMO | 21–28 Oct | $110 p/h</div><div>PAEDS RMO | 13 Nov, 30 Nov | $90 p/h</div><div><strong>Banksia Bay</strong> ED SRMO | 25 Oct–15 Nov | $130–$180 p/h</div><h3><strong>QLD</strong></h3><div><strong>Coral Point</strong> ORTHO RMO | ASAP–17 Jan | $771 p/day</div><div><strong>Mango Hill</strong> CCS NIGHT RMO | 22, 29 Oct; 7, 10–14 Nov | $150 p/h</div><h3>SA</h3><div><strong>Saltbush</strong></div><div>Med SRMO | 16 Nov - 1 Feb | $1100/day ( x 2 positions available)</div></div>` +
    mrFoot,
);
const table = email(
  'table000001',
  one('Pat Sample'),
  '1Medical - Locum RMO/SRMO/Registrar Opportunities',
  '2026-10-15T07:00:00Z',
  `Hi Sam,\n\nState\nStart Date\nEnd Date\nShifts\nHospital\nJob Title\nPay rate\nNEW SOUTH WALES\nNSW\nMonday, 2 November 2026\nFriday, 13 November 2026\nDay shifts\nWattleford Base Hospital\nGen Med RMO\n$120 p/h + super\nNSW\nMonday, 30 November 2026\nSaturday, 3 January 2026\nMixed roster\nRiverbend Hospital\nGen Med Registrar\n$1400 p/d + super\nQLD\nMonday, 26 October 2026\nSunday, 22 November 2026\nMixed roster\nCoral Point Hospital\nGen Med RMO\nenquire within\n\nBest regards,\n\nOnboarding by\nPat Sample`,
);
const blocks = email(
  'blocks00001',
  one('Lee Sample'),
  '1Medical - short / long term mental health locums',
  '2026-10-13T00:00:00Z',
  ` Hi Sam,\n\nVictoria\n\nPosition: Registrar\nUnit: Inpatient\nDates: 02.11.26 - 29.01.27\nRate: $160 per hour\nAccommodation - Included\n\nQLD\n\nPosition: PHO\nUnit: Community\nDates: ASAP - 29.11.26\nDates: 19.12.26 - 03.01.27\nRate: $1, 025 per day\n\nIf you are available for the above roles, please get in touch.${sig}`,
);
const prose = email(
  'prose000001',
  one('Alex Example'),
  '1Medical - NT surgical RMO vacancy',
  '2026-10-06T05:00:00Z',
  `Hi Sam,\nRedgum Hospital in NT are seeking a Surgical RMO or HMO\n\nPeriod: 2 November 2026 - 29 January 2027\n\nRates:\n$150/hr for RMO | $180/hr for HMO\nFlights, car hire, and accommodation reimbursed.\n\nRequirements:\n  * PGY3+${sig}`,
);
const shifts = email(
  'shifts00001',
  mr,
  'ED SRMO HIGH RATES!',
  '2026-10-18T22:00:00Z',
  head +
    `<div><div>Wattleford Hospital has several <strong>Emergency Department SRMO locum shifts</strong> available.</div><div><strong>Rates:</strong></div><div>Day shifts: $130/hr</div><div>Night shifts: $180/hr</div><div><strong>October</strong></div><div>Fri 23 Oct: 1400–2400 – $160/hr</div><div>Wed 28 Oct: 2230–0830 – $180/hr</div><div><strong>November</strong></div><div>Fri 6 Nov: 0800–1830 (2 shifts) and 2230–0830 (2 shifts)</div></div>` +
    mrFoot,
);
const roster = email(
  'roster00001',
  mr,
  'RMO RELIEF SHIFTS!',
  '2026-09-10T22:00:00Z',
  head +
    `<div><div><strong>Seagull Heads QLD – Relief RMO Locum Vacancy</strong></div><div><strong>Travel and accommodation provided.</strong></div><div><strong> $100 per hour – day shifts</strong></div><div><strong>Available roster:</strong></div><div>2 Oct – WARD A – 0800–1630</div><div> 3 Oct – OFF</div><div> 14 Nov – JMO 4 – 0700–1500</div></div>` +
    mrFoot,
);
const lateRates = email(
  'late0000001',
  mr,
  'ED RMO & REG ASAP-December!',
  '2026-09-15T03:00:00Z',
  head +
    `<div><div><strong>Redgum Hospital, QLD – ED RMO &amp; PHO/REG</strong></div><div><strong>Dates:</strong><span> ASAP – 6 December 2026</span></div><div><strong>Travel, accommodation and hire car provided</strong></div><div><strong>RMO:</strong><span> $849 per shift</span></div><div><strong>PHO/REG:</strong><span> $1,018.87–$1,103.77 per shift</span></div><div><em>Rates inclusive of super.</em></div></div>` +
    mrFoot,
);
const hotJobs = email(
  'hotjobs0001',
  mr,
  'HOTTEST JOBS IN AUS!',
  '2026-10-16T06:00:00Z',
  head +
    `<div><div><strong>Weekly Hot Jobs</strong></div><div>Click the link below to explore locum opportunities.</div><div>Call Jo on 07 5555 0000 to discuss.</div></div><table><tr><td><a href="https://example-hotjobs.netlify.app/"><img src="x.png" alt=""></a></td></tr></table>` +
    mrFoot,
);
const reminder = email(
  'remind00001',
  mr,
  'Reminder: AHPRA Renewal Deadline Approaching',
  '2026-09-15T02:00:00Z',
  head +
    `<div><div>Hi Dr Sample, the renewal deadline is 30 September. Renew online.</div></div>` +
    mrFoot,
);
const permanent = email(
  'perm0000001',
  one('Kim Sample'),
  '1Medical - Psychiatry Registrars | Permanent roles | Start ASAP or Feb Intake',
  '2026-10-01T04:00:00Z',
  `Hi Sam,\n\nI'm seeking two Psychiatry Registrars.\n\n  * Senior Psychiatry Registrar, permanent (not locum)\n  * Salary starting from $125,000+\n\nRegards,\n\nKim`,
);

describe('recruiter email dates', () => {
  const anchor = new Date('2026-10-19T00:00:00Z');
  it('infers years, ranges and lists', () => {
    expect(parseDates('29 Jan–5 Feb', anchor)).toMatchObject({
      start: '2027-01-29',
      end: '2027-02-05',
      yearInferred: true,
    });
    expect(parseDates('22, 29 Oct; 7, 10–14 Nov', anchor)?.blocks).toHaveLength(4);
    expect(
      parseDates('Monday, 19 October 2026 - Wednesday, 21 October 2026', anchor),
    ).toMatchObject({
      start: '2026-10-19',
      end: '2026-10-21',
      blocks: [{ start: '2026-10-19', end: '2026-10-21' }],
    });
    expect(parseDates('02.11.26 - 29.01.27', anchor)).toMatchObject({
      start: '2026-11-02',
      end: '2027-01-29',
    });
  });
  it('ignores pay, times and multipliers', () => {
    expect(parseDates('$1, 025 per day x 2 · 0800–1630 · 12% super', anchor)).toBeNull();
    expect(parseDates('Mon–Fri 0800–1630', anchor)).toBeNull();
  });
  it('reads ASAP from the email date but never alone', () => {
    expect(parseDates('ASAP – 17 Jan', anchor)).toMatchObject({ start: '2026-10-19', asap: true });
    expect(parseDates('Start ASAP', anchor)).toBeNull();
  });
});

describe('recruiter email layouts', () => {
  it('reads the Medrecruit weekly digest', () => {
    const r = read(digest);
    expect(r.kind).toBe('offers');
    expect(r.format).toBe('medrecruit-digest');
    expect(r.vacancies).toHaveLength(7);
    const [wattle, surg, paeds, banksia, coral, mango, saltbush] = r.vacancies;
    expect(wattle).toMatchObject({
      town: 'Wattleford',
      state: 'NSW',
      specialty: 'General medicine',
      grade: 'RMO',
      start: '2027-01-29',
      amount: 150,
      basis: 'hour',
    });
    expect(surg).toMatchObject({ town: 'Wattleford', grade: 'RMO', start: '2026-10-21' });
    expect(paeds.blocks).toHaveLength(2);
    expect(banksia).toMatchObject({ grade: 'SRMO', amount: 130 });
    expect(banksia.notes.join(' ')).toMatch(/range/);
    expect(coral).toMatchObject({ state: 'QLD', start: '2026-10-19', basis: 'day' });
    expect(mango.blocks.length).toBeGreaterThan(3);
    expect(saltbush).toMatchObject({ town: 'Saltbush', state: 'SA', positions: 2, amount: 1100 });
  });
  it('reads the 1Medical table and repairs an end year before the start', () => {
    const r = read(table);
    expect(r.format).toBe('1medical-table');
    expect(r.vacancies).toHaveLength(3);
    expect(r.vacancies[0]).toMatchObject({
      hospital: 'Wattleford Base Hospital',
      state: 'NSW',
      super: 'additional',
      start: '2026-11-02',
      end: '2026-11-13',
    });
    expect(r.vacancies[1]).toMatchObject({ grade: 'Registrar', end: '2027-01-03', basis: 'day' });
    expect(r.vacancies[1].notes.join(' ')).toMatch(/before the start/);
    expect(r.vacancies[2]).toMatchObject({ amount: null });
  });
  it('reads labelled blocks with several date lines', () => {
    const r = read(blocks);
    expect(r.format).toBe('labelled-blocks');
    expect(r.vacancies).toHaveLength(3);
    expect(r.vacancies[0]).toMatchObject({
      state: 'VIC',
      grade: 'Registrar',
      specialty: 'Psychiatry',
      accommodation: 'included',
      missing: ['hospital'],
    });
    expect(r.vacancies[1]).toMatchObject({ state: 'QLD', grade: 'PHO', amount: 1025 });
  });
  it('splits "RMO or HMO" prose into one vacancy per rate', () => {
    const r = read(prose);
    expect(r.format).toBe('seeking-prose');
    expect(r.vacancies.map((v) => [v.role, v.amount])).toEqual([
      ['Surgical RMO', 150],
      ['Surgical HMO', 180],
    ]);
    expect(r.vacancies[0]).toMatchObject({
      hospital: 'Redgum Hospital',
      state: 'NT',
      flights: 'included',
    });
  });
  it('groups single-day shifts into one vacancy', () => {
    const r = read(shifts);
    expect(r.vacancies).toHaveLength(1);
    expect(r.vacancies[0]).toMatchObject({
      hospital: 'Wattleford Hospital',
      grade: 'SRMO',
      specialty: 'Emergency medicine',
      start: '2026-10-23',
      end: '2026-11-06',
      amount: 130,
    });
    expect(r.vacancies[0].blocks).toHaveLength(3);
  });
  it('skips OFF days and reads ward names as part of a roster line', () => {
    const r = read(roster);
    expect(r.vacancies).toHaveLength(1);
    expect(r.vacancies[0]).toMatchObject({
      role: 'Relief RMO',
      state: 'QLD',
      start: '2026-10-02',
      end: '2026-11-14',
      accommodation: 'included',
    });
    expect(r.vacancies[0].blocks).toHaveLength(2);
  });
  it('prices each grade from rates listed after the dates', () => {
    const r = read(lateRates);
    expect(r.vacancies.map((v) => [v.grade, v.amount, v.basis, v.super])).toEqual([
      ['RMO', 849, 'shift', 'included'],
      ['PHO', 1018.87, 'shift', 'included'],
    ]);
  });
  it('sets aside link-only, admin and permanent emails', () => {
    expect(read(hotJobs)).toMatchObject({ kind: 'link', vacancies: [] });
    expect(read(hotJobs).links[0].url).toContain('netlify');
    expect(read(reminder)).toMatchObject({ kind: 'other', vacancies: [] });
    expect(read(permanent)).toMatchObject({ kind: 'unparsed', permanent: true });
  });
});

describe('inbox pipeline', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  it('adds complete vacancies to the feed once, and links hand-completed ones', () => {
    const store = emptyStore();
    const first = [digest, table, blocks, prose].map((e) => saveEmail(store, e, now));
    const added = first.reduce((n, r) => n + r.added, 0);
    expect(added).toBeGreaterThan(8);
    expect(store.inbox).toHaveLength(4);
    expect(store.listings.every((l) => l.sourceId === 'email')).toBe(true);
    // RMO and HMO both file as RMO: one feed entry, no duplicate review.
    const redgum = store.inbox.find((e) => e.id === prose.id)!.vacancies;
    expect(redgum[0].opportunityId).toBe(redgum[1].opportunityId);
    expect(store.reviews.filter((r) => r.kind === 'possible duplicate')).toHaveLength(0);
    // Reading again changes nothing.
    const again = [digest, table, blocks, prose].map((e) => saveEmail(store, e, now));
    expect(again.reduce((n, r) => n + r.added, 0)).toBe(0);
    expect(store.opportunities).toHaveLength(added);
    // A vacancy without a hospital waits for the user, then links.
    const block = store.inbox.find((e) => e.id === blocks.id)!.vacancies[0];
    expect(block.opportunityId).toBeNull();
    linkInboxImports(store.inbox, [{ externalId: `inbox-${block.id}`, opportunityId: 'opp-x' }]);
    expect(block.opportunityId).toBe('opp-x');
  });
  it('keys the same vacancy in two weekly emails to one listing', () => {
    const store = emptyStore();
    saveEmail(store, digest, now);
    const next = { ...digest, id: 'digest00002', sentAt: new Date('2026-10-20T00:00:00Z') };
    expect(saveEmail(store, next, now).added).toBe(0);
    const a = store.inbox[0],
      b = store.inbox[1];
    expect(vacancyKey(a, a.vacancies[0])).toBe(vacancyKey(b, b.vacancies[0]));
  });
  it('searches only the recruiters, excluding sent and trash', () => {
    expect(inboxQuery(30)).toBe(
      'from:(medrecruit.com OR 1medical.com.au) newer_than:30d -in:trash -in:spam -in:sent -in:drafts',
    );
  });
});
