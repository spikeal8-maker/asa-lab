import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
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

test('AST includes module.require and triple-slash path dependencies', () => {
  const report = importsFromSource(
    'x.ts',
    '/// <reference path="global.d.ts" />\nmodule.require("./shared.cjs"); module.require(variable);',
  );
  assert.deepEqual(report.imports, ['./global.d.ts', './shared.cjs']);
  assert.equal(report.unknown.length, 1);
});

test('AST resolves static element loaders and bounds literal current-file createRequire aliases', () => {
  for (const binding of [
    'import {createRequire as make} from "node:module";',
    'const {createRequire: make} = require("node:module");',
    'import * as ns from "node:module"; const make = ns.createRequire;',
  ]) {
    const report = importsFromSource(
      'x.ts',
      `${binding} const load = make(import.meta.url); load("./shared.cjs");`,
    );
    // Taking the namespace factory as a value remains conservatively opaque.
    if (!binding.includes('const make =')) assert.deepEqual(report.unknown, []);
    assert.ok(report.imports.includes('./shared.cjs') || report.unknown.length);
  }
  const report = importsFromSource(
    'x.ts',
    'module["require"]("./shared.cjs"); import.meta.resolve("./a.cjs"); import.meta["resolve"]("./b.cjs");',
  );
  assert.deepEqual(report.imports, ['./shared.cjs', './a.cjs', './b.cjs']);
  assert.deepEqual(report.unknown, []);
  assert.deepEqual(
    importsFromSource('x.ts', 'import {createRequire} from "node:module";').unknown,
    [],
  );
});

test('opaque factories, escaped loaders and computed module members never disappear', () => {
  for (const source of [
    'module[method]("./shared.cjs");',
    'require[method]("./shared.cjs");',
    'import.meta[method]("./shared.cjs");',
    'module["require"].call(null, "./shared.cjs");',
    'const load = require; load("./shared.cjs");',
    'import {createRequire as make} from "node:module"; const load=make(otherBase); load("./shared.cjs");',
    'import {createRequire} from "node:module"; const load=createRequire(import.meta.url); export {load};',
    'import * as ns from "node:module"; ns[method](import.meta.url)("./shared.cjs");',
  ])
    assert.ok(importsFromSource('x.ts', source).unknown.length, source);
});

