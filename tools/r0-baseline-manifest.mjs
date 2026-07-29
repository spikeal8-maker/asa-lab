#!/usr/bin/env node
/**
 * Capture and compare the R0 baseline without exposing raw identifiers,
 * credentials, session tokens or project documents.
 *
 * Capture:
 *   R0_BASELINE_DATABASE_URL=... R0_MANIFEST_HMAC_KEY=... \
 *     node tools/r0-baseline-manifest.mjs capture \
 *       --output reports/r0-baseline-before.json
 *
 * Compare:
 *   node tools/r0-baseline-manifest.mjs compare \
 *     --before reports/r0-baseline-before.json \
 *     --after reports/r0-baseline-after.json \
 *     --report reports/r0-baseline-comparison.json
 *
 * The database transaction is READ ONLY and REPEATABLE READ. Missing required
 * environment exits 78 (BLOCKED), never a false PASS.
 */
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORTS_ROOT = resolve(ROOT, 'reports');
const EX_CONFIG = 78;
const TABLES = [
  'tenants',
  'tenant_placements',
  'schools',
  'academic_periods',
  'users',
  'sessions',
  'classrooms',
  'classroom_memberships',
  'audit_events',
  'projects',
  'project_drafts',
  'project_versions',
];
const STABLE_ID_QUERIES = {
  tenants: `SELECT id::text AS identity FROM public.tenants ORDER BY id`,
  schools: `SELECT id::text AS identity FROM public.schools ORDER BY id`,
  academic_periods: `SELECT id::text AS identity FROM public.academic_periods ORDER BY id`,
  users: `SELECT tenant_id::text || ':' || id::text AS identity FROM public.users ORDER BY tenant_id, id`,
  classrooms: `SELECT tenant_id::text || ':' || id::text AS identity FROM public.classrooms ORDER BY tenant_id, id`,
  projects: `SELECT tenant_id::text || ':' || id::text AS identity FROM public.projects ORDER BY tenant_id, id`,
  project_versions: `SELECT tenant_id::text || ':' || id::text AS identity FROM public.project_versions ORDER BY tenant_id, id`,
};

