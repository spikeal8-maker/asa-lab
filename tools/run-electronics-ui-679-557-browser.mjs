import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const expectedCases = Object.freeze([
  ...['mouse', 'touch'].map((input) => ({
    file: 'electronics-interactions.spec.ts',
    suites: ['interaction: natural precise wire routing', 'F2 real persistence'],
    title: `F2 SVG layering: native ${input} wires above breadboard/Uno/PSU and below battery/LED/resistor/terminals`,
  })),
  ...[1440, 1024, 390, 320].map((width) => ({
    file: 'electronics-simulation-time.spec.ts',
    suites: [],
    title: `integer simulation time: real DC Run Stop save reopen at ${width}px`,
  })),
]);
const files = [...new Set(expectedCases.map(({ file }) => `e2e/${file}`))];
const key = ({ file, suites, title }) => JSON.stringify([file, suites, title]);
const expectedKeys = new Set(expectedCases.map(key));
const fail = (message) => {
  throw new Error(`Scoped Electronics qualification: ${message}`);
};

export function casesFromReport(report) {
  if (!Array.isArray(report.suites) || (report.errors?.length ?? 0) !== 0) {
    fail('missing suites or report-level errors');
  }
  const cases = [];
  function visit(suite, parents = []) {
    // The public JSON reporter's outer suite is the file, not a describe block.
    const suites = parents.length ? parents.slice(1) : [];
    for (const spec of suite.specs ?? []) {
      cases.push({
        file: spec.file,
        suites: [...suites, ...(parents.length ? [suite.title] : [])],
        title: spec.title,
        spec,
      });
    }
    for (const child of suite.suites ?? []) visit(child, [...parents, suite.title]);
  }
  for (const suite of report.suites) visit(suite);
  return cases;
}

export function validateReport(report, execution = false, selectedOnly = true) {
  const cases = casesFromReport(report);
  const selected = cases.filter((entry) => expectedKeys.has(key(entry)));
  if (selected.length !== 6 || (selectedOnly && cases.length !== 6))
    fail('exactly six selected cases required');
  const seen = new Set();
  for (const entry of selected) {
    const identity = key(entry);
    if (seen.has(identity)) fail('duplicate case identity');
    seen.add(identity);
    const tests = entry.spec.tests;
    if (!Array.isArray(tests) || tests.length !== 1)
      fail('exactly one project/attempt identity required');
    const test = tests[0];
    if (
      test.expectedStatus !== 'passed' ||
      (test.annotations ?? []).some(({ type }) => ['skip', 'fixme', 'fail'].includes(type))
    ) {
      fail('skipped or expected-failure case');
    }
    if (
      execution &&
      (test.status !== 'expected' ||
        test.results?.length !== 1 ||
        test.results[0].status !== 'passed' ||
        test.results[0].retry !== 0)
    ) {
      fail('each case must pass on its only attempt');
    }
  }
  if (
    execution &&
    (report.stats?.expected !== 6 ||
      report.stats?.unexpected !== 0 ||
      report.stats?.flaky !== 0 ||
      report.stats?.skipped !== 0)
  ) {
    fail('execution totals must be six passed and zero other outcomes');
  }
  return selected;
}

export function selectorFor(cases) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the full leaf title at the end; discovery separately freezes file and describe identities.
  return `(?:${cases.map(({ title }) => escape(title)).join('|')})$`;
}

export function runQualification() {
  if (process.argv.length !== 2) fail('no filters or extra arguments accepted');
  if (process.env.npm_lifecycle_event !== 'gate:electronics-ui-679-557:browser')
    fail('invoke the registered pnpm gate');
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli || !isAbsolute(pnpmCli)) fail('absolute pnpm npm_execpath required');
  if (
    process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE &&
    process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE !== 'strict-real-time'
  ) {
    fail('this scoped gate preserves strict product/test semantics');
  }
  if (process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT)
    fail('alternate qualification entrypoint forbidden');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = resolve(root, 'reports/electronics-ui-679-557');
  mkdirSync(directory, { recursive: true });
  const invoke = (args, env = process.env, stdio = 'pipe') =>
    spawnSync(process.execPath, [pnpmCli, 'exec', 'playwright', 'test', ...files, ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio,
      maxBuffer: 32 * 1024 * 1024,
    });
  const discover = (suffix, args = []) => {
    const child = invoke(['--list', '--reporter=json', ...args]);
    writeFileSync(resolve(directory, `${suffix}.json`), child.stdout ?? '');
    if (child.error || child.status !== 0)
      fail(`discovery failed: ${child.error?.message ?? child.stderr}`);
    return JSON.parse(child.stdout);
  };
  const all = validateReport(discover('discovery-all'), false, false);
  const grep = selectorFor(all);
  validateReport(discover('discovery-six', ['--grep', grep]));
  const resultPath = resolve(directory, 'execution.json');
  const child = invoke(
    ['--grep', grep, '--retries=0', '--reporter=list,json'],
    {
      ...process.env,
      PLAYWRIGHT_JSON_OUTPUT_FILE: resultPath,
    },
    'inherit',
  );
  let failure;
  try {
    if (child.error || child.status !== 0)
      fail(`browser process failed: ${child.error?.message ?? child.status}`);
    validateReport(JSON.parse(readFileSync(resultPath, 'utf8')), true);
  } catch (error) {
    failure = error;
  }
  writeFileSync(
    resolve(directory, 'qualification.json'),
    `${JSON.stringify(
      {
        scope: 'electronics-ui-679-557-six-cases',
        fullElectronicsQualification: false,
        expectedSourceSha: process.env.ASA_ELECTRONICS_EXPECTED_SHA ?? null,
        cases: expectedCases,
        conclusion: failure ? 'FAIL_OR_INCOMPLETE' : 'PASS',
        error: failure?.message ?? null,
      },
      null,
      2,
    )}\n`,
  );
  if (failure) throw failure;
  console.log(
    'Scoped Electronics 679/557 qualification: six cases PASS; full Electronics suite NOT_RUN by this command.',
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runQualification();
