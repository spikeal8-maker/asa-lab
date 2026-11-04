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
import { parse as parseYaml } from 'yaml';
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

const focusedWorkflows = [
  'account-confirmation-focused.yml',
  'learning-e1-focused.yml',
  'projects-publication.yml',
].map((filename) => ({
  filename,
  ...parseYaml(fs.readFileSync(path.join(root, '.github/workflows', filename), 'utf8')),
}));
const applicability = focusedWorkflows[0].jobs.applicability;
const classifySource = applicability.steps.find((step) => step.id === 'changes').run;
const selectSource = applicability.steps.find((step) => step.id === 'selection').run;
const learningJobs = focusedWorkflows[1].jobs;
const partitionSource = learningJobs['learning-e1-batch'].steps.find(
  (step) => step.name === 'Record the complete exact-source browser partition',
).run;
const aggregateSource = learningJobs['learning-e1'].steps.find(
  (step) => step.name === 'Require complete applicable partitions or proved non-applicability',
).run;

function workflowPython(source, directory, extra = {}) {
  const body = /^python3 - <<'PY'\r?\n([\s\S]*?)\r?\nPY\s*$/.exec(source);
  assert.ok(body, 'execute the actual workflow Python, not a mirrored evaluator');
  fs.mkdirSync(path.join(directory, '.asa'), { recursive: true });
  return spawnSync(process.env.ASA_PYTHON || process.env.PYTHON || 'python', ['-c', body[1]], {
    cwd: directory,
    env: {
      ...process.env,
      GITHUB_OUTPUT: path.join(directory, '.asa/output.txt'),
      GITHUB_STEP_SUMMARY: path.join(directory, '.asa/summary.md'),
      ...extra,
    },
    encoding: 'utf8',
    windowsHide: true,
  });
}

function applicabilityFixture(t, effect = 'style') {
  const f = proofFixture(t);
  const protectedControls = [
    'tools/devex-local-ui.mjs',
    'package.json',
    'pnpm-lock.yaml',
    '.prettierrc.json',
    '.prettierignore',
    'docs/architecture/DEVEX_LOCAL_UI_PROFILE_CONTRACT.md',
    'playwright.settings-ui.config.ts',
    'e2e/fixtures/project-collections.ts',
    'e2e/project-collections-baseline.spec.ts',
    '.github/workflows/spec-validation.yml',
    '.github/workflows/devex-changed.yml',
    ...focusedWorkflows.map((workflow) => `.github/workflows/${workflow.filename}`),
  ];
  for (const filename of protectedControls)
    f.write(filename, fs.readFileSync(path.join(root, filename)));
  f.write('.gitignore', '.asa/\nreports/\n');
  f.git('add', '.');
  const commit = (message) =>
    f.git(
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      message,
    );
  commit('trusted CI controls and concrete browser baseline');
  const base = f.git('rev-parse', 'HEAD').toString().trim();
  if (effect === 'style') f.write(PROFILE.style, style.replace('34px', '48px'));
  else f.write(PROFILE.component, withBusy('{busy}'));
  f.git('add', '.');
  commit('real bounded UI effect');
  const head = f.git('rev-parse', 'HEAD').toString().trim();
  return {
    ...f,
    base,
    head,
    commit,
    env: { SOURCE_SHA: head, BASE_SHA: base, EVENT_NAME: 'pull_request' },
  };
}

function classifyAndProve(f, env = {}) {
  const classified = workflowPython(classifySource, f.directory, { ...f.env, ...env });
  assert.equal(classified.status, 0, classified.stderr);
  const receiptPath = path.join(f.directory, '.asa/devex/focused-selection.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (receipt.candidate) {
    const execution = spawnSync(
      process.execPath,
      [path.join(root, 'tools/devex-local-ui.mjs'), '--prove', receipt.merge_base],
      { cwd: f.directory, encoding: 'utf8', windowsHide: true },
    );
    assert.equal(execution.status, 0, execution.stderr);
    fs.writeFileSync(path.join(f.directory, '.asa/devex/focused-proof.json'), execution.stdout);
  }
  return receipt;
}

function selectedReceipt(f, env = {}) {
  const selected = workflowPython(selectSource, f.directory, { ...f.env, ...env });
  assert.equal(selected.status, 0, selected.stderr);
  return JSON.parse(
    fs.readFileSync(path.join(f.directory, '.asa/devex/focused-selection.json'), 'utf8'),
  );
}