function fail(message) {
  throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digestDocument(value) {
  return sha256(canonicalJson(value));
}

function option(args, name, defaultValue = undefined) {
  const index = args.indexOf(name);
  if (index === -1) return defaultValue;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function resolveReportPath(value, label) {
  if (!value || extname(value).toLowerCase() !== '.json') {
    fail(`${label} must be a .json path under reports/`);
  }
  const absolute = resolve(ROOT, value);
  const rel = relative(REPORTS_ROOT, absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    fail(`${label} must stay inside ${relative(ROOT, REPORTS_ROOT)}/`);
  }
  return absolute;
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`${label} does not exist: ${relative(ROOT, path)}`);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must contain a JSON object`);
  }
  return value;
}

function currentCommit() {
  const output = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(output)) fail(`git rev-parse returned an invalid SHA: ${output}`);
  return output;
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) fail(`unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

async function tableExists(client, table) {
  const result = await client.query(`SELECT to_regclass($1) IS NOT NULL AS exists`, [
    `public.${table}`,
  ]);
  return Boolean(result.rows[0]?.exists);
}

async function tableCount(client, table) {
  const result = await client.query(`SELECT count(*)::bigint AS count FROM public.${quoteIdentifier(table)}`);
  return Number(result.rows[0].count);
}

async function captureStableIdentifiers(client, key) {
  const result = {};
  for (const [table, sql] of Object.entries(STABLE_ID_QUERIES)) {
    if (!(await tableExists(client, table))) continue;
    const rows = await client.query(sql);
    for (const row of rows.rows) {
      const identity = String(row.identity);
      const fingerprint = hmac(key, `${table}:${identity}`);
      result[fingerprint] = hmac(key, `stable:${table}:${identity}`);
    }
  }
  return result;
}

async function captureCredentialFingerprints(client, key) {
  if (!(await tableExists(client, 'users'))) return {};
  const rows = await client.query(
    `SELECT tenant_id::text, id::text, password_hash FROM public.users ORDER BY tenant_id, id`,
  );
  return Object.fromEntries(
    rows.rows.map((row) => {
      const identity = `${row.tenant_id}:${row.id}`;
      return [hmac(key, `user:${identity}`), hmac(key, `credential:${String(row.password_hash)}`)];
    }),
  );
}

async function captureProjectDrafts(client, key) {
  if (!(await tableExists(client, 'project_drafts'))) return {};
  const rows = await client.query(
    `SELECT tenant_id::text, project_id::text, document_json, revision
       FROM public.project_drafts ORDER BY tenant_id, project_id`,
  );
  return Object.fromEntries(
    rows.rows.map((row) => {
      const identity = `${row.tenant_id}:${row.project_id}`;
      return [
        hmac(key, `draft:${identity}`),
        {
          documentDigest: digestDocument(row.document_json),
          revision: Number(row.revision),
        },
      ];
    }),
  );
}

async function captureProjectVersions(client, key) {
  if (!(await tableExists(client, 'project_versions'))) return {};
  const rows = await client.query(
    `SELECT tenant_id::text, id::text, project_id::text, version_no, document_json
       FROM public.project_versions ORDER BY tenant_id, id`,
  );
  return Object.fromEntries(
    rows.rows.map((row) => {
      const identity = `${row.tenant_id}:${row.id}`;
      const projectIdentity = `${row.tenant_id}:${row.project_id}`;
      return [
        hmac(key, `version:${identity}`),
        {
          projectKey: hmac(key, `project:${projectIdentity}`),
          documentDigest: digestDocument(row.document_json),
          versionNo: Number(row.version_no),
        },
      ];
    }),
  );
}

async function captureElectronicsDocuments(client, key) {
  if (!(await tableExists(client, 'projects'))) return {};
  const draftsExist = await tableExists(client, 'project_drafts');
  const versionsExist = await tableExists(client, 'project_versions');
  const result = {};
  if (draftsExist) {
    const drafts = await client.query(
      `SELECT p.tenant_id::text, p.id::text, d.document_json
         FROM public.projects p
         JOIN public.project_drafts d
           ON d.tenant_id = p.tenant_id AND d.project_id = p.id
        WHERE p.module_key = 'electronics'
        ORDER BY p.tenant_id, p.id`,
    );
    for (const row of drafts.rows) {
      result[hmac(key, `electronics-draft:${row.tenant_id}:${row.id}`)] = digestDocument(
        row.document_json,
      );
    }
  }
  if (versionsExist) {
    const versions = await client.query(
      `SELECT v.tenant_id::text, v.id::text, v.document_json
         FROM public.project_versions v
         JOIN public.projects p
           ON p.tenant_id = v.tenant_id AND p.id = v.project_id
        WHERE p.module_key = 'electronics'
        ORDER BY v.tenant_id, v.id`,
    );
    for (const row of versions.rows) {
      result[hmac(key, `electronics-version:${row.tenant_id}:${row.id}`)] = digestDocument(
        row.document_json,
      );
    }
  }
  return result;
}

function collectFiles(root, extension) {
  if (!existsSync(root)) return [];
  const result = [];
  const visit = (path) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      const stats = statSync(child);
      if (stats.isDirectory()) visit(child);
      else if (stats.isFile() && extname(child).toLowerCase() === extension) result.push(child);
    }
  };
  visit(root);
  return result;
}

function captureScreenshots() {
  return collectFiles(resolve(ROOT, 'e2e/artifacts'), '.png').map((path) => ({
    path: relative(ROOT, path).replaceAll('\\', '/'),
    sha256: sha256(readFileSync(path)),
  }));
}

