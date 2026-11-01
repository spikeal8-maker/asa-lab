import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importsFromSource, sourceIndex } from './devex-dependencies.mjs';

test('AST recognizes imports, reexports, literal dynamic imports and require', () => {
  const report = importsFromSource(
    'x.ts',
    'import "./a.css"; export * from "./barrel"; import("./lazy"); require("./other");',
  );
  assert.deepEqual(report.imports, ['./a.css', './barrel', './lazy', './other']);
  assert.deepEqual(report.unknown, []);
});
test('AST rejects computed imports, glob and malformed syntax', () => {
  assert.equal(
    importsFromSource('x.ts', 'import(variable); require(variable); import.meta.glob("./*.ts");')
      .unknown.length,
    3,
  );
  assert.ok(importsFromSource('x.ts', 'import {').unknown.length);
});
test('AST distinguishes runtime URLs/global fields from module URLs and require.resolve', () => {
  const report = importsFromSource(
    'x.ts',
    'new URL(userAddress); config.globalSetting; require.resolve("./engine"); new URL("./worker.ts", import.meta.url); type T = import("./types").T;',
  );
  assert.deepEqual(report.unknown, []);
  assert.deepEqual(report.imports, ['./engine', './worker.ts', './types']);
});
test('real parser resolves aliases, CSS, literal dynamic import and reexport consumers in Cyrillic directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asa проба '));
  try {
    const files = {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@shared': ['./shared.ts'] },
          moduleResolution: 'Bundler',
        },
      }),
      'shared.ts': 'export const x=1;',
      'barrel.ts': 'export * from "@shared";',
      'page.tsx': 'import "./main.css"; export * from "./barrel"; import("./lazy");',
      'lazy.ts': 'export const lazy=1;',
      'main.css': '@import "./base.css";',
      'base.css': 'body {color:red}',
    };
    for (const [name, content] of Object.entries(files))
      fs.writeFileSync(path.join(root, name), content);
    const report = sourceIndex(root, Object.keys(files));
    assert.deepEqual(report.unknown, []);
    assert.deepEqual(report.reverse_imports['shared.ts'], ['barrel.ts']);
    assert.deepEqual(report.reverse_imports['barrel.ts'], ['page.tsx']);
    assert.deepEqual(report.reverse_imports['base.css'], ['main.css']);
    assert.deepEqual(report.reverse_imports['main.css'], ['page.tsx']);
    assert.deepEqual(report.reverse_imports['lazy.ts'], ['page.tsx']);
    fs.writeFileSync(path.join(root, 'page.tsx'), 'import("./" + variable); import "./missing";');
    assert.equal(sourceIndex(root, Object.keys(files)).unknown.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
