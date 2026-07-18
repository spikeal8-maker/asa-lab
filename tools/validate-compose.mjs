#!/usr/bin/env node
// Local structural validation of the Docker Compose file. This enforces the
// hardening rules without a Docker runtime: pinned images (no :latest), ports
// published on the loopback interface only, and persistent named volumes.
// It complements `docker compose config`, which needs a Compose CLI.
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const COMPOSE_PATH = 'infra/docker-compose.yml';
const errors = [];

const compose = parseYaml(readFileSync(COMPOSE_PATH, 'utf8'));
const services = compose.services ?? {};
const serviceNames = Object.keys(services);

if (serviceNames.length === 0) {
  errors.push('compose file declares no services');
}

for (const [name, service] of Object.entries(services)) {
  const image = service.image;
  if (typeof image !== 'string' || image.length === 0) {
    errors.push(`service ${name}: missing image`);
    continue;
  }
  if (image.endsWith(':latest') || !image.includes(':')) {
    errors.push(`service ${name}: image is not pinned to a version (${image})`);
  }
  for (const mapping of service.ports ?? []) {
    const text = String(mapping);
    if (!text.startsWith('127.0.0.1:')) {
      errors.push(`service ${name}: port ${text} is not bound to 127.0.0.1`);
    }
  }
}

const volumes = compose.volumes ?? {};
for (const persistent of ['postgres-data', 'redis-data', 'minio-data']) {
  if (!(persistent in volumes)) {
    errors.push(`missing persistent volume: ${persistent}`);
  }
}

if (errors.length > 0) {
  console.error('compose:check FAIL');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('compose:check PASS');
console.log(`  services: ${serviceNames.join(', ')}`);
console.log(`  pinned images, loopback-only ports, persistent volumes verified`);
