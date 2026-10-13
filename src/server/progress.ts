/**
 * In-process progress log for collection runs. The app is a single local
 * process, so a bounded in-memory buffer is enough for the Discover page to
 * poll while a long collection request is still running. Nothing here is
 * persisted; durable outcomes are recorded as collection runs.
 */
export interface LogLine {
  seq: number;
  at: string;
  sourceId: string;
  level: 'info' | 'warn' | 'error';
  text: string;
}
const state = globalThis as typeof globalThis & {
  radarLog?: { seq: number; lines: LogLine[] };
  radarStop?: boolean;
};
const buffer = () => (state.radarLog ??= { seq: 0, lines: [] });

export function log(sourceId: string, text: string, level: LogLine['level'] = 'info') {
  const b = buffer();
  b.lines.push({ seq: ++b.seq, at: new Date().toISOString(), sourceId, level, text });
  if (b.lines.length > 500) b.lines.splice(0, b.lines.length - 500);
}
export function logSince(seq: number) {
  const b = buffer();
  return { seq: b.seq, lines: b.lines.filter((l) => l.seq > seq) };
}
/** Asks running collectors to stop at the next page boundary. */
export function requestStop(value = true) {
  state.radarStop = value;
}
export const stopRequested = () => state.radarStop === true;
