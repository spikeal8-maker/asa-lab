import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { main } from './dev-check.mjs';
import { runPython } from './devex-python.mjs';

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
