#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const BASE_PATH = 'compose.yaml';
const OVERLAYS = {
  base: [],
  dev: ['compose.dev.yaml'],
  test: ['compose.test.yaml'],
  staging: ['compose.staging.yaml'],
  production: ['compose.production.yaml'],
};
const REQUIRED_FILES = [
  BASE_PATH,
  ...new Set(Object.values(OVERLAYS).flat()),
  'Dockerfile.api',
  'Dockerfile.web',
  '.dockerignore',
  '.env.docker.example',
  'docker/api-entrypoint.sh',
  'docker/migrate-entrypoint.sh',
  'docker/certs/russian-trusted-root-ca.pem',
  'docker/web/Caddyfile',
  'tools/asa-lab.sh',
  'tools/asa-lab.ps1',
  'tools/docker-backup.sh',
  'tools/docker-backup.ps1',
  'tools/docker-restore.sh',
  'tools/docker-restore.ps1',
  'tools/docker-update.sh',
  'tools/docker-update.ps1',
  'docs/deployment/QUICK_START.md',
  'docs/deployment/DOCKER_BACKUP_RESTORE.md',
  'docs/deployment/GUARDED_UPDATE.md',
];
const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);
const EXPECTED_PORTS = {
  base: [4610],
  dev: [4610, 4611],
  test: [4612],
  staging: [4610],
  production: [4610],
};
const errors = [];

for (const path of REQUIRED_FILES) {
  if (!existsSync(path)) errors.push(`missing required Docker file: ${path}`);
}

const maxRootCertificatePath = 'docker/certs/russian-trusted-root-ca.pem';
const maxRootCertificateSha256 = 'd26d2d0231b7c39f92cc738512ba54103519e4405d68b5bd703e9788ca8ecf31';
if (existsSync(maxRootCertificatePath)) {
  try {
    const certificateBytes = readFileSync(maxRootCertificatePath);
    const certificate = new X509Certificate(certificateBytes);
    const fingerprint = createHash('sha256').update(certificate.raw).digest('hex');
    if (fingerprint !== maxRootCertificateSha256) {
      errors.push('MAX trust root fingerprint does not match the pinned official certificate');
    }
    if (
      certificate.subject !== certificate.issuer ||
      !certificate.subject.includes('CN=Russian Trusted Root CA')
    ) {
      errors.push('MAX trust root is not the expected self-signed Russian Trusted Root CA');
    }
    if (
      Date.now() < Date.parse(certificate.validFrom) ||
      Date.now() >= Date.parse(certificate.validTo)
    ) {
      errors.push('MAX trust root is outside its validity period');
    }
  } catch (problem) {
    errors.push(
      `MAX trust root cannot be parsed: ${problem instanceof Error ? problem.message : String(problem)}`,
    );
  }
}

const apiDockerfile = existsSync('Dockerfile.api') ? readFileSync('Dockerfile.api', 'utf8') : '';
for (const marker of [
  'NODE_EXTRA_CA_CERTS=/app/certs/russian-trusted-root-ca.pem',
  '/workspace/docker/certs/russian-trusted-root-ca.pem',
]) {
  if (apiDockerfile && !apiDockerfile.includes(marker)) {
    errors.push(`Dockerfile.api: missing MAX trust marker ${marker}`);
  }
}

const portableDeploymentFiles = [
  'README.md',
  'docs/deployment/README.md',
  'docs/deployment/QUICK_START.md',
  'docs/deployment/LINUX_DOCKER_DEPLOYMENT.md',
  'docs/deployment/WINDOWS11_WSL2_DOCKER.md',
];
for (const path of portableDeploymentFiles) {
  if (!existsSync(path)) continue;
  const source = readFileSync(path, 'utf8');
  if (source.includes('git checkout assistant/docker-linux-bootstrap')) {
    errors.push(
      `${path}: deployment must target current main, not the historical bootstrap branch`,
    );
  }
}

const quickStart = existsSync('docs/deployment/QUICK_START.md')
  ? readFileSync('docs/deployment/QUICK_START.md', 'utf8')
  : '';
for (const marker of [
  'tools/asa-lab.sh up',
  'tools\\asa-lab.ps1 up',
  'Profile production',
  'ASA_COMPOSE_PROFILE=production',
  'Node.js, pnpm',
  'docker-update.sh --check',
  'docker-update.ps1 -Profile production -CheckOnly',
]) {
  if (quickStart && !quickStart.includes(marker)) {
    errors.push(`docs/deployment/QUICK_START.md: missing portability marker ${marker}`);
  }
}

