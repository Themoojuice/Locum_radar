'use client';
import { useEffect, useState } from 'react';
export function ProviderSetup({
  kind,
  onSaved,
}: {
  kind: 'gmail' | 'adzuna' | 'search';
  onSaved?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({}),
    [configured, setConfigured] = useState<Record<string, boolean>>({}),
    [redirect, setRedirect] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json())
      .then((v) => {
        setConfigured(v.configured || {});
        setRedirect(v.redirectUri || '');
      })
      .catch(() => setMessage('Could not load connection settings'));
  }, []);
  const fields =
    kind === 'gmail'
      ? [
          ['GMAIL_CLIENT_ID', 'Google client ID'],
          ['GMAIL_CLIENT_SECRET', 'Google client secret'],
        ]
      : kind === 'adzuna'
        ? [
            ['ADZUNA_APP_ID', 'Adzuna app ID'],
            ['ADZUNA_APP_KEY', 'Adzuna app key'],
          ]
        : [['BRAVE_SEARCH_API_KEY', 'Brave Search API key']];
  return (
    <section aria-label={`${kind} connection setup`}>
      {kind === 'gmail' ? (
        <>
          <h3>One-time Google setup</h3>
          <ol>
            <li>
              <a
                href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                target="_blank"
                rel="noreferrer"
              >
                Open Google Cloud and enable Gmail API
              </a>{' '}
              in a project you own.
            </li>
            <li>
              <a
                href="https://console.cloud.google.com/auth/branding"
                target="_blank"
                rel="noreferrer"
              >
                Set up Google Auth
              </a>
              : name the app Locum Radar, choose External if asked, and add your Gmail address under
              Audience → Test users.
            </li>
            <li>
              <a
                href="https://console.cloud.google.com/auth/clients"
                target="_blank"
                rel="noreferrer"
              >
                Create an OAuth client
              </a>
              , choose Web application, and add this authorised redirect URI:
              <input aria-label="Google redirect URI" readOnly value={redirect} />
              <button
                className="button secondary small"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(redirect)
                    .then(() => setMessage('Redirect URI copied'))
                    .catch(() => setMessage('Select and copy the redirect URI above'));
                }}
              >
                Copy redirect URI
              </button>
            </li>
            <li>Paste its client ID and secret below, save, then connect your Google account.</li>
          </ol>
          <p className="small muted">
            If Google says access is blocked, check that your address is a test user. A redirect
            mismatch means the URI must exactly match the field above. Testing-mode consent can
            expire and require reconnecting.
          </p>
        </>
      ) : (
        <p>
          <a
            href={
              kind === 'adzuna'
                ? 'https://developer.adzuna.com/'
                : 'https://api-dashboard.search.brave.com/'
            }
            target="_blank"
            rel="noreferrer"
          >
            Open {kind === 'adzuna' ? 'Adzuna developer account' : 'Brave Search API dashboard'}
          </a>
          , create your own API credentials and paste them here.
        </p>
      )}
      {fields.map(([key, label]) => (
        <label key={key}>
          {label}
          {configured[key] ? ' · saved' : ''}
          <input
            type="password"
            autoComplete="off"
            value={values[key] || ''}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            placeholder={configured[key] ? 'Saved — leave blank to keep' : 'Paste here'}
          />
        </label>
      ))}
      <button
        className="button secondary"
        disabled={busy || !fields.every(([key]) => configured[key] || values[key]?.trim())}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await fetch('/api/setup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(
                Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim())),
              ),
            });
            const v = await r.json();
            if (!r.ok) throw Error(v.error);
            setConfigured({
              ...configured,
              ...Object.fromEntries(fields.map(([key]) => [key, true])),
            });
            setValues({});
            setMessage('Connection settings saved. No restart needed.');
            onSaved?.();
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save connection settings
      </button>
      <p className="small muted">
        Secrets stay encrypted in this installation and are never included in job exports.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
