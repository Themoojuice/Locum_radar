import { describe, expect, it } from 'vitest';
import { parseGmailMessage } from '../src/server/acquisition/gmail';
function message(text: string, html?: string) {
  return {
    id: 'fixture',
    internalDate: String(Date.UTC(2026, 9, 17)),
    payload: {
      headers: [
        { name: 'From', value: 'Recruiter <jobs@1medical.com.au>' },
        { name: 'Subject', value: 'Locum registrar opportunities – mental health' },
      ],
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64url') } },
        ...(html
          ? [{ mimeType: 'text/html', body: { data: Buffer.from(html).toString('base64url') } }]
          : []),
      ],
    },
  };
}
describe('Gmail recruiter structure', () => {
  it('uses HTML table rows even when the plain alternative is unhelpful', () => {
    const html =
      '<table><tr><th>State</th><th>Start Date</th><th>End Date</th><th>Shifts</th><th>Hospital</th><th>Job Title</th><th>Pay rate</th></tr>' +
      ['A', 'B']
        .map(
          (name) =>
            `<tr><td>NSW</td><td>Monday, 19 October 2026</td><td>Wednesday, 21 October 2026</td><td>0800-1700</td><td>${name} Hospital</td><td>Gen Med Registrar</td><td>$180 p/h + super</td></tr>`,
        )
        .join('') +
      '</table>';
    const rows = parseGmailMessage(
      message('Please see the locum table.', html),
      '',
      'gmail-label',
      true,
      ['@1medical.com.au'],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].extractions[0].draft.compensation?.amount).toBe(180);
    expect(rows[0].extractions[0].draft.rawText).toContain(
      'Sender: Recruiter <jobs@1medical.com.au>',
    );
    expect(rows.every((r) => r.emailScreen?.status === 'offer')).toBe(true);
    expect(rows[0].publishedAt).toBe('2026-10-17T00:00:00.000Z');
  });
  it('splits placements and alternative date ranges without guessing ASAP', () => {
    const rows = parseGmailMessage(
      message(
        'Victoria\nPosition: Registrar\nUnit: Community\nDates: 02.11.26 - 29.01.27\nRate: $160 per hour\n\nQLD\nPosition: PHO\nUnit: Community\nDates: ASAP - 29.11.26\nDates: 19.12.26 - 03.01.27\nRate: $1, 025 per day',
      ),
      '',
      'gmail-label',
      true,
      ['@1medical.com.au'],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].extractions[0].draft.startDate).toBe('2026-11-02');
    expect(rows[1].extractions[0].draft.startDate).toBeUndefined();
    expect(rows[2].extractions[0].draft.compensation?.amount).toBe(1025);
    expect(rows[0].extractions[0].draft.specialty).toBe('Psychiatry');
  });
  it('still holds structured emails from unapproved senders', () => {
    const rows = parseGmailMessage(
      message('TAS\nPosition: Registrar\nDates: 02.11.26 - 29.01.27\nRate: $160 per hour'),
      '',
      'gmail-label',
      true,
      [],
    );
    expect(rows[0].emailScreen?.status).toBe('review');
  });
});
