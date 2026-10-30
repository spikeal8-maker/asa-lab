import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../..');
const require = createRequire(resolve(root, 'package.json'));
const ts = require('typescript');
const { chromium } = require('@playwright/test');
const original = readFileSync(resolve(root, 'e2e/browser-failures.ts'), 'utf8');
const module = { exports: {} };
runInNewContext(ts.transpileModule(original, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module, exports: module.exports, require, URL });
const { collectBrowserFailures } = module.exports;
const browser = await chromium.launch({ headless: true });
const contexts = [await browser.newContext(), await browser.newContext()];
const pages = await Promise.all(contexts.map((c) => c.newPage()));
const collectors = pages.map((p) => collectBrowserFailures(p, { allowAdminAccessProbe: true }));
let reopenedFailureCollector;
const snapshot = () => ({ original: collectors[0].counts, reopened: reopenedFailureCollector?.counts ?? null });
const earlyFailureBeforeReopen = snapshot();
assert.equal(earlyFailureBeforeReopen.reopened, null);
reopenedFailureCollector = collectors[1];
const empty = snapshot();
for (let i = 0; i < pages.length; i++) {
  const consoleEvent = pages[i].waitForEvent('console');
  await pages[i].evaluate((index) => console.error(`collector-proof-${index}`), i);
  await consoleEvent;
  const pageError = pages[i].waitForEvent('pageerror');
  await pages[i].evaluate((index) => { setTimeout(() => { throw new Error(`collector-pageerror-${index}`); }, 0); }, i);
  await pageError;
}
const beforeCleanup = snapshot();
for (const c of contexts) await c.close();
const afterCleanup = snapshot();
for (const key of ['original', 'reopened']) {
  assert.equal(empty[key].consoleErrors, 0);
  assert.equal(empty[key].pageErrors, 0);
  assert.equal(beforeCleanup[key].consoleErrors, 1);
  assert.equal(beforeCleanup[key].pageErrors, 1);
  assert.deepEqual(beforeCleanup[key], afterCleanup[key]);
  assert.notEqual(beforeCleanup[key], afterCleanup[key]);
}
// The existing assertions remain strict: neither reading counts nor closing resets errors.
for (const collector of collectors) assert.throws(() => collector.assertEmpty());
await browser.close();
writeFileSync(resolve(here, 'collector-proof-result.json'), JSON.stringify({
  status: 'PASS', scope: 'genuine Chromium, actual unchanged collectors; no backend or product journey',
  earlyFailureBeforeReopen, empty, beforeCleanup, afterCleanup, assertEmptyStillRejectsBothCollectors: true,
  requestsMade: 0, uiActions: 0,
}, null, 2) + '\n');
console.log('PASS: both actual collectors retain independent numeric snapshots and reject original errors after closure');
