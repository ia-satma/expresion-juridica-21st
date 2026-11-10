import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { admin as adminPlugin } from 'better-auth/plugins';
import { AUTH_DB_FILE, DATA_DIR, SECRET_FILE } from './data-paths.mjs';
import { hostedHttps } from './web-security.mjs';
import { privateAuthLogger, safeLog } from './security-logging.mjs';

const authConnectionString = process.env.CMS_AUTH_DATABASE_URL?.trim()
  || (process.env.CMS_AUTH_STORAGE === 'postgres' ? process.env.DATABASE_URL?.trim() : '');
export const authUsesPostgres = Boolean(authConnectionString);

if (process.env.CMS_AUTH_STORAGE === 'postgres' && !authUsesPostgres) {
  safeLog('error', 'auth.database-url-required');
  throw new Error('AUTH_DATABASE_URL_REQUIRED');
}

function authSecret() {
  if (process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32) return process.env.BETTER_AUTH_SECRET;
  if (authUsesPostgres) {
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
    safeLog('error', 'auth.stable-secret-required');
    throw new Error('AUTH_STABLE_SECRET_REQUIRED');
  }
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const generated = `${cryptoRandom()}${cryptoRandom()}`;
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

function cryptoRandom() {
  return randomBytes(24).toString('base64url');
}

function openAuthDatabase() {
  if (authUsesPostgres) {
    const pool = new Pool({ connectionString: authConnectionString, connectionTimeoutMillis: 10_000 });
    pool.on('error', error => safeLog('error', 'auth.database-pool', error));
    return pool;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const database = new Database(AUTH_DB_FILE);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return database;
}

export const authDatabase = openAuthDatabase();

export async function hasAuthUsers() {
  const sql = 'SELECT 1 FROM "user" LIMIT 1';
  if (authUsesPostgres) return (await authDatabase.query(sql)).rowCount > 0;
  return Boolean(authDatabase.prepare(sql).get());
}

export async function setAuthUserRole(id, role) {
  if (authUsesPostgres) {
    await authDatabase.query('UPDATE "user" SET role = $1 WHERE id = $2', [role, id]);
    return;
  }
  authDatabase.prepare('UPDATE "user" SET role = ? WHERE id = ?').run(role, id);
}

export async function findAuthUserByEmail(email) {
  const sql = 'SELECT id, email, role FROM "user" WHERE LOWER(email) = ';
  const normalized = email.trim().toLowerCase();
  if (authUsesPostgres) return (await authDatabase.query(sql + '$1', [normalized])).rows[0];
  return authDatabase.prepare(sql + '?').get(normalized);
}

const baseUrl = process.env.BETTER_AUTH_URL || process.env.REPLIT_DEPLOYMENT_URL || `http://localhost:${process.env.PORT || 3000}`;
const trustedOrigins = [baseUrl, 'https://expresion-juridica-21-st.replit.app', process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null, process.env.REPLIT_DEPLOYMENT_URL].filter(Boolean);
export const auth = betterAuth({
  logger: privateAuthLogger,
  database: authDatabase,
  secret: authSecret(),
  baseURL: baseUrl,
  basePath: '/api/auth',
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    requireEmailVerification: false
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60
  },
  plugins: [adminPlugin()],
  advanced: {
    useSecureCookies: hostedHttps(),
    defaultCookieAttributes: { httpOnly: true, secure: hostedHttps(), sameSite: 'lax', path: '/' },
    database: {
      validateSchema: false
    }
  }
});

async function applyAuthMigrations() {
  const migrations = await getMigrations(auth.options);
  if (migrations.toBeCreated?.length || migrations.toBeAdded?.length || migrations.toBeAddedIndexes?.length) {
    await migrations.runMigrations();
  }
}

export async function migrateAuthDatabase() {
  if (!authUsesPostgres) return applyAuthMigrations();
  const client = await authDatabase.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    // Reserve one connection to serialize schema discovery and changes across instances.
    await client.query('SELECT pg_advisory_xact_lock(624208112)');
    await applyAuthMigrations();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => { releaseError = rollbackError; });
    throw error;
  } finally {
    client.release(releaseError);
  }
}
