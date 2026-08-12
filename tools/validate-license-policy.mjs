#!/usr/bin/env node
import { readFileSync } from 'node:fs';

let failures = 0;

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`FAIL: required licensing file is unavailable: ${path}`);
    console.error(error instanceof Error ? error.message : String(error));
    failures += 1;
    return '';
  }
}

function requireText(path, source, expected) {
  if (!source.includes(expected)) {
    console.error(`FAIL: ${path} must contain ${JSON.stringify(expected)}`);
    failures += 1;
  }
}

const license = read('LICENSE');
const licensing = read('LICENSING.md');
const trademarks = read('TRADEMARKS.md');
const assets = read('ASSETS-LICENSE.md');
const copyright = read('COPYRIGHT');
const contributing = read('CONTRIBUTING.md');
const entryPage = read('apps/web/src/pages/PublicEntryPage.tsx');
const packageJsonSource = read('package.json');

requireText('LICENSE', license, 'GNU AFFERO GENERAL PUBLIC LICENSE');
requireText('LICENSE', license, 'Version 3, 19 November 2007');
requireText(
  'LICENSE',
  license,
  '13. Remote Network Interaction; Use with the GNU General Public License.',
);

if (packageJsonSource) {
  try {
    const packageJson = JSON.parse(packageJsonSource);
    if (packageJson.license !== 'AGPL-3.0-only') {
      console.error('FAIL: package.json license must be exactly AGPL-3.0-only');
      failures += 1;
    }
  } catch (error) {
    console.error('FAIL: package.json is not valid JSON');
    console.error(error instanceof Error ? error.message : String(error));
    failures += 1;
  }
}

for (const excludedPath of [
  'apps/web/public/assets/electronics/owner-supplied/',
  'apps/web/public/assets/electronics/owner-audit/',
  'apps/web/public/assets/electronics/owner-catalog/manifest.json',
  'apps/web/public/asa-lab-mark.svg',
  'e2e/artifacts/',
  'docs/product/',
]) {
  requireText('LICENSING.md', licensing, excludedPath);
}

requireText('LICENSING.md', licensing, 'AGPL-3.0-only');
requireText('TRADEMARKS.md', trademarks, 'предоставляются по лицензии AGPL-3.0-only');
requireText('ASSETS-LICENSE.md', assets, 'All rights reserved');
requireText('COPYRIGHT', copyright, 'Copyright (C) 2026 Alex Al');
requireText('CONTRIBUTING.md', contributing, 'AGPL-3.0-only');
requireText('apps/web/src/pages/PublicEntryPage.tsx', entryPage, 'Исходный код · AGPL-3.0');
requireText(
  'apps/web/src/pages/PublicEntryPage.tsx',
  entryPage,
  'https://github.com/spikeal8-maker/asa-lab',
);

if (failures > 0) {
  console.error(`license:check FAIL (${failures} problem${failures === 1 ? '' : 's'})`);
  process.exit(1);
}

console.log('license:check PASS (AGPL code, protected brand/assets, network source offer)');
