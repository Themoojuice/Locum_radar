import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { transaction, readStore } from './database';
import { extractJobPostings, fromLabelledBlock, type Extraction } from './extraction';
import type { JsonBlock, SourceAdapter } from './adapters/json-sources';
import { sourceAdapters } from './adapters/registry';
import { log, stopRequested } from './progress';
import { fingerprint, ingest } from '@/domain/ingestion';
import { listingInputSchema, type CollectionRun, type Profile, type Store } from '@/domain/model';

const allowed = new Set([
  'medrecruit.medworld.com',
  'ochrerecruitment.com',
  ...Object.values(sourceAdapters).flatMap((a) => a.hosts),
]);
export function allowedSourceUrl(url: string) {
  const u = new URL(url);
  return (
    u.protocol === 'https:' &&
    allowed.has(u.hostname) &&
    !u.username &&
    !u.password &&
    (!u.port || u.port === '443')
  );
}
export function publicIpv4(address: string) {
  const p = address.split('.').map(Number);
  return (
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    ![0, 10, 127].includes(p[0]) &&
    p[0] < 224 &&
    !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) &&
    !(p[0] === 192 && (p[1] === 168 || p[1] === 0 || p[1] === 2)) &&
    !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) &&
    !(p[0] === 198 && (p[1] === 18 || p[1] === 19 || p[1] === 51)) &&
    !(p[0] === 203 && p[1] === 0)
  );
}
async function fetchPage(
  url: string,
  accept = 'text/html,text/plain',
): Promise<{ status: number; text: string }> {
  if (!allowedSourceUrl(url))
    throw new Error('Collector URL is outside the fixed source allowlist');
  const host = new URL(url).hostname,
    addresses = await lookup(host, { family: 4, all: true });
  if (!addresses.length || addresses.some((a) => !publicIpv4(a.address)))
    throw new Error('Source resolved to a non-public address');
  // Pin the validated address so a second DNS resolution cannot reach private services.
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        family: 4,
        headers: {
          'User-Agent': 'LocumRadar/0.1 (private research; manual review)',
          Accept: accept,
        },
        lookup: (_host, _options, callback) => callback(null, addresses[0].address, 4),
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 300 && (res.statusCode ?? 500) < 400) {
          res.resume();
          reject(new Error('Redirect requires source configuration review'));
          return;
        }
        const buffers: Buffer[] = [];
        let length = 0;
        res.on('data', (data: Buffer) => {
          length += data.length;
          if (length > 2000000) {
            res.destroy();
            reject(new Error('Source response exceeds 2 MB'));
          } else buffers.push(data);
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 500, text: Buffer.concat(buffers).toString('utf8') }),
        );
        res.on('error', reject);
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error('Source timed out')));
    req.on('error', reject);
  });
}

// Fail closed: this deliberately conservative gate accepts only a robots file with
// no applicable exclusions. More complex rules need an adapter-specific review.
export function robotsAllows(text: string) {
  if (!/user-agent\s*:/i.test(text)) return false;
  let relevant = false,
    sawRule = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) {
      relevant = false;
      sawRule = false;
      continue;
    }
    const [key, ...rest] = line.split(':'),
      value = rest.join(':').trim();
    if (key.toLowerCase() === 'user-agent') {
      if (sawRule) {
        relevant = false;
        sawRule = false;
      }
      relevant ||= value === '*' || /locumradar/i.test(value);
    } else {
      sawRule = true;
      if (
        relevant &&
        ((key.toLowerCase() === 'disallow' && value) ||
          (key.toLowerCase() === 'crawl-delay' && Number(value) > 0))
      )
        return false;
    }
  }
  return true;
}
/** Adds new extraction candidates to the review queue; returns how many were new. */
export function queueExtractions(s: Store, sourceId: string, results: Extraction[]) {
  let added = 0;
  for (const result of results) {
    const id = `extract-${fingerprint({ source: sourceId, raw: result.draft.rawText })}`;
    if (s.reviews.some((r) => r.id === id)) continue;
    s.reviews.push({
      id,
      kind: 'extraction',
      opportunityId: null,
      candidateId: null,
      reason: result.issues.join(' '),
      resolved: false,
      draft: result.draft,
      rawText: result.draft.rawText || '',
      sourceId,
    });
    added++;
  }
  return added;
}
/**
 * Robots rules per RFC 9309: the group naming LocumRadar wins over `*`; groups
 * for the same agent are merged; the longest matching rule decides, and Allow
 * wins a tie. Returns null when the text is not a robots file.
 */
