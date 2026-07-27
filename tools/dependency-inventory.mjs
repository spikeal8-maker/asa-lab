#!/usr/bin/env node
// TST-DEPENDENCY-001: real dependency gate.
// 1) Writes the full locked inventory (direct + transitive) as an artifact.
// 2) Runs `pnpm audit --json` and fails on any high/critical advisory;
//    an unreachable registry yields BLOCKED (78), never PASS.
// 3) Enforces a license allowlist over every installed package (transitive
//    included); forbidden or unknown licenses fail the gate.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'CC-BY-3.0',
  'Unlicense',
  'Python-2.0',
  'MPL-2.0',
  'WTFPL',
  'Zlib',
  'Artistic-2.0',
  'MIT AND ISC',
  '(MIT OR CC0-1.0)',
  '(MIT OR Apache-2.0)',
  'Apache-2.0 AND MIT',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
  'BSD*',
  'MIT*',
  '(MIT AND Zlib)',
  '(MIT AND BSD-3-Clause)',
  '(AFL-2.1 OR BSD-3-Clause)',
  '(WTFPL OR MIT)',
  '(CC-BY-4.0 AND MIT)',
  'LGPL-3.0-or-later',
  'MIT-0',
]);

function run(args) {
  return spawnSync('pnpm', args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
}

let failures = 0;

// --- 1. inventory artifact ---
const list = run(['licenses', 'list', '--json', '--long']);
if (list.status !== 0 || !list.stdout.trim().startsWith('{')) {
  console.error('BLOCKED: could not enumerate installed packages (pnpm licenses failed)');
  console.error((list.stderr ?? '').slice(-300));
  process.exit(78);
}
const byLicense = JSON.parse(list.stdout);
let packageCount = 0;
const inventory = {};
for (const [license, packages] of Object.entries(byLicense)) {
  inventory[license] = packages.map((p) => `${p.name}@${(p.versions ?? []).join(',')}`);
  packageCount += packages.length;
}
mkdirSync('reports', { recursive: true });
writeFileSync(
  'reports/dependency-inventory.json',
  JSON.stringify(
    { generatedAt: new Date().toISOString(), packageCount, byLicense: inventory },
    null,
    2,
  ),
);
console.log(`inventory: ${packageCount} installed packages -> reports/dependency-inventory.json`);

// --- 2. advisories (network-dependent => BLOCKED when unreachable) ---
const audit = run(['audit', '--json']);
let auditReport = null;
try {
  auditReport = JSON.parse(audit.stdout || 'null');
} catch {
  auditReport = null;
}
if (auditReport === null || !auditReport.metadata) {
  console.error('BLOCKED: pnpm audit did not return a report (registry unreachable?)');
  console.error((audit.stderr ?? '').slice(-300));
  process.exit(78);
}
const vulns = auditReport.metadata.vulnerabilities ?? {};
console.log(
  `advisories: critical=${vulns.critical ?? 0} high=${vulns.high ?? 0} moderate=${vulns.moderate ?? 0} low=${vulns.low ?? 0}`,
);

function installedVersions(moduleName) {
  const versions = new Set();
  for (const packages of Object.values(byLicense)) {
    for (const entry of packages) {
      if (entry.name === moduleName) {
        for (const version of entry.versions ?? []) versions.add(version);
      }
    }
  }
  return [...versions];
}

if ((vulns.critical ?? 0) > 0 || (vulns.high ?? 0) > 0) {
  // No waivers: an advisory is resolved only by actually removing or updating
  // the affected package. Version tables invented locally are not evidence.
  for (const advisory of Object.values(auditReport.advisories ?? {})) {
    if (advisory.severity !== 'high' && advisory.severity !== 'critical') continue;
    const id = advisory.github_advisory_id ?? advisory.id;
    const installed = installedVersions(advisory.module_name);
    console.error(
      `FAIL: ${advisory.severity} advisory ${id}: ${advisory.module_name} (${advisory.vulnerable_versions}); installed: ${installed.join(', ') || 'unknown'}`,
    );
    failures += 1;
  }
}

// --- 3. license policy over every installed package ---
const badLicenses = [];
for (const [license, packages] of Object.entries(byLicense)) {
  if (!ALLOWED_LICENSES.has(license)) {
    badLicenses.push(
      `${license}: ${packages
        .slice(0, 5)
        .map((p) => p.name)
        .join(', ')}${packages.length > 5 ? ', ...' : ''}`,
    );
  }
}
if (badLicenses.length > 0) {
  for (const line of badLicenses) console.error(`FAIL: license not in allowlist -> ${line}`);
  failures += 1;
}

if (failures > 0) {
  console.error('security:dependencies FAIL');
  process.exit(1);
}
console.log(
  'security:dependencies PASS (advisory gate: no high/critical; license allowlist satisfied)',
);
