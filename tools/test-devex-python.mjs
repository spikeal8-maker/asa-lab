import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { runPython } from './devex-python.mjs';

function fixture(t, responses) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asa bootstrap проба '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'script with spaces.py'), '');
  fs.writeFileSync(path.join(root, 'tools', 'requirements.txt'), 'PyYAML>=6.0,<7\n');
  const host = path.join(root, 'host python', 'python.exe');
  const calls = [],
    messages = [];
  const options = {
    root,
    python: host,
    tempRoot: root,
    env: {
      PATH: `preserved-node${path.delimiter}preserved-pnpm`,
      PIP_TARGET: 'unsafe-global',
      PIP_ROOT: 'unsafe-global-root',
      PIP_PYTHON: 'unsafe-other-interpreter',
      PYTHONPATH: 'host-site',
    },
    log: (message) => messages.push(message),
    spawn(command, args, options) {
      calls.push({ command, args, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, `unexpected subprocess: ${command} ${args.join(' ')}`);
      return { stdout: JSON.stringify(host), ...response };
    },
  };
  return { root, host, calls, messages, options };
}

const probe = (status = 0) => ({ status });

test('ready host runs the trusted script directly with verbatim argv and exit code', (t) => {
  const f = fixture(t, [
    probe(),
    { status: 0, stdout: JSON.stringify({ install: [] }) },
    { status: 17 },
  ]);
  const original = { ...f.options.env };
  assert.equal(
    runPython(['tools/script with spaces.py', '--output', 'результат with spaces.json'], f.options),
    17,
  );
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[1].args.includes('--dry-run'));
  assert.ok(f.calls[1].args.includes('--no-index'));
  const scriptCall = f.calls[2];
  assert.deepEqual(scriptCall.args, [
    path.join(f.root, 'tools', 'script with spaces.py'),
    '--output',
    'результат with spaces.json',
  ]);
  assert.equal(scriptCall.command, f.host);
  assert.equal(scriptCall.options.shell, false);
  assert.equal(scriptCall.options.cwd, f.root);
  assert.equal(scriptCall.options.env.PYTHON, f.host);
  assert.ok(scriptCall.options.env.PATH.endsWith(original.PATH));
  assert.deepEqual(f.options.env, original);
  assert.deepEqual(f.messages, []);
  assert.ok(!fs.readdirSync(f.root).some((name) => name.startsWith('asa-devex-python-')));
});

