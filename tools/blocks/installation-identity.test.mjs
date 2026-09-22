import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const shell =
  process.env.ASA_BASH ??
  (process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh');
const pwsh = process.env.ASA_PWSH_PATH ?? 'pwsh';
const identityRoot = '/srv/asa';
const files = ['/srv/asa/compose.yaml', '/srv/asa/compose.dev.yaml'];
const record = (service, extra = {}) => ({
  Project: 'asa-lab-dev',
  Service: service,
  Root: identityRoot,
  Files: files.join(','),
  Image: `asa-lab-${service}:checked`,
  Name: `primary-${service}`,
  ...extra,
});
const own = ['postgres', 'api', 'web', 'scratch', 'minio'].map((service) => record(service));
const cases = [
  {
    name: 'digest-tagged custom ASA installation',
    records: [
      record('web', {
        Root: '/other',
        Project: 'school-custom',
        Image: 'registry/asa-lab-web@sha256:abc',
      }),
    ],
    code: 'EXISTING',
  },
  { name: 'fresh computer', records: [], exists: false },
  { name: 'same installation', records: own },
  {
    name: 'stopped existing installation remains owned',
    records: own.map((r) => ({ ...r, State: 'exited' })),
  },
  {
    name: 'missing environment must not regenerate secrets',
    records: own,
    exists: false,
    code: 'ENV',
  },
  {
    name: 'same project different checkout',
    records: [record('postgres', { Root: '/srv/other' })],
    code: 'ROOT',
  },
  {
    name: 'same checkout renamed project',
    records: [record('web', { Project: 'asa-copy' })],
    code: 'PROJECT',
  },
  {
    name: 'other ASA cannot become second install with spare ports',
    records: [record('web', { Root: '/srv/other', Project: 'asa-other' })],
    code: 'EXISTING',
  },
  {
    name: 'diagnostic inherited labels are not authority',
    records: [...own, record('scratch', { Root: '', Files: '', Name: 'diagnostic' })],
    code: 'ROOT',
  },
  {
    name: 'duplicate same-root service',
    records: [...own, record('scratch', { Name: 'duplicate' })],
    code: 'DUPLICATE',
  },
  {
    name: 'missing overlays',
    records: [record('web', { Files: `${files.join(',')},/srv/asa/compose.frp.yaml` })],
    code: 'FILES',
  },
  { name: 'missing config provenance', records: [record('web', { Files: '' })], code: 'FILES' },
  {
    name: 'reordered overlays',
    records: [record('web', { Files: [...files].reverse().join(',') })],
    code: 'FILES',
  },
  {
    name: 'unrelated PostgreSQL is not ASA',
    records: [record('postgres', { Project: 'other-app', Root: '/other', Image: 'postgres:17' })],
  },
  {
    name: 'known TEST remains untouched beside existing primary',
    records: [...own, record('scratch', { Project: 'asa-test', Root: '/test' })],
  },
  {
    name: 'remaining ASA PostgreSQL identifies an existing installation',
    records: [
      record('postgres', { Root: '/other', Project: 'asa-lab-production', Image: 'postgres:17' }),
    ],
    code: 'EXISTING',
  },
  { name: 'updater cannot bootstrap', records: [], requireExisting: true, code: 'EXISTING' },
];

test('PowerShell and POSIX enforce identical installation-identity decisions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-identity-test-'));
  try {
    const psRunner = path.join(dir, 'check.ps1');
    fs.writeFileSync(
      psRunner,
      `param($Helper, $InputFile)
$ErrorActionPreference = 'Stop'
. $Helper
$c = Get-Content -Raw $InputFile | ConvertFrom-Json
try {
  Assert-AsaIdentityInventory -Root $c.Root -Project $c.Project -Files $c.Files -Records $c.Records -EnvironmentExists $c.EnvironmentExists -RequireExisting $c.RequireExisting
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`,
    );
    for (const item of cases) {
      const input = {
        Root: identityRoot,
        Project: 'asa-lab-dev',
        Files: files,
        Records: item.records,
        EnvironmentExists: item.exists ?? true,
        RequireExisting: item.requireExisting ?? false,
      };
      const jsonPath = path.join(dir, 'case.json');
      const tsvPath = path.join(dir, 'case.txt');
      fs.writeFileSync(jsonPath, JSON.stringify(input));
      fs.writeFileSync(
        tsvPath,
        input.Records.map((r) =>
          [r.Project, r.Service, r.Root, r.Files, r.Image, r.Name].join('|'),
        ).join('\n'),
      );
      const cleanEnv = { ...process.env };
      delete cleanEnv.COMPOSE_PROJECT_NAME;
      const commands = [
        [
          pwsh,
          [
            '-NoProfile',
            '-File',
            psRunner,
            path.join(root, 'tools/installation-identity.ps1'),
            jsonPath,
          ],
        ],
        [
          shell,
          [
            '-c',
            '. "$1"; asa_validate_identity_inventory "$2" "$3" "$4" "$5" "$6" "$(cat "$7")"',
            'identity-test',
            path.join(root, 'tools/installation-identity.sh').replaceAll('\\', '/'),
            identityRoot,
            input.Project,
            files.join(','),
            String(input.EnvironmentExists),
            String(input.RequireExisting),
            tsvPath.replaceAll('\\', '/'),
          ],
        ],
      ];
      if (process.platform === 'win32') commands.push(['powershell.exe', commands[0][1]]);
      for (const [executable, args] of commands) {
        const result = spawnSync(executable, args, {
          encoding: 'utf8',
          env: cleanEnv,
          timeout: 15000,
        });
        assert.ifError(result.error);
        const output = `${result.stdout}\n${result.stderr}`;
        assert.equal(result.status, item.code ? 1 : 0, `${executable}: ${item.name}\n${output}`);
        if (item.code) assert.match(output, new RegExp(`ASA_IDENTITY_${item.code}:`), item.name);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('startup guards precede environment mutation and both updaters recheck before replacement', () => {
  for (const extension of ['ps1', 'sh']) {
    // Git checks out PowerShell as CRLF on Linux too; compare command order,
    // not platform-dependent line-ending bytes.
    const startup = fs
      .readFileSync(path.join(root, `tools/asa-lab.${extension}`), 'utf8')
      .replaceAll('\r\n', '\n');
    const update = fs
      .readFileSync(path.join(root, `tools/docker-update.${extension}`), 'utf8')
      .replaceAll('\r\n', '\n');
    const guard = extension === 'ps1' ? 'Assert-StartupIdentity' : 'assert_startup_identity';
    const prepare = extension === 'ps1' ? '    New-PrivateEnvironment' : '    create_environment';
    assert.ok(startup.includes(`${guard}\n${prepare}`));
    assert.ok(update.includes(`installation-identity.${extension}`));
    assert.match(
      update,
      extension === 'ps1'
        ? /Assert-AsaInstallationIdentity[^\n]*\n\s*# Validate[^\n]*\n\s*Invoke-Compose -Arguments @\('run', '--rm', '--no-deps', '--entrypoint', 'node', 'migration', 'tools\/migrate\.mjs', '--plan'\)\n\s*Invoke-Compose -Arguments @\('up'/
        : /assert_update_identity &&\n\s*compose run --rm --no-deps --entrypoint node migration tools\/migrate\.mjs --plan &&\n\s*compose up/,
    );
  }
});

test('real startup rejects a second checkout before creating .env or calling Compose build/up', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asa-identity-start-'));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.mkdirSync(path.join(dir, 'migrations'));
    fs.writeFileSync(path.join(dir, 'migrations/0001_fixture.sql'), '-- isolated parser fixture\n');
    for (const name of [
      'asa-lab.ps1',
      'asa-lab.sh',
      'installation-identity.ps1',
      'installation-identity.sh',
    ]) {
      fs.copyFileSync(path.join(root, 'tools', name), path.join(dir, 'tools', name));
    }
    const r = record('web', { Root: '/existing/primary', Project: 'asa-lab-production' });
    const labels = {
      'com.docker.compose.project': r.Project,
      'com.docker.compose.service': r.Service,
      'com.docker.compose.project.working_dir': r.Root,
      'com.docker.compose.project.config_files': r.Files,
    };
    const json = path.join(dir, 'docker.json');
    const tsv = path.join(dir, 'docker.txt');
    fs.writeFileSync(json, JSON.stringify([r.Name, r.Image, labels]));
    fs.writeFileSync(
      tsv,
      [r.Project, r.Service, r.Root, r.Files, r.Image, r.Name].join('|') + '\n',
    );
    const stubPs = path.join(dir, 'run.ps1');
    fs.writeFileSync(
      stubPs,
      `param($Startup, $Fixture)
function docker {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'version' -or ($args[0] -eq 'compose' -and $args[1] -eq 'version')) { return }
  if ($args[0] -eq 'ps') { return 'abcdef123456' }
  if ($args[0] -eq 'inspect') { Get-Content -Raw $Fixture; return }
  throw 'UNEXPECTED_DOCKER_MUTATION'
}
& $Startup -Action up -Profile dev
`,
    );
    const cleanEnv = {
      ...process.env,
      ASA_COMPOSE_PROFILE: 'dev',
      ASA_IDENTITY_FIXTURE: tsv.replaceAll('\\', '/'),
    };
    delete cleanEnv.COMPOSE_PROJECT_NAME;
    const commands = [
      [pwsh, ['-NoProfile', '-File', stubPs, path.join(dir, 'tools/asa-lab.ps1'), json]],
      [
        shell,
        [
          '-c',
          `docker() {
case "$1" in
  version) return 0 ;;
  compose) if [ "$2" = version ]; then return 0; fi ;;
  ps) echo abcdef123456; return 0 ;;
  inspect) cat "$ASA_IDENTITY_FIXTURE"; return 0 ;;
esac
echo UNEXPECTED_DOCKER_MUTATION >&2
return 99
}
. "$0"`,
          path.join(dir, 'tools/asa-lab.sh').replaceAll('\\', '/'),
        ],
      ],
    ];
    if (process.platform === 'win32') commands.push(['powershell.exe', commands[0][1]]);
    for (const [executable, args] of commands) {
      const result = spawnSync(executable, args, {
        encoding: 'utf8',
        env: cleanEnv,
        timeout: 20000,
      });
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /ASA_IDENTITY_EXISTING:/, executable);
      assert.doesNotMatch(result.stdout + result.stderr, /UNEXPECTED_DOCKER_MUTATION/);
      assert.equal(
        fs.existsSync(path.join(dir, '.env')),
        false,
        'must reject before generating credentials',
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
