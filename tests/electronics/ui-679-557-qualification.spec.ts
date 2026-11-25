import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type ReporterCase = {
  file: string;
  title: string;
  tests: {
    expectedStatus: string;
    annotations: { type: string }[];
    status: string;
    results: { status: string; retry: number }[];
  }[];
};
type ReporterSuite = { title: string; specs: ReporterCase[]; suites: ReporterSuite[] };
type ReporterReport = {
  suites: ReporterSuite[];
  errors: { message: string }[];
  stats: { expected: number; unexpected: number; flaky: number; skipped: number };
};
type Challenge = [string, (value: ReporterReport) => unknown];
import {
  casesFromReport,
  expectedCases,
  selectorFor,
  validateReport,
} from '../../tools/run-electronics-ui-679-557-browser.mjs';

function report(execution = false): ReporterReport {
  const suites = expectedCases.map(({ file, suites, title }) => {
    const spec: ReporterCase = {
      file,
      title,
      tests: [
        {
          expectedStatus: 'passed',
          annotations: [],
          status: execution ? 'expected' : 'skipped',
          results: execution ? [{ status: 'passed', retry: 0 }] : [],
        },
      ],
    };
    let nested: ReporterSuite = { title: suites.at(-1) ?? file, specs: [spec], suites: [] };
    for (const name of suites.slice(0, -1).reverse())
      nested = { title: name, specs: [], suites: [nested] };
    return suites.length ? { title: file, suites: [nested], specs: [] } : nested;
  });
  return { suites, errors: [], stats: { expected: 6, unexpected: 0, flaky: 0, skipped: 0 } };
}

describe('scoped six-case discovery and actual result fences', () => {
  it('accepts normal public discovery, including its unexecuted skipped status', () => {
    expect(validateReport(report())).toHaveLength(6);
    expect(validateReport(report(true), true)).toHaveLength(6);
    const selected = validateReport(report());
    const selector = new RegExp(selectorFor(selected));
    for (const entry of selected)
      expect(selector.test(`${entry.file} ${entry.suites.join(' ')} ${entry.title}`)).toBe(true);
    expect(selector.test(`${selected[0].title} changed`)).toBe(false);
  });

  for (const [name, mutate] of [
    ['missing', (value) => value.suites.pop()],
    [
      'duplicate',
      (value) => {
        value.suites[1] = structuredClone(value.suites[0]);
      },
    ],
    ['additional', (value) => value.suites.push(structuredClone(value.suites[0]))],
    ['report error', (value) => value.errors.push({ message: 'incomplete' })],
    [
      'renamed describe',
      (value) => {
        value.suites[0].suites[0].title = 'other';
      },
    ],
    [
      'wrong file',
      (value) => {
        casesFromReport(value)[0].spec.file = 'other.spec.ts';
      },
    ],
    [
      'skipped',
      (value) => {
        casesFromReport(value)[0].spec.tests[0].expectedStatus = 'skipped';
      },
    ],
    [
      'fixme',
      (value) => casesFromReport(value)[0].spec.tests[0].annotations.push({ type: 'fixme' }),
    ],
    [
      'expected failure',
      (value) => {
        casesFromReport(value)[0].spec.tests[0].expectedStatus = 'failed';
      },
    ],
    [
      'second project',
      (value) =>
        casesFromReport(value)[0].spec.tests.push(
          structuredClone(casesFromReport(value)[0].spec.tests[0]),
        ),
    ],
  ] as Challenge[]) {
    it(`rejects ${name} discovery`, () => {
      const value = report();
      mutate(value);
      expect(() => validateReport(value)).toThrow();
    });
  }

  for (const [name, mutate] of [
    [
      'failed',
      (value) => {
        casesFromReport(value)[0].spec.tests[0].results[0].status = 'failed';
      },
    ],
    [
      'timed out',
      (value) => {
        casesFromReport(value)[0].spec.tests[0].results[0].status = 'timedOut';
      },
    ],
    [
      'no attempt',
      (value) => {
        casesFromReport(value)[0].spec.tests[0].results = [];
      },
    ],
    [
      'extra attempt',
      (value) =>
        casesFromReport(value)[0].spec.tests[0].results.push({ status: 'passed', retry: 1 }),
    ],
    [
      'retried once',
      (value) => {
        casesFromReport(value)[0].spec.tests[0].results[0].retry = 1;
      },
    ],
    [
      'flaky',
      (value) => {
        value.stats.flaky = 1;
      },
    ],
    [
      'runtime skipped',
      (value) => {
        value.stats.skipped = 1;
      },
    ],
    [
      'wrong total',
      (value) => {
        value.stats.expected = 5;
      },
    ],
  ] as Challenge[]) {
    it(`rejects ${name} execution`, () => {
      const value = report(true);
      mutate(value);
      expect(() => validateReport(value, true)).toThrow();
    });
  }
});