function captureRoutes() {
  const openApiPath = resolve(ROOT, 'schemas/openapi.yaml');
  if (!existsSync(openApiPath)) return [];
  const routes = [];
  let insidePaths = false;
  for (const line of readFileSync(openApiPath, 'utf8').split(/\r?\n/)) {
    if (line === 'paths:') {
      insidePaths = true;
      continue;
    }
    if (insidePaths && /^\S/.test(line) && line.trim()) break;
    const match = insidePaths ? /^  (\/[^:]+):\s*$/.exec(line) : null;
    if (match) routes.push(match[1]);
  }
  return [...new Set(routes)].sort();
}

async function captureManifest(outputPath) {
  const databaseUrl = process.env.R0_BASELINE_DATABASE_URL;
  const key = process.env.R0_MANIFEST_HMAC_KEY;
  if (!databaseUrl) {
    console.error('BLOCKED: R0_BASELINE_DATABASE_URL is required for read-only baseline capture.');
    return EX_CONFIG;
  }
  if (!key || key.length < 32) {
    console.error('BLOCKED: R0_MANIFEST_HMAC_KEY must contain at least 32 characters.');
    return EX_CONFIG;
  }

  const pg = (await import('pg')).default;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const databaseName = await client.query(`SELECT current_database() AS name`);
    const tables = {};
    for (const table of TABLES) {
      const exists = await tableExists(client, table);
      tables[table] = { exists, rowCount: exists ? await tableCount(client, table) : 0 };
    }
    const migrationVersions = (await tableExists(client, 'schema_migrations'))
      ? (
          await client.query(
            `SELECT version FROM public.schema_migrations ORDER BY version`,
          )
        ).rows.map((row) => String(row.version))
      : [];

    const manifest = {
      schemaVersion: '1.0.0',
      manifestType: 'asa-r0-baseline',
      generatedAt: new Date().toISOString(),
      sourceCommitSha: currentCommit(),
      database: {
        nameFingerprint: hmac(key, `database:${databaseName.rows[0].name}`),
        migrationVersions,
      },
      tables,
      stableIdentifiers: await captureStableIdentifiers(client, key),
      credentialFingerprints: await captureCredentialFingerprints(client, key),
      projectDrafts: await captureProjectDrafts(client, key),
      projectVersions: await captureProjectVersions(client, key),
      electronicsDocuments: await captureElectronicsDocuments(client, key),
      routes: captureRoutes(),
      screenshots: captureScreenshots(),
    };
    await client.query('COMMIT');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log('R0 baseline capture PASS');
    console.log(`- output: ${relative(ROOT, outputPath).replaceAll('\\', '/')}`);
    console.log(`- source commit: ${manifest.sourceCommitSha}`);
    console.log(`- migration versions: ${manifest.database.migrationVersions.length}`);
    console.log(`- stable identifiers: ${Object.keys(manifest.stableIdentifiers).length}`);
    console.log('- raw identifiers/documents/credential hashes written: 0');
    return 0;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

function mapPreservationFailures(label, before, after) {
  const failures = [];
  for (const [key, value] of Object.entries(before)) {
    if (!(key in after)) failures.push(`${label}: missing pre-existing key ${key}`);
    else if (canonicalJson(after[key]) !== canonicalJson(value)) {
      failures.push(`${label}: changed pre-existing value ${key}`);
    }
  }
  return failures;
}

function compareManifests(before, after) {
  const failures = [];
  const warnings = [];
  for (const [label, manifest] of [
    ['before', before],
    ['after', after],
  ]) {
    if (manifest.schemaVersion !== '1.0.0' || manifest.manifestType !== 'asa-r0-baseline') {
      failures.push(`${label}: unsupported manifest format`);
    }
  }
  if (before.database?.nameFingerprint !== after.database?.nameFingerprint) {
    failures.push('database fingerprint changed; manifests were not captured from the same database');
  }
  const afterMigrations = new Set(after.database?.migrationVersions ?? []);
  for (const version of before.database?.migrationVersions ?? []) {
    if (!afterMigrations.has(version)) failures.push(`migration removed: ${version}`);
  }
  for (const [table, state] of Object.entries(before.tables ?? {})) {
    const next = after.tables?.[table];
    if (state.exists && !next?.exists) failures.push(`required table removed: ${table}`);
    if (state.exists && next?.exists && Number(next.rowCount) < Number(state.rowCount)) {
      failures.push(`table row count decreased: ${table} (${state.rowCount} -> ${next.rowCount})`);
    }
  }
  failures.push(
    ...mapPreservationFailures('stableIdentifiers', before.stableIdentifiers ?? {}, after.stableIdentifiers ?? {}),
    ...mapPreservationFailures(
      'credentialFingerprints',
      before.credentialFingerprints ?? {},
      after.credentialFingerprints ?? {},
    ),
    ...mapPreservationFailures('projectDrafts', before.projectDrafts ?? {}, after.projectDrafts ?? {}),
    ...mapPreservationFailures(
      'projectVersions',
      before.projectVersions ?? {},
      after.projectVersions ?? {},
    ),
    ...mapPreservationFailures(
      'electronicsDocuments',
      before.electronicsDocuments ?? {},
      after.electronicsDocuments ?? {},
    ),
  );
  const afterRoutes = new Set(after.routes ?? []);
  for (const route of before.routes ?? []) {
    if (!afterRoutes.has(route)) failures.push(`canonical route removed: ${route}`);
  }
  if (canonicalJson(before.screenshots ?? []) === canonicalJson(after.screenshots ?? [])) {
    warnings.push('screenshot inventory did not change; confirm owner evidence is current');
  }
  return { failures, warnings };
}

function compareFiles(beforePath, afterPath, reportPath) {
  const before = readJson(beforePath, 'before manifest');
  const after = readJson(afterPath, 'after manifest');
  const { failures, warnings } = compareManifests(before, after);
  const report = {
    schemaVersion: '1.0.0',
    reportType: 'asa-r0-baseline-comparison',
    comparedAt: new Date().toISOString(),
    beforeSourceCommitSha: before.sourceCommitSha,
    afterSourceCommitSha: after.sourceCommitSha,
    pass: failures.length === 0,
    failures,
    warnings,
  };
  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (failures.length > 0) {
    console.error('R0 baseline comparison FAIL');
    for (const failure of failures) console.error(`- ${failure}`);
    return 1;
  }
  console.log('R0 baseline comparison PASS');
  console.log(`- preserved stable identifiers: ${Object.keys(before.stableIdentifiers ?? {}).length}`);
  console.log(`- preserved project drafts: ${Object.keys(before.projectDrafts ?? {}).length}`);
  console.log(`- preserved project versions: ${Object.keys(before.projectVersions ?? {}).length}`);
  for (const warning of warnings) console.log(`- warning: ${warning}`);
  return 0;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const command = args[0];
    if (command === 'capture') {
      const output = resolveReportPath(
        option(args, '--output', 'reports/r0-baseline-manifest.json'),
        '--output',
      );
      return await captureManifest(output);
    }
    if (command === 'compare') {
      const before = resolveReportPath(option(args, '--before'), '--before');
      const after = resolveReportPath(option(args, '--after'), '--after');
      const reportValue = option(args, '--report');
      const report = reportValue ? resolveReportPath(reportValue, '--report') : undefined;
      return compareFiles(before, after, report);
    }
    console.error(
      'Usage: node tools/r0-baseline-manifest.mjs capture --output reports/file.json\n' +
        '   or: node tools/r0-baseline-manifest.mjs compare --before reports/before.json --after reports/after.json [--report reports/comparison.json]',
    );
    return EX_CONFIG;
  } catch (error) {
    console.error(`R0 baseline tool FAIL: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
