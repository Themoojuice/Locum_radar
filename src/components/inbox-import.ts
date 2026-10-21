import { api } from './shared';

/** Progress of one Gmail import, shared by the inbox page and background auto-import. */
export interface ImportProgress {
  phase: 'listing' | 'reading' | 'done' | 'stopped';
  total: number;
  todo: number;
  done: number;
  offers: number;
  vacancies: number;
  added: number;
  claude: number;
  cost: number;
  notices: string[];
}
export const emptyProgress = (): ImportProgress => ({
  phase: 'listing',
  total: 0,
  todo: 0,
  done: 0,
  offers: 0,
  vacancies: 0,
  added: 0,
  claude: 0,
  cost: 0,
  notices: [],
});

/** Lists new recruiter emails, then reads them 8 at a time, reporting after each batch. */
export async function runInboxImport(options: {
  days?: number;
  reread?: boolean;
  onProgress: (p: ImportProgress) => void;
  onBatch?: () => Promise<void>;
  stopped?: () => boolean;
}) {
  const p = emptyProgress();
  options.onProgress({ ...p });
  const list: { total: number; ids: string[] } = await api({
    command: 'inbox-list',
    ...(options.days ? { days: options.days } : {}),
    reread: !!options.reread,
  });
  Object.assign(p, { phase: 'reading', total: list.total, todo: list.ids.length });
  options.onProgress({ ...p });
  for (let i = 0; i < list.ids.length && !options.stopped?.(); i += 8) {
    const r = await api({ command: 'inbox-read', ids: list.ids.slice(i, i + 8) });
    p.done += r.read;
    p.offers += r.offers;
    p.vacancies += r.vacancies;
    p.added += r.added;
    p.claude += r.claude ?? 0;
    p.cost += r.cost ?? 0;
    p.notices = [...new Set([...p.notices, ...(r.notices ?? [])])];
    options.onProgress({ ...p });
    await options.onBatch?.();
  }
  p.phase = options.stopped?.() ? 'stopped' : 'done';
  options.onProgress({ ...p });
  return p;
}

/** Hours since the most recent import, or Infinity when nothing has been imported. */
export function hoursSinceImport(inbox: { importedAt: string; origin?: string }[]) {
  const last = inbox
    .filter((e) => e.origin !== 'paste')
    .map((e) => Date.parse(e.importedAt))
    .sort((a, b) => b - a)[0];
  return last ? (Date.now() - last) / 3600000 : Infinity;
}

export const dollars = (v: number) =>
  v < 0.01 ? `${(v * 100).toFixed(2)}¢` : `$${v.toFixed(v < 1 ? 3 : 2)}`;

/** Shrinks a screenshot to at most 1600 px and re-encodes it as JPEG for upload. */
export async function compressImage(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.82);
  return { mediaType: 'image/jpeg' as const, data: url.split(',')[1], preview: url };
}
