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
    '[{"label":"s1","shard":"1/4"},{"label":"s2","shard":"2/4"},{"label":"s3","shard":"3/4"},{"label":"s4","shard":"4/4"}]'
  ) }}`;
const shardSuffix = '-${{ matrix.browser_case.label }}';
const shardCli =
  ' ${ASA_ELECTRONICS_BROWSER_SHARD:+--shard=$ASA_ELECTRONICS_BROWSER_SHARD --workers=1}';

function withoutFocusedSharding<T extends BrowserJob>(original: T): T {
  const browser = structuredClone(original);
  expect(browser.name).toBe(
    'Actual editor live simulation journey (${{ matrix.browser_case.label }})',
  );
  expect(browser.strategy).toEqual({ 'fail-fast': false, matrix: { browser_case: shardMatrix } });
  expect(browser['continue-on-error']).toBeUndefined();
  expect(browser.if).toBeUndefined();
  expect(browser.env.ASA_ELECTRONICS_BROWSER_SHARD).toBe('${{ matrix.browser_case.shard }}');
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
  browser.env.COMPOSE_PROJECT_NAME = wholeProject;
  return browser;
}

type QualificationInput = {
  options?: string[];
  [key: string]: unknown;
};
type QualificationWorkflow = {
  on: { workflow_dispatch: { inputs: Record<string, QualificationInput> } };
  jobs: Record<string, BrowserJob>;
  [key: string]: unknown;
};
const pairedProfile = 'r10-paired-regression';
const pairedOnly = "inputs.qualification_profile == 'r10-paired-regression'";
const ordinaryOnly = "inputs.qualification_profile != 'r10-paired-regression'";
const originalFocusedIf = "${{ inputs.qualification_profile != 'arduino-editor-error' }}";
const pairedFocusedIf =
  "${{ inputs.qualification_profile != 'arduino-editor-error' && " + ordinaryOnly + ' }}';
const pairedBrowserIf =
  "${{ !cancelled() && (needs.focused.result == 'success' || (github.event_name == 'workflow_dispatch' && " +
  pairedOnly +
  ')) }}';
const pairedTimeout = '${{ ' + pairedOnly + ' && 60 || 50 }}';
const pairedMatrix = shardMatrix.replace(
  '${{ fromJSON(\n',
  '${{ fromJSON(\n    ' +
    pairedOnly +
    " &&\n    '" +
    JSON.stringify([{ label: 'paired', shard: '' }]) +
    "' ||\n",
);
const ordinaryQualificationInput = {
  description: 'Explicit browser qualification; strict real-time remains the default',
  required: false,
  type: 'choice',
  default: 'strict-real-time',
  options: ['strict-real-time', 'classroom-d13-v2', 'classroom-d13-v3', 'arduino-editor-error'],
};
const pairedInputs = {
  qualification_profile: {
    ...ordinaryQualificationInput,
    options: [...ordinaryQualificationInput.options, pairedProfile],
  },
  before_revision: {
    description: 'Immutable baseline SHA for r10-paired-regression only',
    required: false,
    type: 'string',
    default: 'cb15c700253f26bf276ad69d5e45ca27c2306787',
  },
  after_revision: {
    description: 'Immutable candidate SHA for r10-paired-regression only',
    required: false,
    type: 'string',
  },
};
const pairedHelper = 'tools/electronics_r10_paired_diagnostic.py';
const revisionArguments =
  '--before-revision="$ASA_R10_BEFORE_REVISION" --after-revision="$ASA_R10_AFTER_REVISION"';
const pairedSteps: BrowserStep[] = [
  {
    name: 'Validate paired immutable revisions',
    if: pairedOnly,
    run: 'python3 ' + pairedHelper + ' --check-revisions ' + revisionArguments,
  },
  ...(['before', 'after'] as const).map((phase) => ({
    name: 'Checkout paired ' + (phase === 'before' ? 'baseline' : 'candidate'),
    if: pairedOnly,
    uses: 'actions/checkout@v4',
    with: {
      ref: '${{ env.ASA_R10_' + phase.toUpperCase() + '_REVISION }}',
      path: 'paired-' + phase,
      'fetch-depth': 0,
      'persist-credentials': false,
    },
  })),
  {
    name: 'Paired original millis and joint-LED cases — one attempt each, not full R4',
    if: 'always() && ' + pairedOnly,
    run: 'python3 -u ' + pairedHelper + ' ' + revisionArguments,
  },
  {
    name: 'Remove only paired disposable stacks',
    if: 'always() && ' + pairedOnly,
    run: 'python3 -u ' + pairedHelper + ' --cleanup-only ' + revisionArguments,
  },
  {
    name: 'Upload paired status and incremental failures',
    if: 'always() && ' + pairedOnly,
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'electronics-r10-paired-failures-${{ github.run_id }}-${{ github.run_attempt }}',
      path:
        'reports/r10-paired/paired.json\npaired-before/reports/electronics-failures.ndjson\n' +
        'paired-after/reports/electronics-failures.ndjson\n',
      'if-no-files-found': 'error',
      'retention-days': 14,
    },
  },
  {
    name: 'Upload complete paired receipts, raw observations, traces and videos',
    if: 'always() && ' + pairedOnly,
    uses: 'actions/upload-artifact@v4',
    with: {
      name: 'electronics-r10-paired-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
      path:
        'reports/r10-paired\npaired-before/reports\n' +
        'paired-before/e2e/artifacts/electronics-simulation\npaired-after/reports\n' +
        'paired-after/e2e/artifacts/electronics-simulation\n',
      'if-no-files-found': 'error',
      'retention-days': 14,
    },
  },
];
const ordinarySteps = [
  ['Prepare writable evidence directories', undefined],
  ['Prepare and verify image-only PostgreSQL transport', undefined],
  ['Build isolated Electronics browser images', undefined],
  ['Verify original base layers and exact source revision', undefined],
  ['Start isolated PostgreSQL', undefined],
  ['Verify original PostgreSQL image identity', undefined],
  ['Apply isolated migrations', undefined],
  ['Start Electronics API and Web without unrelated media services', undefined],
  [focusedGateName, undefined],
  ['Show isolated stack state', 'always()'],
  [failureUpload.name, 'always()'],
  ['Upload browser evidence', 'always()'],
  ['Remove isolated test stack', 'always()'],
] as const;

function withoutR10PairedDiagnostic<T extends QualificationWorkflow>(original: T): T {
  const workflow = structuredClone(original);
  const focused = workflow.jobs.focused!;
  const browser = workflow.jobs.browser!;

  // Project only the exact reviewed paired-v1 schedule. Ordinary commands and
  // security controls remain intact for the original complete equality checks.
  // An unknown or partial addition must fail before any normalization occurs.
  expect(workflow.on.workflow_dispatch).toEqual({ inputs: pairedInputs });
  expect(focused.if).toBe(pairedFocusedIf);
  expect(browser.if).toBe(pairedBrowserIf);
  expect(browser['timeout-minutes']).toBe(pairedTimeout);
  expect(browser.strategy).toEqual({ 'fail-fast': false, matrix: { browser_case: pairedMatrix } });
  expect(browser.env.ASA_R10_BEFORE_REVISION).toBe('${{ inputs.before_revision }}');
  expect(browser.env.ASA_R10_AFTER_REVISION).toBe('${{ inputs.after_revision }}');
  expect(browser.steps.slice(1, 1 + pairedSteps.length)).toEqual(pairedSteps);
  const ordinary = browser.steps.slice(1 + pairedSteps.length);
  expect(ordinary.map((step) => step.name)).toEqual(ordinarySteps.map(([name]) => name));
  ordinary.forEach((step, index) => {
    const originalIf = ordinarySteps[index]![1];
    expect(step.if).toBe((originalIf ? originalIf + ' && ' : '') + ordinaryOnly);
  });

  workflow.on.workflow_dispatch = {
    inputs: { qualification_profile: structuredClone(ordinaryQualificationInput) },
  };
  focused.if = originalFocusedIf;
  delete browser.if;
  browser['timeout-minutes'] = 50;
  browser.strategy = { 'fail-fast': false, matrix: { browser_case: shardMatrix } };
  delete browser.env.ASA_R10_BEFORE_REVISION;
  delete browser.env.ASA_R10_AFTER_REVISION;
  ordinary.forEach((step, index) => {
    const originalIf = ordinarySteps[index]![1];
    if (originalIf) step.if = originalIf;
    else delete step.if;
  });
  browser.steps = [browser.steps[0]!, ...ordinary];
  return workflow;
}

describe('paired-v1 diagnostic compatibility projection', () => {
  function fixture(): QualificationWorkflow {
    return parse(readFileSync('.github/workflows/electronics-r4-m1-focused.yml', 'utf8'));
  }
  const inputs = (workflow: QualificationWorkflow) => workflow.on.workflow_dispatch.inputs;
  const pairedStep = (workflow: QualificationWorkflow, index: number) =>
    workflow.jobs.browser!.steps[index + 1]!;
  const ordinaryStep = (workflow: QualificationWorkflow, name: string) =>
    workflow.jobs.browser!.steps.find((step) => step.name === name)!;
  type WorkflowChallenge = [string, (workflow: QualificationWorkflow) => unknown];

  it('projects the reviewed addition without mutating the workflow or its ordinary commands', () => {
    const original = fixture();
    const before = structuredClone(original);
    const projected = withoutR10PairedDiagnostic(original);
    expect(original).toEqual(before);
    expect(projected).not.toBe(original);
    expect(projected.jobs.focused).toEqual({ ...before.jobs.focused, if: originalFocusedIf });
    expect(projected.jobs.benchmark).toEqual(before.jobs.benchmark);
    expect(projected.jobs.browser!.steps[0]).toEqual(before.jobs.browser!.steps[0]);
    expect(projected.on.workflow_dispatch).toEqual({
      inputs: { qualification_profile: ordinaryQualificationInput },
    });
    for (const [name, originalIf] of ordinarySteps) {
      const expected = structuredClone(ordinaryStep(before, name));
      if (originalIf) expected.if = originalIf;
      else delete expected.if;
      expect(ordinaryStep(projected, name)).toEqual(expected);
    }
  });

  for (const [name, mutate] of [
    [
      'unknown profile',
      (workflow) => inputs(workflow).qualification_profile!.options!.push('unknown'),
    ],
    [
      'unreviewed paired version',
      (workflow) => (inputs(workflow).qualification_profile!.options![4] = 'r10-paired-v2'),
    ],
    [
      'paired default',
      (workflow) => (inputs(workflow).qualification_profile!.default = pairedProfile),
    ],
    [
      'removed strict profile',
      (workflow) => inputs(workflow).qualification_profile!.options!.shift(),
    ],
    ['missing revision input', (workflow) => delete inputs(workflow).before_revision],
    [
      'mutable candidate default',
      (workflow) => (inputs(workflow).after_revision!.default = 'main'),
    ],
    ['unknown dispatch input', (workflow) => (inputs(workflow).unreviewed = { type: 'boolean' })],
    [
      'focused strict skip',
      (workflow) =>
        (workflow.jobs.focused!.if = "${{ inputs.qualification_profile != 'strict-real-time' }}"),
    ],
    [
      'ordinary browser without focused success',
      (workflow) =>
        (workflow.jobs.browser!.if = pairedBrowserIf.replace(
          "needs.focused.result == 'success'",
          'true',
        )),
    ],
    [
      'paired execution outside dispatch',
      (workflow) =>
        (workflow.jobs.browser!.if = pairedBrowserIf.replace(
          "github.event_name == 'workflow_dispatch' && ",
          '',
        )),
    ],
    [
      'changed ordinary timeout',
      (workflow) =>
        (workflow.jobs.browser!['timeout-minutes'] = pairedTimeout.replace('|| 50', '|| 49')),
    ],
    [
      'changed paired timeout',
      (workflow) =>
        (workflow.jobs.browser!['timeout-minutes'] = pairedTimeout.replace('&& 60', '&& 70')),
    ],
    [
      'paired sharding',
      (workflow) =>
        (workflow.jobs.browser!.strategy = {
          'fail-fast': false,
          matrix: {
            browser_case: pairedMatrix.replace(
              '"label":"paired","shard":""',
              '"label":"paired","shard":"1/2"',
            ),
          },
        }),
    ],
    [
      'ordinary shard removal',
      (workflow) =>
        (workflow.jobs.browser!.strategy = {
          'fail-fast': false,
          matrix: { browser_case: pairedMatrix.replace(',{"label":"s4","shard":"4/4"}', '') },
        }),
    ],
    [
      'fail-fast cancellation',
      (workflow) =>
        (workflow.jobs.browser!.strategy = {
          'fail-fast': true,
          matrix: { browser_case: pairedMatrix },
        }),
    ],
    [
      'missing candidate environment',
      (workflow) => delete workflow.jobs.browser!.env.ASA_R10_AFTER_REVISION,
    ],
    [
      'wrong baseline environment',
      (workflow) =>
        (workflow.jobs.browser!.env.ASA_R10_BEFORE_REVISION = '${{ inputs.after_revision }}'),
    ],
    ['missing paired step', (workflow) => workflow.jobs.browser!.steps.splice(1, 1)],
    [
      'duplicate paired step',
      (workflow) =>
        workflow.jobs.browser!.steps.splice(1, 0, structuredClone(pairedStep(workflow, 0))),
    ],
    [
      'reordered paired steps',
      (workflow) =>
        workflow.jobs.browser!.steps.splice(
          1,
          2,
          ...workflow.jobs.browser!.steps.slice(1, 3).reverse(),
        ),
    ],
    [
      'unknown paired step',
      (workflow) => workflow.jobs.browser!.steps.splice(1, 0, { if: pairedOnly, run: 'true' }),
    ],
    ['swallowed SHA validation', (workflow) => (pairedStep(workflow, 0).run += ' || true')],
    ['mutable baseline checkout', (workflow) => (pairedStep(workflow, 1).with!.ref = 'main')],
    [
      'persisted checkout credentials',
      (workflow) => (pairedStep(workflow, 2).with!['persist-credentials'] = true),
    ],
    [
      'shared checkout directory',
      (workflow) => (pairedStep(workflow, 2).with!.path = 'paired-before'),
    ],
    [
      'ignored comparison failure',
      (workflow) => (pairedStep(workflow, 3)['continue-on-error'] = true),
    ],
    ['comparison skipping setup failures', (workflow) => (pairedStep(workflow, 3).if = pairedOnly)],
    ['cleanup skipping failures', (workflow) => (pairedStep(workflow, 4).if = pairedOnly)],
    [
      'lost incremental failures',
      (workflow) => (pairedStep(workflow, 5).with!.path = 'reports/r10-paired/paired.json'),
    ],
    [
      'lost candidate raw evidence',
      (workflow) => (pairedStep(workflow, 6).with!.path = 'paired-before/reports'),
    ],
    [
      'ignored missing evidence',
      (workflow) => (pairedStep(workflow, 6).with!['if-no-files-found'] = 'ignore'),
    ],
    ['unguarded ordinary gate', (workflow) => delete ordinaryStep(workflow, focusedGateName).if],
    [
      'ordinary gate also skipping strict',
      (workflow) =>
        (ordinaryStep(workflow, focusedGateName).if =
          ordinaryOnly + " && inputs.qualification_profile != 'strict-real-time'"),
    ],
    [
      'ordinary evidence only on failure',
      (workflow) =>
        (ordinaryStep(workflow, 'Upload browser evidence').if = 'failure() && ' + ordinaryOnly),
    ],
    [
      'missing ordinary gate',
      (workflow) =>
        workflow.jobs.browser!.steps.splice(
          workflow.jobs.browser!.steps.indexOf(ordinaryStep(workflow, focusedGateName)),
          1,
        ),
    ],
    [
      'unexpected ordinary step',
      (workflow) =>
        workflow.jobs.browser!.steps.push({
          name: 'Unreviewed command',
          if: ordinaryOnly,
          run: 'true',
        }),
    ],
  ] as WorkflowChallenge[]) {
    it('rejects ' + name + ' instead of accepting a partial or changed paired overlay', () => {
      const original = fixture();
      mutate(original);
      expect(() => withoutR10PairedDiagnostic(original)).toThrow();
    });
  }

  for (const [name, mutate] of [
    ['write permission', (workflow) => (workflow.permissions = { contents: 'write' })],
    [
      'unrelated browser environment',
      (workflow) => (workflow.jobs.browser!.env.UNREVIEWED_SETTING = 'true'),
    ],
    ['ordinary job dependency', (workflow) => (workflow.jobs.browser!.needs = [])],
    [
      'focused failure handling',
      (workflow) => (workflow.jobs.focused!['continue-on-error'] = true),
    ],
    ['benchmark dependency', (workflow) => (workflow.jobs.benchmark!.needs = [])],
    [
      'ordinary checkout credentials',
      (workflow) => (workflow.jobs.browser!.steps[0]!.with!['persist-credentials'] = true),
    ],
    [
      'ordinary gate failure handling',
      (workflow) => (ordinaryStep(workflow, focusedGateName).run += ' || true'),
    ],
    [
      'ordinary pinned base image',
      (workflow) => {
        const step = ordinaryStep(workflow, 'Build isolated Electronics browser images');
        step.run = step.run!.replace('NODE_IMAGE=mirror.gcr.io/', 'NODE_IMAGE=unreviewed.invalid/');
      },
    ],
    [
      'mandatory M1 gate',
      (workflow) =>
        (workflow.jobs.focused!.steps.find(
          (step) => step.name === 'Focused Electronics M1 gate',
        )!.run = 'true'),
    ],
  ] as WorkflowChallenge[]) {
    it('retains changed ' + name + ' for the original full equality checks', () => {
      const original = fixture();
      const baseline = withoutR10PairedDiagnostic(fixture());
      const expected = structuredClone(baseline);
      mutate(original);
      mutate(expected);
      const projected = withoutR10PairedDiagnostic(original);
      expect(projected).toEqual(expected);
      expect(projected).not.toEqual(baseline);
    });
  }

  it('keeps the original rejection of browser continue-on-error after projection', () => {
    const original = fixture();
    original.jobs.browser!['continue-on-error'] = true;
    const projected = withoutR10PairedDiagnostic(original);
    expect(() => withoutFocusedSharding(projected.jobs.browser!)).toThrow();
  });
});

describe('additive workflow retains existing execution protections', () => {
  it('copies focused, benchmark, pinned transport and runtime commands without weakening', () => {
    const original = withoutR10PairedDiagnostic(
      parse(readFileSync('.github/workflows/electronics-r4-m1-focused.yml', 'utf8')),
    );
    const scoped = parse(readFileSync('.github/workflows/electronics-ui-679-557.yml', 'utf8'));
    expect(scoped.on).toEqual({ workflow_dispatch: null });
    expect(scoped.permissions).toEqual(original.permissions);
    expect(scoped.env).toEqual(original.env);
    expect(Object.keys(scoped.jobs)).toEqual(['focused', 'benchmark', 'browser']);
    for (const job of ['focused', 'benchmark'])
      expect(scoped.jobs[job]).toEqual(original.jobs[job]);
    const browser = withoutFocusedFailureEvidence(withoutFocusedSharding(original.jobs.browser));
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