const guardedUpdaterSources = [
  {
    path: 'tools/docker-update.sh',
    source: existsSync('tools/docker-update.sh')
      ? readFileSync('tools/docker-update.sh', 'utf8')
      : '',
    orderedMarkers: [
      'git status --porcelain',
      'git fetch origin main',
      'assert_github_ci_success "$target_revision"',
      'backup_database "$backup_path"',
      'git pull --ff-only origin main',
      'ASA_BUILD_REVISION=$new_revision',
      'compose up -d --build',
      '&& wait_exact_readiness',
    ],
  },
  {
    path: 'tools/docker-update.ps1',
    source: existsSync('tools/docker-update.ps1')
      ? readFileSync('tools/docker-update.ps1', 'utf8')
      : '',
    orderedMarkers: [
      'git status --porcelain',
      'Invoke-Native git fetch origin main',
      'Assert-GitHubCiSuccess $targetRevision',
      'New-DatabaseBackup $backupPath',
      'Invoke-Native git pull --ff-only origin main',
      '$env:ASA_BUILD_REVISION = $newRevision',
      "Invoke-Compose -Arguments @('up', '-d', '--build')",
      '[void](Wait-ExactReadiness',
    ],
  },
];
for (const { path, source, orderedMarkers } of guardedUpdaterSources) {
  for (const marker of ['pg_restore --list', 'synchronized', 'ASA Lab Governance and Code Gates']) {
    if (!source.includes(marker)) {
      errors.push(`${path}: missing guarded-update marker ${marker}`);
    }
  }
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const index = source.indexOf(marker);
    if (index < 0) {
      errors.push(`${path}: missing guarded-update marker ${marker}`);
    } else if (index <= previousIndex) {
      errors.push(`${path}: guarded-update marker is out of order: ${marker}`);
    }
    previousIndex = index;
  }
  for (const forbidden of ['reset --hard', 'git clean', 'down --volumes', 'docker volume rm']) {
    if (source.includes(forbidden)) {
      errors.push(`${path}: destructive command is forbidden: ${forbidden}`);
    }
  }
  for (const marker of ['COMPOSE_PROJECT_NAME', 'rollback-', 'automatic_database_restore']) {
    if (!source.includes(marker)) {
      errors.push(`${path}: missing fail-closed marker ${marker}`);
    }
  }
  for (const marker of ['build-metadata.json', 'CHECK BLOCKED']) {
    if (!source.includes(marker)) {
      errors.push(`${path}: missing deployment-coherence marker ${marker}`);
    }
  }
  const originMarkers = path.endsWith('.ps1')
    ? ['Select-RequiredWorkflowRun', 'Get-MixedOriginServices', 'Assert-CanonicalDatabaseOrigin']
    : ['mixed_origin_services', 'database_origin'];
  for (const marker of originMarkers) {
    if (!source.includes(marker)) {
      errors.push(`${path}: missing deployment-origin marker ${marker}`);
    }
  }
}

const databaseSafetySources = [
  {
    path: 'tools/docker-backup.sh',
    markers: ['pg_dump --format=custom', 'pg_restore --list', 'umask 077'],
  },
  {
    path: 'tools/docker-backup.ps1',
    markers: ['pg_dump --format=custom', 'pg_restore --list', 'Docker backup is empty'],
  },
  {
    path: 'tools/docker-restore.sh',
    markers: ['_test', 'pg_restore --exit-on-error', 'schema_migrations'],
  },
  {
    path: 'tools/docker-restore.ps1',
    markers: ['_test', 'pg_restore --exit-on-error', 'schema_migrations'],
  },
];
for (const { path, markers } of databaseSafetySources) {
  const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const marker of markers) {
    if (source && !source.includes(marker)) {
      errors.push(`${path}: missing database safety marker ${marker}`);
    }
  }
  for (const forbidden of ['down --volumes', 'docker volume rm']) {
    if (source.includes(forbidden)) {
      errors.push(`${path}: destructive command is forbidden: ${forbidden}`);
    }
  }
}

const shellBootstrap = existsSync('tools/asa-lab.sh')
  ? readFileSync('tools/asa-lab.sh', 'utf8')
  : '';
const powershellBootstrap = existsSync('tools/asa-lab.ps1')
  ? readFileSync('tools/asa-lab.ps1', 'utf8')
  : '';
for (const [path, source, markers] of [
  [
    'tools/asa-lab.sh',
    shellBootstrap,
    ['compose.yaml', 'compose.${profile}.yaml', 'health/ready', 'ASA_SEED_TEACHER_PASSWORD'],
  ],
  [
    'tools/asa-lab.ps1',
    powershellBootstrap,
    ['compose.yaml', 'compose.$Profile.yaml', 'health/ready', 'ASA_SEED_TEACHER_PASSWORD'],
  ],
]) {
  for (const marker of markers) {
    if (source && !source.includes(marker)) {
      errors.push(`${path}: missing bootstrap marker ${marker}`);
    }
  }
}