type BrowserStep = {
  name?: string;
  run?: string;
  with?: Record<string, unknown>;
  [key: string]: unknown;
};
type BrowserJob = {
  env: Record<string, unknown>;
  steps: BrowserStep[];
  [key: string]: unknown;
};
const failureReportFlag = 'ASA_ELECTRONICS_FAILURE_REPORT';
const focusedGateName = 'Selected Electronics browser qualification';
const originalForwarding = '-e ASA_ELECTRONICS_QUALIFICATION_PROFILE test-runner';
const diagnosticForwarding = `-e ASA_ELECTRONICS_QUALIFICATION_PROFILE -e ${failureReportFlag} test-runner`;
const failureUpload = {
  name: 'Upload incremental browser failure evidence',
  if: 'always()',
  uses: 'actions/upload-artifact@v4',
  with: {
    name: 'electronics-r4-m1-failures-${{ github.run_id }}-${{ github.run_attempt }}',
    path: 'reports/electronics-failures.ndjson',
    'if-no-files-found': 'error',
    'retention-days': 14,
  },
};

function withoutFocusedFailureEvidence<T extends BrowserJob>(original: T): T {
  const browser = structuredClone(original);
  const forwarding = browser.steps.filter((step) => step.run?.includes(failureReportFlag));
  const uploads = browser.steps.filter(
    (step) =>
      step.name === failureUpload.name ||
      step.with?.['name'] === failureUpload.with.name ||
      step.with?.['path'] === failureUpload.with.path,
  );
  if (!Object.hasOwn(browser.env, failureReportFlag) && !forwarding.length && !uploads.length)
    return browser;

  // The full workflow owns this exact optional journal. Validate all three
  // additions before projecting them out of the unchanged scoped-job comparison.
  expect(browser.env[failureReportFlag]).toBe('true');
  expect(uploads).toEqual([failureUpload]);
  expect(forwarding).toHaveLength(1);
  const gate = forwarding[0]!;
  expect(gate.name).toBe(focusedGateName);
  expect(gate.run!.split(failureReportFlag)).toHaveLength(2);
  expect(gate.run).toContain(diagnosticForwarding);
  const archive = browser.steps.filter((step) => step.name === 'Upload browser evidence');
  expect(archive).toHaveLength(1);
  expect(browser.steps.indexOf(uploads[0]!)).toBeGreaterThan(browser.steps.indexOf(gate));
  expect(browser.steps.indexOf(uploads[0]!)).toBeLessThan(browser.steps.indexOf(archive[0]!));

  delete browser.env[failureReportFlag];
  gate.run = gate.run!.replace(diagnosticForwarding, originalForwarding);
  browser.steps = browser.steps.filter((step) => step !== uploads[0]);
  return browser;
}

