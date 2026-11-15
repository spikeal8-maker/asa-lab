import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let seatId: string;
let classId: string;
const token = `synthetic-seat-${crypto.randomUUID()}`;
const suffix = crypto.randomUUID().replaceAll('-', '');
const beforeName = `seat_context_before_${suffix}`;
const legacyName = `seat_context_legacy_${suffix}`;
const currentSql = 'SELECT * FROM public.classroom_student_session_context($1)';

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  const teacher = await seedTeacher(admin, 'seat-contention');
  const account = await admin.query(
    'SELECT account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  classId = (
    await admin.query(
      `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by,safe_mode_default)
       VALUES ($1,$2,$3,'Synthetic contention class',$4,false) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    )
  ).rows[0].id;
  seatId = (
    await admin.query(
      `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,status,created_by,safe_mode)
       VALUES ($1,$2,'Synthetic learner','abcdef','abcdef','active',$3,true) RETURNING id`,
      [teacher.tenantId, classId, teacher.teacherId],
    )
  ).rows[0].id;
  await admin.query(
    `INSERT INTO classroom_seat_credentials
     (seat_id,credential_hash,version,last_request_id,issued_by_account_id)
     VALUES ($1,$2,1,$3,$4)`,
    [seatId, 'a'.repeat(64), crypto.randomUUID(), account.rows[0].account_id],
  );
  await admin.query(
    `INSERT INTO classroom_student_sessions (seat_id,token_hash,expires_at,credential_version)
     VALUES ($1,$2,now()+interval '4 hours',1)`,
    [seatId, token],
  );
  // Execute the historical public guard AND its actual latest private helper;
  // renaming creates disposable fixtures, never rewrites historical migrations.
  const legacySource = readFileSync(
    new URL('../../migrations/0143_student_seat_public_teacher_name.sql', import.meta.url),
    'utf8',
  );
  const wrapperSource = readFileSync(
    new URL('../../migrations/0106_access_seat_credentials.sql', import.meta.url),
    'utf8',
  );
  const legacy = legacySource.match(
    /CREATE OR REPLACE FUNCTION public\.classroom_student_session_context_legacy\([\s\S]*?\r?\n\$\$;/,
  )?.[0];
  const wrapper = wrapperSource.match(
    /CREATE FUNCTION classroom_student_session_context\([\s\S]*?\r?\n\$\$;/,
  )?.[0];
  if (!legacy || !wrapper || !/^[a-f0-9]{32}$/.test(suffix))
    throw new Error('Invalid isolated Seat baseline fixture');
  await admin.query(legacy.replaceAll('classroom_student_session_context_legacy', legacyName));
  await admin.query(
    wrapper
      .replace('FUNCTION classroom_student_session_context(', `FUNCTION public.${beforeName}(`)
      .replace('public.classroom_student_session_context_legacy(', `public.${legacyName}(`),
  );
  await admin.query(
    `REVOKE ALL ON FUNCTION public.${legacyName}(varchar),public.${beforeName}(varchar) FROM PUBLIC;
     GRANT EXECUTE ON FUNCTION public.${beforeName}(varchar) TO asalab_app`,
  );
}, 30000);

afterAll(async () => {
  try {
    if (admin) {
      await admin.query(`DROP FUNCTION IF EXISTS public.${beforeName}(varchar)`);
      await admin.query(`DROP FUNCTION IF EXISTS public.${legacyName}(varchar)`);
    }
  } finally {
    await runtime?.end();
    await admin?.end();
  }
});

async function dueActivity() {
  await admin.query(
    "UPDATE classroom_student_sessions SET last_seen_at=now()-interval '2 minutes' WHERE token_hash=$1",
    [token],
  );
  await admin.query(
    "UPDATE classroom_student_seats SET last_active_at='2000-01-01T00:00:00Z' WHERE id=$1",
    [seatId],
  );
}

async function boundedRead(sql: string) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='1000ms'");
    const result = await client.query(sql, [token]);
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('actual StudentSeat authority and optional heartbeat contention', () => {
  for (const lockedTable of ['classroom_student_sessions', 'classroom_student_seats'] as const) {
    it(`avoids the historical lock wait and pool queue with a held ${lockedTable} row`, async () => {
      const baseline = (await runtime.query(`SELECT * FROM public.${beforeName}($1)`, [token]))
        .rows;
      expect(baseline).toHaveLength(1);
      await dueActivity();
      const locker = await admin.connect();
      try {
        await locker.query('BEGIN');
        await locker.query(
          `SELECT id FROM ${lockedTable} WHERE ${lockedTable === 'classroom_student_sessions' ? 'token_hash' : 'id'}=$1 FOR UPDATE`,
          [lockedTable === 'classroom_student_sessions' ? token : seatId],
        );
        const started = performance.now();
        const oldQueries = Array.from({ length: 4 }, () =>
          boundedRead(`SELECT * FROM public.${beforeName}($1)`).then(
            () => null,
            (error: unknown) => error,
          ),
        );
        let observedLock = false;
        let observedPoolQueue = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          observedPoolQueue ||= runtime.waitingCount > 0;
          const locks = await admin.query(
            `SELECT count(*)::int AS count FROM pg_stat_activity
             WHERE datname=current_database() AND wait_event_type='Lock'
               AND query LIKE $1`,
            [`SELECT * FROM public.${beforeName}%`],
          );
          observedLock ||= locks.rows[0].count > 0;
          if (observedLock && observedPoolQueue) break;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const failures = await Promise.all(oldQueries);
        expect(observedLock).toBe(true);
        expect(observedPoolQueue).toBe(true);
        for (const failure of failures) expect(failure).toMatchObject({ code: '57014' });
        const beforeMs = performance.now() - started;
        const beforeActivity = (
          await admin.query(
            `SELECT session.last_seen_at,seat.last_active_at FROM classroom_student_sessions session
             JOIN classroom_student_seats seat ON seat.id=session.seat_id WHERE session.token_hash=$1`,
            [token],
          )
        ).rows[0];
        const afterStarted = performance.now();
        const current = await Promise.all(
          Array.from({ length: 12 }, () => boundedRead(currentSql)),
        );
        for (const rows of current) expect(rows).toEqual(baseline);
        const afterActivity = (
          await admin.query(
            `SELECT session.last_seen_at,seat.last_active_at FROM classroom_student_sessions session
             JOIN classroom_student_seats seat ON seat.id=session.seat_id WHERE session.token_hash=$1`,
            [token],
          )
        ).rows[0];
        const skipped =
          lockedTable === 'classroom_student_sessions' ? 'last_seen_at' : 'last_active_at';
        expect(afterActivity[skipped]).toEqual(beforeActivity[skipped]);
        console.info(
          JSON.stringify({
            kind: 'seat_context_contention_evidence',
            lockedTable,
            beforeObservedLock: observedLock,
            beforeObservedPoolQueue: observedPoolQueue,
            beforeFailures: failures.length,
            beforeSqlstate: '57014',
            beforeMs: Math.round(beforeMs),
            afterReads: current.length,
            afterMs: Math.round(performance.now() - afterStarted),
            lockStillHeld: true,
            lockedHeartbeatUnchanged: true,
          }),
        );
      } finally {
        await locker.query('ROLLBACK');
        locker.release();
      }
    });
  }

  it('refreshes due activity once, preserves expiry and coalesces a 30-read burst on both rows', async () => {
    await dueActivity();
    const expiry = (
      await admin.query('SELECT expires_at FROM classroom_student_sessions WHERE token_hash=$1', [
        token,
      ])
    ).rows[0].expires_at;
    expect((await runtime.query(currentSql, [token])).rows).toHaveLength(1);
    const activity = async () =>
      (
        await admin.query(
          `SELECT session.xmin::text AS session_version,session.last_seen_at,session.expires_at,
                  seat.xmin::text AS seat_version,seat.last_active_at
             FROM classroom_student_sessions session JOIN classroom_student_seats seat ON seat.id=session.seat_id
            WHERE session.token_hash=$1`,
          [token],
        )
      ).rows[0];
    const updated = await activity();
    expect(updated.last_seen_at.getTime()).toBeGreaterThan(Date.now() - 60000);
    expect(updated.last_active_at.getTime()).toBeGreaterThan(Date.now() - 60000);
    for (const result of await Promise.all(
      Array.from({ length: 30 }, () => runtime.query(currentSql, [token])),
    ))
      expect(result.rows).toHaveLength(1);
    expect(await activity()).toEqual(updated);
    expect(updated.expires_at).toEqual(expiry);
  });

  it('rejects invalid authority at exact idle/expiry boundaries without refreshing activity', async () => {
    const mutations: [string, unknown[]][] = [
      ['UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1', [token]],
      ['UPDATE classroom_student_sessions SET expires_at=now() WHERE token_hash=$1', [token]],
      [
        "UPDATE classroom_student_sessions SET last_seen_at=now()-interval '60 minutes' WHERE token_hash=$1",
        [token],
      ],
      ['UPDATE classroom_student_sessions SET credential_version=2 WHERE token_hash=$1', [token]],
      [
        'UPDATE classroom_student_sessions SET credential_version=NULL WHERE token_hash=$1',
        [token],
      ],
      ['UPDATE classroom_seat_credentials SET version=2 WHERE seat_id=$1', [seatId]],
      ["UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [seatId]],
      ["UPDATE classroom_student_seats SET status='removed' WHERE id=$1", [seatId]],
      ["UPDATE classroom_student_seats SET status='issued' WHERE id=$1", [seatId]],
      ["UPDATE classrooms SET status='archived' WHERE id=$1", [classId]],
      ['DELETE FROM classroom_seat_credentials WHERE seat_id=$1', [seatId]],
    ];
    for (const [mutation, args] of mutations) {
      const client = await admin.connect();
      try {
        await client.query('BEGIN');
        // The fixture mutation and runtime-role entry point share a transaction
        // so exact boundaries use the same PostgreSQL now(), not wall time.
        await client.query(mutation, args);
        const timestamps = async () =>
          (
            await client.query(
              `SELECT session.xmin::text AS session_version,session.last_seen_at,
                      seat.xmin::text AS seat_version,seat.last_active_at
                 FROM classroom_student_sessions session JOIN classroom_student_seats seat ON seat.id=session.seat_id
                WHERE session.token_hash=$1`,
              [token],
            )
          ).rows;
        const before = await timestamps();
        await client.query('SET LOCAL ROLE asalab_app');
        expect((await client.query(currentSql, [token])).rows).toEqual([]);
        await client.query('RESET ROLE');
        expect(await timestamps()).toEqual(before);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect((await runtime.query(currentSql, [token])).rows).toHaveLength(1);
    }
    expect((await runtime.query(currentSql, ['unknown-token'])).rows).toEqual([]);
  });

  it('observes committed revocation and credential rotation immediately, and accepts activity just inside the idle limit', async () => {
    const rejectWithoutRefresh = async () => {
      const before = (
        await admin.query(
          'SELECT xmin::text,last_seen_at FROM classroom_student_sessions WHERE token_hash=$1',
          [token],
        )
      ).rows;
      expect((await runtime.query(currentSql, [token])).rows).toEqual([]);
      expect(
        (
          await admin.query(
            'SELECT xmin::text,last_seen_at FROM classroom_student_sessions WHERE token_hash=$1',
            [token],
          )
        ).rows,
      ).toEqual(before);
    };
    await admin.query(
      'UPDATE classroom_student_sessions SET revoked_at=now() WHERE token_hash=$1',
      [token],
    );
    try {
      await rejectWithoutRefresh();
    } finally {
      await admin.query(
        'UPDATE classroom_student_sessions SET revoked_at=NULL WHERE token_hash=$1',
        [token],
      );
    }
    await admin.query('UPDATE classroom_seat_credentials SET version=2 WHERE seat_id=$1', [seatId]);
    try {
      await rejectWithoutRefresh();
    } finally {
      await admin.query('UPDATE classroom_seat_credentials SET version=1 WHERE seat_id=$1', [
        seatId,
      ]);
    }
    await admin.query(
      "UPDATE classroom_student_sessions SET last_seen_at=now()-interval '59 minutes' WHERE token_hash=$1",
      [token],
    );
    expect((await runtime.query(currentSql, [token])).rows).toHaveLength(1);
    expect(
      (
        await admin.query(
          "SELECT last_seen_at>now()-interval '1 minute' AS refreshed FROM classroom_student_sessions WHERE token_hash=$1",
          [token],
        )
      ).rows[0].refreshed,
    ).toBe(true);
  });

  it('keeps public identity/safety values, restricted ACLs and forced table RLS', async () => {
    const rows = (await runtime.query(currentSql, [token])).rows;
    expect(rows[0]).toMatchObject({
      seat_id: seatId,
      classroom_id: classId,
      display_label: 'Synthetic learner',
      teacher_display_name: 'Педагог seat-contention',
      safe_mode: true,
    });
    expect(Object.keys(rows[0]).sort()).toEqual([
      'avatar_key',
      'classroom_id',
      'classroom_title',
      'display_label',
      'expires_at',
      'safe_mode',
      'seat_id',
      'teacher_display_name',
    ]);
    const definition = (
      await admin.query(
        `SELECT prosecdef,proconfig,has_function_privilege('asalab_app',oid,'EXECUTE') AS app_allowed,
                EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl,acldefault('f',proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_allowed
           FROM pg_proc WHERE oid='public.classroom_student_session_context(varchar)'::regprocedure`,
      )
    ).rows[0];
    expect(definition).toMatchObject({ prosecdef: true, app_allowed: true, public_allowed: false });
    expect(definition.proconfig.join(',')).toMatch(/search_path=pg_catalog, pg_temp/);
    expect(
      (
        await admin.query(
          "SELECT has_function_privilege('asalab_app','public.classroom_student_session_context_legacy(varchar)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    expect(
      (
        await admin.query(
          "SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS protected FROM pg_class WHERE oid IN ('classroom_student_seats'::regclass,'classroom_seat_credentials'::regclass)",
        )
      ).rows[0].protected,
    ).toBe(true);
  });
});
