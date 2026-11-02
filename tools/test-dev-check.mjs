import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from './dev-check.mjs';
import { runPython } from './devex-python.mjs';
import prettier from 'prettier';
import ts from 'typescript';
import {
  PROFILE,
  currentTests,
  prove,
  proveComponent,
  proveStyle,
  runScoped,
  validateComponentReport,
} from './devex-local-ui.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('shim invokes only the constant trusted runner and binds failure to a new invocation', () => {
  const messages = [];
  const args = ['--changed', '--base', 'HEAD', '--json'];
  let invocation;
  assert.equal(
    main(args, {
      env: { KEEP: 'preserved' },
      log: (message) => messages.push(message),
      run(scriptArgs, options) {
        assert.deepEqual(scriptArgs, ['tools/dev_check.py', ...args]);
        assert.equal(options.env.KEEP, 'preserved');
        invocation = options.env.ASA_DEV_CHECK_RUN_ID;
        assert.match(invocation, /^[a-f0-9-]{36}$/);
        return 78;
      },
    }),
    78,
  );
  assert.ok(messages.every((message) => message.includes(invocation)));
  assert.match(messages.at(-1), /do not reuse an earlier report/);
});

test(
  'real missing-YAML/no-pip bootstrap executes selected Python PASS, negative -c and timeout',
  { timeout: 180000 },
  (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'asa check bootstrap проба '));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const tools = path.join(temporary, 'tools');
    fs.mkdirSync(tools);
    fs.copyFileSync(
      path.join(root, 'tools/requirements.txt'),
      path.join(tools, 'requirements.txt'),
    );
    fs.copyFileSync(
      path.join(root, 'tools/run_task_tests.py'),
      path.join(tools, 'run_task_tests.py'),
    );
    const python = process.env.ASA_PYTHON || process.env.PYTHON || 'python';
    const raw = path.join(temporary, 'raw no pip');
    const created = spawnSync(python, ['-m', 'venv', '--without-pip', raw], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(created.status, 0, created.stderr || created.error?.message);
    const rawPython = path.join(
      raw,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    const missing = spawnSync(rawPython, ['-c', 'import yaml'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.notEqual(missing.status, 0, 'fresh fixture must really lack YAML');
    fs.writeFileSync(
      path.join(tools, 'probe.py'),
      `import json, os, shlex, sys
from pathlib import Path
import yaml
from run_task_tests import run_test
selected = sys.executable
assert os.path.isabs(selected)
assert os.path.normcase(selected) == os.path.normcase(os.environ['ASA_PYTHON'])
assert 'asa-devex-python-' in selected
def execute(code, timeout=5):
    return run_test({'id': 'REAL-PROBE', 'command': 'python -c ' + shlex.quote(code),
                     'timeout_seconds': timeout}, 'TASK-LOCAL-001', root=Path.cwd(), python_executable=selected)
passed = execute('import sys; print("selected marker проба"); print(sys.executable)')
assert passed['state'] == 'PASS', passed
assert 'selected marker проба' in passed['stdout_tail'], passed
assert selected in passed['stdout_tail'], passed
failed = execute('import sys; print("NEGATIVE executed"); sys.exit(29)')
assert (failed['state'], failed['exit_code']) == ('FAIL', 29), failed
assert 'NEGATIVE executed' in failed['stdout_tail'], failed
timeout = execute('import time; time.sleep(10)', 1)
assert timeout['state'] == 'FAIL' and 'timeout' in timeout['reason'], timeout
Path('actual-results.json').write_text(json.dumps({'selected': selected, 'pass': passed,
    'negative': failed, 'timeout': timeout}), encoding='utf-8')
print('Real selected-interpreter PASS / negative29 / timeout PASS')
`,
      'utf8',
    );
    const code = runPython(['tools/probe.py'], {
      root: temporary,
      python: rawPython,
      tempRoot: temporary,
    });
    assert.equal(code, 0);
    const results = JSON.parse(
      fs.readFileSync(path.join(temporary, 'actual-results.json'), 'utf8'),
    );
    assert.equal(results.pass.state, 'PASS');
    assert.equal(results.negative.exit_code, 29);
    assert.match(results.timeout.reason, /timeout/);
    assert.ok(
      !fs.existsSync(path.dirname(path.dirname(results.selected))),
      'owned interpreter cleaned',
    );
    assert.ok(fs.existsSync(rawPython), 'caller-owned raw fixture preserved');
  },
);

test('mandatory CI keeps B and C separate from the protected code alias', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/spec-validation.yml'),
    'utf8',
  );
  assert.equal(packageJson.scripts['dev:check'], 'node tools/dev-check.mjs');
  assert.match(
    workflow,
    /name: DevEx shadow planner integration\s+run: pnpm test:devex-plan:integration/,
  );
  assert.match(workflow, /name: DevEx changed local checks execution\s+run: pnpm test:dev-check/);
  assert.ok(!packageJson.scripts['gate:code'].includes('test:dev-check'));
});

