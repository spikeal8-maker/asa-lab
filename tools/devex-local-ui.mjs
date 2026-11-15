/** Versioned LOCAL effect proof. Canonical dependency/CI obligations are never waived. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import crypto from 'node:crypto';
import prettier from 'prettier';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
export const PROFILE = Object.freeze({
  id: 'collect-picker-presentation-v1',
  version: 1,
  surface_id: 'SURF-PROJECT-COLLECTION-PICKER',
  component: 'apps/web/src/components/CollectPicker.tsx',
  style: 'apps/web/src/components/collect-picker.css',
  test_family: 'apps/web/src/components/CollectPicker',
  test_ids: [
    'TST-COLLECT-PICKER-FORMAT-001',
    'TST-COLLECT-PICKER-LINT-001',
    'TST-COLLECT-PICKER-UNIT-001',
  ],
});
const testPattern =
  /^apps\/web\/src\/components\/CollectPicker(?:\.[A-Za-z0-9][A-Za-z0-9-]*)?\.spec\.ts$/;
const ciSpec = 'e2e/project-collections-baseline.spec.ts';
const ciConfig = 'playwright.settings-ui.config.ts';
const ciFixture = 'e2e/fixtures/project-collections.ts';
const decode = (bytes) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const git = (root, ...args) => execFileSync('git', args, { cwd: root, windowsHide: true });
const split = (bytes) => decode(bytes).split('\0').filter(Boolean);

function safeFile(root, relative) {
  if (
    !relative ||
    relative.includes('\\') ||
    path.posix.isAbsolute(relative) ||
    relative.split('/').some((p) => !p || p === '.' || p === '..' || p.includes(':'))
  )
    throw new Error(`unsafe profile path: ${relative}`);
  let cursor = fs.realpathSync(root);
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink())
      throw new Error(`profile symlink/junction: ${relative}`);
  }
  if (!fs.statSync(cursor).isFile()) throw new Error(`profile source is not a file: ${relative}`);
  return cursor;
}

export function currentTests(root) {
  const files = split(git(root, 'ls-files', '-c', '-o', '--exclude-standard', '-z'));
  const tests = [...new Set(files.filter((f) => testPattern.test(f)))].sort();
  for (const entry of fs.readdirSync(path.join(root, 'apps/web/src/components'), {
    withFileTypes: true,
  })) {
    if (!entry.name.startsWith('CollectPicker')) continue;
    if (entry.isDirectory()) throw new Error('unsupported component test-family directory');
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error(`unsupported non-regular component test-family entry: ${entry.name}`);
    if (entry.name.endsWith('.spec.ts') && !tests.includes(`apps/web/src/components/${entry.name}`))
      throw new Error(`unsupported or ignored component test file: ${entry.name}`);
  }
  for (const filename of tests) safeFile(root, filename);
  return tests;
}

function changesAt(root, base) {
  const records = [];
  for (const args of [
    ['diff', '--name-status', '-z', '--no-renames', base, 'HEAD', '--'],
    ['diff', '--cached', '--name-status', '-z', '--no-renames', 'HEAD', '--'],
    ['diff', '--name-status', '-z', '--no-renames', '--'],
  ]) {
    const tokens = split(git(root, ...args));
    if (tokens.length % 2) throw new Error('malformed profile Git diff');
    for (let i = 0; i < tokens.length; i += 2)
      records.push({ status: tokens[i], path: tokens[i + 1] });
  }
  records.push(
    ...split(git(root, 'ls-files', '--others', '--exclude-standard', '-z')).map((p) => ({
      status: '?',
      path: p,
    })),
  );
  return records;
}

function parseTs(filename, source) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) throw new Error(`unsupported TypeScript syntax: ${filename}`);
  return ast;
}

function comments(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, source);
  const result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan())
    if (
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    )
      result.push(scanner.getTokenText());
  return result;
}

function maskDialog(source) {
  const ast = parseTs(PROFILE.component, source);
  const owner = ast.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'CollectPicker',
  );
  if (!owner) throw new Error('missing CollectPicker function');
  const dialogs = [];
  let binding = false;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.name.elements.map((e) => e.name?.getText(ast)).join(',') === 'busy,setBusy' &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(ast) === 'useState' &&
      node.initializer.arguments.length === 1 &&
      node.initializer.arguments[0].kind === ts.SyntaxKind.FalseKeyword
    )
      binding = true;
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'div') {
      const attributes = node.attributes.properties;
      const literal = (name, value) =>
        attributes.some(
          (a) =>
            ts.isJsxAttribute(a) &&
            a.name.getText(ast) === name &&
            a.initializer &&
            ts.isStringLiteral(a.initializer) &&
            a.initializer.text === value,
        );
      if (literal('role', 'dialog') && literal('aria-labelledby', 'collect-title'))
        dialogs.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(owner);
  if (!binding || dialogs.length !== 1)
    throw new Error('missing unchanged boolean binding or unique owned dialog');
  const dialog = dialogs[0];
  if (dialog.attributes.properties.some(ts.isJsxSpreadAttribute))
    throw new Error('dialog spreads are unsupported');
  const attributes = dialog.attributes.properties.filter(
    (a) => a.name?.getText(ast) === 'aria-busy',
  );
  if (attributes.length > 1) throw new Error('duplicate aria-busy');
  if (!attributes.length) return { source, value: 'ABSENT' };
  const attribute = attributes[0];
  const initializer = attribute.initializer;
  let value;
  if (
    initializer &&
    ts.isStringLiteral(initializer) &&
    ['true', 'false'].includes(initializer.text)
  )
    value = `string:${initializer.text}`;
  else if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
    const expression = initializer.expression;
    if (
      (ts.isIdentifier(expression) && expression.text === 'busy') ||
      [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(expression.kind) ||
      (ts.isPrefixUnaryExpression(expression) &&
        expression.operator === ts.SyntaxKind.ExclamationToken &&
        ts.isIdentifier(expression.operand) &&
        expression.operand.text === 'busy')
    )
      value = expression.getText(ast).replace(/\s/g, '');
  }
  if (value === undefined)
    throw new Error('aria-busy expression is outside the pure boolean grammar');
  let start = attribute.getStart(ast);
  while (start > 0 && /\s/.test(source[start - 1])) start--;
  return { source: source.slice(0, start) + ' ' + source.slice(attribute.end), value };
}

async function formatted(root, filename, source) {
  const options = (await prettier.resolveConfig(path.join(root, filename))) || {};
  return prettier.format(source, { ...options, filepath: filename });
}

export async function proveComponent(root, before, after) {
  if (JSON.stringify(comments(before)) !== JSON.stringify(comments(after)))
    throw new Error('component comments/directives changed');
  const a = maskDialog(before),
    b = maskDialog(after);
  if (
    (await formatted(root, PROFILE.component, a.source)) !==
    (await formatted(root, PROFILE.component, b.source))
  )
    throw new Error('production code outside aria-busy changed');
  return a.value !== b.value;
}

function maskStyle(source) {
  const ast = postcss.parse(source);
  const declarations = [],
    commentTokens = [];
  ast.walkComments((node) => commentTokens.push(node.toString()));
  ast.walkDecls((node) => {
    if (
      node.prop === 'min-height' &&
      node.parent.type === 'rule' &&
      node.parent.selector === '.collect-picker-create input'
    )
      declarations.push(node);
  });
  if (declarations.length !== 1) throw new Error('missing/duplicate owned min-height declaration');
  const declaration = declarations[0];
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(declaration.value) ||
    !Number.isFinite(Number(declaration.value.slice(0, -2)))
  )
    throw new Error('min-height is not a finite primitive px value');
  const value = declaration.value;
  declaration.value = '0px';
  return { source: ast.toString(), comments: commentTokens, value };
}

export async function proveStyle(root, before, after) {
  const a = maskStyle(before),
    b = maskStyle(after);
  if (JSON.stringify(a.comments) !== JSON.stringify(b.comments))
    throw new Error('style comments changed');
  if (
    (await formatted(root, PROFILE.style, a.source)) !==
    (await formatted(root, PROFILE.style, b.source))
  )
    throw new Error('style outside owned min-height changed');
  return a.value !== b.value;
}

function validateAddedTest(filename, source) {
  const ast = parseTs(filename, source);
  const allowed = new Set(['react', 'react-dom/client', 'vitest', './CollectPicker', '../api']);
  const forbidden = new Set([
    'require',
    'eval',
    'Function',
    'process',
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'Worker',
    'SharedWorker',
  ]);
  let mockedApi = false;
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      if (!ts.isStringLiteral(node.moduleSpecifier) || !allowed.has(node.moduleSpecifier.text))
        throw new Error(`unsupported regression import: ${filename}`);
    }
    if (
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
      (ts.isIdentifier(node) && forbidden.has(node.text)) ||
      (ts.isPropertyAccessExpression(node) && node.name.text === 'constructor')
    )
      throw new Error(`unsupported executable regression shape: ${filename}`);
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === 'vi.mock' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === '../api'
    )
      mockedApi = true;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!mockedApi) throw new Error(`added UI regression must mock ../api: ${filename}`);
}

export async function prove(root, base) {
  const rejected = (reason) => ({ eligible: false, fallback_reason: reason });
  try {
    if (!/^[a-f0-9]{40,64}$/.test(base || ''))
      throw new Error('profile needs an exact base commit SHA');
    const changes = changesAt(root, base);
    if (!changes.length) throw new Error('no changed profile input');
    const baseFiles = new Set(split(git(root, 'ls-tree', '-r', '--name-only', '-z', base)));
    const tests = currentTests(root);
    const baselineTests = [...baseFiles].filter((f) => testPattern.test(f)).sort();
    if (!baselineTests.length) throw new Error('missing baseline component tests');
    const normalized = (source) => source.replace(/\r\n/g, '\n');
    const before = (filename) => normalized(decode(git(root, 'show', `${base}:${filename}`)));
    const observed = new Map();
    const readRaw = (filename) => {
      if (!observed.has(filename))
        observed.set(filename, fs.readFileSync(safeFile(root, filename)));
      return observed.get(filename);
    };
    const read = (filename) => normalized(decode(readRaw(filename)));
    const ciTests = baseFiles.has(ciSpec) ? [ciSpec] : [];
    if (ciTests.length) {
      for (const filename of [ciConfig, ciFixture, ciSpec]) {
        if (!baseFiles.has(filename) || before(filename) !== read(filename))
          throw new Error(`browser baseline changed/missing: ${filename}`);
      }
    }
    for (const record of changes) {
      if ([PROFILE.component, PROFILE.style].includes(record.path)) {
        if (record.status !== 'M' || !baseFiles.has(record.path))
          throw new Error('production additions/deletions/renames are unsupported');
      } else if (
        !testPattern.test(record.path) ||
        baseFiles.has(record.path) ||
        !['A', 'M', '?'].includes(record.status)
      )
        throw new Error(`unsupported changed profile path/status: ${record.path} ${record.status}`);
    }
    for (const filename of baselineTests)
      if (!tests.includes(filename) || before(filename) !== read(filename))
        throw new Error(`baseline regression changed/removed: ${filename}`);
    for (const filename of tests.filter((f) => !baseFiles.has(f)))
      validateAddedTest(filename, read(filename));
    const componentEffect = await proveComponent(
      root,
      before(PROFILE.component),
      read(PROFILE.component),
    );
    const styleEffect = await proveStyle(root, before(PROFILE.style), read(PROFILE.style));
    const protectedPaths = [
      PROFILE.component,
      PROFILE.style,
      ...tests,
      ...(ciTests.length ? [ciConfig, ciFixture, ...ciTests] : []),
    ].sort();
    const digest = crypto.createHash('sha256');
    for (const filename of protectedPaths)
      digest.update(filename).update('\0').update(readRaw(filename)).update('\0');
    return {
      eligible: true,
      profile_id: PROFILE.id,
      version: PROFILE.version,
      surface_id: PROFILE.surface_id,
      local_effect_class: componentEffect ? 'L1_UI_BEHAVIOR' : styleEffect ? 'L0_LOCAL_UI' : 'NONE',
      test_ids: [...PROFILE.test_ids],
      protected_paths: protectedPaths,
      source_digest: digest.digest('hex'),
      test_files: tests,
      added_test_files: tests.filter((f) => !baseFiles.has(f)),
      ci_test_files: ciTests,
      ci_test_ids: ciTests.length ? ['TST-COLLECT-PICKER-BROWSER-001'] : [],
      limitation:
        'LOCAL effect proof only; canonical rank, unknowns and all mandatory CI remain in force.',
    };
  } catch (error) {
    return rejected(error.message);
  }
}

export function validateComponentReport(report, expected, root) {
  if (!Array.isArray(report.testResults) || report.testResults.length !== expected.length)
    throw new Error('component report missing expected test files');
  const names = report.testResults
    .map((entry) => path.relative(root, entry.name).split(path.sep).join('/'))
    .sort();
  if (JSON.stringify(names) !== JSON.stringify([...expected].sort()))
    throw new Error('component execution file set differs from selected family');
  for (const entry of report.testResults) {
    if (
      entry.status !== 'passed' ||
      !entry.assertionResults?.length ||
      entry.assertionResults.some((a) => a.status !== 'passed')
    )
      throw new Error(`component assertions failed, empty or skipped: ${entry.name}`);
  }
  if (
    report.success !== true ||
    !(report.numPassedTests > 0) ||
    report.numFailedTests ||
    report.numPendingTests ||
    report.numTodoTests
  )
    throw new Error('component report is failed, empty or partially unexecuted');
}

export function runScoped(root, mode) {
  const tests = currentTests(root);
  if (!tests.length) throw new Error('no component tests; refusing empty green');
  const files =
    mode === '--format'
      ? [PROFILE.component, PROFILE.style, ...tests]
      : [PROFILE.component, ...tests];
  for (const filename of files) safeFile(root, filename);
  const directory =
    mode === '--components' ? fs.mkdtempSync(path.join(os.tmpdir(), 'asa-collect-tests-')) : null;
  try {
    const output = directory && path.join(directory, 'vitest.json');
    const name = mode === '--format' ? 'prettier' : mode === '--lint' ? 'eslint' : 'vitest';
    const manifest = require.resolve(`${name}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[name];
    const executable = path.resolve(path.dirname(manifest), bin);
    const args =
      mode === '--format'
        ? ['--check', ...files]
        : mode === '--lint'
          ? files
          : ['run', PROFILE.test_family, '--reporter=json', `--outputFile=${output}`];
    const result = spawnSync(process.execPath, [executable, ...args], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status || 1;
    if (output) {
      const report = JSON.parse(fs.readFileSync(output, 'utf8'));
      validateComponentReport(report, tests, root);
      console.log(
        `Actual component checks PASS: ${tests.length} files, ${report.numPassedTests} test cases; aria feature evidence N/A unless a permanent regression is installed.`,
      );
    }
    return 0;
  } finally {
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, base] = process.argv.slice(2);
  try {
    if (mode === '--prove' && process.argv.length === 4)
      console.log(JSON.stringify(await prove(process.cwd(), base)));
    else if (['--format', '--lint', '--components'].includes(mode) && process.argv.length === 3)
      process.exitCode = runScoped(process.cwd(), mode);
    else throw new Error('expected --prove <exact-base-sha>, --format, --lint or --components');
  } catch (error) {
    console.error(`Scoped local checks BLOCKED: ${error.message}`);
    process.exitCode = 78;
  }
}
