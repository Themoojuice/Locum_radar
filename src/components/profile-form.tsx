'use client';
import { useState } from 'react';
import {
  Bell,
  CalendarDays,
  Check,
  Leaf,
  MapPin,
  Plus,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  availabilityKinds,
  availabilityLabels,
  grades,
  profileSchema,
  specialties,
  states,
  type AvailabilityKind,
  type Profile,
} from '@/domain/model';

function Chips<T extends string>({
  legend,
  options,
  value,
  onChange,
  hint,
}: {
  legend: string;
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  hint?: string;
}) {
  return (
    <fieldset>
      <legend>
        {legend}
        {hint && <span className="legend-hint"> · {hint}</span>}
      </legend>
      <div className="check-chips">
        {options.map((o) => (
          <label key={o}>
            <input
              type="checkbox"
              checked={value.includes(o)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, o] : value.filter((v) => v !== o))
              }
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
const list = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const num = (v: string) => (v === '' ? null : Number(v));

export function ProfileForm({
  profile,
  demo,
  onSave,
}: {
  profile: Profile;
  demo: boolean;
  onSave: (p: Profile) => Promise<void>;
}) {
  const [p, setP] = useState(structuredClone(profile));
  // Comma lists are edited as text and parsed on save, so typing a comma is not swallowed.
  const [text, setText] = useState({
    credentials: profile.credentials.join(', '),
    fellowships: profile.fellowships.join(', '),
    procedures: profile.procedures.join(', '),
  });
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const change = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setP((prev) => ({ ...prev, [key]: value }));
  const cost = (key: keyof Profile['costs'], value: number | null) =>
    change('costs', { ...p.costs, [key]: value });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = profileSchema.safeParse({
      ...p,
      credentials: list(text.credentials),
      fellowships: list(text.fellowships),
      procedures: list(text.procedures),
    });
    if (!result.success) {
      setError(result.error.issues.map((i) => `${i.path.join(' › ')}: ${i.message}`).join(' · '));
      return;
    }
    setBusy(true);
    try {
      await onSave(result.data);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const tri = (key: 'independentCover' | 'supervisionRequired', label: string) => (
    <label>
      {label}
      <select value={p[key]} onChange={(e) => change(key, e.target.value as Profile[typeof key])}>
        <option value="unknown">Not yet confirmed</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
  return (
    <form onSubmit={save} className="profile-form">
      <div className="page-intro">
        <p className="eyebrow">PERSONALISATION</p>
        <h1>Make this radar yours.</h1>
        <p>
          Qualifications decide eligibility. Your calendar decides what is feasible. Your
          preferences decide the order. They never share a threshold.
        </p>
      </div>
      {demo && (
        <div className="notice">
          You’re editing an example profile. Switch to My workspace to enter your own details.
        </div>
      )}

      <section className="panel">
        <h2>
          <ShieldCheck size={20} /> Professional eligibility
        </h2>
        <p className="muted">
          Declare only what you have confirmed. Anything blank stays unknown and shows as “verify”,
          never as “eligible”.
        </p>
        <div className="form-grid">
          <label>
            Profile name
            <input value={p.name} onChange={(e) => change('name', e.target.value)} required />
          </label>
          <label>
            Home base (town, state)
            <input
              value={p.homeBase}
              onChange={(e) => change('homeBase', e.target.value)}
              placeholder="Cairns, QLD"
            />
          </label>
          <label>
            Registration
            <select
              value={p.registration}
              onChange={(e) => change('registration', e.target.value as Profile['registration'])}
            >
              <option value="unknown">Not yet confirmed</option>
              <option value="general">General</option>
              <option value="specialist">Specialist</option>
              <option value="limited">Limited</option>
            </select>
          </label>
          <label>
            Postgraduate year
            <input
              type="number"
              min="1"
              max="60"
              value={p.pgy ?? ''}
              placeholder="Not yet confirmed"
              onChange={(e) => change('pgy', e.target.value ? Number(e.target.value) : null)}
            />
          </label>
          {tri('independentCover', 'Can provide independent cover')}
          {tri('supervisionRequired', 'Requires supervision')}
          <label>
            Employer or training-program approval for locum work
            <select
              value={p.employmentApproval}
              onChange={(e) =>
                change('employmentApproval', e.target.value as Profile['employmentApproval'])
              }
            >
              <option value="unknown">Not yet confirmed</option>
              <option value="not needed">Not needed</option>
              <option value="needed">Needed, not yet granted</option>
              <option value="approved">Approved</option>
            </select>
          </label>
          <label>
            Restriction notes
            <input
              value={p.restrictionNotes}
              onChange={(e) => change('restrictionNotes', e.target.value)}
              placeholder="e.g. no locums during accredited rotation"
            />
          </label>
        </div>
        <Chips
          legend="Grades you work at"
          options={grades}
          value={p.eligibleGrades}
          onChange={(v) => change('eligibleGrades', v)}
        />
        <Chips
          legend="Specialties you are competent to work in"
          hint="eligibility, not preference"
          options={specialties}
          value={p.competentSpecialties}
          onChange={(v) => change('competentSpecialties', v)}
        />
        <div className="form-grid">
          <label>
            Credentials held (comma-separated)
            <input
              value={text.credentials}
              onChange={(e) => setText({ ...text, credentials: e.target.value })}
              placeholder="ALS, WWCC"
            />
          </label>
          <label>
            Fellowships held
            <input
              value={text.fellowships}
              onChange={(e) => setText({ ...text, fellowships: e.target.value })}
              placeholder="FRANZCP — only if awarded"
            />
          </label>
          <label>
            Procedures you perform independently
            <input
              value={text.procedures}
              onChange={(e) => setText({ ...text, procedures: e.target.value })}
              placeholder="ECT, intubation"
            />
          </label>
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={p.credentialsConfirmed}
            onChange={(e) => change('credentialsConfirmed', e.target.checked)}
          />
          I have checked my credentials; any not listed are not held.
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={p.fellowshipsConfirmed}
            onChange={(e) => change('fellowshipsConfirmed', e.target.checked)}
          />
          I have checked my fellowships; an empty list means none.
        </label>
      </section>

      <section className="panel">
        <h2>
          <MapPin size={20} /> What you want
        </h2>
        <Chips
          legend="Preferred specialties"
          hint="ranking preference"
          options={specialties}
          value={p.preferredSpecialties}
          onChange={(v) => change('preferredSpecialties', v)}
        />
        <Chips
          legend="Preferred states"
          hint="ranking preference"
          options={states}
          value={p.preferredStates}
          onChange={(v) => change('preferredStates', v)}
        />
        <Chips
          legend="Excluded states"
          hint="hidden by default"
          options={states}
          value={p.excludedStates}
          onChange={(v) => change('excludedStates', v)}
        />
      </section>

      <section className="panel">
        <h2>
          <CalendarDays size={20} /> Your calendar
        </h2>
        <p className="muted">
          Hard conflicts hide a job by default. Negotiable commitments and provisional leave keep it
          visible with a warning; the app never assumes leave or release is approved.
        </p>
        {p.availability.map((a, i) => {
          const update = (patch: Partial<typeof a>) =>
            change(
              'availability',
              p.availability.map((v, j) => (j === i ? { ...v, ...patch } : v)),
            );
          return (
            <div className={`availability-row kind-${a.kind}`} key={i}>
              <label>
                Kind
                <select
                  value={a.kind}
                  onChange={(e) => update({ kind: e.target.value as AvailabilityKind })}
                >
                  {availabilityKinds.map((k) => (
                    <option key={k} value={k}>
                      {availabilityLabels[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                From
                <input
                  type="date"
                  value={a.start}
                  onChange={(e) => update({ start: e.target.value })}
                  required
                />
              </label>
              <label>
                Until
                <input
                  type="date"
                  value={a.end}
                  onChange={(e) => update({ end: e.target.value })}
                  required
                />
              </label>
              <label className="grow">
                Note
                <input
                  value={a.note}
                  maxLength={200}
                  onChange={(e) => update({ note: e.target.value })}
                  placeholder="e.g. ED rotation, exam, leave requested"
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove calendar entry ${i + 1}`}
                onClick={() =>
                  change(
                    'availability',
                    p.availability.filter((_, j) => i !== j),
                  )
                }
              >
                <Trash2 size={18} />
              </button>
            </div>
          );
        })}
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            change('availability', [
              ...p.availability,
              { start: '2027-01-01', end: '2027-12-31', kind: 'available', note: '' },
            ])
          }
        >
          <Plus size={16} /> Add a calendar entry
        </button>
        <div className="form-grid spacing">
          <label>
            Maximum placement length (days)
            <input
              type="number"
              min="1"
              max="730"
              value={p.maxPlacementDays}
              onChange={(e) => change('maxPlacementDays', Number(e.target.value))}
            />
          </label>
          <label>
            Credentialing usually needs (days)
            <input
              type="number"
              min="0"
              max="180"
              value={p.credentialingLeadDays}
              onChange={(e) => change('credentialingLeadDays', Number(e.target.value))}
            />
          </label>
          <label>
            “Urgent” means starting within (days)
            <input
              type="number"
              min="1"
              max="90"
              value={p.urgency.urgentDays}
              onChange={(e) =>
                change('urgency', { ...p.urgency, urgentDays: Number(e.target.value) })
              }
            />
          </label>
          <label>
            “Near-term” within (days)
            <input
              type="number"
              min="2"
              max="180"
              value={p.urgency.nearTermDays}
              onChange={(e) =>
                change('urgency', { ...p.urgency, nearTermDays: Number(e.target.value) })
              }
            />
          </label>
          <label>
            “Medium-term” within (days)
            <input
              type="number"
              min="3"
              max="730"
              value={p.urgency.mediumTermDays}
              onChange={(e) =>
                change('urgency', { ...p.urgency, mediumTermDays: Number(e.target.value) })
              }
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>
          <Wallet size={20} /> Money
        </h2>
        <div className="form-grid">
          <label>
            Minimum comparable hourly (AUD)
            <input
              type="number"
              min="0"
              max="5000"
              value={p.minimumHourly}
              onChange={(e) => change('minimumHourly', Number(e.target.value))}
            />
          </label>
          <label>
            Target hourly (AUD)
            <input
              type="number"
              min="1"
              max="5000"
              value={p.targetHourly}
              onChange={(e) => change('targetHourly', Number(e.target.value))}
            />
          </label>
        </div>
        <p className="muted">
          Optional estimates. Leave blank and the app keeps those figures unknown. Every estimate is
          labelled wherever it is used.
        </p>
        <div className="form-grid">
          <label>
            Return travel when not included (AUD)
            <input
              type="number"
              min="0"
              value={p.costs.returnFlight ?? ''}
              placeholder="Do not estimate"
              onChange={(e) => cost('returnFlight', num(e.target.value))}
            />
          </label>
          <label>
            Accommodation per night when not included (AUD)
            <input
              type="number"
              min="0"
              value={p.costs.nightlyAccommodation ?? ''}
              placeholder="Do not estimate"
              onChange={(e) => cost('nightlyAccommodation', num(e.target.value))}
            />
          </label>
          <label>
            Paid hours per working day, when unstated
            <input
              type="number"
              min="1"
              max="24"
              step="0.5"
              value={p.costs.assumedHoursPerDay ?? ''}
              placeholder="Do not assume"
              onChange={(e) => cost('assumedHoursPerDay', num(e.target.value))}
            />
          </label>
          <label>
            Value of your unpaid travel time (AUD/h)
            <input
              type="number"
              min="0"
              value={p.costs.hourlyValueOfTime ?? ''}
              placeholder="Do not estimate"
              onChange={(e) => cost('hourlyValueOfTime', num(e.target.value))}
            />
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>
          <Leaf size={20} /> Nature lens & alerts
        </h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={p.nature.enabled}
            onChange={(e) => change('nature', { ...p.nature, enabled: e.target.checked })}
          />
          Score locations by species recorded nearby (Atlas of Living Australia)
        </label>
        <div className="form-grid">
          <label>
            What to look for (ALA query)
            <input
              value={p.nature.query}
              onChange={(e) => change('nature', { ...p.nature, query: e.target.value })}
              placeholder="family:Salticidae"
            />
          </label>
          <label>
            Call them
            <input
              value={p.nature.label}
              onChange={(e) => change('nature', { ...p.nature, label: e.target.value })}
              placeholder="jumping spider"
            />
          </label>
          <label>
            Within (km)
            <input
              type="number"
              min="5"
              max="100"
              value={p.nature.radiusKm}
              onChange={(e) => change('nature', { ...p.nature, radiusKm: Number(e.target.value) })}
            />
          </label>
        </div>
        <p className="small muted">
          Occurrence records measure naturalists as much as nature: busy towns look richer. Treat it
          as a nudge, not a survey.
        </p>
        <label>
          <span>
            <Bell size={14} /> Alert me to new jobs scoring at least {p.alertScore}
          </span>
          <input
            type="range"
            min="40"
            max="95"
            value={p.alertScore}
            onChange={(e) => change('alertScore', Number(e.target.value))}
          />
        </label>
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button disabled={busy} className="button primary" type="submit">
        <Check size={16} />
        {busy ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
