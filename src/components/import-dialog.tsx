'use client';
import { useState } from 'react';
import { FileUp, ArrowRight, Check, ChevronLeft } from 'lucide-react';
import {
  grades,
  specialties,
  states,
  listingInputSchema,
  type ListingInput,
  type Source,
} from '@/domain/model';
import type { Extraction } from '@/server/extraction';
import { api, Modal } from './shared';
export const importTemplate = `Title: Psychiatry registrar\nHospital: Cairns Hospital\nTown: Cairns\nState: QLD\nSpecialty: Psychiatry\nGrade: Registrar\nStart: 2027-01-11\nEnd: 2027-01-22\nRate: AUD 160/hour\nPaid hours: 80\nSuper: additional\nOn-call: none\nFlights: included\nAccommodation: included\nRegistration: general\nMinimum PGY: 3\nSupervision available: yes\nIndependent cover: no\nRequirements complete: no\nRoster: Monday–Friday day shifts\nHospital reference: EXAMPLE-REPLACE-ME\nListing ID: EXAMPLE-REPLACE-ME\nContact: Replace with recruiter contact\n\nEXAMPLE ONLY. Replace with the actual advertisement and verify every field before importing.`;
export function ImportDialog({
  sources,
  onClose,
  onImported,
  initial,
  reviewId,
}: {
  sources: Source[];
  onClose: () => void;
  onImported: () => Promise<void>;
  initial?: Partial<ListingInput>;
  reviewId?: string;
}) {
  const [content, setContent] = useState(''),
    [format, setFormat] = useState<'text' | 'eml' | 'json'>('text'),
    [sourceId, setSourceId] = useState(initial?.sourceId || 'manual');
  const [records, setRecords] = useState<Extraction[] | null>(
      initial ? [{ draft: initial, issues: [] }] : null,
    ),
    [index, setIndex] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const record = records?.[index];
  function change(key: string, value: unknown) {
    setConfirmed(false);
    setRecords((prev) =>
      prev!.map((r, i) => (i === index ? { ...r, draft: { ...r.draft, [key]: value } } : r)),
    );
  }
  async function preview() {
    setError('');
    setBusy(true);
    try {
      setRecords(await api({ command: 'preview', content, sourceId, format }));
      setIndex(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    setBusy(true);
    setError('');
    try {
      const listings = records!.map((r, i) => {
        const parsed = listingInputSchema.safeParse(r.draft);
        if (!parsed.success)
          throw new Error(
            `Advertisement ${i + 1}: ${parsed.error.issues.map((v) => `${v.path.join('.')}: ${v.message}`).join('; ')}`,
          );
        return {
          ...parsed.data,
          evidence: {
            ...parsed.data.evidence,
            userReview: `Fields reviewed by the user at ${new Date().toISOString()}; source text retained below.`,
          },
        };
      });
      await api({ command: 'import', listings, reviewId });
      await onImported();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={records ? 'Review extracted advertisements' : 'Bring an opportunity into view'}
      onClose={onClose}
      wide
    >
      {!records ? (
        <>
          <p className="muted">
            Paste a recruiter message or advertisement, upload an email (.eml), or import structured
            JSON. Nothing is saved before you review it.
          </p>
          <div className="form-grid">
            <label>
              Source
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Format
              <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <option value="text">Pasted text or HTML</option>
                <option value="eml">Email (.eml)</option>
                <option value="json">Structured JSON</option>
              </select>
            </label>
          </div>
          <label className="upload-zone">
            <FileUp size={24} />
            <span>Choose a .txt, .eml or .json file</span>
            <input
              type="file"
              accept=".txt,.eml,.json,.html"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 1000000) {
                  setError('Choose a file under 1 MB.');
                  return;
                }
                setContent(await file.text());
                setFormat(
                  file.name.endsWith('.eml')
                    ? 'eml'
                    : file.name.endsWith('.json')
                      ? 'json'
                      : 'text',
                );
                if (file.name.endsWith('.eml')) setSourceId('email');
              }}
            />
          </label>
          <label>
            Advertisement text
            <textarea
              rows={12}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste the original advertisement here. Separate multiple advertisements with a line containing ---"
            />
          </label>
          <div className="spread">
            <button
              className="text-button"
              onClick={() => {
                setContent(importTemplate);
                setFormat('text');
              }}
            >
              Use labelled example
            </button>
            <span className="small muted">Local parsing · no AI service receives this text</span>
          </div>
          <p className="small muted">
            The first parser recognises explicit labelled fields. Free-form prose will need
            corrections in the next step. Email attachments are not extracted.
          </p>
          <button className="button primary" disabled={!content.trim() || busy} onClick={preview}>
            {busy ? 'Reading…' : 'Extract & review'}
            <ArrowRight size={16} />
          </button>
        </>
      ) : (
        record && (
          <>
            <div className="spread">
              <span className="eyebrow">
                ADVERTISEMENT {index + 1} OF {records.length}
              </span>
              <div className="button-row">
                <button
                  className="button secondary small"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  Previous
                </button>
                <button
                  className="button secondary small"
                  disabled={index === records.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  Next
                </button>
              </div>
            </div>
            {record.issues.length > 0 && (
              <div className="notice small">
                <strong>Review needed</strong>
                <ul>
                  {record.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="form-grid spacing">
              {(['title', 'facilityName', 'town', 'externalId'] as const).map((key) => (
                <label key={key}>
                  {
                    {
                      title: 'Title',
                      facilityName: 'Hospital / facility',
                      town: 'Town',
                      externalId: 'Source listing ID',
                    }[key]
                  }
                  <input
                    value={record.draft[key] ?? ''}
                    onChange={(e) => change(key, e.target.value)}
                    required
                  />
                </label>
              ))}
              <label>
                State
                <select
                  value={record.draft.state || ''}
                  onChange={(e) => change('state', e.target.value)}
                >
                  <option value="">Choose…</option>
                  {states.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Specialty
                <select
                  value={record.draft.specialty || ''}
                  onChange={(e) => change('specialty', e.target.value)}
                >
                  <option value="">Choose…</option>
                  {specialties.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Grade
                <select
                  value={record.draft.grade || ''}
                  onChange={(e) => change('grade', e.target.value)}
                >
                  <option value="">Choose…</option>
                  {grades.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Original URL
                <input
                  value={record.draft.url ?? ''}
                  onChange={(e) => change('url', e.target.value || null)}
                  type="url"
                />
              </label>
              <label>
                Start date
                <input
                  type="date"
                  value={record.draft.startDate ?? ''}
                  onChange={(e) => change('startDate', e.target.value)}
                />
              </label>
              <label>
                End date
                <input
                  type="date"
                  value={record.draft.endDate ?? ''}
                  onChange={(e) => change('endDate', e.target.value)}
                />
              </label>
              <label>
                Advertised rate (AUD)
                <input
                  type="number"
                  min="0"
                  value={record.draft.compensation?.amount ?? ''}
                  onChange={(e) =>
                    change('compensation', {
                      ...record.draft.compensation,
                      amount: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </label>
              <label>
                Rate unit
                <select
                  value={record.draft.compensation?.basis || 'unknown'}
                  onChange={(e) =>
                    change('compensation', { ...record.draft.compensation, basis: e.target.value })
                  }
                >
                  {['unknown', 'hour', 'day', 'shift', 'placement'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            <details className="details-block">
              <summary>Full record · requirements, inclusions & pay details</summary>
              <p className="small muted">
                Advanced editor. Leave unknown fields as null. Source evidence is retained. The
                schema is checked again when saving.
              </p>
              <textarea
                aria-label="Full extracted JSON record"
                rows={18}
                key={`${index}-${JSON.stringify(record.draft)}`}
                defaultValue={JSON.stringify(record.draft, null, 2)}
                onBlur={(e) => {
                  try {
                    const value = JSON.parse(e.target.value);
                    if (JSON.stringify(value) !== JSON.stringify(record.draft)) {
                      setRecords((prev) =>
                        prev!.map((r, i) => (i === index ? { ...r, draft: value } : r)),
                      );
                      setConfirmed(false);
                    }
                    setError('');
                  } catch {
                    setError('The full record contains invalid JSON. Correct it before importing.');
                  }
                }}
              />
            </details>
            <details className="details-block">
              <summary>Original source text</summary>
              <pre className="evidence">{record.draft.rawText}</pre>
            </details>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed all {records.length} advertisement(s), including the dates, requirements
              and unknown fields.
            </label>
            <div className="spread">
              <button
                className="text-button"
                onClick={() => {
                  setRecords(null);
                  setConfirmed(false);
                }}
              >
                <ChevronLeft size={16} /> Back
              </button>
              <button
                className="button primary"
                disabled={!confirmed || busy || !!error}
                onClick={commit}
              >
                <Check size={16} />
                {busy
                  ? 'Importing…'
                  : `Import ${records.length} advertisement${records.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
          <button className="text-button" onClick={() => setError('')}>
            Dismiss
          </button>
        </p>
      )}
    </Modal>
  );
}
