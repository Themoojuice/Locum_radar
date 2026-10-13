import type { Store } from './model';

export function collectionPlan(
  store: Store,
  enabled: boolean,
  now = Date.now(),
  missingConfig: Record<string, string> = {},
) {
  const sources = store.sources
    .filter((s) => s.type === 'agency' || s.type === 'government')
    .map((source) => {
      const nextAttempt = source.lastAttempt
        ? new Date(Date.parse(source.lastAttempt) + source.intervalHours * 3600000).toISOString()
        : null;
      const reasons: string[] = [];
      if (source.method === 'manual') reasons.push('Collector not built yet');
      if (missingConfig[source.id]) reasons.push(missingConfig[source.id]);
      if (source.permission !== 'approved' || !source.permissionEvidence.trim())
        reasons.push('Access review needed');
      if (!source.enabled) reasons.push('Source collection is off');
      if (!enabled) reasons.push('Collection is switched off on this installation');
      const due = !nextAttempt || Date.parse(nextAttempt) <= now;
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
        nextAttempt,
        lastSuccess: source.lastSuccess,
        lastAttempt: source.lastAttempt,
        error: source.error,
        lastResult: latestRun?.message ?? null,
        imported: store.listings.filter((l) => l.sourceId === source.id).length,
      };
    });
  return {
    enabled,
    sources,
    checked: sources.filter((s) => s.lastSuccess).length,
    neverChecked: sources.filter((s) => !s.lastSuccess).length,
    ready: sources.filter((s) => s.state === 'ready').length,
    waiting: sources.filter((s) => s.state === 'waiting').length,
    setup: sources.filter((s) => s.state === 'setup').length,
  };
}
export type CollectionPlan = ReturnType<typeof collectionPlan>;
