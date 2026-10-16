import { it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveCredentials, credential, installationKey } from '@/server/credentials';
let directory = '';
afterEach(() => {
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});
it('persists encrypted credentials, preserves other providers and supports environment fallback', () => {
  directory = mkdtempSync(path.join(tmpdir(), 'radar-credentials-'));
  vi.stubEnv('RADAR_SECRETS_DIR', directory);
  vi.stubEnv('ADZUNA_APP_ID', 'env-id');
  expect(credential('ADZUNA_APP_ID')).toBe('env-id');
  saveCredentials({ GMAIL_CLIENT_SECRET: 'private-secret' });
  saveCredentials({ BRAVE_SEARCH_API_KEY: 'search-secret' });
  expect(credential('GMAIL_CLIENT_SECRET')).toBe('private-secret');
  expect(credential('BRAVE_SEARCH_API_KEY')).toBe('search-secret');
  expect(
    readFileSync(path.join(directory, 'providers.enc')).includes(Buffer.from('private-secret')),
  ).toBe(false);
  expect(installationKey()).toEqual(installationKey());
});

it('setup status never returns secrets and rejects cross-origin writes', async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'radar-setup-'));
  vi.stubEnv('RADAR_SECRETS_DIR', directory);
  vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3000');
  vi.stubEnv('APP_PASSWORD', '');
  const { GET, POST } = await import('@/app/api/setup/route');
  const blocked = await POST(
    new Request('http://127.0.0.1:3000/api/setup', {
      method: 'POST',
      headers: { origin: 'https://other.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ BRAVE_SEARCH_API_KEY: 'must-not-save' }),
    }),
  );
  expect(blocked.status).toBe(400);
  expect(credential('BRAVE_SEARCH_API_KEY')).not.toBe('must-not-save');
  const accepted = await POST(
    new Request('http://127.0.0.1:3000/api/setup', {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ BRAVE_SEARCH_API_KEY: 'private-search-key' }),
    }),
  );
  expect(accepted.status).toBe(200);
  const response = await GET(new Request('http://127.0.0.1:3000/api/setup'));
  const body = await response.text();
  expect(body).not.toContain('private-search-key');
  expect(JSON.parse(body).configured.BRAVE_SEARCH_API_KEY).toBe(true);
});