describe('focused diagnostic compatibility projection', () => {
  function fixture(diagnostics = false): BrowserJob {
    const browser: BrowserJob = parse(
      readFileSync('.github/workflows/electronics-ui-679-557.yml', 'utf8'),
    ).jobs.browser;
    const gate = browser.steps.find(
      (step) => step.name === 'Six existing native cases, unchanged assertions',
    )!;
    gate.name = focusedGateName;
    if (diagnostics) {
      expect(gate.run).toContain(originalForwarding);
      browser.env[failureReportFlag] = 'true';
      gate.run = gate.run!.replace(originalForwarding, diagnosticForwarding);
      const archive = browser.steps.findIndex((step) => step.name === 'Upload browser evidence');
      expect(archive).toBeGreaterThan(-1);
      browser.steps.splice(archive, 0, structuredClone(failureUpload));
    }
    return browser;
  }
  const gate = (job: BrowserJob) => job.steps.find((step) => step.name === focusedGateName)!;
  const upload = (job: BrowserJob) => job.steps.find((step) => step.name === failureUpload.name)!;

  it('preserves the complete pre-diagnostic job without mutating its input', () => {
    const original = fixture();
    const before = structuredClone(original);
    const projected = withoutFocusedFailureEvidence(original);
    expect(projected).toEqual(before);
    expect(projected).not.toBe(original);
    expect(original).toEqual(before);
  });

  it('removes exactly the complete diagnostic addition and preserves the input', () => {
    const original = fixture(true);
    const before = structuredClone(original);
    expect(withoutFocusedFailureEvidence(original)).toEqual(fixture());
    expect(original).toEqual(before);
  });

  for (const [name, mutate] of [
    ['missing flag', (job) => delete job.env[failureReportFlag]],
    ['disabled flag', (job) => (job.env[failureReportFlag] = 'false')],
    ['non-string flag', (job) => (job.env[failureReportFlag] = true)],
    [
      'missing forwarding',
      (job) => (gate(job).run = gate(job).run!.replace(diagnosticForwarding, originalForwarding)),
    ],
    [
      'duplicate forwarding',
      (job) =>
        (gate(job).run = gate(job).run!.replace(
          ` -e ${failureReportFlag}`,
          ` -e ${failureReportFlag} -e ${failureReportFlag}`,
        )),
    ],
    ['wrong forwarding step', (job) => (gate(job).name = 'Unrelated command')],
    ['missing upload', (job) => job.steps.splice(job.steps.indexOf(upload(job)), 1)],
    ['duplicate upload', (job) => job.steps.push(structuredClone(upload(job)))],
    ['conditional upload', (job) => (upload(job).if = 'failure()')],
    ['ignored upload error', (job) => (upload(job)['continue-on-error'] = true)],
    ['missing evidence ignored', (job) => (upload(job).with!['if-no-files-found'] = 'ignore')],
    ['unbounded artifact path', (job) => (upload(job).with!['path'] = 'reports')],
    ['changed retention', (job) => (upload(job).with!['retention-days'] = 1)],
    [
      'upload before the gate',
      (job) => job.steps.unshift(job.steps.splice(job.steps.indexOf(upload(job)), 1)[0]!),
    ],
    [
      'upload after the large archive',
      (job) => job.steps.push(job.steps.splice(job.steps.indexOf(upload(job)), 1)[0]!),
    ],
  ] as [string, (job: BrowserJob) => unknown][]) {
    it(`rejects ${name} instead of hiding a partial or changed addition`, () => {
      const original = fixture(true);
      mutate(original);
      expect(() => withoutFocusedFailureEvidence(original)).toThrow();
    });
  }

  for (const [name, mutate] of [
    ['timeout', (job) => (job['timeout-minutes'] = 49)],
    ['unrelated environment', (job) => (job.env['UNREVIEWED_SETTING'] = 'true')],
    ['gate failure handling', (job) => (gate(job).run += ' || true')],
    ['unrelated step', (job) => job.steps.push({ run: 'true' })],
  ] as [string, (job: BrowserJob) => unknown][]) {
    it(`retains changed ${name} for the full scoped-job equality check`, () => {
      const original = fixture(true);
      const expected = fixture();
      mutate(original);
      mutate(expected);
      const projected = withoutFocusedFailureEvidence(original);
      expect(projected).toEqual(expected);
      expect(projected).not.toEqual(fixture());
    });
  }
});

const shardMatrix = `\${{ fromJSON(
    (inputs.qualification_profile == 'classroom-d13-v2' ||
    inputs.qualification_profile == 'classroom-d13-v3' ||
    inputs.qualification_profile == 'arduino-editor-error') &&
    '[{"label":"whole","shard":""}]' ||
    '[{"label":"s1","shard":"1/4"},{"label":"s2","shard":"2/4"},{"label":"s3","shard":"3/4"},{"label":"s4","shard":"4/4"},{"label":"arduino-realtime","shard":""}]'
  ) }}`;
const shardSuffix = '-${{ matrix.browser_case.label }}';
const shardCli =
  ' ${ASA_ELECTRONICS_BROWSER_SHARD:+--shard=$ASA_ELECTRONICS_BROWSER_SHARD}' +
  ' ${ASA_ELECTRONICS_BROWSER_FILTER:+--workers=1 "$ASA_ELECTRONICS_BROWSER_FILTER" "$ASA_ELECTRONICS_REALTIME_TITLES"}';