test('focused workflow selectors use one identical proof path and skip before services or matrix provisioning', () => {
  const originalJobs = [
    ['authentication', 'browser', 'installation'],
    ['learning-e1-batch'],
    ['publication'],
  ];
  for (let index = 0; index < focusedWorkflows.length; index++) {
    const workflow = focusedWorkflows[index];
    const selector = workflow.jobs.applicability;
    assert.equal(selector.steps.find((step) => step.id === 'changes').run, classifySource);
    assert.equal(selector.steps.find((step) => step.id === 'selection').run, selectSource);
    assert.equal(
      selector.steps.find((step) => step.name === 'Reuse the existing CollectPicker effect proof')
        .run,
      'node tools/devex-local-ui.mjs --prove "$MERGE_BASE" > .asa/devex/focused-proof.json',
    );
    assert.equal(selector.services, undefined);
    assert.equal(selector.strategy, undefined);
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(
      selector.steps.find((step) => step.uses === 'actions/upload-artifact@v4').with[
        'include-hidden-files'
      ],
      true,
    );
    for (const id of originalJobs[index]) {
      assert.deepEqual(workflow.jobs[id].needs, ['applicability']);
      assert.equal(workflow.jobs[id].if, "needs.applicability.outputs.route == 'FULL'");
      assert.equal(workflow.jobs[id]['continue-on-error'], undefined);
    }
  }
  assert.deepEqual(learningJobs['learning-e1'].needs, ['applicability', 'learning-e1-batch']);
  const aggregateIf = learningJobs['learning-e1'].if;
  assert.match(aggregateIf, /^always\(\) && !\(/);
  for (const boundary of [
    "needs.applicability.result == 'success'",
    "needs.applicability.outputs.route == 'NOT_APPLICABLE'",
    'needs.applicability.outputs.source_sha == (github.event.pull_request.head.sha || github.sha)',
    "needs.applicability.outputs.source_digest != ''",
    "needs.learning-e1-batch.result == 'skipped'",
  ])
    assert.ok(aggregateIf.includes(boundary), boundary);
  assert.equal(
    learningJobs['learning-e1'].steps.find((step) => step.uses === 'actions/download-artifact@v4')
      .with['merge-multiple'],
    false,
  );
  assert.equal(learningJobs['learning-e1-batch'].strategy['fail-fast'], false);
  assert.deepEqual(learningJobs['learning-e1-batch'].strategy.matrix.batch, ['first', 'second']);
});

test('focused applicability executes the real Git classifier and AST proof for L0 and L1 without claiming tests ran', (t) => {
  for (const effect of ['style', 'component']) {
    const f = applicabilityFixture(t, effect);
    assert.equal(classifyAndProve(f).candidate, true);
    const receipt = selectedReceipt(f);
    assert.equal(receipt.route, 'NOT_APPLICABLE');
    assert.equal(receipt.status, 'NOT_APPLICABLE');
    assert.equal(receipt.focused_tests_state, 'NOT_APPLICABLE');
    assert.equal(receipt.checks_executed, 0);
    assert.equal(receipt.source_sha, f.head);
    assert.equal(receipt.full_general, 'REQUIRED');
    assert.equal(receipt.canonical_risk, 'RETAINED_WITH_UNKNOWNS');
    assert.equal(receipt.integration_ready, false);
    assert.equal(receipt.release_ready, false);
    assert.match(receipt.source_digest, /^[a-f0-9]{64}$/);
    assert.equal(receipt.local_effect_class, effect === 'style' ? 'L0_LOCAL_UI' : 'L1_UI_BEHAVIOR');
  }
});

test('focused applicability keeps manual, unknown, foreign and unsupported changes fully applicable', (t) => {
  const f = applicabilityFixture(t);
  for (const env of [
    { EVENT_NAME: 'workflow_dispatch' },
    { BASE_SHA: '0'.repeat(40) },
    { BASE_SHA: 'unknown' },
  ]) {
    assert.equal(classifyAndProve(f, env).candidate, false);
    const receipt = selectedReceipt(f, env);
    assert.equal(receipt.route, 'FULL');
    assert.equal(receipt.status, 'FULL_REQUIRED');
    assert.equal(receipt.focused_tests_state, 'NOT_RUN');
  }
  f.write('apps/api/src/foreign.ts', 'export const apiChange = true;\n');
  f.git('add', '.');
  f.commit('foreign module changes remain full');
  f.env.SOURCE_SHA = f.git('rev-parse', 'HEAD').toString().trim();
  assert.equal(classifyAndProve(f).candidate, false);
  assert.equal(selectedReceipt(f).route, 'FULL');
  const unsupported = applicabilityFixture(t);
  unsupported.write(PROFILE.style, style.replace('34px', 'calc(34px + 1px)'));
  unsupported.git('add', '.');
  unsupported.commit('unsupported CSS shape');
  unsupported.env.SOURCE_SHA = unsupported.git('rev-parse', 'HEAD').toString().trim();
  assert.equal(
    classifyAndProve(unsupported).candidate,
    true,
    'path admission alone never skips suites',
  );
  assert.equal(
    selectedReceipt(unsupported).route,
    'FULL',
    'actual AST/CSS proof rejects the unsupported effect',
  );
});

test('focused applicability tolerates unrelated main state but rejects obsolete proof controls and wrong source', (t) => {
  for (const controlChange of [false, true]) {
    const f = applicabilityFixture(t);
    f.git('checkout', '--quiet', '--detach', f.base);
    f.write(
      controlChange ? 'tools/devex-local-ui.mjs' : 'docs/execution/current.yaml',
      controlChange ? '// obsolete helper must not authorize N/A\n' : 'unrelated accepted state\n',
    );
    f.git('add', '.');
    f.commit('new target baseline');
    const nextBase = f.git('rev-parse', 'HEAD').toString().trim();
    f.git('checkout', '--quiet', '--detach', f.head);
    const env = { BASE_SHA: nextBase };
    assert.equal(classifyAndProve(f, env).candidate, !controlChange);
    assert.equal(selectedReceipt(f, env).route, controlChange ? 'FULL' : 'NOT_APPLICABLE');
    assert.notEqual(
      workflowPython(classifySource, f.directory, { ...f.env, SOURCE_SHA: 'f'.repeat(40) }).status,
      0,
    );
    f.write(PROFILE.style, style.replace('34px', '49px'));
    assert.notEqual(
      workflowPython(classifySource, f.directory, f.env).status,
      0,
      'dirty sources cannot authorize N/A',
    );
  }
});

test('focused applicability rejects malformed, missing and stale source proof instead of an empty green', (t) => {
  const f = applicabilityFixture(t);
  classifyAndProve(f);
  const proofPath = path.join(f.directory, '.asa/devex/focused-proof.json');
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  const receiptPath = path.join(f.directory, '.asa/devex/focused-selection.json');
  const initialReceipt = fs.readFileSync(receiptPath, 'utf8');
  // The source stays fixed. Reuse its actually executed proof while corrupting
  // one receipt field at a time; rerunning the same AST proof adds no evidence.
  const restore = () => {
    fs.writeFileSync(receiptPath, initialReceipt);
    fs.writeFileSync(proofPath, JSON.stringify(proof));
  };
  const negative = [
    { eligible: 'true' },
    { version: 99 },
    { source_digest: '0'.repeat(64) },
    { protected_paths: proof.protected_paths.slice(1) },
    { test_ids: [] },
    { ci_test_files: [] },
  ];
  for (const patch of negative) {
    restore();
    fs.writeFileSync(proofPath, JSON.stringify({ ...proof, ...patch }));
    assert.notEqual(
      workflowPython(selectSource, f.directory, f.env).status,
      0,
      JSON.stringify(patch),
    );
  }
  restore();
  fs.unlinkSync(proofPath);
  assert.notEqual(workflowPython(selectSource, f.directory, f.env).status, 0);
  restore();
  f.write(PROFILE.style, style.replace('34px', '49px'));
  assert.notEqual(
    workflowPython(selectSource, f.directory, f.env).status,
    0,
    'proof is invalidated by later source drift',
  );
});

function learningFixture(t) {
  const f = proofFixture(t);
  const head = f.base;
  const env = {
    SOURCE_SHA: head,
    SELECTION_RESULT: 'success',
    SELECTION_ROUTE: 'FULL',
    SELECTION_SHA: head,
    SELECTION_DIGEST: '',
    LEARNING_E1_BATCH_RESULT: 'success',
    GITHUB_RUN_ID: '881',
    GITHUB_RUN_ATTEMPT: '2',
  };
  const files = {};
  const receipts = {};
  for (const batch of ['first', 'second']) {
    files[batch] = path.join(
      f.directory,
      '.asa/learning-partitions',
      `learning-e1-${head}-${batch}`,
      'reports/playwright',
      `learning-partition-${batch}.json`,
    );
    fs.mkdirSync(path.dirname(files[batch]), { recursive: true });
    receipts[batch] = {
      source_sha: head,
      batch,
      status: 'PASS',
      code_data_result: 'success',
      browser_result: 'success',
      run_id: '881',
      run_attempt: batch === 'first' ? 1 : 2,
    };
  }
  const restore = () => {
    for (const batch of ['first', 'second'])
      fs.writeFileSync(files[batch], JSON.stringify(receipts[batch]));
  };
  restore();
  return { ...f, env, files, receipts, restore };
}

test('focused Learning aggregate requires real exact-source partitions while N/A stays with the selector', (t) => {
  const f = learningFixture(t);
  const full = workflowPython(aggregateSource, f.directory, f.env);
  assert.equal(full.status, 0, full.stderr);
  const result = JSON.parse(full.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.partitions_completed, 2);
  assert.equal(
    result.partitions.first.run_attempt,
    1,
    'same-run earlier successful partition keeps explicit provenance',
  );
  assert.equal(result.integration_ready, false);
  const none = workflowPython(aggregateSource, f.directory, {
    ...f.env,
    SELECTION_ROUTE: 'NOT_APPLICABLE',
    SELECTION_DIGEST: 'a'.repeat(64),
    LEARNING_E1_BATCH_RESULT: 'skipped',
  });
  assert.notEqual(none.status, 0, 'the test aggregate never fabricates PASS for a N/A route');
  for (const batch of ['first', 'second']) {
    const record = workflowPython(partitionSource, f.directory, {
      SOURCE_SHA: f.base,
      BATCH: batch,
      CODE_RESULT: 'success',
      BROWSER_RESULT: 'success',
      GITHUB_RUN_ID: '881',
      GITHUB_RUN_ATTEMPT: '2',
    });
    assert.equal(record.status, 0, record.stderr);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(f.directory, 'reports/playwright', `learning-partition-${batch}.json`),
          'utf8',
        ),
      ).batch,
      batch,
    );
  }
});