// Controlled baselines retain the real component, but cannot assume which
// supported presentation value the product currently uses.
function componentFixture(source) {
  const ast = ts.createSourceFile(
    PROFILE.component,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const dialogs = [];
  const visit = (node) => {
    if (
      ts.isJsxOpeningElement(node) &&
      node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(ast) === 'role' &&
          attribute.initializer &&
          ts.isStringLiteral(attribute.initializer) &&
          attribute.initializer.text === 'dialog',
      )
    )
      dialogs.push(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(dialogs.length, 1, 'controlled fixture needs the unique owned dialog');
  const busy = dialogs[0].attributes.properties.filter(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'aria-busy',
  );
  assert.ok(busy.length <= 1, 'duplicate production aria-busy is not a supported fixture');
  if (!busy.length) return source;
  const initializer = busy[0].initializer;
  const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : null;
  const readonly =
    initializer && ts.isStringLiteral(initializer)
      ? ['true', 'false'].includes(initializer.text)
      : expression &&
        ((ts.isIdentifier(expression) && expression.text === 'busy') ||
          expression.kind === ts.SyntaxKind.TrueKeyword ||
          expression.kind === ts.SyntaxKind.FalseKeyword ||
          (ts.isPrefixUnaryExpression(expression) &&
            expression.operator === ts.SyntaxKind.ExclamationToken &&
            ts.isIdentifier(expression.operand) &&
            expression.operand.text === 'busy'));
  assert.ok(readonly, 'only supported readonly production aria-busy may enter this fixture');
  return source.slice(0, busy[0].getFullStart()) + source.slice(busy[0].end);
}
function styleFixture(source) {
  const height =
    /(\.collect-picker-create input\s*\{[^}]*?\bmin-height:\s*)[-+]?(?:\d+(?:\.\d*)?|\.\d+)px(?=\s*;)/g;
  assert.equal(
    [...source.matchAll(height)].length,
    1,
    'controlled fixture needs one owned primitive px height',
  );
  return source.replace(height, (_match, prefix) => `${prefix}34px`);
}
const component = componentFixture(fs.readFileSync(path.join(root, PROFILE.component), 'utf8'));
const style = styleFixture(fs.readFileSync(path.join(root, PROFILE.style), 'utf8'));
const withBusy = (value) => component.replace('role="dialog"', `role="dialog" aria-busy=${value}`);

test('real component proof accepts reusable readonly effects and deterministic Prettier reflow', async () => {
  for (const value of ['{busy}', '{!busy}', '{true}', '{false}', '"true"', '"false"']) {
    const candidate = withBusy(value);
    assert.equal(await proveComponent(root, component, candidate), true, value);
    assert.equal(await proveComponent(root, candidate, component), true, `remove ${value}`);
    const formatted = await prettier.format(candidate, {
      ...(await prettier.resolveConfig(path.join(root, PROFILE.component))),
      filepath: PROFILE.component,
    });
    assert.equal(await proveComponent(root, component, formatted), true, `formatted ${value}`);
  }
  assert.equal(await proveComponent(root, withBusy('{busy}'), withBusy('{false}')), true);
});

test('real component proof rejects imports, API, handlers, props, comments and impure attribute drift', async () => {
  const cases = [
    component.replace("from '../api'", "from '../other-api'"),
    component.replace('api.listCollections()', 'api.createCollection("network")'),
    component.replace("event.key === 'Escape'", "event.key === 'Enter'"),
    component.replace('readonly projectId: string', 'readonly projectId: number'),
    component.replace('Добавить в коллекцию» для своей работы.', 'Different comment.'),
    '// eslint-disable\n' + component,
    withBusy('{api.listCollections()}'),
    withBusy('{busy = false}'),
    withBusy('{busy} aria-busy={false}'),
    withBusy('{busy} {...other}'),
    component.replace('useState(false)', 'useState(true)'),
  ];
  for (const candidate of cases) await assert.rejects(proveComponent(root, component, candidate));
});

test('real CSS proof accepts numeric effect families including incorrect sizes, rejects other effects', async () => {
  for (const value of ['44px', '8px', '-1px', '1800px', '0.5px'])
    assert.equal(
      await proveStyle(root, style, style.replace('min-height: 34px', `min-height: ${value}`)),
      true,
      value,
    );
  for (const candidate of [
    style.replace('34px', 'calc(34px + 10px)'),
    style.replace('34px', '44rem'),
    style.replace('min-height: 34px', 'min-height: 44px; min-height: 34px'),
    style.replace('padding: 0 10px', 'padding: 0 20px'),
    style.replace('.collect-picker-create input', '.modal input'),
    style.replace('min-height: 34px', 'min-height: 44px !important'),
    style.replace('/* Выбор подборок для работы. */', '/* changed */'),
    style + '\na { background:url(https://example.invalid/image.png) }',
  ])
    await assert.rejects(proveStyle(root, style, candidate));
});

function proofFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asa ui proof проба '));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (relative, source) => {
    fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
    fs.writeFileSync(path.join(directory, relative), source);
  };
  write(PROFILE.component, component);
  write(PROFILE.style, style);
  const baseline = `${PROFILE.test_family}.spec.ts`;
  write(baseline, fs.readFileSync(path.join(root, baseline)));
  write('.prettierrc.json', '{"singleQuote":true,"printWidth":100}');
  // Match the repository contract even when the host's global Git config differs.
  write('.gitattributes', '* text=auto eol=lf\n');
  const git = (...args) => execFileSync('git', args, { cwd: directory, windowsHide: true });
  git('init', '-q');
  git('config', '--local', 'core.autocrlf', 'false');
  git('add', '.');
  git(
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'approved UI baseline',
  );
  return { directory, write, baseline, git, base: git('rev-parse', 'HEAD').toString().trim() };
}

