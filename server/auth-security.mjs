import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './data-paths.mjs';

const SECURITY_FILE = path.join(DATA_DIR, 'auth-security.json');
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const ACCOUNT_MAX_FAILURES = 5;
const IP_MAX_FAILURES = 25;
const MAX_ENTRIES = 5000;

function emptyState() {
  return { version: 1, accounts: {}, ips: {} };
}

function readState() {
  try {
    if (!fs.existsSync(SECURITY_FILE)) return emptyState();
    const parsed = JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf8'));
    return {
      version: 1,
      accounts: parsed?.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {},
      ips: parsed?.ips && typeof parsed.ips === 'object' ? parsed.ips : {},
    };
  } catch {
    return emptyState();
  }
}

let state = readState();

function digest(value) {
  return crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex');
}

function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = SECURITY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, SECURITY_FILE);
  } catch (error) {
    console.error('[cms-auth] no se pudo guardar el control de intentos', error.message);
  }
}

function cleanBucket(bucket, now) {
  if (!bucket || now - Number(bucket.firstFailureAt || 0) > WINDOW_MS) return null;
  return bucket;
}

function prune(now = Date.now()) {
  for (const collection of [state.accounts, state.ips]) {
    for (const [key, bucket] of Object.entries(collection)) {
      if (!cleanBucket(bucket, now)) delete collection[key];
    }
    const keys = Object.keys(collection);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => Number(collection[a].lastFailureAt || 0) - Number(collection[b].lastFailureAt || 0));
      keys.slice(0, keys.length - MAX_ENTRIES).forEach((key) => delete collection[key]);
    }
  }
}

function loginKeys({ email, ip }) {
  const normalizedEmail = String(email || '').trim().toLowerCase() || 'unknown';
  const normalizedIp = String(ip || '').trim() || 'unknown';
  return { accountKey: digest(normalizedEmail), ipKey: digest(normalizedIp) };
}

function retryAfter(bucket, now) {
  return Math.max(1, Math.ceil((Number(bucket?.lockedUntil || 0) - now) / 1000));
}

export function checkLoginAttempt(input) {
  const now = Date.now();
  prune(now);
  const { accountKey, ipKey } = loginKeys(input);
  const account = state.accounts[accountKey];
  const ip = state.ips[ipKey];
  if (account?.lockedUntil > now) return { allowed: false, retryAfterSeconds: retryAfter(account, now), scope: 'account' };
  if (ip?.lockedUntil > now) return { allowed: false, retryAfterSeconds: retryAfter(ip, now), scope: 'ip' };
  return { allowed: true, retryAfterSeconds: 0, scope: null };
}

function registerFailure(collection, key, max, now) {
  let bucket = cleanBucket(collection[key], now);
  if (!bucket) bucket = { failures: 0, firstFailureAt: now, lastFailureAt: now, lockedUntil: 0 };
  bucket.failures = Number(bucket.failures || 0) + 1;
  bucket.lastFailureAt = now;
  if (bucket.failures >= max) bucket.lockedUntil = now + LOCK_MS;
  collection[key] = bucket;
  return bucket;
}

export function recordLoginFailure(input) {
  const now = Date.now();
  const { accountKey, ipKey } = loginKeys(input);
  const account = registerFailure(state.accounts, accountKey, ACCOUNT_MAX_FAILURES, now);
  const ip = registerFailure(state.ips, ipKey, IP_MAX_FAILURES, now);
  prune(now);
  saveState();
  const blocked = account.lockedUntil > now || ip.lockedUntil > now;
  return {
    blocked,
    retryAfterSeconds: blocked ? Math.max(retryAfter(account, now), retryAfter(ip, now)) : 0,
    accountFailures: account.failures,
    ipFailures: ip.failures,
  };
}

export function recordLoginSuccess(input) {
  const { accountKey } = loginKeys(input);
  delete state.accounts[accountKey];
  prune();
  saveState();
}

export const authSecurityPolicy = Object.freeze({
  sessionHours: 8,
  accountMaxFailures: ACCOUNT_MAX_FAILURES,
  ipMaxFailures: IP_MAX_FAILURES,
  lockMinutes: LOCK_MS / 60000,
  windowMinutes: WINDOW_MS / 60000,
});
