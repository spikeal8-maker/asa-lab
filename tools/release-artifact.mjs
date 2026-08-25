#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWebArtifact } from './verify-web-artifact.mjs';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_NAME = 'release-manifest.json';
const MARKER_NAME = '.release-immutable';
const FORBIDDEN_RELEASE_NAMES = /(^|\/)(?:\.env(?:\..*)?|.*\.(?:dump|sql\.gz)|cookies?\.json)$/i;
const REQUIRED_ENV_NAMES = [
  'APP_DATABASE_URL',
  'ASA_OWNER_ADMIN_EMAIL',
  'ASA_API_PORT',
  'ASA_PUBLIC_WEB_ORIGINS',
  'MAX_AUTH_ENABLED',
];

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function slash(value) {
  return value.replaceAll('\\', '/');
}

function assertInside(root, path, label) {
  const rel = relative(root, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
    throw new Error(`${label} escapes the release root`);
  }
  return slash(rel);
}

function collectEntries(root) {
  const entries = [];
  const visit = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, item.name);
      const path = assertInside(root, absolute, 'Release entry');
      if (path === MANIFEST_NAME) continue;
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) {
        const target = resolve(realpathSync(absolute));
        const targetPath = assertInside(root, target, `Release link ${path}`);
        entries.push({ path, type: 'link', target: targetPath });
      } else if (info.isDirectory()) {
        visit(absolute);
      } else if (info.isFile()) {
        entries.push({ path, type: 'file', bytes: info.size, sha256: sha256(absolute) });
      } else {
        throw new Error(`Unsupported release entry type: ${path}`);
      }
    }
  };
  visit(root);
  return entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

function removePnpmDeploySelfLink(root, source) {
  const link = resolve(root, 'api', 'node_modules', '.pnpm', 'node_modules', '@asa-lab', 'api');
  if (!existsSync(link)) return;
  const info = lstatSync(link);
  if (!info.isSymbolicLink()) {
    throw new Error('pnpm deploy self-reference is not a symbolic link');
  }
  const rawTarget = readlinkSync(link);
  const resolvedTarget = resolve(dirname(link), rawTarget);
  if (resolvedTarget !== resolve(source, 'apps', 'api')) {
    throw new Error(`Unexpected pnpm deploy workspace link target: ${rawTarget}`);
  }
  rmSync(link, { force: true });
}

function migrationVersion(source) {
  const versions = readdirSync(resolve(source, 'migrations'))
    .map((name) => /^(\d{4})_.*\.sql$/.exec(name)?.[1])
    .filter(Boolean)
    .map(Number);
  const expected = Math.max(...versions);
  if (!Number.isSafeInteger(expected)) throw new Error('Cannot determine release schema version');
  return expected;
}

function gitRevision(source) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: source,
    encoding: 'utf8',
    windowsHide: true,
  });
  const revision = result.stdout.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`Cannot determine Git revision for ${source}`);
  }
  return revision;
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function copyRuntimeTool(name, target) {
  const source = resolve(TOOL_ROOT, 'tools', name);
  if (!existsSync(source)) throw new Error(`Release runtime tool is missing: ${name}`);
  copyFileSync(source, resolve(target, 'tools', name));
}

export function createReleaseManifest({
  releaseRoot,
  releaseRole,
  sourceRevision,
  toolingRevision,
}) {
  const root = resolve(releaseRoot);
  const metadata = JSON.parse(
    readFileSync(resolve(root, 'web', 'dist', 'build-metadata.json'), 'utf8'),
  );
  if (metadata.revision !== sourceRevision) {
    throw new Error('Web build revision does not match release source revision');
  }
  const manifest = {
    format: 'asa-lab-release-v1',
    releaseRole,
    sourceRevision,
    toolingRevision,
    builtAt: metadata.builtAt,
    expectedSchemaVersion: migrationVersion(root),
    requiredEnvironment: REQUIRED_ENV_NAMES,
    entrypoint: 'tools/release-start.mjs',
    files: collectEntries(root),
  };
  writeJson(resolve(root, MANIFEST_NAME), manifest);
  return manifest;
}

export function verifyReleaseArtifact(releaseRoot) {
  const root = resolve(releaseRoot);
  const manifestFile = resolve(root, MANIFEST_NAME);
  if (!existsSync(resolve(root, MARKER_NAME)) || !existsSync(manifestFile)) {
    throw new Error('Release marker or manifest is missing');
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  if (
    manifest.format !== 'asa-lab-release-v1' ||
    !['candidate', 'rollback'].includes(manifest.releaseRole) ||
    !/^[0-9a-f]{40}$/.test(manifest.sourceRevision) ||
    !/^[0-9a-f]{40}$/.test(manifest.toolingRevision) ||
    !Number.isSafeInteger(manifest.expectedSchemaVersion)
  ) {
    throw new Error('Release manifest metadata is invalid');
  }
  for (const entry of manifest.files) {
    if (FORBIDDEN_RELEASE_NAMES.test(entry.path)) {
      throw new Error(`Forbidden sensitive file in release: ${entry.path}`);
    }
  }
  const actual = collectEntries(root);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
    throw new Error('Release files do not match release-manifest.json');
  }
  verifyWebArtifact({
    webDist: resolve(root, 'web', 'dist'),
    expectedRevision: manifest.sourceRevision,
  });
  for (const required of ['api/dist/main.js', 'api/package.json', 'pnpm-lock.yaml']) {
    const file = resolve(root, required);
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0) {
      throw new Error(`Release runtime file is missing: ${required}`);
    }
  }
  if (migrationVersion(root) !== manifest.expectedSchemaVersion) {
    throw new Error('Release migration set does not match expected schema');
  }
  return manifest;
}