test('actual Git/source proof supports additive regressions and retains all baseline tests', async (t) => {
  const f = proofFixture(t);
  f.write(PROFILE.component, withBusy('{busy}'));
  f.write(PROFILE.style, style.replace('34px', '44px'));
  const addition = `${PROFILE.test_family}.aria-busy.spec.ts`;
  const regression = `import { it, expect, vi } from 'vitest';\nvi.mock('../api', () => ({api:{}}));\nit('new unconditional assertion', () => { expect(true).toBe(true); });\n`;
  f.write(addition, regression);
  const passed = await prove(f.directory, f.base);
  assert.equal(passed.eligible, true, passed.fallback_reason);
  assert.equal(passed.local_effect_class, 'L1_UI_BEHAVIOR');
  assert.deepEqual(passed.test_files, [addition, f.baseline].sort());
  assert.deepEqual(passed.added_test_files, [addition]);
  assert.match(passed.source_digest, /^[a-f0-9]{64}$/);
  f.write(addition, regression.replace("from 'vitest'", "from 'node:fs'"));
  assert.match((await prove(f.directory, f.base)).fallback_reason, /unsupported regression import/);
  f.write(addition, regression);
  f.write(f.baseline, '// weakened baseline\n');
  assert.match(
    (await prove(f.directory, f.base)).fallback_reason,
    /baseline regression changed|unsupported changed profile path/,
  );
});