for (const platform of ['win32', 'linux']) {
  test(`missing YAML installs requirements only in owned ${platform} venv and cleans after test failure`, (t) => {
    const f = fixture(t, [probe(42), { status: 0 }, { status: 0 }, probe(), { status: 9 }]);
    const original = { ...f.options.env };
    assert.equal(runPython(['tools/script with spaces.py'], { ...f.options, platform }), 9);
    assert.equal(f.calls.length, 5);
    const owned = path.dirname(f.calls[1].args[2]);
    const venv = path.join(owned, 'venv');
    const selected = path.join(venv, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    assert.equal(path.dirname(owned), f.root);
    assert.deepEqual(f.calls[1].args, ['-m', 'venv', venv]);
    assert.equal(f.calls[2].command, selected);
    assert.deepEqual(f.calls[2].args.slice(-4), [
      '--prefix',
      venv,
      '-r',
      path.join(f.root, 'tools', 'requirements.txt'),
    ]);
    assert.ok(f.calls[2].args.includes('--require-virtualenv'));
    assert.ok(f.calls[2].args.includes('--no-cache-dir'));
    for (const call of f.calls.slice(2)) {
      assert.equal(call.options.shell, false);
      assert.equal(call.options.env.VIRTUAL_ENV, venv);
      assert.equal(call.options.env.ASA_PYTHON, selected);
      assert.equal(call.options.env.PYTHON, selected);
      assert.equal(call.options.env.PYTHONPATH, undefined);
      assert.equal(call.options.env.PYTHONUTF8, '1');
      assert.equal(call.options.env.PYTHONIOENCODING, 'utf-8');
      assert.equal(call.options.env.PIP_TARGET, undefined);
      assert.equal(call.options.env.PIP_ROOT, undefined);
      assert.equal(call.options.env.PIP_PYTHON, undefined);
      assert.equal(call.options.env.PIP_CONFIG_FILE, platform === 'win32' ? 'nul' : '/dev/null');
      assert.equal(
        call.options.env.PATH,
        `${path.dirname(selected)}${platform === 'win32' ? ';' : ':'}${original.PATH}`,
      );
    }
    assert.equal(f.calls[4].command, selected);
    assert.deepEqual(f.options.env, original);
    assert.ok(!fs.existsSync(owned));
    assert.ok(fs.existsSync(path.join(f.root, 'tools', 'requirements.txt')));
  });
}

for (const checked of [
  { status: 1, stderr: 'missing or old pip / unmet requirements' },
  { status: 0, stdout: JSON.stringify({ install: [{ metadata: { name: 'PyYAML' } }] }) },
  { status: 0, stdout: 'unrecognized old pip output' },
]) {
  test(`unproven host requirements use isolation: ${checked.stderr || checked.stdout}`, (t) => {
    const f = fixture(t, [probe(), checked, { status: 0 }, { status: 0 }, probe(), { status: 0 }]);
    assert.equal(runPython(['tools/script with spaces.py'], f.options), 0);
    assert.equal(f.calls.length, 6);
    assert.deepEqual(f.calls[2].args.slice(0, 2), ['-m', 'venv']);
    assert.ok(!fs.existsSync(path.dirname(f.calls[2].args[2])));
  });
}

for (const [name, responses] of [
  ['venv failure', [probe(42), { status: 1 }]],
  ['pip failure', [probe(42), { status: 0 }, { status: 2 }]],
  ['prepared import failure', [probe(42), { status: 0 }, { status: 0 }, { status: 1 }]],
  ['process launch error', [probe(42), new Error('cannot start venv process')]],
  [
    'test launch error',
    [probe(42), { status: 0 }, { status: 0 }, probe(), new Error('cannot start test')],
  ],
]) {
  test(`${name} fails closed and removes only its owned temporary directory`, (t) => {
    const f = fixture(t, responses);
    assert.equal(runPython(['tools/script with spaces.py'], f.options), 78);
    assert.ok(f.messages.some((message) => message.includes('BLOCKED')));
    assert.ok(!fs.readdirSync(f.root).some((entry) => entry.startsWith('asa-devex-python-')));
    assert.ok(fs.existsSync(path.join(f.root, 'tools', 'requirements.txt')));
  });
}

for (const response of [
  new Error('missing Python'),
  { status: null, signal: 'SIGTERM' },
  { status: 1, stderr: 'broken YAML installation' },
]) {
  test(`host probe failure does not run a script or install dependencies: ${response.message || response.signal || response.stderr}`, (t) => {
    const f = fixture(t, [response]);
    assert.equal(runPython(['tools/script with spaces.py'], f.options), 78);
    assert.equal(f.calls.length, 1);
    assert.ok(!fs.readdirSync(f.root).some((entry) => entry.startsWith('asa-devex-python-')));
  });
}

test('cleanup failure cannot turn a successful test into PASS', (t) => {
  const f = fixture(t, [probe(42), { status: 0 }, { status: 0 }, probe(), { status: 0 }]);
  assert.equal(
    runPython(['tools/script with spaces.py'], {
      ...f.options,
      removeTemp() {
        throw new Error('cleanup denied');
      },
    }),
    78,
  );
  assert.ok(f.messages.some((message) => message.includes('cleanup failed')));
});

test('unexpected temporary target is neither used nor recursively deleted', (t) => {
  const f = fixture(t, [probe(42)]);
  let removed = false;
  assert.equal(
    runPython(['tools/script with spaces.py'], {
      ...f.options,
      makeTemp: () => f.root,
      removeTemp: () => {
        removed = true;
      },
    }),
    78,
  );
  assert.equal(removed, false);
  assert.equal(f.calls.length, 1);
  assert.ok(fs.existsSync(f.root));
});

test('Python flags and scripts outside trusted tools are rejected before process launch', (t) => {
  const f = fixture(t, []);
  fs.writeFileSync(path.join(f.root, 'outside.py'), '');
  for (const args of [[], ['-c', 'print(1)'], ['outside.py']])
    assert.equal(runPython(args, f.options), 78);
  assert.equal(f.calls.length, 0);
});

test('actual Python and nested Python emit Unicode JSON through Windows-compatible pipes', (t) => {
  const f = fixture(t, []);
  const discovered = spawnSync(
    process.env.ASA_PYTHON || process.env.PYTHON || 'python',
    ['-c', 'import json,sys; print(json.dumps(sys.executable))'],
    { encoding: 'utf8', shell: false, windowsHide: true },
  );
  assert.equal(discovered.status, 0, discovered.stderr);
  const executable = JSON.parse(discovered.stdout);
  fs.writeFileSync(
    path.join(f.root, 'tools', 'script with spaces.py'),
    `import json,subprocess,sys
payload = subprocess.check_output(['python', '-c', "import json; print(json.dumps({'value':'проба'}, ensure_ascii=False))"], text=True, encoding='utf-8')
print(json.dumps({'value':'проба', 'nested':json.loads(payload)['value'], 'executable':sys.executable}, ensure_ascii=False))
`,
  );
  let step = 0;
  let output;
  const spawn = (command, args, options) => {
    step += 1;
    if (step === 1) return { status: 0, stdout: JSON.stringify(executable) };
    if (step === 2) return { status: 0, stdout: JSON.stringify({ install: [] }) };
    const result = spawnSync(command, args, { ...options, stdio: 'pipe' });
    output = result.stdout;
    return result;
  };
  assert.equal(
    runPython(['tools/script with spaces.py'], { ...f.options, env: process.env, spawn }),
    0,
  );
  assert.deepEqual(JSON.parse(output), { value: 'проба', nested: 'проба', executable });
});

test('Windows mixed-case controlled variables are removed before probes/setup and uniquely overwritten', (t) => {
  const f = fixture(t, [probe(42), { status: 0 }, { status: 0 }, probe(), { status: 0 }]);
  const env = {
    path: 'node-and-pnpm-path',
    asa_python: f.host,
    pYtHoN: f.host,
    virtual_env: 'stale-venv',
    pythonhome: 'foreign-home',
    PyThOnPaTh: 'foreign-imports',
    pythonuserbase: 'foreign-user-base',
    pythonnousersite: '0',
    pythonutf8: '0',
    pythonioencoding: 'ascii',
    pip_root: 'outside-root',
    PiP_TaRgEt: 'outside-target',
    pip_prefix: 'outside-prefix',
    pip_user: 'true',
    pip_python: 'other-python',
    pip_config_file: 'foreign-pip.ini',
    PIP_INDEX_URL: 'https://normal-index.invalid/simple',
    publicName: 'kept',
  };
  const original = { ...env };
  assert.equal(
    runPython(['tools/script with spaces.py'], {
      ...f.options,
      env,
      python: undefined,
      platform: 'win32',
    }),
    0,
  );
  assert.equal(f.calls[0].command, f.host);
  for (const { options } of f.calls) {
    const keys = Object.keys(options.env);
    assert.equal(new Set(keys.map((key) => key.toUpperCase())).size, keys.length);
    assert.ok(keys.every((key) => key === key.toUpperCase()));
    for (const key of [
      'PYTHONHOME',
      'PYTHONPATH',
      'PYTHONUSERBASE',
      'PIP_ROOT',
      'PIP_TARGET',
      'PIP_PREFIX',
      'PIP_USER',
      'PIP_PYTHON',
    ])
      assert.equal(options.env[key], undefined, key);
    assert.equal(options.env.PIP_CONFIG_FILE, 'nul');
    assert.equal(options.env.PYTHONUTF8, '1');
    assert.equal(options.env.PYTHONIOENCODING, 'utf-8');
    assert.equal(options.env.PIP_INDEX_URL, original.PIP_INDEX_URL);
    assert.equal(options.env.PUBLICNAME, 'kept');
    assert.notEqual(options.env.VIRTUAL_ENV, 'stale-venv');
  }
  assert.deepEqual(env, original);
});

test('Windows differing-value case collisions fail closed before any subprocess', (t) => {
  for (const key of [
    'PATH',
    'ASA_PYTHON',
    'PYTHON',
    'VIRTUAL_ENV',
    'PIP_ROOT',
    'PIP_CONFIG_FILE',
    'PYTHONHOME',
    'PYTHONPATH',
    'PYTHONUTF8',
    'PYTHONIOENCODING',
    'TEMP',
  ]) {
    const f = fixture(t, []);
    const env = {
      PATH: 'runtime',
      [key]: 'first-private-value',
      [key.toLowerCase()]: 'second-private-value',
    };
    assert.equal(
      runPython(['tools/script with spaces.py'], { ...f.options, env, platform: 'win32' }),
      78,
      key,
    );
    assert.equal(f.calls.length, 0, key);
    assert.ok(
      f.messages.some((message) =>
        message.includes(`ambiguous Windows environment variable: ${key}`),
      ),
    );
    assert.ok(f.messages.every((message) => !message.includes('private-value')));
  }
});

test('Windows equal-value aliases collapse before canonical overrides', (t) => {
  const f = fixture(t, [
    probe(),
    { status: 0, stdout: JSON.stringify({ install: [] }) },
    { status: 0 },
  ]);
  const env = {
    PATH: 'runtime',
    Path: 'runtime',
    ASA_PYTHON: f.host,
    asa_python: f.host,
    PIP_ROOT: 'unsafe',
    pip_root: 'unsafe',
    PYTHONUTF8: '0',
    pythonutf8: '0',
  };
  assert.equal(
    runPython(['tools/script with spaces.py'], { ...f.options, env, platform: 'win32' }),
    0,
  );
  for (const { options } of f.calls) {
    assert.equal(options.env.PIP_ROOT, undefined);
    assert.equal(options.env.pip_root, undefined);
    assert.equal(options.env.PYTHONUTF8, '1');
    assert.equal(options.env.pythonutf8, undefined);
    assert.equal(options.env.Path, undefined);
  }
});

test('POSIX preserves actual PATH and public case-sensitive variables while denying controlled aliases', (t) => {
  const f = fixture(t, [
    probe(),
    { status: 0, stdout: JSON.stringify({ install: [] }) },
    { status: 0 },
  ]);
  const env = {
    PATH: '/usr/bin:/node-and-pnpm',
    Path: 'public-path-value',
    pAtH: 'another-public-value',
    publicName: 'one',
    PUBLICNAME: 'two',
    ASA_PYTHON: f.host,
    asa_python: 'unselected-command',
    pip_root: 'outside-root',
    PiP_Config_File: 'foreign-pip.conf',
    PYTHONUTF8: '0',
    pythonutf8: 'different',
  };
  assert.equal(
    runPython(['tools/script with spaces.py'], {
      ...f.options,
      env,
      python: undefined,
      platform: 'linux',
    }),
    0,
  );
  assert.equal(f.calls[0].command, f.host);
  for (const { options } of f.calls) {
    assert.equal(options.env.Path, env.Path);
    assert.equal(options.env.pAtH, env.pAtH);
    assert.equal(options.env.publicName, 'one');
    assert.equal(options.env.PUBLICNAME, 'two');
    assert.ok(options.env.PATH.endsWith(env.PATH));
    assert.equal(options.env.asa_python, undefined);
    assert.equal(options.env.pip_root, undefined);
    assert.equal(options.env.PiP_Config_File, undefined);
    assert.equal(options.env.PIP_CONFIG_FILE, '/dev/null');
    assert.equal(options.env.PYTHONUTF8, '1');
    assert.equal(options.env.pythonutf8, undefined);
  }
});
