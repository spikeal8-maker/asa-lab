#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const BASE_PATH = 'compose.yaml';
const OVERLAYS = {
  base: [],
  dev: ['compose.dev.yaml'],
  test: ['compose.test.yaml'],
  staging: ['compose.staging.yaml'],
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
  'docker/web/Caddyfile',
];
const FORBIDDEN_PORTS = new Set([3000, 3100, 5173]);
const EXPECTED_PORTS = {
  base: [4610],
  dev: [4610, 4611],
  test: [4612],
  staging: [4610],
};
const errors = [];

for (const path of REQUIRED_FILES) {
  if (!existsSync(path)) errors.push(`missing required Docker file: ${path}`);
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
      DATABASE_URL:
        'postgres://asalab_admin:compose-validation-admin-password@postgres:5432/asalab',
      APP_DATABASE_URL:
        'postgres://asalab_app:compose-validation-runtime-password@postgres:5432/asalab',
    },
  });
  if (result.status !== 0) {
    errors.push(`${profile} compose config failed: ${(result.stderr || result.stdout).trim()}`);
    continue;
  }
  const config = JSON.parse(result.stdout);
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
  console.log('- profiles: base, dev, test, staging');
  console.log('- PostgreSQL internal, loopback ports and non-root security verified');
}
