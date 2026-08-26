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

function forbidText(path, source, forbidden) {
  if (source.includes(forbidden)) {
    console.error(`FAIL: ${path} must not contain ${JSON.stringify(forbidden)}`);
    failures += 1;
  }
}

const license = read('LICENSE');
const licensing = read('LICENSING.md');
const trademarks = read('TRADEMARKS.md');
const assets = read('ASSETS-LICENSE.md');
const copyright = read('COPYRIGHT');
const contributing = read('CONTRIBUTING.md');
const cla = read('CLA.md');
const notice = read('NOTICE');
const pullRequestTemplate = read('.github/pull_request_template.md');
const brandNotice = read('apps/web/public/BRAND_NOTICE.md');
const electronicsAssetsNotice = read('apps/web/public/assets/electronics/ASSETS_NOTICE.md');
const interfaceEvidenceNotice = read('e2e/artifacts/ASSETS_NOTICE.md');
const productMaterialsNotice = read('docs/product/ASSETS_NOTICE.md');
const claWorkflow = read('.github/workflows/cla.yml');
const claValidator = read('tools/validate-pr-cla.mjs');
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
  'apps/web/public/assets/electronics/component-database/',
  'apps/web/public/asa-lab-mark.svg',
  'e2e/artifacts/',
  'docs/product/',
]) {
  requireText('LICENSING.md', licensing, excludedPath);
}

requireText('LICENSING.md', licensing, 'AGPL-3.0-only');
requireText('LICENSING.md', licensing, 'впоследствии принимается');
requireText('LICENSING.md', licensing, 'условиями GitHub');
requireText('LICENSING.md', licensing, '[`CLA.md`](CLA.md)');
requireText('TRADEMARKS.md', trademarks, 'предоставляются по лицензии AGPL-3.0-only');
requireText('ASSETS-LICENSE.md', assets, 'All rights reserved');
requireText('ASSETS-LICENSE.md', assets, 'предоставленных пользователям GitHub');
requireText(
  'COPYRIGHT',
  copyright,
  'Copyright (C) 2026 Аликин Александр Сергеевич (Alexander Alikin)',
);
requireText('COPYRIGHT', copyright, 'GitHub Terms of Service');
requireText('CONTRIBUTING.md', contributing, 'AGPL-3.0-only');
requireText('CONTRIBUTING.md', contributing, '[`CLA.md`](CLA.md)');
requireText('CLA.md', cla, 'You retain ownership of your Contribution');
requireText('CLA.md', cla, 'under other open-source or commercial terms');
requireText('CLA.md', cla, 'The Pull Request URL');
requireText('NOTICE', notice, 'ASA Lab mixed-license notice');
requireText('NOTICE', notice, 'GitHub Terms of Service');
requireText(
  '.github/pull_request_template.md',
  pullRequestTemplate,
  'https://github.com/spikeal8-maker/asa-lab/blob/main/CLA.md',
);
requireText('apps/web/public/BRAND_NOTICE.md', brandNotice, 'excluded from the AGPL');
requireText(
  'apps/web/public/assets/electronics/ASSETS_NOTICE.md',
  electronicsAssetsNotice,
  'owner-supplied/',
);
requireText(
  'apps/web/public/assets/electronics/ASSETS_NOTICE.md',
  electronicsAssetsNotice,
  'component-database/',
);
requireText(
  'e2e/artifacts/ASSETS_NOTICE.md',
  interfaceEvidenceNotice,
  'AGPL-3.0-only code license',
);
requireText('docs/product/ASSETS_NOTICE.md', productMaterialsNotice, 'excluded from the AGPL');
requireText('.github/workflows/cla.yml', claWorkflow, 'pull_request_target:');
requireText(
  '.github/workflows/cla.yml',
  claWorkflow,
  'ref: ${{ github.event.repository.default_branch }}',
);
requireText('.github/workflows/cla.yml', claWorkflow, 'CLA acceptance');
requireText('.github/workflows/cla.yml', claWorkflow, 'concurrency:');
requireText(
  '.github/workflows/cla.yml',
  claWorkflow,
  'group: cla-${{ github.event.pull_request.number }}',
);
requireText('.github/workflows/cla.yml', claWorkflow, 'cancel-in-progress: true');
forbidText('.github/workflows/cla.yml', claWorkflow, 'statuses: write');
forbidText('.github/workflows/cla.yml', claWorkflow, 'repos/$REPOSITORY/statuses/$HEAD_SHA');
requireText('tools/validate-pr-cla.mjs', claValidator, 'PR_AUTHOR_ASSOCIATION');
requireText('tools/validate-pr-cla.mjs', claValidator, '--self-test');
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

console.log('license:check PASS (AGPL code, CLA, protected brand/assets, network source offer)');
