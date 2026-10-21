import type { Store } from '@/domain/model';
import type { EmailVacancy } from '@/domain/inbox';
import { agencyFor } from '@/domain/agencies';
import { askClaude, emailFromAnswer, emailPrompt } from './claude-reader';
import { readRecruiterEmail, type RawEmail } from './recruiter-email';

/*
 * Accuracy check: Claude re-reads emails the built-in readers already handle
 * (checked by hand against real Medrecruit and 1Medical emails), and the two
 * readings are compared vacancy by vacancy. It shows how far Claude can be
 * trusted on agencies that have no built-in reader.
 */
const key = (v: EmailVacancy) =>
  [v.start, v.end, v.grade, v.amount === null ? '' : Math.round(v.amount)].join('|');
const label = (v: EmailVacancy) =>
  `${v.hospital || v.town || '?'} · ${v.role} · ${v.start ?? '?'}–${v.end ?? '?'} · ${v.amount ? `$${v.amount}/${v.basis}` : 'no rate'}`;

export function compareReadings(expected: EmailVacancy[], actual: EmailVacancy[]) {
  const pool = actual.map(key);
  let matched = 0;
  const missed: string[] = [];
  for (const v of expected) {
    const i = pool.indexOf(key(v));
    if (i >= 0) {
      matched++;
      pool.splice(i, 1);
    } else missed.push(label(v));
  }
  const extra = actual.filter((v) => pool.includes(key(v))).map(label);
  return { matched, missed, extra };
}

/** Recent stored emails with built-in readings, newest first and one per layout where possible. */
export function checkCandidates(store: Store, limit = 6) {
  const known = store.inbox
    .filter(
      (e) =>
        e.origin !== 'paste' &&
        e.kind === 'offers' &&
        e.reader !== 'claude' &&
        agencyFor(e.fromAddress)?.rules,
    )
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const bySubject = new Map<string, string>();
  for (const e of known) {
    const layout = e.subject.replace(/\d+/g, '').slice(0, 30);
    if (!bySubject.has(layout)) bySubject.set(layout, e.id);
  }
  const ids = [...bySubject.values()];
  for (const e of known) if (!ids.includes(e.id)) ids.push(e.id);
  return ids.slice(0, limit);
}

export async function checkClaude(raws: RawEmail[], ask: typeof askClaude = askClaude) {
  let expected = 0,
    matched = 0,
    claudeCount = 0,
    cost = 0;
  const problems: { subject: string; missed: string[]; extra: string[] }[] = [];
  for (const raw of raws) {
    const today = new Date().toISOString().slice(0, 10);
    const rules = readRecruiterEmail(raw, today);
    const { answer, cost: spent } = await ask(emailPrompt(raw));
    const claude = emailFromAnswer(raw, answer, today);
    cost += spent;
    const result = compareReadings(rules.vacancies, claude.vacancies);
    expected += rules.vacancies.length;
    claudeCount += claude.vacancies.length;
    matched += result.matched;
    if (result.missed.length || result.extra.length)
      problems.push({
        subject: raw.subject,
        missed: result.missed.slice(0, 5),
        extra: result.extra.slice(0, 5),
      });
  }
  return { emails: raws.length, expected, claude: claudeCount, matched, cost, problems };
}
export type ClaudeCheck = Awaited<ReturnType<typeof checkClaude>>;