if (existsSync('package.json')) {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  if (packageJson.packageManager !== 'pnpm@9.15.9') {
    errors.push('package.json: packageManager must pin pnpm@9.15.9');
  }
  if (packageJson.engines?.pnpm !== '9.15.9') {
    errors.push('package.json: engines.pnpm must match the pinned package manager');
  }
  for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
    if (name.startsWith('gate:') && /(^|&&\s+)pnpm\b/.test(command)) {
      errors.push(`${name}: nested pnpm calls must go through Corepack`);
    }
  }
}

if (!existsSync(BASE_PATH)) {
  finish();
}

const base = parseYaml(readFileSync(BASE_PATH, 'utf8'));
const baseServices = base.services ?? {};
const serviceNames = Object.keys(baseServices).sort();
const expectedServices = ['api', 'migration', 'postgres', 'web'];
if (JSON.stringify(serviceNames) !== JSON.stringify(expectedServices)) {
  errors.push(
    `base services must be exactly ${expectedServices.join(', ')}, got ${serviceNames.join(', ')}`,
  );
}
if (base.networks?.database?.internal !== true) {
  errors.push('database network must be internal');
}
if (!Object.hasOwn(base.volumes ?? {}, 'postgres-data')) {
  errors.push('missing persistent postgres-data volume');
}

for (const [name, service] of Object.entries(baseServices)) {
  const image = service.image;
  if (typeof image !== 'string' || !image.includes(':') || image.endsWith(':latest')) {
    errors.push(`service ${name}: image must use a non-latest version tag`);
  }
  if (service.privileged === true) errors.push(`service ${name}: privileged mode is forbidden`);
  if (service.network_mode === 'host') errors.push(`service ${name}: host networking is forbidden`);
  if (service.user === undefined || service.user === 'root' || service.user === '0') {
    errors.push(`service ${name}: explicit non-root user is required`);
  }
  if (!(service.cap_drop ?? []).includes('ALL')) {
    errors.push(`service ${name}: cap_drop must include ALL`);
  }
  if (!(service.security_opt ?? []).includes('no-new-privileges:true')) {
    errors.push(`service ${name}: no-new-privileges is required`);
  }
  if (name !== 'postgres' && service.read_only !== true) {
    errors.push(`service ${name}: read-only root filesystem is required`);
  }
  for (const volume of service.volumes ?? []) {
    if (String(volume).includes('/var/run/docker.sock')) {
      errors.push(`service ${name}: Docker socket mount is forbidden`);
    }
  }
  for (const port of service.ports ?? []) {
    if (!String(port).startsWith('127.0.0.1:')) {
      errors.push(`service ${name}: published port must bind to 127.0.0.1 (${port})`);
    }
  }
}

if ((baseServices.postgres?.ports ?? []).length > 0) {
  errors.push('PostgreSQL must not publish a host port');
}
if ((baseServices.api?.ports ?? []).length > 0) {
  errors.push('base/staging API must remain internal; publish it only in compose.dev.yaml');
}

// `docker compose config` needs a Docker CLI. It is always present in CI; on a
// developer machine it may not be (for example a WSL distro without Docker
// Desktop integration, where the daemon is reachable only from the host). Skip
// loudly there instead of crashing, and never skip where CI enforces the gate.
const dockerProbe = spawnSync('docker', ['version', '--format', '{{.Client.Version}}'], {
  encoding: 'utf8',
});
const dockerAvailable = dockerProbe.error === undefined && dockerProbe.status === 0;
const dockerRequired = process.env.CI === 'true' || process.env.ASA_REQUIRE_DOCKER === 'true';

