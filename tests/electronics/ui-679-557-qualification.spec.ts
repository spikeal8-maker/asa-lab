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
const shardFilter = "${{ matrix.browser_case.shard != '' && '--grep-invert' || '' }}";
const universalSlot =
  "${{ matrix.browser_case.label != 'arduino-realtime' && matrix.browser_case.label != 's3' }}";
const universalUpload =
  "${{ always() && matrix.browser_case.label != 'arduino-realtime' && matrix.browser_case.label != 's3' }}";

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
  expect(browser.env.ASA_ELECTRONICS_REALTIME_TITLES).toBeUndefined();
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
  browser.env.COMPOSE_PROJECT_NAME = wholeProject;
  return browser;
}

function withoutFocusedNativeQualifications<T extends BrowserJob>(original: T): T {
  const browser = structuredClone(original);
  const gate = browser.steps.find((step) => step.name === focusedGateName)!;
  const failure = browser.steps.find((step) => step.name === failureUpload.name)!;
  expect(gate.id).toBe('selected_electronics_browser');
  expect(gate.if).toBe(universalSlot);
  expect(failure.if).toBe(universalUpload);
  expect(browser['timeout-minutes']).toBe(
    "${{ (inputs.qualification_profile || 'strict-real-time') == 'strict-real-time' && 75 || 50 }}",
  );
  delete gate.id;
  delete gate.if;
  failure.if = 'always()';
  browser['timeout-minutes'] = 50;
  const additions = [
    'Prequalify assigned Electronics clock runner',
    'Run all strict clock cases on each prequalified runner',
    'Upload cohort journal',
    'Upload separate clock-reference qualification',
    'Verify actual simulation pace under load',
    'Upload actual simulation pace under load evidence',
    'Verify actual simulation pace on a slow CPU',
    'Upload actual simulation pace on a slow CPU evidence',
    'Collect generic pace proof receipts',
  ];
  for (const name of additions) {
    const steps = browser.steps.filter((step) => step.name === name);
    expect(steps).toHaveLength(1);
    expect(steps[0]!['continue-on-error']).toBeUndefined();
  }
  browser.steps = browser.steps.filter((step) => !additions.includes(step.name ?? ''));
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

describe('strict clock cohort report', () => {
  it('requires every assigned result, complete distinct coverage and both generic pace proofs', () => {
    const program = [
      'import hashlib, json, runpy, tempfile',
      'from pathlib import Path',
      "m = runpy.run_path('tools/electronics-clock-reference.py')",
      "head = '1' * 40",
      'def journal(path, cases, hardware, failed=False):',
      "    timing = dict(status='available', scope='test-runner', phase='before', architecture='x86_64')",
      "    timing['hardwareClass'] = dict(status=hardware, referenceId=m['HARDWARE'])",
      "    rows = [dict(event='started', expectedSourceSha=head, qualificationProfile='strict-real-time', mode='test'),",
      "            dict(event='begin', expectedTestCount=len(cases), runnerTiming=timing)]",
      '    for i, (key, titles) in enumerate(cases.items()):',
      "        rows.append(dict(event='testEnd', testId=key, expectedStatus='passed', retry=0, titlePath=titles,",
      "                         status='failed' if failed and i == 0 else 'passed', location=dict(file=titles[2])))",
      "    counts = dict.fromkeys(m['END_STATUSES'], 0)",
      '    counts.update(passed=len(cases)-int(failed), failed=int(failed))',
      "    rows.append(dict(event='end', status='failed' if failed else 'passed',",
      '                     observedAttemptCounts=counts, dataEventsOmitted=0, runnerErrorCount=0, evidenceLimited=False))',
      "    path.write_text('\\n'.join(json.dumps(dict(row, sequence=i, schemaVersion=1))",
      "                             for i, row in enumerate(rows, 1)), encoding='utf-8')",
      '    return timing',
      'with tempfile.TemporaryDirectory() as tmp:',
      '    root = Path(tmp)',
      '    expected_ids = []',
      "    wall = {key: labels[1] for key, labels in m['WALL_CASES'].items()}",
      "    store = m['store']",
      "    for slot in m['SLOTS']:",
      '        path = root / slot',
      '        path.mkdir()',
      "        store(path/'identity.json', [head, slot, '101', '1'])",
      "        if slot in m['UNIVERSAL_COUNTS']:",
      "            cases = {f'{slot}-{i}': ('', '', 'example.spec.ts', f'case {i}')",
      "                     for i in range(m['UNIVERSAL_COUNTS'][slot])}",
      '            expected_ids.extend(cases)',
      "            store(path/'universal-roster.json', cases)",
      "            store(path/'universal-exit.json', 'success' if cases else 'skipped')",
      '            if cases:',
      "                journal(path/'universal.ndjson', cases, 'other')",
      "        hardware = 'reference' if slot in ('s1', 'arduino-realtime') else 'other'",
      "        if hardware == 'reference':",
      "            before = journal(path/'reference.ndjson', wall, hardware)",
      "            store(path/'reference-before.json', before)",
      "            store(path/'reference-exit.json', 0)",
      '        else:',
      "            before = journal(path/'classifier-fixture.ndjson', {}, hardware)",
      "        store(path/'assignment.json', before)",
      "    for name in ('overload', 'slow-cpu'):",
      "        store(root/'s4'/f'{name}-receipt.json', [{'fixture': name}])",
      "    qualify = m['qualification']",
      "    qualify.__globals__['UNIVERSAL_ROSTER_SHA256'] = hashlib.sha256(",
      "        ('\\n'.join(sorted(expected_ids))+'\\n').encode()).hexdigest()",
      "    def status(browser='success'):",
      "        result = qualify(head, root, browser, '101', '1')",
      "        return [result['status'], len(result['universalIds']), len(result['referenceIds'])]",
      "    answers = [status(), status('failure')]",
      "    first = root/'s1'/'universal-roster.json'",
      "    second = root/'s2'/'universal-roster.json'",
      "    roster_two = m['read'](second)",
      '    duplicate = dict(roster_two)',
      "    duplicate[next(iter(m['read'](first)))] = duplicate.pop(next(iter(duplicate)))",
      '    store(second, duplicate)',
      '    answers.append(status())',
      '    store(second, roster_two)',
      "    slot_id = root/'s3'/'identity.json'",
      '    slot_id.unlink()',
      '    answers.append(status())',
      "    store(slot_id, [head, 's3', '101', '1'])",
      "    gate_evidence = root/'s1'/'reference.ndjson'",
      '    complete = gate_evidence.read_bytes()',
      '    gate_evidence.unlink()',
      '    answers.append(status())',
      '    gate_evidence.write_bytes(complete)',
      "    store(root/'s1'/'reference-exit.json', 3)",
      '    answers.append(status())',
      "    store(root/'s1'/'reference-exit.json', 0)",
      "    (root/'s4'/'slow-cpu-receipt.json').unlink()",
      '    answers.append(status())',
      "    store(root/'s4'/'slow-cpu-receipt.json', [{'fixture': 'fixed'}])",
      "    for slot in ('s1', 'arduino-realtime'):",
      '        path = root/slot',
      "        before = m['read'](path/'assignment.json')",
      "        before['hardwareClass']['status'] = 'other'",
      "        store(path/'assignment.json', before)",
      "        (path/'reference.ndjson').unlink()",
      "        (path/'reference-exit.json').unlink()",
      '    answers.append(status())',
      '    print(json.dumps(answers))',
    ].join('\n');
    const output = execFileSync(
      process.platform === 'win32' ? 'python' : 'python3',
      ['-c', program],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(output)).toEqual([
      ['passed', 252, 25],
      ['failed', 252, 25],
      ['failed', 125, 25],
      ['failed', 252, 25],
      ['failed', 252, 25],
      ['failed', 252, 25],
      ['failed', 252, 25],
      ['failed', 252, 0],
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
