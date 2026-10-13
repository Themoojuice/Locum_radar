'use client';
import { useEffect, useRef } from 'react';
import {
  BellRing,
  CircleDollarSign,
  Clock,
  Sparkles,
  TrendingUp,
  Bookmark,
  CalendarCheck,
  X,
} from 'lucide-react';
import { alertLabels, type Alert, type AlertKind } from '@/domain/insights';

const icons: Record<AlertKind, typeof BellRing> = {
  'new-high': Sparkles,
  rate: TrendingUp,
  'better-offer': CircleDollarSign,
  urgent: Clock,
  'future-match': CalendarCheck,
  'saved-change': Bookmark,
};
const ago = (at: string) => {
  const h = (Date.now() - Date.parse(at)) / 3600000;
  return h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
};

/** In-app alerts. One per vacancy and kind; nothing is sent outside the app. */
export function AlertsDrawer({
  alerts,
  onClose,
  onOpen,
  onMarkRead,
  threshold,
}: {
  alerts: Alert[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onMarkRead: () => void;
  threshold: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const unread = alerts.filter((a) => a.unread).length;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="alerts-drawer"
        ref={ref}
        tabIndex={-1}
        aria-label="Alerts"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="spread">
          <div>
            <p className="eyebrow">WORTH KNOWING</p>
            <h2>{unread ? `${unread} new` : 'All caught up'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close alerts">
            <X size={20} />
          </button>
        </header>
        <p className="small muted">
          New jobs scoring {threshold}+, material rate changes, better competing offers, exceptional
          urgent jobs, blocks that fit your plans, and changes to jobs you track. A vacancy
          advertised by several agencies is announced once.
        </p>
        {unread > 0 && (
          <button className="text-button small" onClick={onMarkRead}>
            Mark all as read
          </button>
        )}
        <ul className="alert-list">
          {alerts.slice(0, 80).map((a) => {
            const Icon = icons[a.kind];
            return (
              <li key={a.id} className={a.unread ? 'unread' : ''}>
                <button onClick={() => onOpen(a.opportunityId)}>
                  <Icon size={17} />
                  <span>
                    <small>
                      {alertLabels[a.kind]} · {ago(a.at)}
                    </small>
                    <strong>{a.title}</strong>
                    <span className="small muted">{a.detail}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {!alerts.length && (
            <li className="muted small">
              Nothing yet. Alerts come from collection runs and imports.
            </li>
          )}
        </ul>
      </aside>
    </div>
  );
}
