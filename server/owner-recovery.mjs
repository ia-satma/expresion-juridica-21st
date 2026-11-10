import { randomUUID } from 'node:crypto';

function emailKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchingOwner(admins, email) {
  const matches = admins.filter((admin) => emailKey(admin?.email) === email && !admin?.deletedAt);
  const [owner] = matches;
  if (matches.length !== 1 || owner.role !== 'owner' || owner.provider !== 'password' || owner.banned || owner.pending ||
      typeof owner.userId !== 'string' || !owner.userId.trim() || admins.some((admin) => admin !== owner && admin?.userId === owner.userId)) {
    throw new Error('CMS_OWNER_BOOTSTRAP_OWNER_MISMATCH');
  }
  return owner;
}

// This runs only at startup, with a password supplied by the deployment operator.
export async function recoverExistingOwner({ pool, auth, authAdmins, ownerEmail, persistNewOwner, password = process.env.CMS_OWNER_BOOTSTRAP_PASSWORD }) {
  if (!password) return { status: 'disabled' };

  const email = emailKey(ownerEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !Array.isArray(authAdmins)) {
    throw new Error('CMS_OWNER_BOOTSTRAP_OWNER_MISMATCH');
  }

  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    // Keep concurrent deployment startups from both creating an owner.
    await client.query('LOCK TABLE "user" IN SHARE ROW EXCLUSIVE MODE');
    const existing = authAdmins.length > 0 ? matchingOwner(authAdmins, email) : null;
    const { rows: [state] } = await client.query(`
      SELECT EXISTS (SELECT 1 FROM "user") AS occupied, EXISTS (
        SELECT 1 FROM "user" AS u JOIN account AS a ON a."userId" = u.id
        WHERE u.id = $1 AND u.email = $2 AND u.role = 'admin' AND u.banned IS NOT TRUE
          AND a."providerId" = 'credential' AND a."accountId" = u.id AND a.password IS NOT NULL
      ) AS owner_ready`, [existing?.userId ?? null, email]);
    if (state.occupied) {
      if (!state.owner_ready) throw new Error('CMS_OWNER_BOOTSTRAP_DATABASE_OCCUPIED');
      await client.query('COMMIT');
      return { status: 'initialized' };
    }

    if (!existing && typeof persistNewOwner !== 'function') throw new Error('CMS_OWNER_BOOTSTRAP_OWNER_MISMATCH');
    const context = await auth.$context;
    const { minPasswordLength, maxPasswordLength } = context.password.config;
    if (typeof password !== 'string' || password.length < minPasswordLength || password.length > maxPasswordLength) {
      throw new Error('CMS_OWNER_BOOTSTRAP_PASSWORD_INVALID');
    }
    const passwordHash = await context.password.hash(password);
    const now = new Date();
    const owner = existing || {
      id: randomUUID(), userId: randomUUID(), email, name: 'Administrador del CMS', role: 'owner',
      provider: 'password', mustChangePassword: false, createdAt: now.toISOString()
    };
    const originalCreatedAt = new Date(owner.createdAt ?? now);
    const createdAt = Number.isNaN(originalCreatedAt.valueOf()) ? now : originalCreatedAt;
    await client.query(`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", role, banned)
      VALUES ($1, $2, $3, FALSE, $4, $5, 'admin', FALSE)`,
    [owner.userId, owner.name || 'Administrador del CMS', email, createdAt, now]);
    await client.query(`
      INSERT INTO account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      VALUES ($1, $2, 'credential', $2, $3, $4, $4)`, [randomUUID(), owner.userId, passwordHash, now]);

    // If the SQL commit fails after a successful CMS write, the next startup
    // can recover the same account ID from the saved metadata.
    if (!existing) await persistNewOwner(owner);
    await client.query('COMMIT');
    return { status: existing ? 'recovered' : 'created' };
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => { releaseError = rollbackError; });
    throw error;
  } finally {
    client.release(releaseError);
  }
}
