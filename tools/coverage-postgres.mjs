import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

if (process.env.GITHUB_ACTIONS !== 'true' || !/^\d+$/.test(process.env.GITHUB_RUN_ID || ''))
  throw new Error('Disposable GitHub CI only');
const name = `asa-coverage-${process.env.GITHUB_RUN_ID}`;
const docker = (args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (process.argv[2] === 'stop') {
  let label;
  try {
    label = docker([
      'inspect',
      '--format',
      '{{index .Config.Labels "asa.coverage.run"}}',
      name,
    ]).trim();
  } catch {
    process.exit(0);
  }
  if (label !== process.env.GITHUB_RUN_ID) throw new Error('Refusing foreign container cleanup');
  docker(['rm', '-f', name]);
} else {
  const service = parse(readFileSync('compose.yaml', 'utf8')).services.postgres;
  docker([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `asa.coverage.run=${process.env.GITHUB_RUN_ID}`,
    '-e',
    'POSTGRES_DB=asa_coverage_test',
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_PASSWORD=coverage-ci-only',
    '-p',
    '127.0.0.1:5432:5432',
    service.image,
    ...service.command,
  ]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      docker(['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'asa_coverage_test']);
      ready = true;
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Disposable database not ready');
}
