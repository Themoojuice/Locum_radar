import type { Store } from '@/domain/model';
import { sourceFromRecipe, sourceRecipes } from '@/domain/source-catalog';

export const collectionEnabled = () => process.env.COLLECTOR_ENABLED !== 'false';
export const publicStarterIds = ['ochre'];
/** Enable inspected public sources once; preserve any subsequent owner decision. */
export function applyPublicStarter(store: Store) {
  for (const id of publicStarterIds) {
    const source = store.sources.find((s) => s.id === id);
    if (!source || source.permission !== 'unreviewed' || source.permissionEvidence.trim()) continue;
    const recipe = sourceRecipes.find((r) => r.id === id)!;
    Object.assign(source, sourceFromRecipe(recipe), {
      enabled: true,
      permission: 'approved',
      permissionEvidence:
        'Built-in public starter: public Ochre job pages and terms inspected 15 Oct 2026. Personal discovery with live per-path robots checks, pacing and bounded scans; no account, bypass or redistribution.',
    });
  }
}
