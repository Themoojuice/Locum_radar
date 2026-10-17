import { randomUUID } from 'node:crypto';
import { transaction, readStore } from './database';
import { fingerprint, ingest } from '@/domain/ingestion';
import { configForSource, sourceRecipes } from '@/domain/source-catalog';
import { collectorConfigSchema } from '@/domain/acquisition';
import {
  listingInputSchema,
  type CollectionRun,
  type Store,
  type Source,
  type Profile,
} from '@/domain/model';
import { initialFrontier, pageProcessor } from './acquisition/providers';
import { canonicalUrl, type Candidate, type ParsedPage } from './acquisition/parsers';
import { safeUrl, requestPage } from './acquisition/transport';
import { fromLabelledBlock, type Extraction } from './extraction';
import type { JsonBlock, SourceAdapter } from './adapters/json-sources';
import { sourceAdapters } from './adapters/registry';
import { log, stopRequested } from './progress';
import { collectionEnabled } from './public-starter';
import { providerEnvironment } from './credentials';
export { publicIpv4, robotsAllows } from './acquisition/transport';
export const allowedSourceUrl = (url: string) =>
  safeUrl(url, [
    ...sourceRecipes.flatMap((r) => r.config.allowedHosts),
    ...Object.values(sourceAdapters).flatMap((a) => a.hosts),
  ]);
async function fetchPage(url: string, accept = 'text/html,text/plain') {
  return requestPage(
    url,
    [
      ...sourceRecipes.flatMap((r) => r.config.allowedHosts),
      ...Object.values(sourceAdapters).flatMap((a) => a.hosts),
    ],
    { Accept: accept },
  );
}
export function configIdentity(source: Source) {
  const config = configForSource(source);
  if (!config) return '';
  const { maxPages, maxRecords, delayMs, ...identity } = config;
  void [maxPages, maxRecords, delayMs];
  return fingerprint(identity);
}
export function recordCandidates(
  store: Store,
  sourceId: string,
  candidates: Candidate[],
  observedAt: string,
) {
  let count = 0;
  for (const item of candidates) {
    const contentHash = fingerprint({
      text: item.text,
      title: item.title,
      extractions: item.extractions,
    });
    const id = fingerprint({ sourceId, externalId: item.externalId, contentHash });
    if (store.documents.some((d) => d.id === id)) continue;
    store.documents.push({
      id,
      sourceId,
      externalId: item.externalId,
      url: item.url,
      title: item.title,
      text: item.text.slice(0, 100000),
      contentHash,
      observedAt,
      publishedAt: item.publishedAt,
      kind: item.kind,
    });
    for (const [index, extracted] of item.extractions.entries()) {
      for (const previous of store.reviews) {
        if (
          previous.sourceId === sourceId &&
          previous.kind === 'extraction' &&
          previous.draft?.externalId &&
          previous.draft.externalId === extracted.draft.externalId
        )
          previous.resolved = true;
      }
      store.reviews.push({
        emailScreen: item.emailScreen,
        publishedAt: item.publishedAt,
        observedAt,
        id: 'acquire-' + id + '-' + index,
        kind: 'extraction',
        sourceId,
        opportunityId: null,
        candidateId: null,
        reason: [item.kind === 'lead' ? 'Unverified discovery lead.' : '', ...extracted.issues]
          .filter(Boolean)
          .join(' '),
        resolved: false,
        draft: extracted.draft,
        rawText: extracted.draft.rawText || item.text,
      });
      count++;
    }
  }
  return count;
}
const allowed = (source: Source) =>
  collectionEnabled() &&
  source.enabled &&
  source.permission === 'approved' &&
  !!source.permissionEvidence.trim() &&
  source.method !== 'manual';