export function parseRobots(text: string) {
  if (!/user-agent\s*:/i.test(text) || /<html/i.test(text)) return null;
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[]; delay: number }[] = [];
  let current: (typeof groups)[number] | null = null,
    lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim().toLowerCase(),
      value = line.slice(at + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [], delay: 0 }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if ((key === 'allow' || key === 'disallow') && value)
      current.rules.push({ allow: key === 'allow', path: value });
    if (key === 'crawl-delay' && Number(value) > 0)
      current.delay = Math.max(current.delay, Number(value) * 1000);
  }
  const own = groups.filter((g) => g.agents.some((a) => a && 'locumradar'.includes(a) && a !== '*'));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  const rules = chosen.flatMap((g) => g.rules);
  const delay = Math.max(0, ...chosen.map((g) => g.delay));
  const compiled = rules.map((r) => ({
    ...r,
    length: r.path.replace(/\*/g, '').length,
    re: new RegExp(
      '^' +
        r.path
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\$$/, '$'),
    ),
  }));
  const allowed = (path: string) => {
    let best: (typeof compiled)[number] | null = null;
    for (const r of compiled)
      if (r.re.test(path) && (!best || r.length > best.length || (r.length === best.length && r.allow)))
        best = r;
    return !best || best.allow;
  };
  return { allowed, delay };
}
/**
 * Path-aware robots check for adapters with recorded permission: the crawl
 * delay in milliseconds, or null when any needed path is disallowed.
 */
export function robotsDelayFor(text: string, paths: string[]): number | null {
  const robots = parseRobots(text);
  if (!robots) return null;
  return paths.every((p) => robots.allowed(p)) ? robots.delay : null;
}

const knownExternalIds = (s: Store, sourceId: string) =>
  new Set([
    ...s.listings.filter((l) => l.sourceId === sourceId).map((l) => l.externalId),
    ...s.reviews.filter((r) => r.sourceId === sourceId).map((r) => r.draft?.externalId ?? ''),
  ]);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Discovery is national and cross-specialty (LR-001): nothing is skipped for
 * being outside the profile. Relevance only orders work when a source must be
 * read over several runs, so the jobs most likely to matter arrive first.
 * 3 = preferred specialty in an allowed state, 0 = excluded state.
 */
export function profileRelevance(profile: Profile, specialty: string | null, state: string | null) {
  if (state && (profile.excludedStates as string[]).includes(state)) return 0;
  if (specialty && (profile.preferredSpecialties as string[]).includes(specialty)) return 3;
  if (specialty && (profile.competentSpecialties as string[]).includes(specialty)) return 2;
  return 1;
}

/**
 * Saves a run's candidates. Records that pass validation are imported straight
 * into the feed (reconciliation still sends possible duplicates to review);
 * everything else waits in the review queue. Set COLLECTOR_AUTO_IMPORT=false to
 * review every record first.
 */
export function commitExtractions(
  s: Store,
  sourceId: string,
  results: Extraction[],
  autoImport = process.env.COLLECTOR_AUTO_IMPORT !== 'false',
) {
  const tally = { imported: 0, unchanged: 0, queued: 0 };
  for (const result of results) {
    const parsed = autoImport ? listingInputSchema.safeParse(result.draft) : null;
    if (parsed?.success) {
      try {
        const outcome = ingest(s, parsed.data);
        if (outcome.unchanged) tally.unchanged++;
        else tally.imported++;
        continue;
      } catch (error) {
        result.issues.push(`Automatic import failed: ${(error as Error).message}`);
      }
    }
    tally.queued += queueExtractions(s, sourceId, [result]);
  }
  return tally;
}
export const describeTally = (t: { imported: number; unchanged: number; queued: number }) =>
  `${t.imported} new or updated vacancies imported, ${t.unchanged} unchanged, ${t.queued} sent to Review queue.`;

