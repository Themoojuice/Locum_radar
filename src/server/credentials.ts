import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
export const credentialNames = [
  'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET',
  'ADZUNA_APP_ID',
  'ADZUNA_APP_KEY',
  'BRAVE_SEARCH_API_KEY',
  'ANTHROPIC_API_KEY',
] as const;
export type CredentialName = (typeof credentialNames)[number];
const directory = () =>
  path.resolve(/* turbopackIgnore: true */ process.env.RADAR_SECRETS_DIR || 'data/secrets');
export function installationKey(): Buffer {
  mkdirSync(directory(), { recursive: true });
  const file = path.join(directory(), 'installation.key');
  try {
    return Buffer.from(readFileSync(file, 'utf8'), 'hex');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  try {
    writeFileSync(file, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return Buffer.from(readFileSync(file, 'utf8'), 'hex');
}
function saved(): Partial<Record<CredentialName, string>> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path.join(directory(), 'providers.enc'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw e;
  }
  const decipher = createDecipheriv('aes-256-gcm', installationKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(),
  );
}
export function credential(name: CredentialName): string {
  return saved()[name] || process.env[name] || '';
}
export function providerEnvironment() {
  return {
    ...process.env,
    ...Object.fromEntries(credentialNames.map((name) => [name, credential(name)])),
  };
}
export function saveCredentials(values: Partial<Record<CredentialName, string>>) {
  const data = { ...saved(), ...values };
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', installationKey(), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  const file = path.join(directory(), 'providers.enc'),
    temp = file + '.' + randomBytes(6).toString('hex') + '.tmp';
  writeFileSync(temp, Buffer.concat([iv, cipher.getAuthTag(), content]), { mode: 0o600 });
  renameSync(temp, file);
}