const shardFilter = `\${{ matrix.browser_case.label == 'arduino-realtime' && '--grep' || (matrix.browser_case.shard != '' && '--grep-invert' || '') }}`;
const realtimeTitles =
  'Issue 682 acknowledged native realtime baseline ' +
  '(?:delays|button-serial|short(?:20|30|50|100)|long(?:1000|5000|10000|20000)):' +
  ' strict real time and acknowledged native evidence$';

function withoutFocusedSharding<T extends BrowserJob>(original: T): T {
  const browser = structuredClone(original);
  expect(browser.name).toBe(
    'Actual editor live simulation journey (${{ matrix.browser_case.label }})',
  );
  expect(browser.strategy).toEqual({ 'fail-fast': false, matrix: { browser_case: shardMatrix } });
  expect(browser['continue-on-error']).toBeUndefined();
  expect(browser.if).toBeUndefined();
  expect(browser.env.ASA_ELECTRONICS_BROWSER_SHARD).toBe('${{ matrix.browser_case.shard }}');
  expect(browser.env.ASA_ELECTRONICS_BROWSER_FILTER).toBe(shardFilter);
  expect(browser.env.ASA_ELECTRONICS_REALTIME_TITLES).toBe(realtimeTitles);
  const wholeProject = 'asa-lab-electronics-${{ github.run_id }}';
  expect(browser.env.COMPOSE_PROJECT_NAME).toBe(wholeProject + shardSuffix);

  const gates = browser.steps.filter((step) => step.name === focusedGateName);
  expect(gates).toHaveLength(1);
  const gate = gates[0]!;
  expect(gate.run?.endsWith(shardCli)).toBe(true);
  gate.run = gate.run!.slice(0, -shardCli.length);

  for (const [name, originalArtifact] of [
    [failureUpload.name, failureUpload.with.name],
    ['Upload browser evidence', 'electronics-r4-m1-browser-${{ github.run_id }}'],
  ] as const) {
    const uploads = browser.steps.filter((step) => step.name === name);
    expect(uploads).toHaveLength(1);
    const options = uploads[0]!.with!;
    expect(options['name']).toBe(originalArtifact + shardSuffix);
    options['name'] = originalArtifact;
  }

  delete browser.strategy;
  delete browser.env.ASA_ELECTRONICS_BROWSER_SHARD;
  delete browser.env.ASA_ELECTRONICS_BROWSER_FILTER;
  delete browser.env.ASA_ELECTRONICS_REALTIME_TITLES;
  browser.env.COMPOSE_PROJECT_NAME = wholeProject;
  return browser;
}