test('actual Git/source proof falls back on foreign paths, deletion, missing tests and unsafe junctions', async (t) => {
  const f = proofFixture(t);
  f.write(PROFILE.style, style.replace('34px', '8px'));
  f.write(
    f.baseline,
    fs.readFileSync(path.join(root, f.baseline), 'utf8').replace(/\r?\n/g, '\r\n'),
  );
  const eolProof = await prove(f.directory, f.base);
  assert.equal(eolProof.eligible, true, eolProof.fallback_reason);
  assert.equal(eolProof.local_effect_class, 'L0_LOCAL_UI');
  f.write('apps/web/src/api.ts', 'foreign change');
  assert.match(
    (await prove(f.directory, f.base)).fallback_reason,
    /unsupported changed profile path/,
  );
  fs.unlinkSync(path.join(f.directory, 'apps/web/src/api.ts'));
  fs.unlinkSync(path.join(f.directory, f.baseline));
  assert.equal((await prove(f.directory, f.base)).eligible, false);
  f.write(f.baseline, fs.readFileSync(path.join(root, f.baseline)));
  const original = path.join(f.directory, 'apps/web/src/components');
  const preserved = path.join(f.directory, 'preserved-components');
  fs.renameSync(original, preserved);
  fs.symlinkSync(preserved, original, process.platform === 'win32' ? 'junction' : 'dir');
  assert.match((await prove(f.directory, f.base)).fallback_reason, /symlink\/junction/);
});

test('component report requires actual complete per-file assertions, never empty or skipped green', () => {
  const filename = `${PROFILE.test_family}.spec.ts`;
  const report = {
    success: true,
    numPassedTests: 1,
    numFailedTests: 0,
    testResults: [
      {
        name: path.join(root, filename),
        status: 'passed',
        assertionResults: [{ status: 'passed' }],
      },
    ],
  };
  validateComponentReport(report, [filename], root);
  for (const changed of [
    { ...report, testResults: [] },
    { ...report, numPassedTests: 0 },
    { ...report, numPendingTests: 1 },
    { ...report, success: false },
    { ...report, testResults: [{ ...report.testResults[0], assertionResults: [] }] },
    {
      ...report,
      testResults: [{ ...report.testResults[0], assertionResults: [{ status: 'pending' }] }],
    },
    {
      ...report,
      testResults: [{ ...report.testResults[0], name: path.join(root, 'foreign.spec.ts') }],
    },
  ])
    assert.throws(() => validateComponentReport(changed, [filename], root));
});

test('scoped discovery rejects ignored and unsupported files before executing any test', (t) => {
  const f = proofFixture(t);
  const hidden = `${PROFILE.test_family}.hidden.spec.ts`;
  f.write('.gitignore', `${hidden}\n`);
  f.write(hidden, 'throw new Error("must never execute");');
  assert.throws(() => currentTests(f.directory), /unsupported or ignored/);
  fs.unlinkSync(path.join(f.directory, hidden));
  f.write(`${PROFILE.test_family}Unexpected.spec.ts`, 'throw new Error("must never execute");');
  assert.throws(() => currentTests(f.directory), /unsupported or ignored/);
});

