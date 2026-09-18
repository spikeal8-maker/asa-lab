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
      `SELECT seat_id,credential_version,encryption_key_id,lookup_key_id
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
    ).toEqual(
      resultRows.map((row) => ({ seatId: row.seatId, studentCode: row.studentCode })),
    );

    const afterReplay = await admin.query(
      'SELECT count(*)::int AS count,max(credential_version)::int AS max_version FROM classroom_student_code_protected WHERE seat_id=ANY($1::uuid[])',
      [resultRows.map((row) => row.seatId)],
    );
    expect(afterReplay.rows[0]).toEqual({ count: 2, max_version: 1 });
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
    expect(compat.json().items.find((item: { id: string }) => item.id === protectedSeat.id)).toBeTruthy();
  });
});
