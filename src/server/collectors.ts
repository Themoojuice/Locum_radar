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
 * Path-aware robots check for adapters with recorded permission: allowed when
 * no rule for `*` or LocumRadar disallows a path the adapter will request.
 * Returns the crawl delay in milliseconds, or null when a path is disallowed.
 */
export function robotsDelayFor(text: string, paths: string[]): number | null {
  if (!/user-agent\s*:/i.test(text)) return null;
  let relevant = false,
    sawRule = false,
    delay = 0;
  const disallowed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [key, ...rest] = line.split(':'),
      value = rest.join(':').trim(),
      k = key.trim().toLowerCase();
    if (k === 'user-agent') {
      if (sawRule) relevant = false;
      sawRule = false;
      relevant ||= value === '*' || /locumradar/i.test(value);
      continue;
    }
    sawRule = true;
    if (!relevant) continue;
    if (k === 'disallow' && value) disallowed.push(value);
    if (k === 'crawl-delay' && Number(value) > 0) delay = Math.max(delay, Number(value) * 1000);
  }
  const matches = (rule: string, path: string) => {
    const pattern = new RegExp(
      '^' +
        rule
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\$$/, '$'),
    );
    return pattern.test(path);
  };
  return paths.some((p) => disallowed.some((rule) => matches(rule, p))) ? null : delay;
}

const knownExternalIds = (s: Store, sourceId: string) =>
  new Set([
    ...s.listings.filter((l) => l.sourceId === sourceId).map((l) => l.externalId),
    ...s.reviews.filter((r) => r.sourceId === sourceId).map((r) => r.draft?.externalId ?? ''),
  ]);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Profile scope: preferred specialties and excluded states, when the profile sets them. */
export function inProfileScope(profile: Profile, specialty: string | null, state: string | null) {
  if (state && (profile.excludedStates as string[]).includes(state)) return false;
  if (specialty && profile.preferredSpecialties.length)
    return (profile.preferredSpecialties as string[]).includes(specialty);
  return true;
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
async function runAdapter(adapter: SourceAdapter, sourceId: string) {
  const store = await readStore();
  const missing = adapter.missingConfig?.(process.env);
  if (missing) throw new Error(`Needs configuration: ${missing}.`);
  let delay = Number(process.env.COLLECTOR_PAGE_DELAY_MS ?? 1500);
  if (adapter.access === 'site-endpoint') {
    const robots = await fetchPage(adapter.robotsUrl!, 'text/plain');
    const paths =
      'pageUrl' in adapter
        ? [new URL(adapter.pageUrl(1, process.env)!).pathname]
        : ['/wp-json/wp/v2/job_posts', '/doctors/jobs-board/'];
    const robotsDelay = robots.status === 200 ? robotsDelayFor(robots.text, paths) : null;
    if (robots.status !== 404 && robotsDelay === null)
      throw new Error('Robots rules disallow the pages this collector needs; stopped.');
    delay = Math.max(delay, robotsDelay ?? 0);
  }
  const seen = knownExternalIds(store, sourceId);
  const say = (text: string, level: 'info' | 'warn' | 'error' = 'info') =>
    log(sourceId, text, level);
  const get = (url: string, accept: string) => fetchPage(url, accept);
  let blocks: JsonBlock[] = [];
  let outOfScope = 0;
  const inScope = (specialty: string | null, state: string | null) =>
    inProfileScope(store.profile, specialty, state);
  if ('collect' in adapter) {
    blocks = await adapter.collect({
      get,
      pause: () => pause(delay),
      seen,
      inScope,
      log: say,
      stopped: stopRequested,
      env: process.env,
    });
  } else {
    for (let page = 1; page <= adapter.maxPages; page++) {
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
    if (!inScope(r.draft.specialty ?? null, r.draft.state ?? null)) {
      outOfScope++;
      continue;
    }
    results.push(r);
  }
  if (outOfScope)
    say(
      `${outOfScope} listings fall outside your profile's specialties or states and were skipped.`,
    );
  return results;
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
      const results = await runAdapter(sourceAdapters[source.id], sourceId);
      const tally = await transaction((s) => {
        const t = commitExtractions(s, sourceId, results);
        const current = s.sources.find((v) => v.id === sourceId)!;
        current.lastSuccess = startedAt;
        current.error = null;
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