function withoutFocusedNativeQualifications<T extends BrowserJob>(original: T): T {
  const browser = structuredClone(original);
  const route = browser.steps.filter(
    (step) => step.name === 'Complete preselected Arduino clock reference',
  );
  const upload = browser.steps.filter(
    (step) => step.name === 'Upload separate clock-reference qualification',
  );
  const pace = browser.steps.filter(
    (step) => step.name === 'Verify actual simulation pace under load',
  );
  const paceUploads = browser.steps.filter(
    (step) => step.name === 'Upload actual simulation pace under load evidence',
  );
  expect(pace).toHaveLength(1);
  expect(paceUploads).toHaveLength(1);
  expect(route).toHaveLength(1);
  expect(upload).toHaveLength(1);
  const onlySelectedStrictJob =
    "${{ always() && matrix.browser_case.label == 'arduino-realtime' &&\n" +
    "    env.ASA_ELECTRONICS_QUALIFICATION_PROFILE == 'strict-real-time' }}";
  const completion = route[0]!;
  const archive = upload[0]!;
  const originalGate = browser.steps.find((step) => step.name === focusedGateName)!;
  expect(originalGate.id).toBe('selected_electronics_browser');
  expect(completion.if).toBe(onlySelectedStrictJob);
  expect(completion.env).toEqual({
    ASA_ELECTRONICS_ORIGINAL_GATE_OUTCOME: '${{ steps.selected_electronics_browser.outcome }}',
  });
  delete originalGate.id;
  expect(completion.run).toContain('tools/electronics-clock-reference.py plan');
  expect(completion.run).toContain('test-runner python3 tools/electronics-clock-reference.py run');
  expect(completion.run).toContain('tools/electronics-clock-reference.py finish');
  expect(completion['continue-on-error']).toBeUndefined();
  expect(archive).toEqual({
    name: 'Upload separate clock-reference qualification',
    if: onlySelectedStrictJob,
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'electronics-r4-m1-clock-reference-${{ github.run_id }}-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/asa-electronics-clock-reference',
      'if-no-files-found': 'error',
      'retention-days': 14,
    },
  });
  const paceVerify = pace[0]!;
  const paceArchive = paceUploads[0]!;
  expect(paceVerify.if).toBe(onlySelectedStrictJob);
  expect(paceVerify.run).toContain(
    'test-runner node apps/web/src/electronics/testing/simulation-speed.browser.mjs --overload',
  );
  expect(paceVerify['continue-on-error']).toBeUndefined();
  expect(paceArchive).toEqual({
    name: 'Upload actual simulation pace under load evidence',
    if: onlySelectedStrictJob,
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'electronics-r4-m1-overload-${{ github.run_id }}-${{ github.run_attempt }}',
      path: '${{ runner.temp }}/asa-electronics-overload/reports/electronics-overload',
      'if-no-files-found': 'error',
      'retention-days': 14,
    },
  });
  const steps = browser.steps.map((step) => step.name);
  expect(steps.indexOf('Upload browser evidence')).toBeLessThan(steps.indexOf(completion.name));
  expect(steps.indexOf(completion.name)).toBeLessThan(steps.indexOf(archive.name));
  expect(steps.indexOf(archive.name)).toBeLessThan(steps.indexOf(paceVerify.name));
  expect(steps.indexOf(paceVerify.name)).toBeLessThan(steps.indexOf(paceArchive.name));
  expect(steps.indexOf(paceArchive.name)).toBeLessThan(steps.indexOf('Remove isolated test stack'));
  const additional = new Set([completion, archive, paceVerify, paceArchive]);
  browser.steps = browser.steps.filter((step) => !additional.has(step));
  return browser;
}

describe('strict clock reference selection', () => {
  it('matches a literal titled case and rejects regex-like and suffix variants', () => {
    const title = 'D13 [LED] (50 + 1)? ^$. | \\ path';
    const pattern = execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      [
        '-c',
        "import runpy, sys; print(runpy.run_path('tools/electronics-clock-reference.py')['selector']([sys.argv[1]]))",
        title,
      ],
      { encoding: 'utf8' },
    ).trim();
    const selector = new RegExp(pattern);
    expect(selector.test('test file ' + title)).toBe(true);
    expect(selector.test(title.replace('.', 'X'))).toBe(false);
    expect(selector.test(title.replace('[LED]', 'L'))).toBe(false);
    expect(selector.test(title + ' same prefix')).toBe(false);
  });
});

