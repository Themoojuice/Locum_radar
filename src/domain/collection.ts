import type { Store } from './model';
import { configForSource } from './source-catalog';

export function collectionPlan(
  store: Store,
  enabled: boolean,
  now = Date.now(),
  setup: Record<string, string[] | string> = {},
) {
  const latestAdverts = new Map<string, Store['reviews'][number]>();
  for (const review of store.reviews) {
    if (review.kind === 'extraction')
      latestAdverts.set(
        `${review.sourceId}:${review.draft?.externalId || review.draft?.url || review.id}`,
        review,
      );
  }
  const sources = store.sources
    .filter((s) => s.type !== 'manual' && (s.type !== 'email' || s.method === 'collector'))
    .map((source) => {
      const nextAttempt = source.lastAttempt
        ? new Date(Date.parse(source.lastAttempt) + source.intervalHours * 3600000).toISOString()
        : null;
      const reasons: string[] = [];
      const config = configForSource(source),
        crawl = source.method === 'json-api' ? undefined : source.crawl;
      if (source.method === 'manual' || (!config && source.method !== 'json-api'))
        reasons.push('Choose a collector recipe');
      if (config?.kind === 'gmail' && config.gmailMode !== 'search' && !config.labelId)
        reasons.push('Select a Gmail label');
      for (const key of new Set([source.id, config?.kind || ''])) {
        const reason = setup[key];
        if (reason) reasons.push(...(Array.isArray(reason) ? reason : [reason]));
      }
      if (
        crawl &&
        !crawl.complete &&
        config &&
        (crawl.pages >= config.maxPages || crawl.records >= config.maxRecords)
      )
        reasons.push('Scan budget reached; increase the page or record limit to resume');
      if (source.permission !== 'approved' || !source.permissionEvidence.trim())
        reasons.push('Access review needed');
      if (!source.enabled) reasons.push('Source collection is off');
      if (!enabled) reasons.push('Collection is switched off on this installation');
      const active = !!crawl?.leaseUntil && Date.parse(crawl.leaseUntil) > now;
      const paused = !!crawl?.retryAfter && Date.parse(crawl.retryAfter) > now;
      const due =
        !active &&
        !paused &&
        ((!!crawl && !crawl.complete) || !nextAttempt || Date.parse(nextAttempt) <= now);
      const state = reasons.length ? 'setup' : !due ? 'waiting' : 'ready';
      const latestRun = store.runs
        .filter((r) => r.sourceId === source.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      return {
        id: source.id,
        name: source.name,
        url: source.url,
        state,
        reasons,
        nextAttempt: paused ? crawl!.retryAfter! : nextAttempt,
        lastSuccess: source.lastSuccess,
        lastAttempt: source.lastAttempt,
        error: source.error,
        lastResult: latestRun?.message ?? null,
        imported: store.listings.filter((l) => l.sourceId === source.id).length,
        adverts: [...latestAdverts.values()].filter(
          (r) => r.sourceId === source.id && r.kind === 'extraction' && !r.resolved,
        ).length,
        starter: source.id === 'ochre',
        pages: crawl?.pages || 0,
        remaining: crawl?.queue.length || 0,
        partial:
          (!!crawl && (!crawl.complete || !!crawl.errors.length)) ||
          latestRun?.status === 'partial',
        active,
        qualification: source.qualification || '',
      };
    });
  return {
    automaticStarter: false,
    enabled,
    sources,
    checked: sources.filter((s) => s.lastSuccess).length,
    neverChecked: sources.filter((s) => !s.lastSuccess).length,
    ready: sources.filter((s) => s.state === 'ready').length,
    waiting: sources.filter((s) => s.state === 'waiting').length,
    setup: sources.filter((s) => s.state === 'setup').length,
    partial: sources.filter((s) => s.partial).length,
  };
}
export type CollectionPlan = ReturnType<typeof collectionPlan>;