test('ignored prefix junction cannot execute an unbound test body', async (t) => {
  const f = proofFixture(t);
  const alias = path.join(f.directory, 'apps/web/src/components/CollectPickerHidden');
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'asa-ui-unbound-')));
  const marker = path.join(outside, 'unexpected-executed.marker');
  let linked = false;
  try {
    f.write('.gitignore', 'apps/web/src/components/CollectPickerHidden/\n');
    f.write(
      'vitest.config.ts',
      "export default {test:{include:['apps/**/src/**/*.spec.ts'],environment:'node'}};\n",
    );
    f.write(
      f.baseline,
      `import { test, expect } from ${JSON.stringify(import.meta.resolve('vitest'))};\ntest('bound baseline', () => expect(true).toBe(true));\n`,
    );
    f.git('add', '.');
    f.git(
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'isolated alias baseline',
    );
    const base = f.git('rev-parse', 'HEAD').toString().trim();
    f.write(PROFILE.style, style.replace('34px', '44px'));
    const positive = await prove(f.directory, base);
    assert.equal(positive.eligible, true, positive.fallback_reason);
    assert.equal(positive.local_effect_class, 'L0_LOCAL_UI');
    fs.writeFileSync(
      path.join(outside, 'unexpected.spec.ts'),
      `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'unbound body executed');\nthrow new Error('unexpected test body executed');\n`,
    );
    fs.symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
    assert.ok(fs.lstatSync(alias).isSymbolicLink(), 'real filesystem alias was created');
    const negative = await prove(f.directory, base);
    let rejected;
    try {
      runScoped(f.directory, '--components');
    } catch (error) {
      rejected = error;
    }
    assert.equal(fs.existsSync(marker), false, 'unbound test body must never execute');
    assert.equal(negative.eligible, false, 'alias invalidates the otherwise valid local proof');
    assert.match(negative.fallback_reason, /non-regular|directory/);
    assert.match(
      rejected?.message || '',
      /non-regular|directory/,
      'scope rejects before spawning Vitest',
    );
    console.log(
      `Real ${process.platform === 'win32' ? 'junction' : 'directory symlink'}: proof rejected, scoped execution rejected, unexpected marker absent`,
    );
  } finally {
    if (linked) {
      assert.ok(fs.lstatSync(alias).isSymbolicLink(), 'cleanup removes only the owned alias');
      if (process.platform === 'win32') fs.rmdirSync(alias);
      else fs.unlinkSync(alias);
    }
    assert.equal(fs.realpathSync(outside), outside, 'cleanup stays in the owned temporary target');
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('concrete browser baseline stays source-bound and browser changes fall back broad', async (t) => {
  const f = proofFixture(t);
  const spec = 'e2e/project-collections-baseline.spec.ts';
  const config = 'playwright.settings-ui.config.ts';
  const fixture = 'e2e/fixtures/project-collections.ts';
  const sources = new Map([
    [spec, 'existing browser baseline'],
    [
      config,
      "import {defineConfig} from '@playwright/test';\nexport default defineConfig({testMatch:['project-collections-baseline.spec.ts']});\n",
    ],
    [fixture, 'existing controlled REST fixture'],
  ]);
  f.write(spec, sources.get(spec));
  assert.equal(
    (await prove(f.directory, f.base)).eligible,
    false,
    'browser additions are unsupported',
  );
  for (const [filename, source] of sources) f.write(filename, source);
  f.git('add', '.');
  f.git(
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-qm',
    'concrete browser baseline',
  );
  const base = f.git('rev-parse', 'HEAD').toString().trim();
  f.write(PROFILE.component, withBusy('{busy}'));
  const passed = await prove(f.directory, base);
  assert.equal(passed.eligible, true, passed.fallback_reason);
  assert.deepEqual(passed.ci_test_files, [spec]);
  assert.deepEqual(passed.ci_test_ids, ['TST-COLLECT-PICKER-BROWSER-001']);
  assert.deepEqual(passed.test_ids, PROFILE.test_ids, 'browser is never selected locally');
  for (const [filename, source] of sources) {
    assert.ok(passed.protected_paths.includes(filename));
    f.write(filename, source + '\nchanged browser input');
    assert.equal((await prove(f.directory, base)).eligible, false, filename);
    f.write(filename, source);
  }
  f.write('e2e/project-collections-new.spec.ts', 'new browser file');
  assert.equal(
    (await prove(f.directory, base)).eligible,
    false,
    'new browser files fall back broad',
  );
});