test('type-reference resolution and CSS image-set strings reach actual dependency files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asa resource parsers '));
  try {
    const files = {
      'reference.ts': '/// <reference types="./global.d.ts" />',
      'global.d.ts': 'declare const x: number;',
      'main.css':
        'a {background-image: image-set("image.svg" 1x, url(other.svg) 2x); mask-image: -webkit-image-set("other.svg" 2x)}',
      'image.svg': '<svg/>',
      'other.svg': '<svg/>',
    };
    for (const [name, content] of Object.entries(files))
      fs.writeFileSync(path.join(root, name), content);
    const report = sourceIndex(root, Object.keys(files));
    assert.deepEqual(report.unknown, []);
    assert.deepEqual(report.reverse_imports['global.d.ts'], ['reference.ts']);
    assert.deepEqual(report.reverse_imports['image.svg'], ['main.css']);
    assert.deepEqual(report.reverse_imports['other.svg'], ['main.css']);
    for (const value of [
      'image("image.svg", red)',
      'cross-fade(url(image.svg), red)',
      'future-image(image.svg)',
      'image-set(var(--asset) 1x)',
    ]) {
      fs.writeFileSync(path.join(root, 'main.css'), `a {background-image:${value}}`);
      assert.ok(
        sourceIndex(root, Object.keys(files)).uncertainties.some(
          (issue) => issue.unbounded_code_consumer,
        ),
        value,
      );
    }
    const originalLoad = Module._load;
    try {
      Module._load = function (request, ...rest) {
        if (request.startsWith('@csstools/')) throw new Error('controlled missing value parser');
        return originalLoad.call(this, request, ...rest);
      };
      assert.ok(
        sourceIndex(root, Object.keys(files)).uncertainties.some(
          (issue) =>
            issue.reason.includes('CSS value parser unavailable') && issue.unbounded_code_consumer,
        ),
      );
    } finally {
      Module._load = originalLoad;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary CSS substitution, math, fonts and color gradients do not invent asset consumers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asa css precision '));
  try {
    for (const declarations of [
      'color:var(--color); width:calc(100% - 1rem); font-family:var(--font, "Arial");',
      'background-color:var(--color); background-image:linear-gradient(var(--start), rgb(0 0 0));',
      'display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); transform:translateX(calc(1px + var(--offset)));',
    ]) {
      fs.writeFileSync(path.join(root, 'main.css'), `a {${declarations}}`);
      assert.deepEqual(sourceIndex(root, ['main.css']).unknown, [], declarations);
    }
    fs.writeFileSync(
      path.join(root, 'main.css'),
      'a {--asset:url(image.svg); background-image:var(--asset); color:var(--color)}',
    );
    fs.writeFileSync(path.join(root, 'image.svg'), '<svg/>');
    const report = sourceIndex(root, ['main.css', 'image.svg']);
    assert.ok(
      report.uncertainties.some(
        (issue) =>
          issue.reason.includes('custom-property resource') && issue.unbounded_code_consumer,
      ),
    );
    assert.deepEqual(report.reverse_imports['image.svg'], ['main.css']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CSS assets, case-insensitive URL/import and tsconfig asset aliases resolve', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asa css assets '));
  try {
    const files = {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          paths: { '@styles/*': ['./*'], '#style': ['./base.css'] },
          moduleResolution: 'Bundler',
        },
      }),
      'main.css':
        '@IMPORT UrL("base.css") screen; a { background: URL(image.svg#icon), url(./other.svg?v=1); }',
      'base.css': 'a {color:red}',
      'image.svg': '<svg/>',
      'other.svg': '<svg/>',
      'page.ts': 'import "@styles/base.css"; import "#style"; module.require("./shared.cjs");',
      'shared.cjs': 'module.exports = 1;',
      'reference.ts': '/// <reference path="./global.d.ts" />',
      'global.d.ts': 'declare const globalValue: string;',
    };
    for (const [name, content] of Object.entries(files))
      fs.writeFileSync(path.join(root, name), content);
    const report = sourceIndex(root, Object.keys(files));
    assert.deepEqual(report.unknown, []);
    assert.deepEqual(report.reverse_imports['image.svg'], ['main.css']);
    assert.deepEqual(report.reverse_imports['other.svg'], ['main.css']);
    assert.deepEqual(report.reverse_imports['base.css'], ['main.css', 'page.ts']);
    assert.deepEqual(report.reverse_imports['shared.cjs'], ['page.ts']);
    assert.deepEqual(report.reverse_imports['global.d.ts'], ['reference.ts']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unsupported CSS and unresolved aliases retain possible asset consumers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asa css unknown '));
  try {
    for (const content of [
      'a {background: URL(var(--image))}',
      '@import url(var(--base));',
      'a {background: url(/public/image.svg)}',
      'a {background: url(@styles/image.svg)}',
      'a {background: url("ima\\67 e.svg")}',
      'a {background: url("image.svg")',
    ]) {
      fs.writeFileSync(path.join(root, 'main.css'), content);
      const report = sourceIndex(root, ['main.css', 'image.svg']);
      assert.ok(
        report.uncertainties.some((issue) => issue.unbounded_code_consumer),
        content,
      );
    }
    fs.writeFileSync(path.join(root, 'page.ts'), 'import "@styles/shared.css";');
    const report = sourceIndex(root, ['page.ts', 'shared.css']);
    assert.ok(report.uncertainties.some((issue) => issue.unbounded_code_consumer));
    fs.writeFileSync(path.join(root, 'main.css'), 'a {background:url(missing.svg)}');
    assert.deepEqual(sourceIndex(root, ['main.css']).uncertainties[0].potential_roots, [
      'missing.svg',
    ]);
    assert.equal(sourceIndex(root, ['main.css']).uncertainties[0].unbounded_code_consumer, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
