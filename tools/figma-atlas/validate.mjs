#!/usr/bin/env node
/**
 * ASA Lab Figma Atlas — repository-only manifest validator.
 *
 * Run: node tools/figma-atlas/validate.mjs
 * No Figma credentials, network access, or external packages are required.
 *
 * This checks the source mapping. It intentionally DOES NOT claim that the
 * Figma canvas matches a rendered browser page.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const filename = resolve(root, 'docs/product/figma-ui-atlas-manifest.json');
const manifest = JSON.parse(readFileSync(filename, 'utf8'));
const readSource = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

assert.equal(manifest.schemaVersion, 1, 'Unsupported manifest schema');
assert.equal(manifest.repoFullName, 'spikeal8-maker/asa-lab');
assert.match(manifest.baselineSha, /^[0-9a-f]{40}$/);
assert.match(manifest.figma.url, /^https:\/\/www\.figma\.com\/design\/[A-Za-z0-9]+$/);
assert.equal(manifest.figma.variables.sourceCSS + manifest.figma.variables.inlineCSS, manifest.figma.variables.total);
assert.equal(manifest.inventory.count, manifest.screens.length);

const roles = new Set(['anonymous', 'account', 'seat', 'teacher', 'author', 'admin']);
const groups = new Set(['public', 'account', 'seat', 'learning', 'teacher', 'editor', 'admin']);
const ids = new Set();
const invalidPaths = new Set();
const invalidRoles = new Set();
let figmaDrafts = 0;
let approvedScreens = 0;

for (const entry of manifest.screens) {
  assert.equal(typeof entry.id, 'string');
  assert.match(entry.id, /^[a-z0-9-]+\.[a-z0-9-]+$/);
  assert.ok(!ids.has(entry.id), `Duplicate screen id: ${entry.id}`);
  ids.add(entry.id);
  assert.ok(groups.has(entry.group), `Unknown group for ${entry.id}`);
  assert.ok(entry.roles.length > 0, `Missing roles for ${entry.id}`);
  assert.ok(entry.states.length > 0, `Missing states for ${entry.id}`);
  assert.ok(
    entry.routePattern.startsWith('/') || entry.routePattern.startsWith('(session:'),
    `Invalid route type for ${entry.id}`
  );
  for (const role of entry.roles) if (!roles.has(role)) invalidRoles.add(role);
  for (const source of entry.sourceFiles) {
    if (!source.startsWith('apps/web/src/') || !existsSync(resolve(root, source))) {
      invalidPaths.add(source);
    }
  }

  assert.ok(entry.figma && typeof entry.figma.status === 'string', `Missing Figma status: ${entry.id}`);
  if (entry.figma.desktopNodeId || entry.figma.mobileNodeId) {
    figmaDrafts++;
    for (const id of [entry.figma.desktopNodeId, entry.figma.mobileNodeId]) {
      if (id !== null) assert.match(id, /^\d+:\d+$/);
    }
  }
  if (entry.figma.status === 'approved') {
    approvedScreens++;
    assert.equal(entry.figma.pixelAccurate, true, `Approval without visual capture: ${entry.id}`);
    assert.equal(entry.figma.visualReview, 'PASS', `Approval without visual PASS: ${entry.id}`);
    assert.ok(entry.figma.desktopNodeId && entry.figma.mobileNodeId, `Incomplete approved pair: ${entry.id}`);
  }
}

assert.deepEqual([...invalidRoles], [], 'Invalid role values');
assert.deepEqual([...invalidPaths], [], 'Missing implementation files');
assert.ok(manifest.screens.length >= 40, 'Role-sensitive inventory unexpectedly shrank');

const app = readSource('apps/web/src/App.tsx');
const portal = readSource('apps/web/src/creator-portal/navigation.ts');
const admin = readSource('apps/web/src/admin/admin-navigation.ts');
const editor = readSource('apps/web/src/modules/ModuleEditorHost.tsx');

assert.ok(app.includes('const PUBLIC_ROUTES'), 'Public router anchor missing');
assert.ok(portal.includes('const PORTAL_ROUTES'), 'Portal router anchor missing');
assert.ok(portal.includes('creatorViewFromHash'), 'Dynamic portal parsing missing');
assert.ok(admin.includes('const ADMIN_SECTIONS'), 'Admin registry anchor missing');
assert.ok(editor.includes('const EDITORS'), 'Editor registry missing');

const publicRouter = app.slice(app.indexOf('const PUBLIC_ROUTES'), app.indexOf('function publicViewToHash'));
const portalRouter = portal.slice(portal.indexOf('const PORTAL_ROUTES'), portal.indexOf('function decodeRouteParameter'));
const adminRouter = admin.slice(admin.indexOf('const ADMIN_SECTIONS'), admin.indexOf('export const ADMIN_HREF'));

for (const entry of manifest.screens) {
  if (entry.id === 'public.home' || entry.id === 'public.max-link') continue;
  const hashStatic = /^\/#\/[a-z-]+$/.test(entry.routePattern);
  if (!hashStatic) continue;
  const decoded = entry.routePattern.replace('/#', '');
  if (entry.group === 'admin') {
    assert.ok(adminRouter.includes(`path: '${decoded}'`), `Admin route drift: ${entry.id}`);
  } else if (entry.group === 'public') {
    assert.ok(publicRouter.includes(`path: '${decoded}'`), `Public route drift: ${entry.id}`);
  } else {
    assert.ok(portalRouter.includes(`path: '${decoded}'`), `Portal route drift: ${entry.id}`);
  }
}

assert.ok(portal.includes("if (view.kind === 'editor' && view.moduleKey === 'electronics')"));
assert.ok(portal.includes('const independentThreeDEditor'));
assert.ok(portal.includes('const gameEditor'));
assert.ok(editor.includes('blocks: BlocksEditorAdapter'));
assert.ok(editor.includes('electronics: lazy(loadSchematicEditor)'));
assert.ok(editor.includes('chess: lazy(loadChessEditor)'));
assert.ok(editor.includes('checkers: lazy(loadCheckersEditor)'));

console.log(JSON.stringify({
  result: 'PASS',
  repository: manifest.repoFullName,
  baselineSha: manifest.baselineSha,
  checkedSourcePaths: [...new Set(manifest.screens.flatMap((e) => e.sourceFiles))].length,
  roleSensitiveScreenRecords: manifest.screens.length,
  figmaDraftPairs: figmaDrafts,
  figmaApprovedPairs: approvedScreens,
  note: 'Repository manifest consistency only — does not prove Figma visual fidelity.'
}, null, 2));
