#!/usr/bin/env node
/** Milestone 4 evidence validator for TASK-PORTAL-001. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = resolve(process.cwd());
const REPORT_DIR = join(ROOT, 'reports');
const REPORT_FILE = join(REPORT_DIR, 'portal-m4-evidence.json');
const EXPECTED_TESTS = [
  'TST-MAP-001',
  'TST-CAPABILITY-MAP-001',
  'TST-DEVELOPMENT-PROGRAM-001',
  'TST-FORMAT-001',
  'TST-LINT-001',
  'TST-TYPE-001',
  'TST-BOUNDARY-001',
  'TST-BUILD-001',
  'TST-CONTRACT-001',
  'TST-UNIT-001',
  'TST-SECRET-001',
  'TST-DEPENDENCY-001',
  'TST-PORTS-001',
  'TST-STARTUP-001',
  'TST-A11Y-001',
  'TST-MIGRATION-001',
  'TST-TENANT-001',
  'TST-RLS-001',
  'TST-AUTHZ-001',
  'TST-PORTAL-API-001',
  'TST-E2E-PORTAL-001',
].sort();

function repoPath(path) {
  return relative(ROOT, path).split(sep).join('/');
}

const errors = [];
const evidence = {};

for (const relativePath of [
  'e2e/artifacts/portal-desktop.png',
  'e2e/artifacts/portal-mobile.png',
]) {
  const path = join(ROOT, relativePath);
  if (!existsSync(path) || statSync(path).size === 0) {
    errors.push(`missing or empty screenshot: ${relativePath}`);
  } else {
    evidence[relativePath] = { bytes: statSync(path).size };
  }
}

const mapPath = join(ROOT, 'docs/project-map/project-map.yaml');
const map = parseYaml(readFileSync(mapPath, 'utf8'));
if (map?.project?.current_focus !== 'TASK-PORTAL-001') {
  errors.push(
    `project.current_focus must be TASK-PORTAL-001, got ${String(map?.project?.current_focus)}`,
  );
}
const portalNode = Array.isArray(map?.nodes)
  ? map.nodes.find((node) => node.id === 'TASK-PORTAL-001')
  : undefined;
const nextNode = Array.isArray(map?.nodes)
  ? map.nodes.find((node) => node.id === 'TASK-PROJECT-SHELL-001')
  : undefined;
if (!portalNode || portalNode.status !== 'in_review') {
  errors.push('TASK-PORTAL-001 status must be in_review for final owner review');
}
if (!nextNode || nextNode.status !== 'blocked') {
  errors.push('TASK-PROJECT-SHELL-001 must remain blocked before Portal merge');
}

const catalogPath = join(ROOT, 'docs/testing/test-catalog.yaml');
const catalog = parseYaml(readFileSync(catalogPath, 'utf8'));
const actualTests = (catalog?.tests ?? [])
  .filter((test) => (test.required_for ?? []).includes('TASK-PORTAL-001'))
  .map((test) => test.id)
  .sort();
if (JSON.stringify(actualTests) !== JSON.stringify(EXPECTED_TESTS)) {
  errors.push(
    `TASK-PORTAL-001 exact gate mismatch: expected ${EXPECTED_TESTS.join(', ')}, got ${actualTests.join(', ')}`,
  );
}

evidence.currentFocus = map?.project?.current_focus;
evidence.taskStatus = portalNode?.status;
evidence.nextTaskStatus = nextNode?.status;
evidence.testIds = actualTests;

const graphPath = join(ROOT, 'docs/project-map/nx-project-graph.json');
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
const nodes = graph?.graph?.nodes ?? {};
for (const name of ['api', 'web', 'identity', 'organization', 'classroom']) {
  if (!nodes[name]) errors.push(`nx-project-graph.json lacks node ${name}`);
}
const dependencies = graph?.graph?.dependencies ?? {};
const apiTargets = new Set((dependencies.api ?? []).map((edge) => edge.target));
for (const target of ['identity', 'organization', 'classroom']) {
  if (!apiTargets.has(target))
    errors.push(`nx-project-graph.json lacks api -> ${target} dependency`);
}

try {
  const changed = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const requiredMapFiles = [
    'docs/project-map/project-map.yaml',
    'docs/project-map/PROJECT_MAP.md',
    'docs/project-map/QUALITY_MAP.md',
    'docs/project-map/nx-project-graph.json',
  ];
  for (const file of requiredMapFiles) {
    if (!changed.includes(file)) errors.push(`Portal PR must include updated ${file}`);
  }
  evidence.changedFiles = changed;
} catch (error) {
  errors.push(
    `unable to inspect git diff: ${error instanceof Error ? error.message : String(error)}`,
  );
}

const report = {
  generatedAt: new Date().toISOString(),
  task: 'TASK-PORTAL-001',
  evidence,
  errors,
};
mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

if (errors.length > 0) {
  console.error(`portal-m4-evidence FAIL (${errors.length} error(s))`);
  for (const error of errors) console.error(`  - ${error}`);
  console.error(`report: ${repoPath(REPORT_FILE)}`);
  process.exit(1);
}

console.log(
  `portal-m4-evidence PASS: ${actualTests.length} exact test IDs, screenshots, maps and Nx graph present`,
);
console.log(`report: ${repoPath(REPORT_FILE)}`);