/**
 * Runs one adapter. Paged adapters go newest first and stop at the first page
 * whose vacancies have all been seen before, so routine runs are short.
 */
async function runAdapter(adapter: SourceAdapter, sourceId: string, dryRun = false) {
  const store = await readStore();
  // A test run reads a handful of pages to show what the parser makes of the live site.
  const env: Record<string, string | undefined> = dryRun
    ? {
        ...process.env,
        ONEMEDICAL_DETAIL_LIMIT: '3',
        [`${sourceId.toUpperCase().replace(/\W/g, '_')}_DETAIL_LIMIT`]: '3',
        DRY_RUN: 'true',
      }
    : process.env;
  const missing = adapter.missingConfig?.(process.env);
  if (missing) throw new Error(`Needs configuration: ${missing}.`);
  let delay = Number(process.env.COLLECTOR_PAGE_DELAY_MS ?? 1500);
  let robotsAllowed: ((path: string) => boolean) | null = null;
  if (adapter.access === 'site-endpoint') {
    const robotsText = await fetchPage(adapter.robotsUrl!, 'text/plain');
    const paths =
      adapter.robotsPaths ??
      ('pageUrl' in adapter
        ? [new URL(adapter.pageUrl(1, process.env)!).pathname]
        : ['/wp-json/wp/v2/job_posts', '/doctors/jobs-board/']);
    if (robotsText.status === 200) {
      const robots = parseRobots(robotsText.text);
      if (!robots || !paths.every((p) => robots.allowed(p)))
        throw new Error('Robots rules disallow the pages this collector needs; stopped.');
      robotsAllowed = robots.allowed;
      delay = Math.max(delay, robots.delay);
    } else if (robotsText.status !== 404)
      throw new Error(`Robots file returned HTTP ${robotsText.status}; stopped conservatively.`);
  }
  const seen = knownExternalIds(store, sourceId);
  const source = store.sources.find((s) => s.id === sourceId);
  const seenUrls = new Set([
    ...store.listings.filter((l) => l.sourceId === sourceId && l.url).map((l) => l.url!),
    ...(source?.readUrls ?? []),
  ]);
  const read: string[] = [];
  const say = (text: string, level: 'info' | 'warn' | 'error' = 'info') =>
    log(sourceId, text, level);
  const get = (url: string, accept: string) => {
    // Every request, not only the first, must be allowed by the site's robots rules.
    if (robotsAllowed && !robotsAllowed(new URL(url).pathname))
      return Promise.reject(new Error('Disallowed by robots rules'));
    return fetchPage(url, accept);
  };
  let blocks: JsonBlock[] = [];
  const relevance = (specialty: string | null, state: string | null) =>
    profileRelevance(store.profile, specialty, state);
  if ('collect' in adapter) {
    blocks = await adapter.collect({
      get,
      pause: () => pause(delay),
      seen,
      seenUrls,
      markRead: (urls) => read.push(...urls),
      relevance,
      log: say,
      stopped: stopRequested,
      env,
    });
  } else {
    for (let page = 1; page <= (dryRun ? 1 : adapter.maxPages); page++) {
      if (stopRequested()) {
        say(`Stopped on request after ${page - 1} page(s).`, 'warn');
        break;
      }
      const url = adapter.pageUrl(page, process.env);
      if (!url) throw new Error('This source needs configuration (for example an API key) first.');
      if (page > 1) await pause(delay);
      let response = await fetchPage(
        url,
        adapter.format === 'html' ? 'text/html' : 'application/json',
      );
      if (response.status >= 500) {
        say(`Page ${page} returned HTTP ${response.status}; retrying once.`, 'warn');
        await pause(delay * 2);
        response = await fetchPage(
          url,
          adapter.format === 'html' ? 'text/html' : 'application/json',
        );
      }
      if (response.status !== 200)
        throw new Error(
          `Page ${page} returned HTTP ${response.status}; historical vacancies were retained.`,
        );
      let body: unknown = response.text;
      if (adapter.format !== 'html') {
        try {
          body = JSON.parse(response.text);
        } catch {
          throw new Error('Source did not return JSON. The endpoint may have changed.');
        }
      }
      const parsed = adapter.parse(body);
      blocks.push(...parsed.blocks);
      const unseen = parsed.blocks.filter(
        (b) => !seen.has(b.labelled.match(/^Listing ID: (.+)$/m)?.[1] ?? ''),
      );
      if (page === 1 || page % 10 === 0)
        say(
          `Page ${page}: ${parsed.blocks.length} locum listings, ${unseen.length} not seen before.`,
        );
      if (!parsed.hasMore) {
        say(`Reached the last page (${page}).`);
        break;
      }
      if (parsed.blocks.length > 0 && unseen.length === 0) {
        say(`Page ${page} holds nothing new; stopping early.`);
        break;
      }
      if (page === adapter.maxPages) say(`Stopped at the page limit (${page}).`, 'warn');
    }
  }
  const results: Extraction[] = [];
  for (const b of blocks) {
    const r = fromLabelledBlock(b, sourceId, `${sourceId}-adapter`, store.facilities);
    r.draft.url = b.url;
    results.push(r);
  }
  return { results, read };
}
export interface SourceTest {
  sourceId: string;
  ok: boolean;
  message: string;
  read: number;
  valid: number;
  samples: { title: string; valid: boolean; issues: string[]; fields: Record<string, string> }[];
}
/**
 * Qualification run: reads a few live pages through the same adapter, gates and
 * robots checks as collection, and reports what the parser extracted. Nothing is
 * saved and the collection interval is not consumed. Permission must still be
 * recorded, because a test is still access.
 */
