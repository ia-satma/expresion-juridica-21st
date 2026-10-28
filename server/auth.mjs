import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { admin as adminPlugin } from 'better-auth/plugins';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const AUTH_DB_FILE = path.join(DATA_DIR, 'auth.sqlite');
const SECRET_FILE = path.join(DATA_DIR, 'better-auth.secret');
const GOOGLE_CLIENT_ID = String(process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
export const googleAuthEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
fs.mkdirSync(DATA_DIR, { recursive: true });

function authSecret() {
  if (process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32) return process.env.BETTER_AUTH_SECRET;
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  const generated = `${cryptoRandom()}${cryptoRandom()}`;
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

function cryptoRandom() {
  return randomBytes(24).toString('base64url');
}

export const authDatabase = new Database(AUTH_DB_FILE);
authDatabase.pragma('journal_mode = WAL');
authDatabase.pragma('foreign_keys = ON');

const baseUrl = process.env.BETTER_AUTH_URL || process.env.REPLIT_DEPLOYMENT_URL || `http://localhost:${process.env.PORT || 3000}`;
const trustedOrigins = [baseUrl, 'https://expresion-juridica-21-st.replit.app', process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null, process.env.REPLIT_DEPLOYMENT_URL].filter(Boolean);
const socialProviders = googleAuthEnabled ? {
  google: {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    requireEmailVerification: true,
    prompt: 'select_account'
  }
} : undefined;

export const auth = betterAuth({
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
  ...(socialProviders ? { socialProviders } : {}),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'email-password'],
      allowDifferentEmails: false
    }
  },
  user: {
    validateUserInfo: ({ user, source }) => {
      if (source.method !== 'oauth' || source.oauth?.providerId !== 'google') return;
      // Google identities are authenticated by Google. CMS authorization is
      // checked after the callback so invited clients can use any domain.
      if (!String(user.email || '').includes('@')) return {
        error: 'GOOGLE_EMAIL_REQUIRED',
        errorDescription: 'La cuenta de Google debe incluir un correo verificable.'
      };
    }
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60
  },
  plugins: [adminPlugin()],
  advanced: {
    database: {
      validateSchema: false
    }
  }
});

export async function migrateAuthDatabase() {
  const migrations = await getMigrations(auth.options);
  if (migrations.toBeCreated?.length || migrations.toBeAdded?.length) await migrations.runMigrations();
}
