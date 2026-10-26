#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

// Both gates require the same real PostgreSQL boundary as CI. Missing database
// access is a failure, never a skipped suite that can be reported as acceptance.
const browser = process.argv.includes('--browser');
for (const path of browser
  ? [
      'e2e/public-projects.spec.ts',
      'e2e/public-project-copy.spec.ts',
      'e2e/public-project-admin-moderation.spec.ts',
      'e2e/gallery.spec.ts',
      'e2e/project-hub.spec.ts',
    ]
  : [
      'tests/portal/public-projects.pg.spec.ts',
      'tests/portal/public-project-copy.pg.spec.ts',
      'tests/portal/public-project-moderation.pg.spec.ts',
      'tests/portal/public-project-pinning.pg.spec.ts',
      'tests/migration/project-publication-moderation.pg.spec.ts',
      'tests/migration/project-publication-editorial.pg.spec.ts',
      'tests/migration/project-publication-pins.pg.spec.ts',
      'tests/migration/ai-main-prefix-upgrade.pg.spec.ts',
      'apps/api/src/public-projects.spec.ts',
      'apps/api/src/public-project-copy.spec.ts',
      'apps/api/src/admin-public-projects.controller.spec.ts',
    ]) {
  if (!existsSync(path)) {
    console.error(`BLOCKED: required publication evidence file is missing: ${path}`);
    process.exit(78);
  }
}
const adminUrl = process.env.TEST_DATABASE_URL;
const runtimeUrl = process.env.APP_TEST_DATABASE_URL;
if (!adminUrl || !runtimeUrl) {
  console.error('BLOCKED: TEST_DATABASE_URL and APP_TEST_DATABASE_URL are required');
  process.exit(78);
}
const adminTarget = new URL(adminUrl);
const runtimeTarget = new URL(runtimeUrl);
if (
  !adminTarget.pathname.endsWith('_test') ||
  runtimeTarget.pathname !== adminTarget.pathname ||
  runtimeTarget.hostname !== adminTarget.hostname ||
  runtimeTarget.port !== adminTarget.port
) {
  console.error('BLOCKED: admin and runtime must use the same isolated *_test PostgreSQL');
  process.exit(78);
}
const client = new pg.Client({ connectionString: runtimeUrl, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  const result = await client.query(
    `SELECT current_user AS runtime_role, current_database() AS database,
            version() AS engine, role.rolsuper, role.rolbypassrls
       FROM pg_roles role WHERE role.rolname = current_user`,
  );
  const role = result.rows[0];
  if (
    !role ||
    role.runtime_role !== 'asalab_app' ||
    role.rolsuper ||
    role.rolbypassrls ||
    !String(role.engine).startsWith('PostgreSQL ')
  ) {
    throw new Error('real PostgreSQL with the restricted asalab_app role is required');
  }
  console.log(`PostgreSQL boundary: ${role.database}; restricted ${role.runtime_role}`);
} catch (cause) {
  console.error(`BLOCKED: PostgreSQL precondition failed (${cause.code ?? cause.name})`);
  process.exitCode = 78;
} finally {
  await client.end();
}
if (process.exitCode) process.exit(process.exitCode);

const checkout = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
const checkoutRevision = checkout.stdout?.trim();
const expectedRevision = process.env.ASA_BUILD_REVISION?.trim() || checkoutRevision;
if (
  checkout.status !== 0 ||
  !/^[a-f0-9]{40}$/.test(checkoutRevision ?? '') ||
  expectedRevision !== checkoutRevision
) {
  console.error(
    'BLOCKED: exact checkout revision is unavailable or differs from ASA_BUILD_REVISION',
  );
  process.exit(78);
}
const env = {
  ...process.env,
  ASA_BUILD_REVISION: expectedRevision,
  VITE_ASA_BUILD_REVISION: expectedRevision,
  NX_SKIP_NX_CACHE: 'true',
  NX_DAEMON: 'false',
};
function verifyBuiltRevision() {
  const path = 'apps/web/dist/build-metadata.json';
  if (!existsSync(path)) {
    console.error('BLOCKED: built web revision metadata is missing');
    process.exit(78);
  }
  const metadata = JSON.parse(readFileSync(path, 'utf8'));
  if (metadata.revision !== expectedRevision) {
    console.error('BLOCKED: built web revision differs from the checked-out publication candidate');
    process.exit(78);
  }
  console.log(`Built publication candidate: ${metadata.revision}`);
}
function run(args) {
  console.log(`\n> pnpm ${args.join(' ')}`);
  const result = spawnSync('pnpm', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(78);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (browser) {
  for (const file of ['apps/api/dist/main.js', 'apps/web/dist/index.html']) {
    if (!existsSync(file)) {
      console.error(`BLOCKED: ${file} is missing; run gate:projects-publication first`);
      process.exit(78);
    }
  }
  verifyBuiltRevision();
  run([
    'exec',
    'playwright',
    'test',
    'e2e/public-projects.spec.ts',
    'e2e/public-project-copy.spec.ts',
    'e2e/public-project-admin-moderation.spec.ts',
    'e2e/gallery.spec.ts',
    'e2e/project-hub.spec.ts',
    '--workers=1',
    '--reporter=list',
    '--output=reports/playwright/projects-publication',
  ]);
} else {
  run(['db:migrate:check']);
  // Nx follows ^build dependencies. API injection tests import the built API;
  // the browser then serves exactly these built files, not a Vite dev server.
  run(['exec', 'nx', 'run-many', '-t', 'build', '--projects=api,web', '--parallel=2']);
  verifyBuiltRevision();
  run(['exec', 'nx', 'run-many', '-t', 'typecheck', '--projects=projects,api,web', '--parallel=2']);
  run([
    'exec',
    'tsc',
    '--noEmit',
    '--target',
    'ES2022',
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--skipLibCheck',
    '--strict',
    '--types',
    'node',
    '--allowSyntheticDefaultImports',
    'e2e/public-projects.spec.ts',
    'e2e/public-project-copy.spec.ts',
    'e2e/public-project-admin-moderation.spec.ts',
    'e2e/gallery.spec.ts',
  ]);
  run([
    'exec',
    'vitest',
    'run',
    'contexts/projects/testing',
    'tests/portal/projects-api.spec.ts',
    'tests/portal/project-transactions.spec.ts',
    'tests/portal/project-publication-revisions.pg.spec.ts',
    'tests/portal/public-projects.pg.spec.ts',
    'tests/portal/public-project-copy.pg.spec.ts',
    'tests/portal/public-project-moderation.pg.spec.ts',
    'tests/portal/public-project-pinning.pg.spec.ts',
    'tests/migration/project-publication-moderation.pg.spec.ts',
    'tests/migration/project-publication-editorial.pg.spec.ts',
    'tests/migration/project-publication-pins.pg.spec.ts',
    'apps/api/src/public-projects.spec.ts',
    'apps/api/src/public-project-copy.spec.ts',
    'apps/api/src/admin-public-projects.controller.spec.ts',
    'apps/web/src/admin/testing/admin-publications.spec.ts',
    'apps/web/src/admin/testing/admin-navigation.spec.ts',
    'apps/web/src/projects-public',
    '--maxWorkers=2',
  ]);
  run(['test:creator-portal']);
  // Verify supported populated database upgrades from 0225 through 0247.
  run([
    'exec',
    'vitest',
    'run',
    'tests/migration/ai-main-prefix-upgrade.pg.spec.ts',
    '--maxWorkers=1',
  ]);
}
console.log(`Public Projects ${browser ? 'real browser' : 'code and PostgreSQL'} gate: PASS`);
