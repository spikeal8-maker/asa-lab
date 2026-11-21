#!/usr/bin/env node
// Run an explicitly named, trusted repository Python tool with validator dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MISSING_YAML = 42;
const PROBE = `import importlib.util, json, sys
print(json.dumps(sys.executable), flush=True)
if importlib.util.find_spec('yaml') is None:
    sys.exit(${MISSING_YAML})
import yaml
`;

const CONTROLLED = new Set([
  'ASA_PYTHON',
  'PYTHON',
  'VIRTUAL_ENV',
  'PYTHONHOME',
  'PYTHONPATH',
  'PYTHONUSERBASE',
  'PYTHONNOUSERSITE',
  'PYTHONUTF8',
  'PYTHONIOENCODING',
  'PIP_TARGET',
  'PIP_PREFIX',
  'PIP_USER',
  'PIP_ROOT',
  'PIP_PYTHON',
  'PIP_CONFIG_FILE',
]);

function normalizedEnvironment(env, platform) {
  const child = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // Windows child processes compare keys without regard to case. Resolve
    // aliases before Node can choose one by alphabetic order. Conflicting
    // aliases are ambiguous and fail before any subprocess or installation.
    const canonical = platform === 'win32' ? key.toUpperCase() : key;
    if (Object.hasOwn(child, canonical) && child[canonical] !== value)
      throw new Error(`ambiguous Windows environment variable: ${canonical}`);
    child[canonical] = value;
  }
  return child;
}

function removeControlled(env) {
  for (const key of Object.keys(env)) if (CONTROLLED.has(key.toUpperCase())) delete env[key];
}

function interpreterEnvironment(env, executable, platform, venv, temporary) {
  const child = { ...env };
  // Windows keys are already canonical; POSIX Path/path remain public variables,
  // distinct from the real PATH. Never pick them as a replacement for PATH.
  child.PATH = [path.dirname(executable), child.PATH]
    .filter(Boolean)
    .join(platform === 'win32' ? ';' : ':');
  child.ASA_PYTHON = executable;
  child.PYTHON = executable;
  if (venv) {
    Object.assign(child, {
      VIRTUAL_ENV: venv,
      PYTHONNOUSERSITE: '1',
      TEMP: temporary,
      TMP: temporary,
      TMPDIR: temporary,
    });
  }
  return child;
}

