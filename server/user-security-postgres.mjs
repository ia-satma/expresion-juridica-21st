import { randomUUID } from 'node:crypto';

const securityNamespace = 1163084645;
const schemaLock = 1;
const loginLockId = 2;

export function createPostgresUserSecurity({
  database, clock, digest, loginKeys, loginLimits, loginLock, loginCapacity, loginObservation,
  loginFailure, sessionTiming, sessionStatus, sessionExpiration, auditExpiration, absoluteMs
}) {
  async function transaction(run, lock) {
    const client = await database.connect();
    let discard;
    try {
      await client.query('BEGIN');
      if (lock) await client.query('SELECT pg_advisory_xact_lock($1, $2)', [securityNamespace, lock]);
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        discard = rollbackError;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }

  const ready = transaction(client => client.query(`
    CREATE TABLE IF NOT EXISTS cms_security_buckets (
      kind text NOT NULL, key text NOT NULL, failures integer NOT NULL,
      first_at bigint NOT NULL, last_at bigint NOT NULL, locked_until bigint NOT NULL DEFAULT 0,
      PRIMARY KEY (kind, key)
    );
    CREATE TABLE IF NOT EXISTS cms_security_attempts (
      id text PRIMARY KEY, account_key text NOT NULL, ip_key text NOT NULL,
      network_kind text NOT NULL DEFAULT 'transport', expires_at bigint NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cms_security_attempt_account ON cms_security_attempts (account_key, expires_at);
    CREATE INDEX IF NOT EXISTS cms_security_attempt_network ON cms_security_attempts (network_kind, ip_key, expires_at);
    CREATE TABLE IF NOT EXISTS cms_security_sessions (
      key text PRIMARY KEY, created_at bigint NOT NULL,
      last_activity_at bigint NOT NULL, absolute_expires_at bigint NOT NULL
    );
  `), schemaLock);

  async function readBucket(client, kind, key) {
    const { rows: [row] } = await client.query(
      'SELECT failures, first_at, locked_until FROM cms_security_buckets WHERE kind = $1 AND key = $2',
      [kind, key]
    );
    return row;
  }

  function beginLogin(input) {
    // Serialize the short reservation and finalization transactions across app instances.
    // The credential check itself runs outside the advisory lock.
    return transaction(async client => {
      const now = clock();
      await client.query('DELETE FROM cms_security_attempts WHERE expires_at <= $1', [now]);
      await client.query(`
        DELETE FROM cms_security_buckets
        WHERE locked_until <= $1 AND ((kind = 'transport' AND first_at <= $2) OR (kind <> 'transport' AND first_at <= $3))
      `, [now, now - loginObservation('transport'), now - loginObservation('account')]);
      await client.query('DELETE FROM cms_security_sessions WHERE absolute_expires_at <= $1', [now - absoluteMs]);
      const { networkKind, accountKey, ipKey } = loginKeys(input);
      for (const [kind, key, max] of loginLimits(accountKey, networkKind, ipKey)) {
        const current = await readBucket(client, kind, key);
        const locked = loginLock(kind, current, now);
        if (locked) return locked;
        const { rows: [reserved] } = kind === 'account'
          ? await client.query(
            'SELECT COUNT(*)::integer AS total, MAX(expires_at) AS until FROM cms_security_attempts WHERE account_key = $1 AND expires_at > $2',
            [key, now]
          )
          : await client.query(
            'SELECT COUNT(*)::integer AS total, MAX(expires_at) AS until FROM cms_security_attempts WHERE network_kind = $1 AND ip_key = $2 AND expires_at > $3',
            [kind, key, now]
          );
        const limited = loginCapacity(kind, max, current, reserved, now);
        if (limited) return limited;
      }
      const ticket = randomUUID();
      await client.query(
        'INSERT INTO cms_security_attempts (id, account_key, ip_key, network_kind, expires_at) VALUES ($1, $2, $3, $4, $5)',
        [ticket, accountKey, ipKey, networkKind, now + 90000]
      );
      return { allowed: true, ticket };
    }, loginLockId);
  }

  function finishLogin(ticket, status) {
    return transaction(async client => {
      const { rows: [current] } = await client.query(
        'DELETE FROM cms_security_attempts WHERE id = $1 RETURNING account_key, ip_key, network_kind', [ticket]
      );
      if (!current) return { counted: false, blocked: false };
      if (status >= 200 && status < 300) {
        await client.query("DELETE FROM cms_security_buckets WHERE kind = 'account' AND key = $1", [current.account_key]);
        return { counted: false, success: true, blocked: false };
      }
      if (![400, 401, 403, 422].includes(status)) return { counted: false, blocked: false };
      let blocked = false;
      const now = clock();
      for (const [kind, key, max] of loginLimits(current.account_key, current.network_kind, current.ip_key)) {
        const previous = await readBucket(client, kind, key);
        const { failures, firstAt, lockedUntil } = loginFailure(kind, max, previous, now);
        await client.query(`
          INSERT INTO cms_security_buckets (kind, key, failures, first_at, last_at, locked_until)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (kind, key) DO UPDATE SET failures = excluded.failures,
            first_at = excluded.first_at, last_at = excluded.last_at, locked_until = excluded.locked_until
        `, [kind, key, failures, firstAt, now, lockedUntil]);
        blocked ||= lockedUntil > now;
      }
      return { counted: true, blocked };
    }, loginLockId);
  }

  function releaseLogin(ticket) {
    return database.query('DELETE FROM cms_security_attempts WHERE id = $1', [ticket]);
  }

  async function forgetSession(session) {
    if (session?.session?.id) {
      await database.query('DELETE FROM cms_security_sessions WHERE key = $1', [digest('session', session.session.id)]);
    }
  }

  async function removeSession(client, id) {
    await client.query('DELETE FROM "session" WHERE id = $1', [id]);
    await client.query('DELETE FROM cms_security_sessions WHERE key = $1', [digest('session', id)]);
  }

  async function revokeSession(session) {
    if (session?.session?.id) await transaction(client => removeSession(client, session.session.id));
  }

  function revokeUserSessions(userId, { exceptId = null } = {}) {
    return transaction(async client => {
      const { rows } = await client.query(
        'DELETE FROM "session" WHERE "userId" = $1 AND id IS DISTINCT FROM $2 RETURNING id',
        [userId, exceptId]
      );
      if (rows.length) {
        const keys = rows.map(({ id }) => digest('session', id));
        await client.query('DELETE FROM cms_security_sessions WHERE key = ANY($1::text[])', [keys]);
      }
      return rows.length;
    });
  }

  async function withSession(session, run) {
    if (!session?.session?.id || !session?.user?.id) return null;
    return transaction(async client => {
      // Lock the Better Auth row first, as in revocation, so concurrent requests
      // cannot re-create activity state for a session being removed.
      const { rowCount } = await client.query(
        'SELECT id FROM "session" WHERE id = $1 AND "userId" = $2 FOR UPDATE',
        [session.session.id, session.user.id]
      );
      if (!rowCount) return null;
      return run(client, digest('session', session.session.id));
    });
  }

  async function readSessionInfo(client, session, key) {
    const now = clock();
    const { createdAt, absoluteExpiresAt } = sessionTiming(session, now);
    const { rows } = await client.query(
      'SELECT last_activity_at, absolute_expires_at FROM cms_security_sessions WHERE key = $1', [key]
    );
    let row = rows[0];
    if (!row) {
      // Give sessions present at rollout their initial idle window under the original cap.
      await client.query(`
        INSERT INTO cms_security_sessions (key, created_at, last_activity_at, absolute_expires_at)
        VALUES ($1, $2, $3, $4)
      `, [key, createdAt, now, absoluteExpiresAt]);
      row = { last_activity_at: now, absolute_expires_at: absoluteExpiresAt };
    }
    return sessionStatus({ last_activity_at: Number(row.last_activity_at), absolute_expires_at: Number(row.absolute_expires_at) }, now, absoluteExpiresAt);
  }

  function sessionInfo(session) {
    return withSession(session, (client, key) => readSessionInfo(client, session, key));
  }

  async function checkSession(session, activity) {
    const checked = await withSession(session, async (client, key) => {
      const info = await readSessionInfo(client, session, key);
      const reason = sessionExpiration(session, info);
      if (reason) {
        await removeSession(client, session.session.id);
        return { valid: false, reason };
      }
      if (!activity) return { valid: true, info };
      await client.query('UPDATE cms_security_sessions SET last_activity_at = GREATEST(last_activity_at, $2) WHERE key = $1', [key, clock()]);
      return { valid: true, info: await readSessionInfo(client, session, key) };
    });
    if (!checked) return { valid: false, reason: 'AUTH_REQUIRED' };
    if (!checked.valid) auditExpiration(checked.reason);
    return checked;
  }

  const validateSession = session => checkSession(session, false);
  const recordActivity = session => checkSession(session, true);
  return { ready, beginLogin, finishLogin, releaseLogin, validateSession, sessionInfo, recordActivity, revokeSession, revokeUserSessions, forgetSession };
}
