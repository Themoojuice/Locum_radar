'use client';
import { useRef, useState } from 'react';
import { ImagePlus, Sparkles, X } from 'lucide-react';
import { api } from './shared';
import { compressImage, dollars } from './inbox-import';

interface Shot {
  mediaType: 'image/jpeg';
  data: string;
  preview: string;
}
export interface PasteResult {
  id: string;
  kind: string;
  vacancies: number;
  added: number;
  summary: string;
  cost: number;
}

/**
 * Paste box: recruiter texts, WhatsApp messages, Facebook posts or screenshots.
 * Claude reads them into the same vacancy rows as emails.
 */
export function PastePanel({
  claudeKey,
  onNeedKey,
  onDone,
}: {
  claudeKey: boolean;
  onNeedKey: () => void;
  onDone: (result: PasteResult) => Promise<void>;
}) {
  const [text, setText] = useState(''),
    [shots, setShots] = useState<Shot[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [last, setLast] = useState<PasteResult | null>(null),
    [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function addFiles(files: Iterable<File>) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    try {
      const next = await Promise.all(images.map(compressImage));
      setShots((s) => [...s, ...next].slice(0, 4));
    } catch {
      setError('That image could not be opened.');
    }
  }
  async function read() {
    setBusy(true);
    setError('');
    try {
      const result: PasteResult = await api({
        command: 'inbox-paste',
        text,
        images: shots.map(({ mediaType, data }) => ({ mediaType, data })),
      });
      setLast(result);
      setText('');
      setShots([]);
      await onDone(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`panel paste-panel ${dragging ? 'dragging' : ''}`}
      aria-label="Add an advert"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
    >
      <h2>
        <Sparkles size={17} /> Add an advert
      </h2>
      <p className="small muted">
        Paste a recruiter’s text, WhatsApp message, Facebook post or email, or add screenshots
        (drop, paste or choose up to four). Claude reads the vacancies into your inbox.
      </p>
      {!claudeKey && (
        <p className="notice small">
          This needs your Anthropic API key.{' '}
          <button className="text-button" onClick={onNeedKey}>
            Add it in Settings
          </button>
        </p>
      )}
      <label>
        <span className="sr-only">Advert text</span>
        <textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.items]
              .filter((i) => i.kind === 'file')
              .map((i) => i.getAsFile())
              .filter((f): f is File => !!f);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          placeholder={
            'e.g. "Mackay Base ED SRMO 3–17 Jan, $165/hr + super, flights and accom provided"'
          }
        />
      </label>
      <div className="paste-shots">
        {shots.map((s, i) => (
          <figure key={i}>
            <img src={s.preview} alt={`Screenshot ${i + 1}`} />
            <button
              className="icon-button"
              aria-label={`Remove screenshot ${i + 1}`}
              onClick={() => setShots(shots.filter((_, j) => j !== i))}
            >
              <X size={14} />
            </button>
          </figure>
        ))}
        {shots.length < 4 && (
          <button className="paste-add" onClick={() => input.current?.click()}>
            <ImagePlus size={18} />
            <span>Add screenshot</span>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="button-row">
        <button
          className="button primary"
          disabled={busy || !claudeKey || (!text.trim() && !shots.length)}
          onClick={() => void read()}
        >
          {busy ? 'Reading…' : 'Read it'}
        </button>
        {last && !busy && (
          <span className="small muted">
            Last: {last.summary || `${last.vacancies} vacancies`} ({dollars(last.cost)})
          </span>
        )}
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
