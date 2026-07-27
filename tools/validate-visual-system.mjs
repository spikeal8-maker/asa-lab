import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const failures = [];

function requireText(path, text, reason) {
  const source = read(path);
  if (!source.includes(text)) failures.push(`${path}: ${reason}`);
}

function forbidText(path, text, reason) {
  const source = read(path);
  if (source.includes(text)) failures.push(`${path}: ${reason}`);
}

requireText(
  'docs/product/ASA_VISUAL_PRODUCT_SYSTEM.md',
  'A-flask-circuit',
  'visual product contract must define the ASA Lab mark',
);
requireText(
  'apps/web/src/brand/AsaLabBrand.tsx',
  'export function AsaLabMark',
  'original brand mark component is missing',
);
requireText(
  'apps/web/src/components/PortalHeader.tsx',
  '<AsaLabWordmark />',
  'portal must render the ASA Lab wordmark',
);
requireText(
  'apps/web/src/electronics/WorkbenchHeader.tsx',
  '<AsaLabMark title="ASA Lab" />',
  'workbench must render the ASA Lab mark',
);
forbidText(
  'apps/web/src/components/PortalHeader.tsx',
  'portal-brand-mark',
  'legacy four-tile mark is prohibited',
);
forbidText(
  'apps/web/src/electronics/WorkbenchHeader.tsx',
  'workbench-brand-grid',
  'legacy four-tile workbench mark is prohibited',
);
forbidText(
  'apps/web/src/pages/DashboardPage.tsx',
  'Открыть проекты класса',
  'class-card action must not wrap the old long label',
);
requireText(
  'apps/web/src/pages/DashboardPage.tsx',
  'classroom-open-button',
  'stable class-card action layout is missing',
);

const tokens = read('apps/web/src/brand/brand.css');
for (const token of ['--asa-ink-900', '--asa-cyan-500', '--asa-amber-500', '--asa-danger']) {
  if (!tokens.includes(token)) failures.push(`brand.css: missing design token ${token}`);
}

if (failures.length > 0) {
  console.error('ASA Lab visual system validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('ASA Lab visual system validation PASS');
