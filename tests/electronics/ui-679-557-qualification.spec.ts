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
    const browser = withoutFocusedFailureEvidence(original.jobs.browser);
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