describe('strict clock reference report', () => {
  it('requires the original command verdict as well as both complete reference journals', () => {
    const program = [
      'import json, runpy, tempfile',
      'from pathlib import Path',
      "m = runpy.run_path('tools/electronics-clock-reference.py')",
      "head = '0' * 40",
      'def journal(path, roster, hardware, failed=False):',
      "    timing = dict(status='available', scope='test-runner', phase='before', architecture='x86_64')",
      "    timing['hardwareClass'] = dict(status=hardware, referenceId=m['HARDWARE'])",
      "    rows = [dict(event='started', expectedSourceSha=head, qualificationProfile='strict-real-time', mode='test'),",
      "            dict(event='begin', expectedTestCount=len(roster), runnerTiming=timing)]",
      '    for index, (case_id, (_, titles)) in enumerate(roster.items()):',
      "        state = 'failed' if failed and index == 0 else 'passed'",
      "        rows.append(dict(event='testEnd', testId=case_id, expectedStatus='passed',",
      '                         status=state, retry=0, titlePath=titles, location=dict(file=titles[2])))',
      "    counts = dict.fromkeys(m['END_STATUSES'], 0)",
      '    counts.update(passed=len(roster)-int(failed), failed=int(failed))',
      "    rows.append(dict(event='end', status='failed' if failed else 'passed',",
      '                     observedAttemptCounts=counts, dataEventsOmitted=0, runnerErrorCount=0, evidenceLimited=False))',
      "    path.write_text('\\n'.join(json.dumps(dict(row, sequence=i, schemaVersion=1))",
      "                              for i, row in enumerate(rows, 1)), encoding='utf-8')",
      'def journal_ids(path):',
      "    rows = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()]",
      "    return sorted(row['testId'] for row in rows if row['event'] == 'testEnd')",
      'with tempfile.TemporaryDirectory() as tmp:',
      '    directory = Path(tmp)',
      "    initial, extra, receipt = [directory / name for name in ('first', 'extra', 'receipt')]",
      "    journal(extra, m['REMAINING'], 'reference')",
      "    m['store'](directory / 'reference-before.json', m['load_report'](extra, head, m['REMAINING'])['before'])",
      '    outcomes = []',
      '    for outcome, hardware, failed, next_exit in [',
      "        ('success', 'reference', False, None), ('success', 'reference', False, 0),",
      "        ('failure', 'reference', False, 0), ('', 'reference', False, 0),",
      "        ('success', 'other', False, 0), ('success', 'unverified', False, 0),",
      "        ('failure', 'reference', True, 0), ('success', 'reference', False, 7),",
      '    ]:',
      "        journal(initial, m['ORIGINAL'], hardware, failed)",
      "        decision = m['finish'](head, receipt, initial, extra, outcome, next_exit)",
      "        data = json.loads(receipt.read_text(encoding='utf-8'))",
      "        outcomes.append([decision, data['status'], len(data['original']['failedIds']), len(data['observedIds'])])",
      "        if decision == 'REFERENCE_PASSED':",
      '            first_ids, later_ids = [journal_ids(path) for path in (initial, extra)]',
      "            outcomes[-1].append([len(data['original']['ids']), len(data['remaining']['ids']),",
      "                data['original']['ids'] == first_ids, data['remaining']['ids'] == later_ids,",
      "                set(first_ids).isdisjoint(later_ids), data['observedIds'] == first_ids + later_ids])",
      '    print(json.dumps(outcomes))',
    ].join('\n');
    const outcomes = execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      ['-c', program],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(outcomes)).toEqual([
      ['RUN_REMAINING', 'REFERENCE_INCOMPLETE', 0, 10],
      ['REFERENCE_PASSED', 'REFERENCE_PASSED', 0, 25, [10, 15, true, true, true, true]],
      ['REFERENCE_INCOMPLETE', 'REFERENCE_INCOMPLETE', 0, 10],
      ['REFERENCE_INCOMPLETE', 'REFERENCE_INCOMPLETE', 0, 10],
      ['REFERENCE_ABSENT', 'REFERENCE_ABSENT', 0, 0],
      ['REFERENCE_UNVERIFIED', 'REFERENCE_UNVERIFIED', 0, 0],
      ['REFERENCE_FAILED', 'REFERENCE_FAILED', 1, 10],
      ['REFERENCE_INCOMPLETE', 'REFERENCE_INCOMPLETE', 0, 25],
    ]);
  });
});

describe('additive workflow retains existing execution protections', () => {
  it('copies focused, benchmark, pinned transport and runtime commands without weakening', () => {
    const original = parse(readFileSync('.github/workflows/electronics-r4-m1-focused.yml', 'utf8'));
    const scoped = parse(readFileSync('.github/workflows/electronics-ui-679-557.yml', 'utf8'));
    expect(scoped.on).toEqual({ workflow_dispatch: null });
    expect(scoped.permissions).toEqual(original.permissions);
    expect(scoped.env).toEqual(original.env);
    expect(Object.keys(scoped.jobs)).toEqual(['focused', 'benchmark', 'browser']);
    for (const job of ['focused', 'benchmark'])
      expect(scoped.jobs[job]).toEqual(original.jobs[job]);
    const browser = withoutFocusedFailureEvidence(
      withoutFocusedSharding(withoutFocusedNativeQualifications(original.jobs.browser)),
    );
    browser.name = 'Scoped six-case UI qualification (not full Electronics)';
    browser.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE = 'strict-real-time';
    browser.env.ASA_ELECTRONICS_BROWSER_GATE = 'gate:electronics-ui-679-557:browser';
    for (const step of browser.steps) {
      if (step.name === 'Selected Electronics browser qualification')
        step.name = 'Six existing native cases, unchanged assertions';
      if (step.name === 'Upload browser evidence')
        step.with.name = 'electronics-ui-679-557-browser-${{ github.run_id }}';
    }
    expect(scoped.jobs.browser).toEqual(browser);
  });
});
