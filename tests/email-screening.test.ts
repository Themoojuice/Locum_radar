import { it, expect } from 'vitest';
import { screenEmail, screenStoredEmail } from '@/domain/email-screening';
import { jobPool } from '@/domain/job-pool';
import { emptyStore } from '@/domain/seed';
const body = 'Locum registrar vacancy at Cairns Hospital, 21 October, $180 per hour';
it('does not treat a keyword in personal mail as an offer', () => {
  expect(
    screenEmail('Dinner', 'How is locum life? Dinner next week?', 'friend@example.com').status,
  ).toBe('ignore');
});
it('requires sender approval even when the content resembles an offer', () => {
  expect(screenEmail('Registrar vacancy', body, 'Friend <friend@example.com>').status).toBe(
    'review',
  );
});
it('requires vacancy evidence even for approved recruiters', () => {
  expect(
    screenEmail('Locum registrar', 'Are you looking for locum roles?', 'jobs@agency.com', [
      '@agency.com',
    ]).status,
  ).toBe('review');
});
it('accepts supported offers from approved addresses or a curated label', () => {
  expect(
    screenEmail('Registrar vacancy', body, 'Jobs <jobs@agency.com>', ['@agency.com']).status,
  ).toBe('offer');
  expect(screenEmail('Registrar vacancy', body, 'jobs@agency.com', [], true).status).toBe('offer');
  expect(
    screenEmail('Registrar vacancy', body, 'jobs@fakeagency.com', ['@agency.com']).status,
  ).toBe('review');
});
it('does not qualify an unrelated reply from a quoted advert', () => {
  expect(
    screenEmail('Hello', 'See you soon\nOn Monday recruiter wrote:\n' + body, 'jobs@agency.com', [
      '@agency.com',
    ]).status,
  ).toBe('ignore');
});
it('screens stored records and excludes held emails from the default pool', () => {
  const store = emptyStore();
  const emailScreen = screenStoredEmail({
    rawText: 'Sender: friend@example.com\n' + body,
    draft: { title: 'Vacancy' },
  });
  store.reviews.push({
    id: 'held',
    sourceId: 'email',
    kind: 'extraction',
    opportunityId: null,
    candidateId: null,
    resolved: false,
    reason: emailScreen.reason,
    draft: { title: 'Vacancy' },
    rawText: body,
    emailScreen,
  });
  expect(jobPool(store)).toHaveLength(0);
  expect(jobPool(store, undefined, true)).toHaveLength(1);
});
