import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

// Execute the actual browser-side helper, not a duplicated oracle.
const source = readFileSync(
  new URL('../e2e/helpers/visible-control-overflow.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { visibleControlOverflow } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);
const control = (left, right, layout = true, parent = true) => ({
  getClientRects: () => (layout ? [{}] : []),
  getBoundingClientRect: () => ({ left, right }),
  closest: () => (parent ? { getBoundingClientRect: () => ({ left: 152, right: 382 }) } : null),
});

test('hidden disclosure zero box does not contaminate visible inspector bounds', () => {
  // Exact numeric causal fixture from 2a CSS, NOT an actual-page layout claim.
  assert.equal(visibleControlOverflow([control(0, 0, false), control(152, 382)]), false);
});
test('visible left overflow still fails', () => {
  assert.equal(visibleControlOverflow([control(0, 0, false), control(150, 382)]), true);
});
test('visible right overflow still fails', () => {
  assert.equal(visibleControlOverflow([control(152, 384)]), true);
});
test('original one-pixel tolerance is preserved at both edges', () => {
  assert.equal(visibleControlOverflow([control(151, 383)]), false);
  assert.equal(visibleControlOverflow([control(150.99, 383)]), true);
  assert.equal(visibleControlOverflow([control(151, 383.01)]), true);
});
test('zero-width rendered control is not silently ignored', () => {
  assert.equal(visibleControlOverflow([control(0, 0)]), true);
});
test('missing panel is an invalid observer scope', () => {
  assert.throws(() => visibleControlOverflow([control(152, 382, true, false)]), /no panel/);
});
