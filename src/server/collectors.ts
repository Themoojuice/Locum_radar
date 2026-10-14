import { randomUUID } from 'node:crypto';
import { transaction, readStore } from './database';
import { fingerprint } from '@/domain/ingestion';
import { configForSource, sourceRecipes } from '@/domain/source-catalog';
import { collectorConfigSchema } from '@/domain/acquisition';
import type { CollectionRun, Store, Source } from '@/domain/model';
import { initialFrontier, pageProcessor } from './acquisition/providers';
import { canonicalUrl, type Candidate, type ParsedPage } from './acquisition/parsers';
import { safeUrl } from './acquisition/transport';
export { publicIpv4, robotsAllows } from './acquisition/transport';
export const allowedSourceUrl = (url: string) =>
  safeUrl(
    url,
    sourceRecipes.flatMap((r) => r.config.allowedHosts),
  );
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
      store.reviews.push({
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
  process.env.COLLECTOR_ENABLED === 'true' &&
  source.enabled &&
  source.permission === 'approved' &&
  !!source.permissionEvidence.trim() &&
  source.method !== 'manual';
export async function collectSource(sourceId: string) {
  const original = (await readStore()).sources.find((s) => s.id === sourceId);
  if (!original) throw new Error('Unknown source');
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
      const item = crawl.queue[0];
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
          next.records += kept.length;
          if (offset + kept.length < result.candidates.length) {
            pageFinished = false;
            next.queue[0].offset = offset + kept.length;
            next.queue[0].pageHash = pageHash;
          }
          const known = new Set([...next.seen, ...next.queue.map((v) => v.url)]);
          for (const link of result.links) {
            const url = link.url.startsWith('/') ? link.url : canonicalUrl(link.url);
            if (!known.has(url) && next.queue.length < 5000) {
              known.add(url);
              next.queue.push({ ...link, url });
            } else if (!known.has(url) && !next.errors.includes('Discovery frontier limit reached'))
              next.errors.push('Discovery frontier limit reached');
          }
        }
        if (pageFinished) {
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
    record.status =
      crawl.complete && !crawl.errors.length
        ? 'success'
        : crawl.complete && crawl.errors.length && !crawl.records
          ? 'failed'
          : 'partial';
    record.message = `${crawl.pages} pages/messages checked; ${record.count} new review records; ${crawl.queue.length} queued.${crawl.limited ? ' Scan budget reached; coverage is partial.' : ''}${crawl.errors.length ? ' Issues: ' + [...new Set(crawl.errors)].slice(0, 4).join(' · ') : ''}`;
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