test('focused Learning aggregate rejects failed cancelled skipped missing and partial applicable partitions', (t) => {
  const f = learningFixture(t);
  for (const state of ['failure', 'cancelled', 'skipped', '', 'unknown']) {
    assert.notEqual(
      workflowPython(aggregateSource, f.directory, { ...f.env, LEARNING_E1_BATCH_RESULT: state })
        .status,
      0,
      state,
    );
  }
  for (const patch of [
    { status: 'CANCELLED' },
    { browser_result: 'skipped' },
    { code_data_result: 'failure' },
    { source_sha: 'f'.repeat(40) },
    { run_id: '882' },
    { run_attempt: 3 },
    { run_attempt: 0 },
    { batch: 'first' },
  ]) {
    f.restore();
    fs.writeFileSync(f.files.second, JSON.stringify({ ...f.receipts.second, ...patch }));
    assert.notEqual(
      workflowPython(aggregateSource, f.directory, f.env).status,
      0,
      JSON.stringify(patch),
    );
  }
  f.restore();
  fs.unlinkSync(f.files.second);
  assert.notEqual(
    workflowPython(aggregateSource, f.directory, f.env).status,
    0,
    'a single successful half is insufficient',
  );
  f.restore();
  const extra = path.join(path.dirname(f.files.second), 'learning-partition-duplicate.json');
  fs.writeFileSync(extra, JSON.stringify(f.receipts.second));
  assert.notEqual(
    workflowPython(aggregateSource, f.directory, f.env).status,
    0,
    'duplicated proofs cannot hide a missing half',
  );
  fs.unlinkSync(extra);
  for (const state of ['failure', 'cancelled', 'skipped', '']) {
    assert.notEqual(
      workflowPython(partitionSource, f.directory, {
        SOURCE_SHA: f.base,
        BATCH: 'second',
        CODE_RESULT: 'success',
        BROWSER_RESULT: state,
        GITHUB_RUN_ID: '881',
        GITHUB_RUN_ATTEMPT: '2',
      }).status,
      0,
      state,
    );
  }
});

test('focused Learning N/A requires a successful exact-source selector and actually skipped matrix', (t) => {
  const f = learningFixture(t);
  const env = {
    ...f.env,
    SELECTION_ROUTE: 'NOT_APPLICABLE',
    SELECTION_DIGEST: 'a'.repeat(64),
    LEARNING_E1_BATCH_RESULT: 'skipped',
  };
  for (const patch of [
    { SELECTION_RESULT: 'failure' },
    { SELECTION_RESULT: 'cancelled' },
    { SELECTION_RESULT: '' },
    { SELECTION_SHA: 'f'.repeat(40) },
    { SELECTION_ROUTE: '' },
    { SELECTION_ROUTE: 'unknown' },
    { SELECTION_DIGEST: '' },
    { LEARNING_E1_BATCH_RESULT: 'success' },
    { LEARNING_E1_BATCH_RESULT: 'failure' },
    { LEARNING_E1_BATCH_RESULT: 'cancelled' },
  ]) {
    assert.notEqual(
      workflowPython(aggregateSource, f.directory, { ...env, ...patch }).status,
      0,
      JSON.stringify(patch),
    );
  }
});
