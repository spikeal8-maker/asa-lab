import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { testAdminPool } from '../portal/helpers';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan as applyPlan } from '../migration/isolated-postgres-plan';

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let databaseOwner: pg.Pool;
let databaseCreated = false;

const databaseName = `asa_protected_student_code_${crypto.randomUUID().replaceAll('-', '')}_test`;
const originalEnv = {
  mode: process.env['ASA_STUDENT_CODE_PROTECTION_MODE'],
  encryptionKeys: process.env['ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON'],
  encryptionActive: process.env['ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID'],
  lookupKeys: process.env['ASA_STUDENT_CODE_LOOKUP_KEYS_JSON'],
  lookupActive: process.env['ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID'],
};

const enc1 = Buffer.alloc(32, 0x41);
const lookup1 = Buffer.alloc(32, 0x51);
const lookup0 = Buffer.alloc(32, 0x61);
const lookup2 = Buffer.alloc(32, 0x71);

function useLookupKeyring(keys: Record<string, Buffer>, activeKeyId: string): void {
  process.env['ASA_STUDENT_CODE_LOOKUP_KEYS_JSON'] = JSON.stringify(
    Object.fromEntries(Object.entries(keys).map(([keyId, key]) => [keyId, key.toString('base64')])),
  );
  process.env['ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID'] = activeKeyId;
}

function useDefaultLookupKeyring(): void {
  useLookupKeyring({ lookup1, lookup0 }, 'lookup1');
}

function restoreEnv(): void {
  const entries: Array<[string, string | undefined]> = [
    ['ASA_STUDENT_CODE_PROTECTION_MODE', originalEnv.mode],
    ['ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON', originalEnv.encryptionKeys],
    ['ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID', originalEnv.encryptionActive],
    ['ASA_STUDENT_CODE_LOOKUP_KEYS_JSON', originalEnv.lookupKeys],
    ['ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID', originalEnv.lookupActive],
  ];
  for (const [name, value] of entries) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeAll(async () => {
  if (!/^asa_protected_student_code_[a-f0-9]{32}_test$/.test(databaseName)) {
    throw new Error('Unsafe generated test database name');
  }
  process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'compat';
  process.env['ASA_STUDENT_CODE_ENCRYPTION_KEYS_JSON'] = JSON.stringify({
    enc1: enc1.toString('base64'),
  });
  process.env['ASA_STUDENT_CODE_ENCRYPTION_ACTIVE_KEY_ID'] = 'enc1';
  process.env['ASA_STUDENT_CODE_LOOKUP_KEYS_JSON'] = JSON.stringify({
    lookup1: lookup1.toString('base64'),
    lookup0: lookup0.toString('base64'),
  });
  process.env['ASA_STUDENT_CODE_LOOKUP_ACTIVE_KEY_ID'] = 'lookup1';

  const adminUrl = new URL(process.env['TEST_DATABASE_URL']!);
  const runtimeUrl = new URL(process.env['APP_TEST_DATABASE_URL']!);
  if (!adminUrl.pathname.endsWith('_test') || runtimeUrl.pathname !== adminUrl.pathname) {
    throw new Error('Matching isolated admin/runtime test databases required');
  }

  databaseOwner = testAdminPool();
  await databaseOwner.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  adminUrl.pathname = runtimeUrl.pathname = '/' + databaseName;
  admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 3 });

  const migrationClient = await admin.connect();
  try {
    await applyPlan(migrationClient, planMigrations());
  } finally {
    migrationClient.release();
  }

  runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 3 });
  app = await buildTestApp(runtime);
}, 30_000);

afterAll(async () => {
  try {
    if (app) await app.close();
    else await runtime?.end();
    await admin?.end();
    if (databaseCreated) await databaseOwner.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    restoreEnv();
    await databaseOwner?.end();
  }
});