/** Adds new extraction candidates to the review queue; returns how many were new. */
export function queueExtractions(s: Store, sourceId: string, results: Extraction[]) {
  let added = 0;
  for (const result of results) {
    const id = `extract-${fingerprint({ source: sourceId, raw: result.draft.rawText })}`;
    if (s.reviews.some((r) => r.id === id)) continue;
    s.reviews.push({
      observedAt: new Date().toISOString(),
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
  let incomplete = false;
  const store = await readStore();
  const missing = adapter.missingConfig?.(providerEnvironment());
  if (missing) throw new Error(`Needs configuration: ${missing}.`);
  let delay = Number(process.env.COLLECTOR_PAGE_DELAY_MS ?? 1500);
  if (adapter.access === 'site-endpoint') {
    const robots = await fetchPage(adapter.robotsUrl!, 'text/plain');
    const paths =
      'pageUrl' in adapter
        ? [new URL(adapter.pageUrl(1, providerEnvironment())!).pathname]
        : ['/wp-json/wp/v2/job_posts', '/doctors/jobs-board/'];
    const robotsDelay = robots.status === 200 ? robotsDelayFor(robots.text, paths) : null;
    if (robots.status !== 404 && robotsDelay === null)
      throw new Error('Robots rules disallow the pages this collector needs; stopped.');
    delay = Math.max(delay, robotsDelay ?? 0);
  }
  const seen = knownExternalIds(store, sourceId);
  const say = (text: string, level: 'info' | 'warn' | 'error' = 'info') => {
    if (level !== 'info' || /nothing new; stopping early/i.test(text)) incomplete = true;
    log(sourceId, text, level);
  };
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
      env: providerEnvironment(),
    });
  } else {
    for (let page = 1; page <= adapter.maxPages; page++) {
      if (stopRequested()) {
        say(`Stopped on request after ${page - 1} page(s).`, 'warn');
        break;
      }
      const url = adapter.pageUrl(page, providerEnvironment());
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
  return { results, incomplete: incomplete || stopRequested() };
}
/** Retain the existing agency-specific incremental adapters and automatic-import preference. */
async function collectNativeSource(source: Source): Promise<CollectionRun> {
  const record: CollectionRun = {
    id: randomUUID(),
    sourceId: source.id,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'skipped',
    count: 0,
    message: '',
  };
  const adapter = sourceAdapters[source.id];
  if (!allowed(source) || !adapter)
    return { ...record, message: 'Collection is disabled or access review is missing.' };
  const acquired = await transaction((s) => {
    const current = s.sources.find((v) => v.id === source.id)!;
    if (
      !allowed(current) ||
      current.method !== 'json-api' ||
      (current.lastAttempt &&
        Date.now() - Date.parse(current.lastAttempt) < current.intervalHours * 3600000)
    )
      return false;
    current.lastAttempt = record.startedAt;
    return true;
  });
  if (!acquired) return { ...record, message: 'Not due yet; the collection interval is enforced.' };
  try {
    log(source.id, `Starting ${source.name}.`);
    const { results, incomplete } = await runAdapter(adapter, source.id);
    const tally = await transaction((s) => {
      const current = s.sources.find((v) => v.id === source.id)!;
      if (!allowed(current) || current.method !== 'json-api')
        throw new Error('Source disabled or changed during collection; no fetched records saved');
      return commitExtractions(s, source.id, results);
    });
    record.count = tally.imported + tally.queued;
    record.status = incomplete ? 'partial' : 'success';
    record.message = `${results.length} listings read. ${describeTally(tally)}${incomplete ? ' Incremental, stopped or limited scan; full coverage was not established. See the collection log.' : ''}`;
  } catch (error) {
    record.status = 'failed';
    record.message = error instanceof Error ? error.message : 'Collection failed';
  }
  record.completedAt = new Date().toISOString();
  log(
    source.id,
    record.message,
    record.status === 'failed' ? 'error' : record.status === 'partial' ? 'warn' : 'info',
  );
  await transaction((s) => {
    const current = s.sources.find((v) => v.id === source.id)!;
    if (record.status === 'success') {
      current.lastSuccess = record.completedAt;
      current.error = null;
    } else current.error = record.message;
    s.runs.unshift(record);
    s.runs = s.runs.slice(0, 300);
  });
  return record;
}
export async function collectSource(sourceId: string) {
  const original = (await readStore()).sources.find((s) => s.id === sourceId);
  if (!original) throw new Error('Unknown source');
  if (original.method === 'json-api') return collectNativeSource(original);
  const record: CollectionRun = {
    id: randomUUID(),
    sourceId,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'skipped',
    count: 0,
    message: '',
  };
  const rawConfig = configForSource(original);
  if (!allowed(original) || !rawConfig)
    return {
      ...record,
      message:
        'Collection needs an enabled adapter, recorded access review and the installation collection switch.',
    };
  const config = collectorConfigSchema.parse(rawConfig);
  const starts = initialFrontier(config);
  if (!starts.length) throw new Error('Configure at least one starting URL');
  if (
    ['web', 'feed', 'sitemap'].includes(config.kind) &&
    starts.some((i) => !safeUrl(i.url, config.allowedHosts))
  )
    throw new Error('Starting URLs must use the explicitly allowed HTTPS hosts');
  const configHash = configIdentity(original),
    owner = randomUUID();
  const claimed = await transaction((s) => {
    const source = s.sources.find((v) => v.id === sourceId)!;
    if (
      !allowed(source) ||
      configIdentity(source) !== configHash ||
      (source.crawl?.leaseUntil && Date.parse(source.crawl.leaseUntil) > Date.now()) ||
      (source.crawl?.retryAfter && Date.parse(source.crawl.retryAfter) > Date.now())
    )
      return null;
    let crawl = source.crawl;
    if (!crawl || crawl.complete || crawl.configHash !== configHash) {
      if (
        source.lastAttempt &&
        Date.now() - Date.parse(source.lastAttempt) < source.intervalHours * 3600000
      )
        return null;
      crawl = {
        id: randomUUID(),
        startedAt: record.startedAt,
        queue: starts,
        seen: [],
        pages: 0,
        records: 0,
        newRecords: 0,
        reused: 0,
        errors: [],
        limited: false,
        complete: false,
        configHash,
      };
      source.lastAttempt = record.startedAt;
    }
    crawl.limited = crawl.pages >= config.maxPages || crawl.records >= config.maxRecords;
    if (crawl.limited) return null;
    crawl.leaseOwner = owner;
    crawl.leaseUntil = new Date(Date.now() + 900000).toISOString();
    source.crawl = crawl;
    return structuredClone(crawl);
  });
  if (!claimed)
    return {
      ...record,
      message: 'Not due, another worker is active, or the scan budget needs increasing.',
    };
  const processPage = pageProcessor(config, sourceId);
  let crawl = claimed;
  try {
    for (let batch = 0; batch < 3 && crawl.queue.length; batch++) {
      if (stopRequested()) break;
      const item = crawl.queue[0];
      log(sourceId, `Checking ${item.kind}; ${crawl.pages} checked, ${crawl.queue.length} queued.`);
      let result: ParsedPage | undefined, problem: string | undefined;
      try {
        result = await processPage(item);
        if (!result.recognised)
          throw new Error('No recognised vacancies or pagination; adapter needs review');
      } catch (error) {
        problem =
          (error instanceof Error ? error.message : 'Collection failed').slice(0, 400) +
          ' [' +
          item.kind +
          ']';
      }
      const checkpoint = await transaction((s) => {
        const source = s.sources.find((v) => v.id === sourceId)!;
        if (source.crawl?.leaseOwner !== owner) throw new Error('Collector lease changed');
        if (!allowed(source) || configIdentity(source) !== configHash)
          throw new Error('Source settings changed; collection stopped');
        const next = structuredClone(source.crawl);
        let count = 0,
          pageFinished = true;
        if (problem) {
          if (!next.errors.includes(problem)) next.errors.push(problem);
          if (/rate.limit|HTTP 429|Robots rules unavailable/i.test(problem)) {
            pageFinished = false;
            next.retryAfter = new Date(Date.now() + 86400000).toISOString();
          }
        } else if (result) {
          for (const warning of result.warnings || [])
            if (!next.errors.includes(warning)) next.errors.push(warning);
          const pageHash = fingerprint(result.candidates);
          const offset = item.pageHash === pageHash ? item.offset || 0 : 0,
            room = Math.max(0, config.maxRecords - next.records);
          const kept = result.candidates.slice(offset, offset + room);
          count = recordCandidates(s, sourceId, kept, new Date().toISOString());
          next.newRecords = (next.newRecords || 0) + count;
          next.records += kept.length;
          if (offset + kept.length < result.candidates.length) {
            pageFinished = false;
            next.queue[0].offset = offset + kept.length;
            next.queue[0].pageHash = pageHash;
          }
          const known = new Set([...next.seen, ...next.queue.map((v) => v.url)]);
          for (const link of result.links) {
            const url = link.url.startsWith('/') ? link.url : canonicalUrl(link.url);
            const cached = source.detailChecks?.[url];
            if (
              !known.has(url) &&
              link.kind === 'detail' &&
              link.signature &&
              cached?.signature === link.signature &&
              Date.now() - Date.parse(cached.checkedAt) < 7 * 86400000 &&
              s.documents.some((d) => d.sourceId === sourceId && d.url === url)
            ) {
              known.add(url);
              next.seen.push(url);
              next.reused = (next.reused || 0) + 1;
              continue;
            }
            if (!known.has(url) && next.queue.length < 5000) {
              known.add(url);
              next.queue.push({ ...link, url });
            } else if (!known.has(url) && !next.errors.includes('Discovery frontier limit reached'))
              next.errors.push('Discovery frontier limit reached');
          }
        }
        if (pageFinished) {
          if (!problem && item.kind === 'detail' && item.signature) {
            source.detailChecks ??= {};
            source.detailChecks[item.url] = {
              signature: item.signature,
              checkedAt: new Date().toISOString(),
            };
            if (Object.keys(source.detailChecks).length > 2000)
              delete source.detailChecks[Object.keys(source.detailChecks)[0]];
          }
          next.queue.shift();
          next.seen.push(item.url);
          next.pages++;
        }
        next.limited =
          !!next.queue.length &&
          (next.pages >= config.maxPages || next.records >= config.maxRecords);
        next.complete = !next.queue.length;
        next.leaseUntil = new Date(Date.now() + 900000).toISOString();
        source.crawl = next;
        return { crawl: structuredClone(next), count };
      });
      crawl = checkpoint.crawl;
      record.count += checkpoint.count;
      if (crawl.limited || (crawl.retryAfter && Date.parse(crawl.retryAfter) > Date.now())) break;
      if (['gmail', 'adzuna', 'search'].includes(config.kind))
        await new Promise((r) => setTimeout(r, config.delayMs));
    }
    record.pages = crawl.pages;
    record.remaining = crawl.queue.length;
    record.limited = crawl.limited;
    record.scanCount = crawl.newRecords || 0;
    record.status =
      crawl.complete && !crawl.errors.length
        ? 'success'
        : crawl.complete && crawl.errors.length && !crawl.records
          ? 'failed'
          : 'partial';
    record.message = `${crawl.pages} pages/messages checked; ${record.scanCount} adverts added or updated in this scan (${record.count} this batch); ${crawl.reused || 0} unchanged adverts reused; ${crawl.queue.length} queued.${crawl.limited ? ' Scan budget reached; coverage is partial.' : ''}${crawl.errors.length ? ' Issues: ' + [...new Set(crawl.errors)].slice(0, 4).join(' · ') : ''}`;
    log(sourceId, record.message, record.status === 'success' ? 'info' : 'warn');
  } catch (error) {
    record.status = 'failed';
    record.message =
      error instanceof Error
        ? error.message
        : 'Collection interrupted; last saved checkpoint retained';
  } finally {
    record.completedAt = new Date().toISOString();
    await transaction((s) => {
      const source = s.sources.find((v) => v.id === sourceId)!;
      if (source.crawl?.leaseOwner === owner) {
        delete source.crawl.leaseOwner;
        delete source.crawl.leaseUntil;
        if (record.status === 'success') {
          source.lastSuccess = record.completedAt;
          source.error = null;
        } else
          source.error =
            record.status === 'failed' || crawl.errors.length || crawl.limited
              ? record.message
              : null;
      }
      s.runs.unshift(record);
      s.runs = s.runs.slice(0, 300);
    });
  }
  return record;
}
