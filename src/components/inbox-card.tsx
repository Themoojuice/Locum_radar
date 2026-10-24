'use client';
import { ClipboardPaste, Mail, RefreshCw } from 'lucide-react';
import type { Store } from '@/domain/model';
import type { ImportProgress } from './inbox-import';

/** Discover's summary of the recruiter inbox, with the two everyday actions. */
export function InboxCard({
  store,
  background,
  onImport,
  onPaste,
  onOpen,
}: {
  store: Store;
  background: ImportProgress | null;
  onImport: () => void;
  onPaste: () => void;
  onOpen: () => void;
}) {
  const inbox = store.inbox ?? [];
  const current = inbox.flatMap((e) => e.vacancies).filter((v) => !v.ended);
  const needs = current.filter((v) => !v.opportunityId).length;
  const fresh = inbox.filter((e) => e.status === 'new' && e.kind === 'offers').length;
  const running = background && (background.phase === 'listing' || background.phase === 'reading');
  return (
    <section className="panel inbox-card" id="gmail-import" aria-labelledby="inbox-card-title">
      <div className="inbox-import-main">
        <span className="inbox-import-icon">
          <Mail size={22} />
        </span>
        <div>
          <h2 id="inbox-card-title">Recruiter inbox</h2>
          <p className="small muted" role="status">
            {running
              ? `Checking your recruiter emails… ${background!.done}/${background!.todo || '?'}`
              : inbox.length
                ? `${current.length} current vacancies from ${inbox.length} emails${needs ? ` · ${needs} need a detail` : ''}${fresh ? ` · ${fresh} new emails` : ''}.`
                : 'Import your recruiter emails, or paste an advert.'}
          </p>
        </div>
      </div>
      <div className="button-row">
        <button className="button primary" disabled={!!running} onClick={onImport}>
          <RefreshCw size={15} /> Import offers
        </button>
        <button className="button secondary" onClick={onPaste}>
          <ClipboardPaste size={15} /> Add an advert
        </button>
        {inbox.length > 0 && (
          <button className="text-button" onClick={onOpen}>
            Open inbox
          </button>
        )}
      </div>
    </section>
  );
}
