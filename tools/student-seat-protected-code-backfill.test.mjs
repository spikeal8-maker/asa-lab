import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  collectStudentSeatProtectedCodeInventory,
  formatStudentSeatProtectedCodeInventory,
  resolveInventoryDatabaseUrl,
  runStudentSeatProtectedCodeInventoryCli,
} from './student-seat-protected-code-backfill.mjs';

function trackedClient(db, statements) {
  return {
    async query(sql, params = []) {
      statements.push(String(sql));
      return params.length > 0 ? db.query(sql, params) : db.query(sql);
    },
  };
}

test('requires an explicit test/admin database URL and ignores generic DATABASE_URL', async () => {
  assert.throws(
    () => resolveInventoryDatabaseUrl({ DATABASE_URL: 'postgresql://ignored/production' }),
    /BLOCKED: set STUDENT_CODE_BACKFILL_ADMIN_DATABASE_URL or TEST_DATABASE_URL explicitly/,
  );
  assert.throws(
    () => resolveInventoryDatabaseUrl({ TEST_DATABASE_URL: 'postgresql://admin/db_not_safe' }),
    /must end in _test/,
  );
  assert.equal(
    resolveInventoryDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://admin@localhost/asa_inventory_test',
    }),
    'postgresql://admin@localhost/asa_inventory_test',
  );
  assert.equal(
    resolveInventoryDatabaseUrl({
      STUDENT_CODE_BACKFILL_ADMIN_DATABASE_URL: 'postgresql://admin@localhost/asa_admin',
    }),
    'postgresql://admin@localhost/asa_admin',
  );

  const errors = [];
  const exitCode = await runStudentSeatProtectedCodeInventoryCli({
    env: { DATABASE_URL: 'postgresql://ignored/production' },
    log: () => assert.fail('inventory CLI must not print output when configuration is blocked'),
    error: (message) => errors.push(String(message)),
  });
  assert.equal(exitCode, 78);
  assert.match(errors.join('\n'), /^BLOCKED:/);
});

test('reports only deterministic aggregate inventory and performs zero DB mutations', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE classroom_student_seats (
        id text PRIMARY KEY,
        status text NOT NULL,
        login_handle text NOT NULL
      );
      CREATE TABLE classroom_student_code_protected (
        seat_id text PRIMARY KEY REFERENCES classroom_student_seats(id),
        credential_state text NOT NULL,
        encryption_key_id text NOT NULL,
        lookup_key_id text NOT NULL,
        encryption_ciphertext text NOT NULL,
        lookup_digest text NOT NULL,
        key_material_for_test text NOT NULL
      );

      INSERT INTO classroom_student_seats(id,status,login_handle) VALUES
        ('s1','issued','DoNotPrint-Alpha'),
        ('s2','active','DoNotPrint-Beta'),
        ('s3','suspended','DoNotPrint-Gamma'),
        ('s4','issued','DoNotPrint-Delta'),
        ('s5','removed','DoNotPrint-Removed');

      INSERT INTO classroom_student_code_protected(
        seat_id,credential_state,encryption_key_id,lookup_key_id,
        encryption_ciphertext,lookup_digest,key_material_for_test
      ) VALUES
        ('s1','protected','enc-v1','lookup-v1','ciphertext-secret-1','hmac-secret-1','actual-key-secret-1'),
        ('s2','legacy_predictable','enc-v1','lookup-v2','ciphertext-secret-2','hmac-secret-2','actual-key-secret-2'),
        ('s3','legacy_predictable','enc-v2','lookup-v2','ciphertext-secret-3','hmac-secret-3','actual-key-secret-3'),
        ('s5','protected','enc-removed','lookup-removed','ciphertext-secret-removed','hmac-secret-removed','actual-key-secret-removed');
    `);

    const beforeSeats = await db.query('SELECT * FROM classroom_student_seats ORDER BY id');
    const beforeProtected = await db.query(
      'SELECT * FROM classroom_student_code_protected ORDER BY seat_id',
    );

    const statements = [];
    const client = trackedClient(db, statements);
    const first = await collectStudentSeatProtectedCodeInventory(client);
    const second = await collectStudentSeatProtectedCodeInventory(client);

    assert.deepEqual(first, {
      active_student_seats: 4,
      protected_active: 3,
      unprotected_active: 1,
      legacy_predictable: 2,
      encryption_key_id_distribution: [
        { key_id: 'enc-v1', count: 2 },
        { key_id: 'enc-v2', count: 1 },
      ],
      lookup_key_id_distribution: [
        { key_id: 'lookup-v1', count: 1 },
        { key_id: 'lookup-v2', count: 2 },
      ],
    });
    assert.deepEqual(second, first);

    const rendered = formatStudentSeatProtectedCodeInventory(first);
    for (const forbidden of [
      'DoNotPrint-',
      'ciphertext-secret',
      'hmac-secret',
      'actual-key-secret',
      'enc-removed',
      'lookup-removed',
    ]) {
      assert.equal(rendered.includes(forbidden), false, `output leaked ${forbidden}`);
    }

    const afterSeats = await db.query('SELECT * FROM classroom_student_seats ORDER BY id');
    const afterProtected = await db.query(
      'SELECT * FROM classroom_student_code_protected ORDER BY seat_id',
    );
    assert.deepEqual(afterSeats.rows, beforeSeats.rows);
    assert.deepEqual(afterProtected.rows, beforeProtected.rows);

    const executedSql = statements.join('\n');
    assert.match(executedSql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/i);
    assert.equal(
      /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|MERGE|GRANT|REVOKE|CALL)\b/i.test(
        executedSql,
      ),
      false,
      executedSql,
    );
  } finally {
    await db.close();
  }
});
