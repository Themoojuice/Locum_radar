import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import { transaction, readStore } from './database';
import { extractJobPostings, fromLabelledBlock, type Extraction } from './extraction';
import { jsonAdapters, type JsonAdapter } from './adapters/json-sources';
import { fingerprint } from '@/domain/ingestion';
import type { CollectionRun, Store } from '@/domain/model';

const allowed = new Set([
  'medrecruit.medworld.com',
  'ochrerecruitment.com',
  ...Object.values(jsonAdapters).flatMap((a) => a.hosts),
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
const knownExternalIds = (s: Store, sourceId: string) =>
  new Set([
    ...s.listings.filter((l) => l.sourceId === sourceId).map((l) => l.externalId),
    ...s.reviews.filter((r) => r.sourceId === sourceId).map((r) => r.draft?.externalId ?? ''),
  ]);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pages through a JSON adapter newest-first and stops once a page contains no
 * vacancy that has been seen before, so routine runs make a handful of requests.
 */
async function collectJson(adapter: JsonAdapter, sourceId: string) {
  if (adapter.access === 'site-endpoint') {
    const robots = await fetchPage(adapter.robotsUrl!);
    if (robots.status !== 200 || !robotsAllows(robots.text))
      throw new Error('Robots rules need review; collection stopped conservatively.');
  }
  const store = await readStore();
  const seen = knownExternalIds(store, sourceId);
  const results: Extraction[] = [];
  for (let page = 1; page <= adapter.maxPages; page++) {
    const url = adapter.pageUrl(page, process.env);
    if (!url) throw new Error('This source needs configuration (for example an API key) first.');
    if (page > 1) await pause(Number(process.env.COLLECTOR_PAGE_DELAY_MS ?? 2000));
    const response = await fetchPage(url, 'application/json');
    if (response.status !== 200)
      throw new Error(
        `Source returned HTTP ${response.status}; historical vacancies were retained.`,
      );
    let body: unknown;
    try {
      body = JSON.parse(response.text);
    } catch {
      throw new Error(
        'Source did not return JSON. The endpoint may have changed; use manual import.',
      );
    }
    const { blocks, hasMore } = adapter.parse(body);
    const extracted = blocks.map((b) => {
      const r = fromLabelledBlock(b, sourceId, `${sourceId}-json`, store.facilities);
      r.draft.url = b.url;
      return r;
    });
    results.push(...extracted);
    const unseen = extracted.filter((r) => !seen.has(r.draft.externalId ?? ''));
    if (!hasMore || (blocks.length > 0 && unseen.length === 0)) break;
  }
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
    !(source.method === 'jsonld' || (source.method === 'json-api' && jsonAdapters[source.id]))
  ) {
    record.message = 'Collection is disabled or access permission has not been recorded.';
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
  if (!acquired) return { ...record, message: 'Not due yet; the collection interval is enforced.' };
  try {
    if (source.method === 'json-api') {
      const results = await collectJson(jsonAdapters[source.id], sourceId);
      await transaction((s) => {
        record.count = queueExtractions(s, sourceId, results);
        const current = s.sources.find((v) => v.id === sourceId)!;
        current.lastSuccess = startedAt;
        current.error = null;
      });
      record.status = 'success';
      record.message = `${record.count} new records await extraction review.`;
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
    record.message = error instanceof Error ? error.message : 'Collection failed';
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