async function account() {
  const id = crypto.randomUUID().replaceAll('-', '');
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `${id}@protected-seat.test`,
      username: `p${id.slice(0, 24)}`,
      displayName: 'Protected Student Code Teacher',
      password: `Safe-${id}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const token = response.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
  expect(token).toBeTruthy();
  return { cookie: `asa_session=${token}` };
}

async function teacherClass() {
  const teacher = await account();
  const teaching = await inject(app, {
    method: 'POST',
    url: '/api/capabilities/educator/self-attest',
    headers: { cookie: teacher.cookie },
    payload: {},
  });
  expect(teaching.statusCode, teaching.body).toBe(201);

  const created = await inject(app, {
    method: 'POST',
    url: '/api/classrooms',
    headers: { cookie: teacher.cookie, 'idempotency-key': crypto.randomUUID() },
    payload: {
      title: 'Protected Student Code class',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const classroomId = created.json().classroom.id as string;

  const read = await inject(app, {
    method: 'GET',
    url: `/api/classrooms/${classroomId}`,
    headers: { cookie: teacher.cookie },
  });
  expect(read.statusCode, read.body).toBe(200);
  return {
    teacher,
    classroomId,
    classCode: read.json().classroom.joinCode as string,
  };
}

async function addSeat(cookie: string, classroomId: string, label: string) {
  const response = await inject(app, {
    method: 'POST',
    url: `/api/classrooms/${classroomId}/seats`,
    headers: { cookie },
    payload: { displayLabel: label, safeMode: true },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().student as { id: string; studentCode: string };
}

describe('E1-FIX-02B protected Student Code storage foundation', () => {
  it('reads an archived protected roster without reopening login, mutations or foreign-class access', async () => {
    const previousMode = process.env['ASA_STUDENT_CODE_PROTECTION_MODE'];
    process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'enforced';
    try {
      const { teacher, classroomId, classCode } = await teacherClass();
      const student = await addSeat(teacher.cookie, classroomId, 'Архивный ученик');
      const other = await teacherClass();
      const persisted = async () =>
        (
          await admin.query(
            'SELECT to_jsonb(p) AS value FROM classroom_student_code_protected p WHERE seat_id=$1',
            [student.id],
          )
        ).rows[0].value;
      const protectedBefore = await persisted();
      const roster = () =>
        inject(app, {
          method: 'GET',
          url: `/api/classrooms/${classroomId}/roster`,
          headers: { cookie: teacher.cookie },
        });
      expect((await roster()).statusCode).toBe(200);
      const status = (value: string) =>
        inject(app, {
          method: 'POST',
          url: `/api/classrooms/${classroomId}/status`,
          headers: { cookie: teacher.cookie },
          payload: { status: value },
        });
      const archived = await status('archived');
      expect(archived.statusCode, archived.body).toBe(201);
      const read = await roster();
      expect(read.statusCode, read.body).toBe(200);
      expect(
        read.json().items.find((item: { id: string }) => item.id === student.id),
      ).toMatchObject({ studentCode: student.studentCode, loginMethod: 'student_code' });
      expect(await persisted()).toEqual(protectedBefore);

      const foreign = await inject(app, {
        method: 'GET',
        url: `/api/classrooms/${classroomId}/roster`,
        headers: { cookie: other.teacher.cookie },
      });
      expect(foreign.statusCode, foreign.body).toBe(404);
      const foreignAccount = (
        await admin.query(
          "SELECT account_id FROM classroom_memberships WHERE classroom_id=$1 AND member_role='owner'",
          [other.classroomId],
        )
      ).rows[0].account_id;
      expect(
        (
          await runtime.query('SELECT * FROM classroom_student_code_protected_read($1,$2)', [
            foreignAccount,
            classroomId,
          ])
        ).rows,
      ).toEqual([]);
      const hidden = await inject(app, {
        method: 'POST',
        url: '/api/class-join/resolve',
        payload: { code: classCode },
      });
      expect(hidden.statusCode, hidden.body).toBe(404);
      const deniedLogin = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code: classCode, studentCode: student.studentCode },
      });
      expect(deniedLogin.statusCode).toBeGreaterThanOrEqual(400);
      expect(deniedLogin.statusCode).toBeLessThan(500);
      const deniedEdit = await inject(app, {
        method: 'PATCH',
        url: `/api/classrooms/${classroomId}/seats/${student.id}`,
        headers: { cookie: teacher.cookie },
        payload: {
          displayLabel: 'Не должно сохраниться',
          safeMode: false,
          status: 'active',
          avatarKey: null,
        },
      });
      expect(deniedEdit.statusCode, deniedEdit.body).toBe(404);
      const deniedRotate = await inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classroomId}/join-code/rotate`,
        headers: { cookie: teacher.cookie },
        payload: {},
      });
      expect(deniedRotate.statusCode, deniedRotate.body).toBe(409);
      expect(await persisted()).toEqual(protectedBefore);
      const untouched = await roster();
      expect(untouched.statusCode, untouched.body).toBe(200);
      expect(
        untouched.json().items.find((item: { id: string }) => item.id === student.id),
      ).toMatchObject({
        displayLabel: 'Архивный ученик',
        safeMode: true,
        studentCode: student.studentCode,
      });

      const restored = await status('active');
      expect(restored.statusCode, restored.body).toBe(201);
      // Restoration deliberately does not resurrect last year's circulated class code.
      const staleCode = await inject(app, {
        method: 'POST',
        url: '/api/class-join/resolve',
        payload: { code: classCode },
      });
      expect(staleCode.statusCode, staleCode.body).toBe(404);
      const newCode = await inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classroomId}/join-code/rotate`,
        headers: { cookie: teacher.cookie },
        payload: {},
      });
      expect(newCode.statusCode, newCode.body).toBe(201);
      const reopened = await inject(app, {
        method: 'GET',
        url: `/api/classrooms/${classroomId}`,
        headers: { cookie: teacher.cookie },
      });
      expect(reopened.statusCode, reopened.body).toBe(200);
      const reopenedCode = reopened.json().classroom.joinCode as string;
      expect(reopenedCode).not.toBe(classCode);
      const login = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code: reopenedCode, studentCode: student.studentCode },
      });
      expect(login.statusCode, login.body).toBe(200);
      expect(await persisted()).toEqual(protectedBefore);
      const removed = await status('deleted');
      expect(removed.statusCode, removed.body).toBe(201);
      expect((await roster()).statusCode).toBe(404);
      const ownerAccount = (
        await admin.query(
          "SELECT account_id FROM classroom_memberships WHERE classroom_id=$1 AND member_role='owner'",
          [classroomId],
        )
      ).rows[0].account_id;
      expect(
        (
          await runtime.query('SELECT * FROM classroom_student_code_protected_read($1,$2)', [
            ownerAccount,
            classroomId,
          ])
        ).rows,
      ).toEqual([]);
      expect(await persisted()).toEqual(protectedBefore);
    } finally {
      if (previousMode === undefined) delete process.env['ASA_STUDENT_CODE_PROTECTION_MODE'];
      else process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = previousMode;
    }
  });

  it('rolls back settings and row revision after damaged protected readback, then saves the restored retry', async () => {
    const previousMode = process.env['ASA_STUDENT_CODE_PROTECTION_MODE'];
    process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'enforced';
    try {
      const { teacher, classroomId } = await teacherClass();
      const policy = await inject(app, {
        method: 'PATCH',
        url: `/api/classrooms/${classroomId}/policies`,
        headers: { cookie: teacher.cookie },
        payload: { safeModeDefault: false },
      });
      expect(policy.statusCode, policy.body).toBe(200);
      const seat = await addSeat(
        teacher.cookie,
        classroomId,
        'Исходное имя, индивидуальная защита',
      );
      const snapshot = async () => ({
        seat: (
          await admin.query(
            'SELECT to_jsonb(seat) AS settings, xmin::text AS row_revision FROM classroom_student_seats seat WHERE id=$1',
            [seat.id],
          )
        ).rows,
        credential: (
          await admin.query('SELECT * FROM classroom_seat_credentials WHERE seat_id=$1', [seat.id])
        ).rows,
        policy: (
          await admin.query('SELECT safe_mode_default FROM classrooms WHERE id=$1', [classroomId])
        ).rows,
        updates: Number(
          (
            await admin.query(
              "SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='classroom.student_seat_updated'",
              [seat.id],
            )
          ).rows[0].count,
        ),
      });
      const before = await snapshot();
      expect(before.seat[0].settings.safe_mode).toBe(true);
      const envelope = (
        await admin.query('SELECT * FROM classroom_student_code_protected WHERE seat_id=$1', [
          seat.id,
        ])
      ).rows;
      const settings = {
        displayLabel: 'Новое подтверждённое имя',
        safeMode: false,
        status: 'active',
        avatarKey: null,
      };
      const patch = () =>
        inject(app, {
          method: 'PATCH',
          url: `/api/classrooms/${classroomId}/seats/${seat.id}`,
          headers: { cookie: teacher.cookie },
          payload: settings,
        });
      await admin.query(
        'UPDATE classroom_student_code_protected SET encryption_tag=$1 WHERE seat_id=$2',
        [Buffer.alloc(16), seat.id],
      );
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const rejected = await patch();
          expect(rejected.statusCode, rejected.body).toBe(503);
          expect(rejected.body).toContain('credential_storage_unavailable');
          // Includes label, policy, handle, timestamps and PostgreSQL row revision.
          expect(await snapshot()).toEqual(before);
        }
      } finally {
        await admin.query(
          'UPDATE classroom_student_code_protected SET encryption_tag=$1 WHERE seat_id=$2',
          [envelope[0].encryption_tag, seat.id],
        );
      }
      const saved = await patch();
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json().student).toMatchObject({
        displayLabel: settings.displayLabel,
        safeMode: false,
        studentCode: seat.studentCode,
      });
      const after = await snapshot();
      expect(after.seat[0].settings).toMatchObject({
        display_label: settings.displayLabel,
        safe_mode: false,
        login_handle: before.seat[0].settings.login_handle,
      });
      expect(after.seat[0].row_revision).not.toBe(before.seat[0].row_revision);
      expect(after.credential).toEqual(before.credential);
      expect(after.policy).toEqual(before.policy);
      expect(after.updates).toBe(before.updates + 1);
      expect(
        (
          await admin.query('SELECT * FROM classroom_student_code_protected WHERE seat_id=$1', [
            seat.id,
          ])
        ).rows,
      ).toEqual(envelope);
      const roster = await inject(app, {
        method: 'GET',
        url: `/api/classrooms/${classroomId}/roster`,
        headers: { cookie: teacher.cookie },
      });
      expect(roster.statusCode, roster.body).toBe(200);
      expect(roster.json().items.find((row: { id: string }) => row.id === seat.id)).toMatchObject(
        saved.json().student,
      );
      expect(await snapshot()).toEqual(after);
    } finally {
      if (previousMode === undefined) delete process.env['ASA_STUDENT_CODE_PROTECTION_MODE'];
      else process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = previousMode;
    }
  });
  it('enforced mixed roster keeps Account-only admission and both linked Seat access paths without rotating storage', async () => {
    const previousMode = process.env['ASA_STUDENT_CODE_PROTECTION_MODE'];
    process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'enforced';
    try {
      const { teacher, classroomId, classCode } = await teacherClass();
      const codeSeat = await addSeat(
        teacher.cookie,
        classroomId,
        'Связанный ученик с коротким кодом',
      );
      const accountOnly = await account();
      const requested = await inject(app, {
        method: 'POST',
        url: '/api/class-join/account',
        headers: { cookie: accountOnly.cookie },
        payload: { code: classCode },
      });
      expect(requested.statusCode, requested.body).toBe(200);
      expect(requested.json().status).toBe('pending');
      const decided = await inject(app, {
        method: 'POST',
        url: `/api/class-join/requests/${classroomId}/${requested.json().requestId}/decision`,
        headers: { cookie: teacher.cookie },
        payload: { decision: 'approved' },
      });
      expect(decided.statusCode, decided.body).toBe(201);
      const linkedAccount = await account();
      const linkedSession = await inject(app, {
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie: linkedAccount.cookie },
      });
      expect(linkedSession.statusCode, linkedSession.body).toBe(200);
      // Seed the existing Account+Seat relation in this disposable database.
      // This is a credential-preservation test, not a claim of a new linking journey.
      await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
        linkedSession.json().account.id,
        codeSeat.id,
      ]);
      const before = await admin.query(
        'SELECT * FROM classroom_student_code_protected WHERE seat_id=$1',
        [codeSeat.id],
      );
      const readRoster = () =>
        inject(app, {
          method: 'GET',
          url: `/api/classrooms/${classroomId}/roster`,
          headers: { cookie: teacher.cookie },
        });
      const roster = await readRoster();
      expect(roster.statusCode, roster.body).toBe(200);
      expect(roster.body).not.toContain('acc:');
      const codeRow = roster.json().items.find((row: { id: string }) => row.id === codeSeat.id);
      const accountRow = roster
        .json()
        .items.find((row: { loginMethod: string }) => row.loginMethod === 'account');
      expect(codeRow).toMatchObject({
        studentCode: codeSeat.studentCode,
        loginHandle: codeSeat.studentCode,
        loginMethod: 'student_code',
      });
      expect(accountRow).toMatchObject({
        studentCode: null,
        loginHandle: null,
        loginMethod: 'account',
      });
      const accountStored = await admin.query(
        'SELECT login_handle FROM classroom_student_seats WHERE id=$1',
        [accountRow.id],
      );
      expect(accountStored.rows[0].login_handle).toMatch(/^acc:/);
      expect(
        (
          await admin.query('SELECT * FROM classroom_student_code_protected WHERE seat_id=$1', [
            accountRow.id,
          ])
        ).rowCount,
      ).toBe(0);
      const changed = await inject(app, {
        method: 'PATCH',
        url: `/api/classrooms/${classroomId}/seats/${accountRow.id}`,
        headers: { cookie: teacher.cookie },
        payload: {
          displayLabel: 'Участник через аккаунт',
          safeMode: false,
          status: 'active',
          avatarKey: null,
        },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json().student).toMatchObject({
        studentCode: null,
        loginHandle: null,
        loginMethod: 'account',
        safeMode: false,
      });
      const linkedChanged = await inject(app, {
        method: 'PATCH',
        url: `/api/classrooms/${classroomId}/seats/${codeSeat.id}`,
        headers: { cookie: teacher.cookie },
        payload: {
          displayLabel: 'Связанный ученик',
          safeMode: true,
          status: 'active',
          avatarKey: null,
        },
      });
      expect(linkedChanged.statusCode, linkedChanged.body).toBe(200);
      expect(linkedChanged.json().student.studentCode).toBe(codeSeat.studentCode);
      const codeLogin = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code: classCode, studentCode: codeSeat.studentCode },
      });
      expect(codeLogin.statusCode, codeLogin.body).toBe(200);
      const linkedClasses = await inject(app, {
        method: 'GET',
        url: '/api/class-join/account/classes',
        headers: { cookie: linkedAccount.cookie },
      });
      expect(linkedClasses.statusCode, linkedClasses.body).toBe(200);
      expect(
        linkedClasses
          .json()
          .items.some((row: { classroomId: string }) => row.classroomId === classroomId),
      ).toBe(true);
      expect(
        (
          await admin.query('SELECT * FROM classroom_student_code_protected WHERE seat_id=$1', [
            codeSeat.id,
          ])
        ).rows,
      ).toEqual(before.rows);
      const originalTag = before.rows[0].encryption_tag;
      await admin.query(
        'UPDATE classroom_student_code_protected SET encryption_tag=$1 WHERE seat_id=$2',
        [Buffer.alloc(16), codeSeat.id],
      );
      try {
        const corruptRoster = await readRoster();
        expect(corruptRoster.statusCode, corruptRoster.body).toBe(503);
        expect(corruptRoster.body).toContain('credential_storage_unavailable');
      } finally {
        await admin.query(
          'UPDATE classroom_student_code_protected SET encryption_tag=$1 WHERE seat_id=$2',
          [originalTag, codeSeat.id],
        );
      }
      expect((await readRoster()).statusCode).toBe(200);
    } finally {
      if (previousMode === undefined) delete process.env['ASA_STUDENT_CODE_PROTECTION_MODE'];
      else process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = previousMode;
    }
  });
  it('compat dual-writes protected envelope, decrypts current readback, and signs in by HMAC lookup', async () => {
    const { teacher, classroomId, classCode } = await teacherClass();
    const seat = await addSeat(teacher.cookie, classroomId, 'Protected learner');

    const protectedRow = await admin.query(
      `SELECT protected.*,encode(encryption_ciphertext,'hex') AS ciphertext_hex
         FROM classroom_student_code_protected protected
        WHERE seat_id=$1`,
      [seat.id],
    );
    expect(protectedRow.rowCount).toBe(1);
    expect(protectedRow.rows[0]).toMatchObject({
      credential_version: 1,
      credential_state: 'protected',
      encryption_key_id: 'enc1',
      lookup_key_id: 'lookup1',
    });
    expect(protectedRow.rows[0].encryption_nonce.length).toBe(12);
    expect(protectedRow.rows[0].encryption_tag.length).toBe(16);
    expect(protectedRow.rows[0].lookup_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(protectedRow.rows[0].ciphertext_hex).not.toContain(
      Buffer.from(seat.studentCode).toString('hex'),
    );

    const legacy = await admin.query(
      `SELECT seat.login_handle,seat.normalized_login_handle,cred.credential_hash
         FROM classroom_student_seats seat
         JOIN classroom_seat_credentials cred ON cred.seat_id=seat.id
        WHERE seat.id=$1`,
      [seat.id],
    );
    expect(legacy.rows[0].login_handle).toBe(seat.studentCode);
    expect(legacy.rows[0].normalized_login_handle).toBe(seat.studentCode);
    expect(legacy.rows[0].credential_hash).toMatch(/^[0-9a-f]{64}$/);

    // Prove teacher readback is decrypted from the protected envelope rather
    // than merely echoing the temporary compatibility plaintext.
    await admin.query(
      `UPDATE classroom_student_seats
          SET login_handle='ZZZZ',normalized_login_handle='ZZZZ'
        WHERE id=$1`,
      [seat.id],
    );
    const roster = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId}/roster`,
      headers: { cookie: teacher.cookie },
    });
    expect(roster.statusCode, roster.body).toBe(200);
    const rosterSeat = roster.json().items.find((item: { id: string }) => item.id === seat.id);
    expect(rosterSeat.studentCode).toBe(seat.studentCode);

    const signedIn = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: classCode, studentCode: seat.studentCode },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);

    // Generated codes can theoretically contain only digits. When letters are
    // present, prove protected lookup retains their exact case.
    if (/[A-Za-z]/.test(seat.studentCode)) {
      const changedCase = seat.studentCode
        .split('')
        .map((char) =>
          /[A-Z]/.test(char) ? char.toLowerCase() : /[a-z]/.test(char) ? char.toUpperCase() : char,
        )
        .join('');
      const rejected = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code: classCode, studentCode: changedCase },
      });
      expect(rejected.statusCode, rejected.body).toBe(401);
    }
  });

  it('restricted runtime cannot mint a protected session from seat/version without HMAC proof', async () => {
    const { teacher, classroomId } = await teacherClass();
    const seat = await addSeat(teacher.cookie, classroomId, 'Atomic proof learner');

    const state = await admin.query(
      `SELECT code.token_hash,cred.version,cred.credential_hash
         FROM classroom_student_seats seat
         JOIN classroom_join_codes code
           ON code.classroom_id=seat.classroom_id AND code.tenant_id=seat.tenant_id
         JOIN classroom_seat_credentials cred ON cred.seat_id=seat.id
        WHERE seat.id=$1 AND code.status='active'`,
      [seat.id],
    );
    const classCodeHash = String(state.rows[0].token_hash);
    const credentialVersion = Number(state.rows[0].version);
    const legacyCredentialHash = String(state.rows[0].credential_hash);
    const directTokenHash = 'f'.repeat(64);

    const protectedFunctions = await admin.query(
      `SELECT p.oid::regprocedure::text AS signature,
              has_function_privilege('asalab_app',p.oid,'EXECUTE') AS can_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname='classroom_student_seat_sign_in_protected'
        ORDER BY 1`,
    );
    expect(protectedFunctions.rows).toHaveLength(1);
    expect(protectedFunctions.rows[0].signature).toContain(
      'classroom_student_seat_sign_in_protected(character varying,jsonb,character varying,character varying,integer)',
    );
    expect(protectedFunctions.rows[0].can_execute).toBe(true);

    await expect(
      runtime.query(
        `SELECT * FROM classroom_student_seat_sign_in_protected(
          $1,$2::uuid,$3::integer,$4,$5
        )`,
        [classCodeHash, seat.id, credentialVersion, directTokenHash, 8],
      ),
    ).rejects.toThrow();

    const noProof = await runtime.query(
      `SELECT result_code
         FROM classroom_student_seat_sign_in_protected($1,$2::jsonb,$3,$4,$5)`,
      [
        classCodeHash,
        JSON.stringify([{ keyId: 'lookup1', digest: '0'.repeat(64) }]),
        legacyCredentialHash,
        directTokenHash,
        8,
      ],
    );
    expect(noProof.rows[0]?.result_code).toBe('credential_storage_unavailable');

    const minted = await admin.query(
      `SELECT count(*)::int AS count
         FROM classroom_student_sessions
        WHERE seat_id=$1 AND token_hash=$2`,
      [seat.id, directTokenHash],
    );
    expect(minted.rows[0]?.count).toBe(0);
  });

  it('rehashes retired history K1 to K2 before K1 removal and still blocks historical reuse', async () => {
    const { teacher, classroomId, classCode } = await teacherClass();
    const seat = await addSeat(teacher.cookie, classroomId, 'Lookup rotation learner');
    const x = 'Ab7k';
    const y = 'Cd8m';

    const establishX = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats/${seat.id}/code`,
      headers: { cookie: teacher.cookie },
      payload: { studentCode: x, requestId: crypto.randomUUID() },
    });
    expect(establishX.statusCode, establishX.body).toBe(201);

    const rotateRequestId = crypto.randomUUID();
    const rotateToY = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats/${seat.id}/code`,
      headers: { cookie: teacher.cookie },
      payload: { studentCode: y, requestId: rotateRequestId },
    });
    expect(rotateToY.statusCode, rotateToY.body).toBe(201);
    expect(rotateToY.json()).toMatchObject({ studentCode: y, version: 3 });

    const retiredBefore = await admin.query(
      `SELECT credential_version,encryption_key_id,lookup_key_id,lookup_digest,
              encode(encryption_ciphertext,'hex') AS ciphertext_hex
         FROM classroom_student_code_retired_digests
        WHERE seat_id=$1 AND credential_version=2`,
      [seat.id],
    );
    expect(retiredBefore.rows).toHaveLength(1);
    expect(retiredBefore.rows[0].lookup_key_id).toBe('lookup1');
    expect(retiredBefore.rows[0].lookup_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(retiredBefore.rows[0].ciphertext_hex).not.toContain(Buffer.from(x).toString('hex'));

    const oldLogin = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: classCode, studentCode: x },
    });
    expect(oldLogin.statusCode, oldLogin.body).toBe(401);

    useLookupKeyring({ lookup1, lookup2 }, 'lookup2');
    try {
      const rehashReplay = await inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classroomId}/seats/${seat.id}/code`,
        headers: { cookie: teacher.cookie },
        payload: { studentCode: y, requestId: rotateRequestId },
      });
      expect(rehashReplay.statusCode, rehashReplay.body).toBe(201);
      expect(rehashReplay.json()).toMatchObject({ studentCode: y, version: 3, reused: true });

      const currentAfter = await admin.query(
        `SELECT lookup_key_id,lookup_digest,encryption_key_id
           FROM classroom_student_code_protected WHERE seat_id=$1`,
        [seat.id],
      );
      expect(currentAfter.rows[0].lookup_key_id).toBe('lookup2');

      const retiredAfter = await admin.query(
        `SELECT lookup_key_id,lookup_digest,encryption_key_id,
                encode(encryption_ciphertext,'hex') AS ciphertext_hex
           FROM classroom_student_code_retired_digests
          WHERE seat_id=$1 AND credential_version=2`,
        [seat.id],
      );
      expect(retiredAfter.rows[0].lookup_key_id).toBe('lookup2');
      expect(retiredAfter.rows[0].lookup_digest).not.toBe(retiredBefore.rows[0].lookup_digest);
      expect(retiredAfter.rows[0].ciphertext_hex).not.toContain(Buffer.from(x).toString('hex'));

      useLookupKeyring({ lookup2 }, 'lookup2');

      const yLogin = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code: classCode, studentCode: y },
      });
      expect(yLogin.statusCode, yLogin.body).toBe(200);

      const reuseX = await inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classroomId}/seats/${seat.id}/code`,
        headers: { cookie: teacher.cookie },
        payload: { studentCode: x, requestId: crypto.randomUUID() },
      });
      expect(reuseX.statusCode, reuseX.body).toBe(409);
      expect(reuseX.body).toContain('student_code_taken');

      const other = await addSeat(teacher.cookie, classroomId, 'Case-sensitive reuse learner');
      const caseVariant = await inject(app, {
        method: 'POST',
        url: `/api/classrooms/${classroomId}/seats/${other.id}/code`,
        headers: { cookie: teacher.cookie },
        payload: { studentCode: x.toLowerCase(), requestId: crypto.randomUUID() },
      });
      expect(caseVariant.statusCode, caseVariant.body).toBe(201);
      expect(caseVariant.json().studentCode).toBe(x.toLowerCase());

      const yStillWorks = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code: classCode, studentCode: y },
      });
      expect(yStillWorks.statusCode, yStillWorks.body).toBe(200);
    } finally {
      useDefaultLookupKeyring();
    }
  });

  it('rotation retires old keyed digest, is atomic on retired-code reuse, and preserves the current credential', async () => {
    const { teacher, classroomId, classCode } = await teacherClass();
    const seat = await addSeat(teacher.cookie, classroomId, 'Rotation learner');
    const originalCode = seat.studentCode;

    const initialDigest = await admin.query(
      'SELECT lookup_key_id,lookup_digest FROM classroom_student_code_protected WHERE seat_id=$1',
      [seat.id],
    );

    const initialLogin = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: classCode, studentCode: originalCode },
    });
    expect(initialLogin.statusCode, initialLogin.body).toBe(200);

    const rotated = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats/${seat.id}/code`,
      headers: { cookie: teacher.cookie },
      payload: { studentCode: 'Ab7k', requestId: crypto.randomUUID() },
    });
    expect(rotated.statusCode, rotated.body).toBe(201);
    expect(rotated.json()).toMatchObject({ studentCode: 'Ab7k', version: 2 });

    const retired = await admin.query(
      `SELECT credential_version,lookup_key_id,lookup_digest
         FROM classroom_student_code_retired_digests WHERE seat_id=$1`,
      [seat.id],
    );
    expect(retired.rows).toContainEqual({
      credential_version: 1,
      lookup_key_id: initialDigest.rows[0].lookup_key_id,
      lookup_digest: initialDigest.rows[0].lookup_digest,
    });

    const active = await admin.query(
      `SELECT cred.version,seat.login_handle,protected.credential_version,
              protected.lookup_digest
         FROM classroom_student_seats seat
         JOIN classroom_seat_credentials cred ON cred.seat_id=seat.id
         JOIN classroom_student_code_protected protected ON protected.seat_id=seat.id
        WHERE seat.id=$1`,
      [seat.id],
    );
    expect(active.rows[0].version).toBe(2);
    expect(active.rows[0].credential_version).toBe(2);
    expect(active.rows[0].login_handle).toBe('Ab7k');

    const oldLogin = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: classCode, studentCode: originalCode },
    });
    expect(oldLogin.statusCode, oldLogin.body).toBe(401);
    const currentLogin = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: classCode, studentCode: 'Ab7k' },
    });
    expect(currentLogin.statusCode, currentLogin.body).toBe(200);

    const activeBeforeRejectedReuse = active.rows[0];
    const reuse = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats/${seat.id}/code`,
      headers: { cookie: teacher.cookie },
      payload: { studentCode: originalCode, requestId: crypto.randomUUID() },
    });
    expect(reuse.statusCode, reuse.body).toBe(409);
    expect(reuse.body).toContain('student_code_taken');

    const afterRejectedReuse = await admin.query(
      `SELECT cred.version,seat.login_handle,protected.credential_version,
              protected.lookup_digest
         FROM classroom_student_seats seat
         JOIN classroom_seat_credentials cred ON cred.seat_id=seat.id
         JOIN classroom_student_code_protected protected ON protected.seat_id=seat.id
        WHERE seat.id=$1`,
      [seat.id],
    );
    expect(afterRejectedReuse.rows[0]).toEqual(activeBeforeRejectedReuse);
  });

  it('lazily protects a legacy-only Seat before rotation and tombstones its old code', async () => {
    process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'off';
    let teacher: { cookie: string };
    let classroomId: string;
    let legacySeat: { id: string; studentCode: string };
    try {
      const created = await teacherClass();
      teacher = created.teacher;
      classroomId = created.classroomId;
      legacySeat = await addSeat(teacher.cookie, classroomId, 'Legacy compat learner');
    } finally {
      process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'compat';
    }

    const before = await admin.query(
      'SELECT count(*)::int AS count FROM classroom_student_code_protected WHERE seat_id=$1',
      [legacySeat!.id],
    );
    expect(before.rows[0]?.count).toBe(0);

    const oldCode = legacySeat!.studentCode;
    const rotated = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId!}/seats/${legacySeat!.id}/code`,
      headers: { cookie: teacher!.cookie },
      payload: { studentCode: 'Ab7k', requestId: crypto.randomUUID() },
    });
    expect(rotated.statusCode, rotated.body).toBe(201);
    expect(rotated.json()).toMatchObject({ studentCode: 'Ab7k', version: 2 });

    const protectedCurrent = await admin.query(
      `SELECT credential_version,credential_state
         FROM classroom_student_code_protected WHERE seat_id=$1`,
      [legacySeat!.id],
    );
    expect(protectedCurrent.rows[0]).toEqual({
      credential_version: 2,
      credential_state: 'protected',
    });

    const retired = await admin.query(
      `SELECT credential_version,lookup_key_id,lookup_digest
         FROM classroom_student_code_retired_digests WHERE seat_id=$1`,
      [legacySeat!.id],
    );
    expect(retired.rows).toHaveLength(1);
    expect(retired.rows[0].credential_version).toBe(1);
    expect(retired.rows[0].lookup_key_id).toBe('lookup1');
    expect(retired.rows[0].lookup_digest).toMatch(/^[0-9a-f]{64}$/);

    const other = await addSeat(teacher!.cookie, classroomId!, 'Retired reuse target');
    const rejectedReuse = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId!}/seats/${other.id}/code`,
      headers: { cookie: teacher!.cookie },
      payload: { studentCode: oldCode, requestId: crypto.randomUUID() },
    });
    expect(rejectedReuse.statusCode, rejectedReuse.body).toBe(409);
    expect(rejectedReuse.body).toContain('student_code_taken');

    const roster = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId!}/roster`,
      headers: { cookie: teacher!.cookie },
    });
    expect(roster.statusCode, roster.body).toBe(200);
    expect(
      roster.json().items.find((item: { id: string }) => item.id === other.id).studentCode,
    ).toBe(other.studentCode);
  });

  it('batch commit and exact replay keep one protected version per created StudentSeat', async () => {
    const { teacher, classroomId } = await teacherClass();
    const students = [
      { displayLabel: 'Batch protected one', safeMode: true },
      { displayLabel: 'Batch protected two', safeMode: true },
    ];
    const requestId = crypto.randomUUID();

    const preview = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats/batch/preview`,
      headers: { cookie: teacher.cookie },
      payload: { students, requestId },
    });
    expect(preview.statusCode, preview.body).toBe(201);

    const commit = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats/batch`,
      headers: { cookie: teacher.cookie },
      payload: { students, requestId },
    });
    expect(commit.statusCode, commit.body).toBe(201);
    expect(commit.json()).toMatchObject({ created: 2, reused: false });
    const resultRows = commit.json().results as Array<{
      seatId: string;
      studentCode: string;
      credentialVersion: number;
    }>;

    const protectedRows = await admin.query(
      `SELECT seat_id,credential_version,encryption_key_id,lookup_key_id,
              encode(encryption_nonce,'hex') AS nonce_hex,
              encode(encryption_ciphertext,'hex') AS ciphertext_hex,
              encode(encryption_tag,'hex') AS tag_hex,
              updated_at
         FROM classroom_student_code_protected
        WHERE seat_id=ANY($1::uuid[]) ORDER BY seat_id`,
      [resultRows.map((row) => row.seatId)],
    );
    expect(protectedRows.rows).toHaveLength(2);
    expect(
      protectedRows.rows.every(
        (row) =>
          Number(row.credential_version) === 1 &&
          row.encryption_key_id === 'enc1' &&
          row.lookup_key_id === 'lookup1',
      ),
    ).toBe(true);

    const replay = await inject(app, {
      method: 'POST',
      url: `/api/classrooms/${classroomId}/seats/batch`,
      headers: { cookie: teacher.cookie },
      payload: { students, requestId },
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toMatchObject({ reused: true });
    expect(
      replay.json().results.map((row: { seatId: string; studentCode: string }) => ({
        seatId: row.seatId,
        studentCode: row.studentCode,
      })),
    ).toEqual(resultRows.map((row) => ({ seatId: row.seatId, studentCode: row.studentCode })));

    const afterReplay = await admin.query(
      `SELECT seat_id,credential_version,encryption_key_id,lookup_key_id,
              encode(encryption_nonce,'hex') AS nonce_hex,
              encode(encryption_ciphertext,'hex') AS ciphertext_hex,
              encode(encryption_tag,'hex') AS tag_hex,
              updated_at
         FROM classroom_student_code_protected
        WHERE seat_id=ANY($1::uuid[]) ORDER BY seat_id`,
      [resultRows.map((row) => row.seatId)],
    );
    expect(afterReplay.rows).toEqual(protectedRows.rows);
  });

  it('unknown protected lookup key fails closed in compat without consuming abuse budget while legacy-only still signs in', async () => {
    const { teacher, classroomId, classCode } = await teacherClass();
    const protectedSeat = await addSeat(teacher.cookie, classroomId, 'Missing lookup key learner');

    const normal = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: classCode, studentCode: protectedSeat.studentCode },
    });
    expect(normal.statusCode, normal.body).toBe(200);

    await admin.query(
      `UPDATE classroom_student_code_protected
          SET lookup_key_id='missing-key'
        WHERE seat_id=$1`,
      [protectedSeat.id],
    );
    const beforeSessions = await admin.query(
      `SELECT count(*)::int AS count FROM classroom_student_sessions WHERE seat_id=$1`,
      [protectedSeat.id],
    );

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const unavailable = await inject(app, {
        method: 'POST',
        url: '/api/class-join/studentseat',
        payload: { code: classCode, studentCode: protectedSeat.studentCode },
      });
      expect(unavailable.statusCode, unavailable.body).toBe(503);
      expect(unavailable.body).toContain('credential_storage_unavailable');
      expect(unavailable.body).not.toContain('too_many_attempts');
    }

    const afterSessions = await admin.query(
      `SELECT count(*)::int AS count FROM classroom_student_sessions WHERE seat_id=$1`,
      [protectedSeat.id],
    );
    expect(afterSessions.rows[0]?.count).toBe(beforeSessions.rows[0]?.count);

    process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'off';
    let legacySeat: { id: string; studentCode: string };
    try {
      legacySeat = await addSeat(teacher.cookie, classroomId, 'True legacy-only learner');
    } finally {
      process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'compat';
    }

    const legacyProtected = await admin.query(
      `SELECT count(*)::int AS count
         FROM classroom_student_code_protected
        WHERE seat_id=$1`,
      [legacySeat!.id],
    );
    expect(legacyProtected.rows[0]?.count).toBe(0);

    const legacyLogin = await inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      payload: { code: classCode, studentCode: legacySeat!.studentCode },
    });
    expect(legacyLogin.statusCode, legacyLogin.body).toBe(200);
  });

  it('fails protected current readback closed on an unknown encryption key while compat legacy rows remain supported', async () => {
    const { teacher, classroomId } = await teacherClass();
    const protectedSeat = await addSeat(teacher.cookie, classroomId, 'Unknown key learner');

    await admin.query(
      `UPDATE classroom_student_code_protected SET encryption_key_id='missing-key' WHERE seat_id=$1`,
      [protectedSeat.id],
    );
    const unavailable = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId}/roster`,
      headers: { cookie: teacher.cookie },
    });
    expect(unavailable.statusCode, unavailable.body).toBe(503);
    expect(unavailable.body).toContain('credential_storage_unavailable');

    // A row without a protected envelope is intentionally still readable in
    // compat mode; no backfill is performed by this slice.
    await admin.query('DELETE FROM classroom_student_code_protected WHERE seat_id=$1', [
      protectedSeat.id,
    ]);
    const compat = await inject(app, {
      method: 'GET',
      url: `/api/classrooms/${classroomId}/roster`,
      headers: { cookie: teacher.cookie },
    });
    expect(compat.statusCode, compat.body).toBe(200);
    expect(
      compat.json().items.find((item: { id: string }) => item.id === protectedSeat.id),
    ).toBeTruthy();

    process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'enforced';
    try {
      const enforcedRoster = await inject(app, {
        method: 'GET',
        url: `/api/classrooms/${classroomId}/roster`,
        headers: { cookie: teacher.cookie },
      });
      expect(enforcedRoster.statusCode, enforcedRoster.body).toBe(503);
      expect(enforcedRoster.body).toContain('credential_storage_unavailable');
    } finally {
      process.env['ASA_STUDENT_CODE_PROTECTION_MODE'] = 'compat';
    }
  });
});