export function runPython(
  args,
  {
    root = ROOT,
    env = process.env,
    python,
    platform = process.platform,
    spawn = spawnSync,
    tempRoot = os.tmpdir(),
    makeTemp = fs.mkdtempSync,
    removeTemp = fs.rmSync,
    log = console.error,
  } = {},
) {
  let owned;
  let ownedVerified = false;
  let code = 78;
  const temporaryRoot = path.resolve(tempRoot);
  const verifyOwned = () => {
    if (
      path.dirname(owned) !== temporaryRoot ||
      !path.basename(owned).startsWith('asa-devex-python-')
    )
      throw new Error('temporary directory is outside the owned bootstrap namespace');
  };
  try {
    const scopedEnv = normalizedEnvironment(env, platform);
    const selectedCommand = python || scopedEnv.ASA_PYTHON || scopedEnv.PYTHON || 'python';
    // Remove all case variants before the first probe/setup, then write each
    // controlled setting once. Normal index/proxy/public environment is retained.
    removeControlled(scopedEnv);
    Object.assign(scopedEnv, {
      ASA_PYTHON: selectedCommand,
      PYTHON: selectedCommand,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      // pip compares this with Python's os.devnull to disable ALL config files.
      PIP_CONFIG_FILE: platform === 'win32' ? 'nul' : '/dev/null',
    });
    const repository = fs.realpathSync(root);
    const tools = path.join(repository, 'tools') + path.sep;
    const script = fs.realpathSync(path.resolve(repository, args[0] || ''));
    const requirements = fs.realpathSync(path.join(repository, 'tools/requirements.txt'));
    if (
      !script.startsWith(tools) ||
      path.extname(script) !== '.py' ||
      !requirements.startsWith(tools) ||
      !fs.statSync(script).isFile()
    )
      throw new Error('expected an explicit trusted tools/*.py script and repository requirements');
    const invoke = (command, argv, childEnv, capture = false) => {
      const result = spawn(command, argv, {
        cwd: repository,
        env: childEnv,
        shell: false,
        windowsHide: true,
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        encoding: 'utf8',
      });
      if (result.error) throw result.error;
      if (!Number.isInteger(result.status) || result.status < 0)
        throw new Error(
          `Python subprocess terminated without an exit code (${result.signal || 'unknown'})`,
        );
      return result;
    };
    const requireSuccess = (result, stage) => {
      if (result.status !== 0)
        throw new Error(
          `${stage} exited ${result.status}${result.stderr ? `: ${result.stderr.trim()}` : ''}`,
        );
    };
    const probe = invoke(selectedCommand, ['-c', PROBE], scopedEnv, true);
    if (![0, MISSING_YAML].includes(probe.status)) requireSuccess(probe, 'host dependency probe');
    const executable = JSON.parse(probe.stdout.trim());
    if (typeof executable !== 'string' || !path.isAbsolute(executable))
      throw new Error('Python probe did not identify its executable');
    let selected = executable;
    const hostEnv = interpreterEnvironment(scopedEnv, executable, platform);
    let childEnv = hostEnv;
    let requirementsSatisfied = false;
    if (probe.status === 0) {
      // Ask pip to interpret the existing requirements without installation,
      // downloads, cache writes or a second maintained version constraint.
      const checked = invoke(
        executable,
        [
          '-m',
          'pip',
          'install',
          '--dry-run',
          '--no-index',
          '--no-cache-dir',
          '--disable-pip-version-check',
          '--no-input',
          '--quiet',
          '--report',
          '-',
          '-r',
          requirements,
        ],
        hostEnv,
        true,
      );
      if (checked.status === 0) {
        try {
          const report = JSON.parse(checked.stdout);
          requirementsSatisfied = Array.isArray(report.install) && report.install.length === 0;
        } catch {
          /* An unavailable/old pip or unproven environment needs isolation. */
        }
      }
    }
    if (!requirementsSatisfied) {
      owned = path.resolve(makeTemp(path.join(temporaryRoot, 'asa-devex-python-')));
      verifyOwned();
      ownedVerified = true;
      const venv = path.join(owned, 'venv');
      log(`DEVEX Python: preparing isolated validator environment in ${owned}`);
      requireSuccess(invoke(executable, ['-m', 'venv', venv], hostEnv), 'temporary venv setup');
      selected = path.join(venv, platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      childEnv = interpreterEnvironment(scopedEnv, selected, platform, venv, owned);
      requireSuccess(
        invoke(
          selected,
          [
            '-m',
            'pip',
            'install',
            '--disable-pip-version-check',
            '--no-input',
            '--no-cache-dir',
            '--require-virtualenv',
            '--prefix',
            venv,
            '-r',
            requirements,
          ],
          childEnv,
        ),
        'validator dependency installation',
      );
      requireSuccess(invoke(selected, ['-c', PROBE], childEnv, true), 'prepared dependency probe');
    }
    code = invoke(selected, [script, ...args.slice(1)], childEnv).status;
  } catch (error) {
    log(`DEVEX Python: BLOCKED: ${error.message}`);
  } finally {
    if (ownedVerified) {
      try {
        verifyOwned();
        removeTemp(owned, { recursive: true, force: true });
      } catch (error) {
        log(`DEVEX Python: BLOCKED: temporary cleanup failed: ${error.message}`);
        if (code === 0) code = 78;
      }
    }
  }
  return code;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runPython(process.argv.slice(2));
