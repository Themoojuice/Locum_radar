import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
export const sessionCookie = 'radar_session';
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
export function configuration() {
  const origin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:3000');
  const remote = !loopback.has(origin.hostname);
  const password = process.env.APP_PASSWORD || '';
  const secret = process.env.SESSION_SECRET || '';
  if (remote && (password.length < 16 || secret.length < 32 || origin.protocol !== 'https:'))
    throw new Error(
      'Private hosting needs HTTPS, APP_PASSWORD (16+ characters) and SESSION_SECRET (32+ characters).',
    );
  if (password && secret.length < 32)
    throw new Error('Set SESSION_SECRET to at least 32 random characters when using a password.');
  return { origin, remote, password, secret };
}
export function validateOrigin(request: Request, mutation = false) {
  const config = configuration(),
    url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  if (
    host !== config.origin.host &&
    !(
      loopback.has(config.origin.hostname) &&
      loopback.has(url.hostname) &&
      loopback.has(host.split(':')[0]) &&
      url.port === config.origin.port
    )
  )
    throw new Error('Unrecognised request host');
  const origin = request.headers.get('origin');
  if (mutation && (!origin || (origin !== config.origin.origin && origin !== url.origin)))
    throw new Error('Request origin rejected');
  if (origin && origin !== config.origin.origin && origin !== url.origin)
    throw new Error('Cross-origin request rejected');
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new Error('Cross-site request rejected');
  return config;
}
const sign = (text: string, secret: string) =>
  createHmac('sha256', secret).update(text).digest('hex');
export function createSession(secret: string, now = Date.now()) {
  const payload = `${now + 8 * 3600000}.${randomBytes(24).toString('hex')}`;
  return `${payload}.${sign(payload, secret)}`;
}
export function checkSession(token: string | undefined, secret: string, now = Date.now()) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (
    parts.length !== 3 ||
    !/^\d+$/.test(parts[0]) ||
    !/^[a-f0-9]{48}$/.test(parts[1]) ||
    !/^[a-f0-9]{64}$/.test(parts[2])
  )
    return false;
  const expires = Number(parts[0]);
  if (expires <= now || expires > now + 8 * 3600000) return false;
  return timingSafeEqual(
    Buffer.from(parts[2], 'hex'),
    Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret), 'hex'),
  );
}
export function authenticated(request: Request, mutation = false) {
  const config = validateOrigin(request, mutation);
  if (!config.password) return true;
  const token = request.headers
    .get('cookie')
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${sessionCookie}=`))
    ?.slice(sessionCookie.length + 1);
  return checkSession(token, config.secret);
}
export function checkPassword(input: string, expected: string) {
  return timingSafeEqual(
    scryptSync(input, 'locum-radar-password-check', 64),
    scryptSync(expected, 'locum-radar-password-check', 64),
  );
}
const attempts: number[] = [];
export function allowLogin(now = Date.now()) {
  while (attempts.length && attempts[0] < now - 900000) attempts.shift();
  if (attempts.length >= 10) return false;
  attempts.push(now);
  return true;
}
