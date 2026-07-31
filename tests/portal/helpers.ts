import pg from 'pg';
import { hashPassword } from '../../contexts/identity/dist/index.js';

/** Isolated-test-database helpers. Integration suites refuse to run against
 * anything but a dedicated *_test database. */

function requireTestUrl(variable: string): string {
  const url = process.env[variable];
  if (!url) {
    throw new Error(`${variable} is required for integration tests`);
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `${variable} must point to an isolated test database (name ending in _test), got "${dbName}" — refusing to touch a development/production database`,
    );
  }
  return url;
}

/** Admin connection to the isolated test database (seeding/inspection). */
export function testAdminPool(): pg.Pool {
  return new pg.Pool({ connectionString: requireTestUrl('TEST_DATABASE_URL'), max: 3 });
}

/** Runtime-role connection to the SAME isolated test database. */
export function testAppPool(): pg.Pool {
  const adminDb = new URL(requireTestUrl('TEST_DATABASE_URL')).pathname;
  const appUrl = requireTestUrl('APP_TEST_DATABASE_URL');
  if (new URL(appUrl).pathname !== adminDb) {
    throw new Error(
      'APP_TEST_DATABASE_URL must target the same _test database as TEST_DATABASE_URL',
    );
  }
  return new pg.Pool({ connectionString: appUrl, max: 3 });
}

export interface SeededTeacher {
  tenantId: string;
  workspace: string;
  schoolId: string;
  periodId: string;
  teacherId: string;
  email: string;
  password: string;
}

export async function seedLegacyTeacherIdentity(
  admin: pg.Pool,
  input: {
    tenantId: string;
    userId: string;
    email: string;
    passwordHash: string;
    displayName: string;
    workspaceId: string;
  },
): Promise<void> {
  const account = await admin.query(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, $2, DATE '1990-01-01', 'RU') RETURNING id`,
    [input.email, input.passwordHash],
  );
  const accountId = account.rows[0].id as string;
  await admin.query(
    `INSERT INTO profiles (account_id, username, display_name)
     VALUES ($1, $2, $3)`,
    [accountId, `edu-${accountId.replaceAll('-', '').slice(0, 10)}`, input.displayName],
  );
  const principal = await admin.query(
    `INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id`,
    [accountId],
  );
  const principalId = principal.rows[0].id as string;
  await admin.query(
    `INSERT INTO capability_grants
       (account_id, capability, state, policy_version, granted_by)
     VALUES
       ($1, 'creator', 'verified', 'asa-lab-2026-07', 'migration'),
       ($1, 'educator', 'verified', 'asa-lab-2026-07', 'migration')`,
    [accountId],
  );
  await admin.query(
    `INSERT INTO workspace_memberships (account_id, workspace_id, role)
     VALUES ($1, $2, 'educator')`,
    [accountId, input.workspaceId],
  );
  await admin.query(
    `INSERT INTO legacy_user_account_links
       (tenant_id, user_id, account_id, principal_id)
     VALUES ($1, $2, $3, $4)`,
    [input.tenantId, input.userId, accountId, principalId],
  );
}

let n = 0;

export async function seedTeacher(
  admin: pg.Pool,
  label: string,
  options: { withSchool?: boolean; withActivePeriod?: boolean } = {},
): Promise<SeededTeacher> {
  n += 1;
  const unique = `${Date.now()}-${n}-${Math.floor(Math.random() * 1e6)}`;
  const workspace = `ws-${label}-${unique}`.toLowerCase().slice(0, 60);
  const email = `teacher-${label}-${unique}@test.local`.toLowerCase();
  const password = `pw-${unique}`;
  const withSchool = options.withSchool !== false;
  const withActivePeriod = options.withActivePeriod !== false;

  const tenant = await admin.query(
    `INSERT INTO tenants (title, workspace_slug) VALUES ($1, $2) RETURNING id`,
    [`Тест ${label}`, workspace],
  );
  const tenantId = tenant.rows[0].id as string;
  await admin.query(
    `INSERT INTO tenant_placements (tenant_id, mode) VALUES ($1, 'DEDICATED_REGION')`,
    [tenantId],
  );
  const school = await admin.query(
    `INSERT INTO schools (tenant_id, title) VALUES ($1, 'Школа') RETURNING id`,
    [tenantId],
  );
  const schoolId = school.rows[0].id as string;
  const period = await admin.query(
    `INSERT INTO academic_periods (tenant_id, school_id, title, starts_on, ends_on, is_active)
     VALUES ($1, $2, 'Период', '2026-09-01', '2027-06-30', $3) RETURNING id`,
    [tenantId, schoolId, withActivePeriod],
  );
  const passwordHash = hashPassword(password);
  const teacher = await admin.query(
    `INSERT INTO users (tenant_id, school_id, role, email, display_name, password_hash)
     VALUES ($1, $2, 'teacher', $3, $4, $5) RETURNING id`,
    [tenantId, withSchool ? schoolId : null, email, `Педагог ${label}`, passwordHash],
  );
  const teacherId = teacher.rows[0].id as string;
  const workspaceResult = await admin.query(
    `INSERT INTO workspaces (tenant_id, kind, title)
     VALUES ($1, 'organization', $2) RETURNING id`,
    [tenantId, `Тест ${label}`],
  );
  const workspaceId = workspaceResult.rows[0].id as string;
  await seedLegacyTeacherIdentity(admin, {
    tenantId,
    userId: teacherId,
    email,
    passwordHash,
    displayName: `Педагог ${label}`,
    workspaceId,
  });
  return {
    tenantId,
    workspace,
    schoolId,
    periodId: period.rows[0].id as string,
    teacherId,
    email,
    password,
  };
}