export async function testSource(sourceId: string): Promise<SourceTest> {
  const store = await readStore(),
    source = store.sources.find((s) => s.id === sourceId);
  const fail = (message: string): SourceTest => ({ sourceId, ok: false, message, read: 0, valid: 0, samples: [] });
  if (!source) return fail('Unknown source.');
  const adapter = sourceAdapters[sourceId];
  if (!adapter) return fail('This source has no automatic collector yet.');
  if (source.permission !== 'approved' || !source.permissionEvidence.trim())
    return fail('Record access permission for this source first.');
  if (process.env.COLLECTOR_ENABLED !== 'true')
    return fail('Collection is switched off on this installation (COLLECTOR_ENABLED).');
  try {
    log(sourceId, `Testing ${source.name} (a few pages; nothing is saved).`);
    const { results } = await runAdapter(adapter, sourceId, true);
    const samples = results.slice(0, 8).map((r) => {
      const parsed = listingInputSchema.safeParse(r.draft);
      return {
        title: r.draft.title ?? '(untitled)',
        valid: parsed.success,
        issues: r.issues.slice(0, 6),
        fields: {
          Facility: r.draft.facilityName ?? '',
          Town: r.draft.town ?? '',
          State: r.draft.state ?? '',
          Specialty: r.draft.specialty ?? '',
          Grade: r.draft.grade ?? '',
          Dates: r.draft.startDate ? `${r.draft.startDate} → ${r.draft.endDate ?? '?'}` : '',
          Rate: r.draft.compensation?.amount ? `$${r.draft.compensation.amount}/${r.draft.compensation.basis}` : '',
        },
      };
    });
    const valid = results.filter((r) => listingInputSchema.safeParse(r.draft).success).length;
    const message = `${results.length} records parsed; ${valid} complete enough to import automatically.`;
    log(sourceId, `Test: ${message}`);
    return { sourceId, ok: true, message, read: results.length, valid, samples };
  } catch (error) {
    const message = (error as Error).message;
    log(sourceId, `Test failed: ${message}`, 'error');
    return fail(message);
  }
}
export async function collectSource(sourceId: string) {
  const state = await readStore(),
    source = state.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error('Unknown source');
  const startedAt = new Date().toISOString();
  const record: CollectionRun = {
    id: randomUUID(),
    sourceId,
    startedAt,
    completedAt: startedAt,
    status: 'skipped',
    count: 0,
    message: '',
  };
  if (
    process.env.COLLECTOR_ENABLED !== 'true' ||
    !source.enabled ||
    source.permission !== 'approved' ||
    !source.permissionEvidence ||
    !(source.method === 'jsonld' || (source.method === 'json-api' && sourceAdapters[source.id]))
  ) {
    record.message = 'Collection is disabled or access permission has not been recorded.';
    log(sourceId, `${source.name}: ${record.message}`, 'warn');
    await transaction((s) => {
      s.runs.unshift(record);
      s.runs = s.runs.slice(0, 200);
    });
    return record;
  }
  // Acquire a durable scheduling lease before network work; two workers cannot poll simultaneously.
  const acquired = await transaction((s) => {
    const current = s.sources.find((v) => v.id === sourceId)!;
    if (
      current.lastAttempt &&
      Date.now() - Date.parse(current.lastAttempt) < current.intervalHours * 3600000
    )
      return false;
    current.lastAttempt = startedAt;
    return true;
  });
  if (!acquired) {
    log(sourceId, `${source.name}: not due yet; the collection interval is enforced.`, 'warn');
    return { ...record, message: 'Not due yet; the collection interval is enforced.' };
  }
  try {
    if (source.method === 'json-api') {
      log(sourceId, `Starting ${source.name}.`);
      const { results, read } = await runAdapter(sourceAdapters[source.id], sourceId);
      const tally = await transaction((s) => {
        const t = commitExtractions(s, sourceId, results);
        const current = s.sources.find((v) => v.id === sourceId)!;
        current.lastSuccess = startedAt;
        current.error = null;
        if (read.length)
          current.readUrls = [...new Set([...(current.readUrls ?? []), ...read])].slice(-5000);
        return t;
      });
      record.count = tally.imported + tally.queued;
      record.status = 'success';
      record.message = `${results.length} listings read. ${describeTally(tally)}`;
      log(sourceId, record.message);
      record.completedAt = new Date().toISOString();
      await transaction((s) => {
        s.runs.unshift(record);
        s.runs = s.runs.slice(0, 200);
      });
      return record;
    }
    const robots = await fetchPage(new URL('/robots.txt', source.url).toString());
    if (robots.status !== 200 || !robotsAllows(robots.text))
      throw new Error('Robots rules need review; collection stopped conservatively.');
    let response = await fetchPage(source.url);
    if (response.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      response = await fetchPage(source.url);
    }
    if (response.status !== 200)
      throw new Error(
        `Source returned HTTP ${response.status}; historical vacancies were retained.`,
      );
    const results = extractJobPostings(response.text, source.id, source.url, state.facilities);
    if (!results.length)
      throw new Error(
        'No supported JobPosting records found. The source may have changed; use manual import.',
      );
    await transaction((s) => {
      record.count = queueExtractions(s, sourceId, results);
      const current = s.sources.find((v) => v.id === sourceId)!;
      current.lastSuccess = startedAt;
      current.error = null;
    });
    record.status = 'success';
    record.message = `${record.count} new records await extraction review.`;
  } catch (error) {
    record.status = 'failed';
    const reason = error instanceof Error ? error.message : 'Collection failed';
    record.message = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out/i.test(reason)
      ? `Could not reach the site (${reason}). Check the internet connection; historical vacancies were retained.`
      : reason;
    log(sourceId, `Failed: ${record.message}`, 'error');
    await transaction((s) => {
      s.sources.find((v) => v.id === sourceId)!.error = record.message;
    });
  }
  record.completedAt = new Date().toISOString();
  await transaction((s) => {
    s.runs.unshift(record);
    s.runs = s.runs.slice(0, 200);
  });
  return record;
}