export function packReleaseArtifact({ sourceRoot, outputRoot, releaseRole }) {
  const source = resolve(sourceRoot);
  const output = resolve(outputRoot);
  if (!['candidate', 'rollback'].includes(releaseRole)) throw new Error('Invalid release role');
  if (existsSync(output)) throw new Error(`Release target already exists: ${output}`);
  const sourceRevision = gitRevision(source);
  const toolingRevision = gitRevision(TOOL_ROOT);
  verifyWebArtifact({
    webDist: resolve(source, 'apps', 'web', 'dist'),
    expectedRevision: sourceRevision,
  });

  mkdirSync(dirname(output), { recursive: true });
  // The final directory is not launchable until both marker and manifest are
  // present and verification succeeds. Keeping its path stable is required on
  // Windows because pnpm deploy uses self-contained absolute junctions.
  const staging = output;
  mkdirSync(staging);
  try {
    const pnpm =
      process.platform === 'win32'
        ? resolve(process.env.APPDATA ?? '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
        : 'pnpm';
    if (process.platform === 'win32' && !existsSync(pnpm)) {
      throw new Error('pnpm CLI is not available in the current Windows user profile');
    }
    const deployCommand = process.platform === 'win32' ? process.execPath : pnpm;
    const deployArguments = [
      ...(process.platform === 'win32' ? [pnpm] : []),
      '--filter',
      '@asa-lab/api',
      'deploy',
      '--prod',
      resolve(staging, 'api'),
    ];
    const deployed = spawnSync(deployCommand, deployArguments, {
      cwd: source,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });
    if (deployed.status !== 0) {
      throw new Error(
        `pnpm deploy failed while packaging release: ${deployed.error?.message ?? `exit ${String(deployed.status)}`}`,
      );
    }
    // pnpm deploy creates a workspace package self-reference inside its virtual
    // store. It is not needed by the API entrypoint and would make the release
    // depend on the source checkout, so remove only that exact self-link. Any
    // other link escaping the release still fails in collectEntries().
    removePnpmDeploySelfLink(staging, source);

    mkdirSync(resolve(staging, 'web'), { recursive: true });
    cpSync(resolve(source, 'apps', 'web', 'dist'), resolve(staging, 'web', 'dist'), {
      recursive: true,
    });
    cpSync(resolve(source, 'migrations'), resolve(staging, 'migrations'), { recursive: true });
    mkdirSync(resolve(staging, 'tools'));
    for (const name of [
      'release-start.mjs',
      'release-artifact.mjs',
      'verify-web-artifact.mjs',
      'child-env.mjs',
      'assert-build-workspace.mjs',
    ]) {
      copyRuntimeTool(name, staging);
    }
    for (const name of ['package.json', 'pnpm-lock.yaml', 'LICENSE', 'README.md']) {
      copyFileSync(resolve(source, name), resolve(staging, name));
    }
    mkdirSync(resolve(staging, 'receipts'));
    const inventory = resolve(source, 'reports', 'dependency-inventory.json');
    if (existsSync(inventory))
      copyFileSync(inventory, resolve(staging, 'receipts', 'dependencies.json'));
    writeJson(resolve(staging, 'receipts', 'package.json'), {
      releaseRole,
      sourceRevision,
      toolingRevision,
      expectedSchemaVersion: migrationVersion(source),
      packedAt: new Date().toISOString(),
      buildCacheAcceptedAsEvidence: false,
    });
    writeFileSync(resolve(staging, MARKER_NAME), 'immutable ASA Lab release\n', 'utf8');
    createReleaseManifest({
      releaseRoot: staging,
      releaseRole,
      sourceRevision,
      toolingRevision,
    });
    verifyReleaseArtifact(staging);
    verifyReleaseArtifact(output);
    return { output, sourceRevision, toolingRevision };
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--verify')) {
      const releaseRoot = argument('--release');
      if (!releaseRoot) throw new Error('--release is required');
      const manifest = verifyReleaseArtifact(releaseRoot);
      console.log(
        `release:verify PASS role=${manifest.releaseRole} revision=${manifest.sourceRevision} files=${manifest.files.length}`,
      );
    } else if (process.argv.includes('--pack')) {
      const sourceRoot = argument('--source');
      const outputRoot = argument('--output');
      const releaseRole = argument('--role');
      if (!sourceRoot || !outputRoot || !releaseRole) {
        throw new Error('--source, --output and --role are required');
      }
      const result = packReleaseArtifact({ sourceRoot, outputRoot, releaseRole });
      console.log(`release:pack PASS ${result.output}`);
    } else {
      throw new Error('Use --pack or --verify');
    }
  } catch (error) {
    console.error(`release artifact failed: ${String(error)}`);
    process.exit(78);
  }
}
