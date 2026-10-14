import { describe, expect, it } from 'vitest';
import { collectionPlan } from '@/domain/collection';
import { emptyStore } from '@/domain/seed';
const now = Date.parse('2026-10-13T02:00:00Z');
function readyStore() {
  const store = emptyStore();
  Object.assign(
    store.sources.find((s) => s.id === 'medrecruit')!,
    {
      enabled: true,
      permission: 'approved',
      permissionEvidence: 'Test fixture',
    },
  );
  return store;
}
describe('source collection planning', () => {
  it('counts registered web sources, excluding manual and email channels', () => {
    const plan = collectionPlan(emptyStore(), false, now);
    expect(plan.sources).toHaveLength(14);
    expect(plan.checked).toBe(0);
    expect(plan.neverChecked).toBe(14);
    expect(plan.ready).toBe(0);
  });
  it('only queues supported, approved, enabled and due sources', () => {
    expect(collectionPlan(readyStore(), true, now).ready).toBe(1);
    expect(collectionPlan(readyStore(), false, now).ready).toBe(0);
    const store = readyStore();
    store.sources.find((s) => s.id === 'medrecruit')!.method = 'manual';
    expect(collectionPlan(store, true, now).ready).toBe(0);
  });
  it('retains past success while showing a subsequent failure and cooldown', () => {
    const store = readyStore(),
      source = store.sources.find((s) => s.id === 'medrecruit')!;
    source.lastSuccess = '2026-10-10T02:00:00Z';
    source.lastAttempt = '2026-10-13T01:00:00Z';
    source.error = 'Source unavailable';
    const plan = collectionPlan(store, true, now);
    expect(plan.checked).toBe(1);
    expect(plan.waiting).toBe(1);
    expect(plan.ready).toBe(0);
    expect(plan.sources[0].error).toBe('Source unavailable');
    expect(collectionPlan(store, true, now + 86400000).ready).toBe(1);
  });
  it('does not report a failed attempt as a successful scrape', () => {
    const store = readyStore(),
      source = store.sources.find((s) => s.id === 'medrecruit')!;
    source.lastAttempt = '2026-10-11T02:00:00Z';
    source.error = 'HTTP 503';
    const plan = collectionPlan(store, true, now);
    expect(plan.neverChecked).toBe(14);
    expect(plan.ready).toBe(1);
  });
});
