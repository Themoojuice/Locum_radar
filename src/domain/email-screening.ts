export interface EmailScreen {
  status: 'offer' | 'review' | 'ignore';
  reason: string;
}
export function screenEmail(
  subject: string,
  body: string,
  sender: string,
  approved: string[] = [],
  labelled = false,
): EmailScreen {
  const address = (sender.match(/<([^<>]+)>/)?.[1] || sender).trim().toLowerCase();
  const trusted =
    labelled ||
    approved.some((value) => {
      const v = value.trim().toLowerCase();
      return v.startsWith('@') ? address.endsWith(v) && address.includes('@') : address === v;
    });
  // Do not qualify an unrelated reply solely from a quoted historical advert.
  const text = (subject + '\n' + body.split(/\n(?:On .+wrote:|From:|>)/i)[0]).slice(0, 100000);
  const role =
    /\b(registrar|resident medical officer|rmo|sho|general practitioner|gp|doctor|physician|surgeon|anaesthetist|psychiatrist|paediatrician|consultant|smo|facem)\b/i.test(
      text,
    );
  const hiring =
    /\b(locum(?:s| tenens)?|vacanc(?:y|ies)|shifts? available|seeking|recruiting|cover(?: required)?|job opportunit(?:y|ies)|positions? available)\b/i.test(
      text,
    );
  const rate =
    /\$\s*[\d,]+(?:\.\d+)?\s*(?:\/|per\s*|a\s*)?(?:hour|hr|day|shift|week)|\b(?:hourly|daily) rate\b/i.test(
      text,
    );
  const dates =
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(
      text,
    );
  const location =
    /\b(hospital|clinic|medical centre|health service|QLD|NSW|VIC|TAS|NT|SA|WA|ACT)\b/i.test(text);
  const facts = Number(rate) + Number(dates) + Number(location);
  if (!role || !hiring)
    return {
      status: 'ignore',
      reason: 'No clear medical recruitment offer; keyword matches alone are insufficient.',
    };
  if (!trusted)
    return {
      status: 'review',
      reason:
        'Potential medical offer, but the sender is not approved. Add its exact email/domain to your recruiter list or use a curated recruitment label.',
    };
  if (facts < 2)
    return {
      status: 'review',
      reason:
        'Not enough vacancy details: confirm the role, dates/location and advertised terms before adding it.',
    };
  return {
    status: 'offer',
    reason:
      'Recruitment context and vacancy details found in a selected recruitment label or approved sender email. Confirm availability with the recruiter.',
  };
}

export function screenStoredEmail(
  item: { rawText: string | null; draft: { title?: string; rawText?: string | null } | null },
  approved: string[] = [],
  labelled = false,
) {
  const raw = item.rawText || item.draft?.rawText || '';
  const sender = raw.match(/^Sender:\s*(.+)$/im)?.[1] || '';
  return screenEmail(item.draft?.title || '', raw, sender, approved, labelled);
}
