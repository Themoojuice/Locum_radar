'use client';
import { useState } from 'react';
import { Plus, Trash2, ShieldCheck, MapPin, CalendarDays, Check } from 'lucide-react';
import { grades, specialties, states, profileSchema, type Profile } from '@/domain/model';
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
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const change = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setP((prev) => ({ ...prev, [key]: value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const result = profileSchema.safeParse({
      ...p,
      credentials: p.credentials.filter((c) => c.trim()),
    });
    if (!result.success) {
      setError(result.error.issues.map((i) => i.message).join(' · '));
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
  return (
    <form onSubmit={save} className="profile-form">
      <div className="page-intro">
        <p className="eyebrow">PERSONALISATION</p>
        <h1>Make this radar yours.</h1>
        <p>Your qualifications determine suitability. Your preferences determine the order.</p>
      </div>
      {demo && (
        <div className="notice">
          You’re editing an example profile. Switch to My workspace to enter your own details.
        </div>
      )}
      <section className="panel">
        <h2>
          <ShieldCheck size={20} /> Professional profile
        </h2>
        <p className="muted">
          Declare only grades and credentials you have confirmed. Blank details stay unknown.
        </p>
        <div className="form-grid">
          <label>
            Profile name
            <input value={p.name} onChange={(e) => change('name', e.target.value)} required />
          </label>
          <label>
            Home base
            <input value={p.homeBase} onChange={(e) => change('homeBase', e.target.value)} />
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
          <label>
            Can provide independent cover
            <select
              value={p.independentCover}
              onChange={(e) =>
                change('independentCover', e.target.value as Profile['independentCover'])
              }
            >
              <option value="unknown">Not yet confirmed</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Requires supervision
            <select
              value={p.supervisionRequired}
              onChange={(e) =>
                change('supervisionRequired', e.target.value as Profile['supervisionRequired'])
              }
            >
              <option value="unknown">Not yet confirmed</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Confirmed eligible grades</legend>
          <div className="check-chips">
            {grades.map((g) => (
              <label key={g}>
                <input
                  type="checkbox"
                  checked={p.eligibleGrades.includes(g)}
                  onChange={(e) =>
                    change(
                      'eligibleGrades',
                      e.target.checked
                        ? [...p.eligibleGrades, g]
                        : p.eligibleGrades.filter((v) => v !== g),
                    )
                  }
                />
                {g}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Credentials, separated by commas
          <input
            value={p.credentials.join(', ')}
            onChange={(e) =>
              change(
                'credentials',
                e.target.value.split(',').map((s) => s.trim()),
              )
            }
            placeholder="e.g. ALS, FRANZCP — only if held"
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={p.credentialsConfirmed}
            onChange={(e) => change('credentialsConfirmed', e.target.checked)}
          />
          I have checked this list; credentials not listed are not held.
        </label>
      </section>
      <section className="panel">
        <h2>
          <MapPin size={20} /> Where & what
        </h2>
        <fieldset>
          <legend>Clinical interests</legend>
          <div className="check-chips">
            {specialties.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={p.preferredSpecialties.includes(s)}
                  onChange={(e) =>
                    change(
                      'preferredSpecialties',
                      e.target.checked
                        ? [...p.preferredSpecialties, s]
                        : p.preferredSpecialties.filter((v) => v !== s),
                    )
                  }
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Preferred states · a ranking preference</legend>
          <div className="check-chips">
            {states.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={p.preferredStates.includes(s)}
                  onChange={(e) =>
                    change(
                      'preferredStates',
                      e.target.checked
                        ? [...p.preferredStates, s]
                        : p.preferredStates.filter((v) => v !== s),
                    )
                  }
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Excluded states · a hard restriction</legend>
          <div className="check-chips">
            {states.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={p.excludedStates.includes(s)}
                  onChange={(e) =>
                    change(
                      'excludedStates',
                      e.target.checked
                        ? [...p.excludedStates, s]
                        : p.excludedStates.filter((v) => v !== s),
                    )
                  }
                />
                {s}
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <section className="panel">
        <h2>
          <CalendarDays size={20} /> Time & remuneration
        </h2>
        <p className="muted">
          No availability entered means no date restriction. Placement dates must fit completely
          inside a window.
        </p>
        {p.availability.map((a, i) => (
          <div className="availability-row" key={i}>
            <label>
              Available from
              <input
                type="date"
                value={a.start}
                onChange={(e) =>
                  change(
                    'availability',
                    p.availability.map((v, j) => (j === i ? { ...v, start: e.target.value } : v)),
                  )
                }
                required
              />
            </label>
            <label>
              Until
              <input
                type="date"
                value={a.end}
                onChange={(e) =>
                  change(
                    'availability',
                    p.availability.map((v, j) => (j === i ? { ...v, end: e.target.value } : v)),
                  )
                }
                required
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove availability ${i + 1}`}
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
        ))}
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            change('availability', [...p.availability, { start: '2027-01-01', end: '2027-12-31', kind: 'available', note: '' }])
          }
        >
          <Plus size={16} /> Add availability
        </button>
        <div className="form-grid spacing">
          <label>
            Minimum comparable hourly rate (AUD)
            <input
              type="number"
              min="0"
              max="5000"
              value={p.minimumHourly}
              onChange={(e) => change('minimumHourly', Number(e.target.value))}
            />
          </label>
          <label>
            Target hourly rate (AUD)
            <input
              type="number"
              min="1"
              max="5000"
              value={p.targetHourly}
              onChange={(e) => change('targetHourly', Number(e.target.value))}
            />
          </label>
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
        </div>
        <p className="small muted">
          Unknown rates stay discoverable. The minimum applies only when an hourly comparison is
          supported.
        </p>
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