if (!dockerAvailable && !dockerRequired) {
  if (errors.length > 0) {
    console.error('compose:check FAIL');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  // Deliberately never the word PASS: the rendered-config checks — loopback
  // binding, non-root users, cap_drop, forbidden ports across all four profiles
  // — did not run. Calling this a pass is how a partial result gets quoted as
  // evidence later.
  console.log('compose:check SKIPPED (static file checks only)');
  console.log('- no Docker CLI on PATH; rendered compose config was not validated');
  console.log('- run in CI, or set ASA_REQUIRE_DOCKER=true, for the complete gate');
  process.exit(0);
}

for (const [profile, overlays] of Object.entries(OVERLAYS)) {
  const args = ['compose', '-f', BASE_PATH];
  for (const overlay of overlays) args.push('-f', overlay);
  args.push('config', '--format', 'json');
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      COMPOSE_PROJECT_NAME: `asa-lab-validate-${profile}`,
      ASA_WEB_PORT: '4610',
      ASA_API_PORT: '4611',
      POSTGRES_PASSWORD: 'compose-validation-admin-password',
      ASA_APP_DB_PASSWORD: 'compose-validation-runtime-password',
      DATABASE_URL: 'postgres://wrong-generic:wrong@elsewhere:5432/asalab',
      MIGRATION_DATABASE_URL:
        'postgres://asalab_admin:compose-validation-admin-password@postgres:5432/asalab',
      MIGRATION_EXPECT_DATABASE: 'asalab',
      MIGRATION_CONFIRM: 'APPLY:asalab',
      APP_DATABASE_URL:
        'postgres://asalab_app:compose-validation-runtime-password@postgres:5432/asalab',
      ASA_SETTINGS_ENCRYPTION_KEY: 'compose-validation-placeholder',
      ASA_EXPECTED_SCHEMA_VERSION: '103',
      ASA_PUBLIC_WEB_ORIGINS: 'https://asa-lab.ru',
    },
  });
  if (result.status !== 0) {
    // result.stderr/stdout are undefined when the binary could not be spawned.
    const detail = (result.error?.message ?? result.stderr ?? result.stdout ?? 'no output').trim();
    errors.push(`${profile} compose config failed: ${detail}`);
    continue;
  }
  const config = JSON.parse(result.stdout);
  const migrationEnvironment = config.services?.migration?.environment ?? {};
  if ('DATABASE_URL' in migrationEnvironment) {
    errors.push(`${profile}/migration: generic DATABASE_URL must not enter the container`);
  }
  const expectedMigrationUrl =
    profile === 'test'
      ? 'postgres://asalab_admin:asa-local-test-admin-change-me@postgres:5432/asalab_test'
      : 'postgres://asalab_admin:compose-validation-admin-password@postgres:5432/asalab';
  if (migrationEnvironment.MIGRATION_DATABASE_URL !== expectedMigrationUrl) {
    errors.push(`${profile}/migration: dedicated MIGRATION_DATABASE_URL was not preserved`);
  }
  if (
    config.services?.api?.environment?.ASA_SETTINGS_ENCRYPTION_KEY !==
    'compose-validation-placeholder'
  ) {
    errors.push(`${profile}/api: runtime settings encryption key was not preserved`);
  }
  if (config.services?.api?.environment?.ASA_EXPECTED_SCHEMA_VERSION !== '103') {
    errors.push(`${profile}/api: expected schema version was not preserved`);
  }
  if (profile === 'production') {
    if (config.services?.api?.environment?.NODE_ENV !== 'production') {
      errors.push('production/api: NODE_ENV must be production');
    }
    if (config.services?.migration?.environment?.ASA_SEED_DEV !== 'false') {
      errors.push('production/migration: development seed must be disabled');
    }
    if (!config.services?.api?.environment?.ASA_PUBLIC_WEB_ORIGINS) {
      errors.push('production/api: public browser origins must be configured');
    }
  }
  const published = [];
  for (const [name, service] of Object.entries(config.services ?? {})) {
    if (service.privileged === true) errors.push(`${profile}/${name}: privileged is forbidden`);
    if (service.network_mode === 'host') {
      errors.push(`${profile}/${name}: host networking is forbidden`);
    }
    if (service.user === undefined || service.user === 'root' || service.user === '0') {
      errors.push(`${profile}/${name}: explicit non-root user is required`);
    }
    if (!(service.cap_drop ?? []).includes('ALL')) {
      errors.push(`${profile}/${name}: cap_drop must include ALL`);
    }
    if (!(service.security_opt ?? []).includes('no-new-privileges:true')) {
      errors.push(`${profile}/${name}: no-new-privileges is required`);
    }
    for (const port of service.ports ?? []) {
      const hostIp = port.host_ip ?? port.hostIp;
      const publishedPort = Number(port.published);
      if (hostIp !== '127.0.0.1') {
        errors.push(`${profile}/${name}: port ${publishedPort} is not loopback-only`);
      }
      if (FORBIDDEN_PORTS.has(publishedPort)) {
        errors.push(`${profile}/${name}: forbidden port ${publishedPort} is published`);
      }
      published.push(publishedPort);
    }
  }
  published.sort((left, right) => left - right);
  if (JSON.stringify(published) !== JSON.stringify(EXPECTED_PORTS[profile])) {
    errors.push(
      `${profile}: expected published ports ${EXPECTED_PORTS[profile].join(', ')}, got ${published.join(', ')}`,
    );
  }
}

finish();

function finish() {
  if (errors.length > 0) {
    console.error('compose:check FAIL');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log('compose:check PASS');
  console.log(`- services: ${expectedServices.join(', ')}`);
  console.log('- profiles: base, dev, test, staging, production');
  console.log('- PostgreSQL internal, loopback ports and non-root security verified');
}
