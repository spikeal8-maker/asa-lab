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

describe('additive workflow retains existing execution protections', () => {
  it('copies focused, benchmark, pinned transport and runtime commands without weakening', () => {
    const original = parse(readFileSync('.github/workflows/electronics-r4-m1-focused.yml', 'utf8'));
    const scoped = parse(readFileSync('.github/workflows/electronics-ui-679-557.yml', 'utf8'));
    expect(scoped.on).toEqual({
      workflow_dispatch: {
        inputs: {
          evidence_subset: {
            description: 'Closed targeted evidence only; never full Electronics acceptance',
            required: false,
            type: 'choice',
            default: 'ui-679-557-six',
            options: ['ui-679-557-six', '836-runtime-three-v1'],
          },
        },
      },
    });
    expect(scoped.permissions).toEqual(original.permissions);
    expect(scoped.env).toEqual(original.env);
    expect(Object.keys(scoped.jobs)).toEqual(['focused', 'benchmark', 'browser']);
    expect(scoped.jobs.benchmark).toEqual(original.jobs.benchmark);
    const focused = structuredClone(scoped.jobs.focused);
    expect(focused.steps.pop()).toEqual({
      name: 'Three-case harness adversarial contracts',
      if: "${{ inputs.evidence_subset == '836-runtime-three-v1' }}",
      run:
        'python3 tools/electronics_836_three_source.py --executables\n' +
        'node --test tools/test-electronics-836-runtime-three.mjs\n' +
        'python3 tools/test_electronics_836_three_source.py\n' +
        'pnpm exec vitest run tests/electronics/ui-679-557-qualification.spec.ts --maxWorkers=1\n',
    });
    expect(focused).toEqual(original.jobs.focused);
    const browser = structuredClone(original.jobs.browser);
    browser.name =
      "Targeted ${{ inputs.evidence_subset || 'ui-679-557-six' }} (not full Electronics)";
    browser.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE = 'strict-real-time';
    browser.env.ASA_ELECTRONICS_BROWSER_GATE = 'gate:electronics-ui-679-557:browser';
    browser.env.ASA_ELECTRONICS_EVIDENCE_SUBSET =
      "${{ inputs.evidence_subset || 'ui-679-557-six' }}";
    for (const step of browser.steps) {
      if (step.name === 'Selected Electronics browser qualification') {
        step.name = 'Six existing native cases, unchanged assertions';
        step.if = "${{ inputs.evidence_subset != '836-runtime-three-v1' }}";
      }
      if (step.name === 'Upload browser evidence')
        step.with.name = 'electronics-ui-679-557-browser-${{ github.run_id }}';
    }
    const actual = structuredClone(scoped.jobs.browser);
    const additions = [
      'Verify closed subset and exact three-case source before Docker',
      'Retain verified three-case image identities',
      'Three original 836 journeys only, unchanged assertions',
    ];
    const extra = actual.steps.filter((step) => additions.includes(step.name));
    expect(extra).toEqual([
      { name: additions[0], run: 'python3 tools/electronics_836_three_source.py --source' },
      {
        name: additions[1],
        if: "${{ inputs.evidence_subset == '836-runtime-three-v1' }}",
        run:
          'python3 tools/test_ci_image_transport.py --electronics-built-images > reports/electronics-836-three/built-images.jsonl\n' +
          'python3 tools/test_ci_image_transport.py --electronics-pulled-postgres > reports/electronics-836-three/postgres-image.json\n',
      },
      {
        name: additions[2],
        if: "${{ inputs.evidence_subset == '836-runtime-three-v1' }}",
        run: browser.steps
          .find((step) => step.name === 'Six existing native cases, unchanged assertions')!
          .run.replace(
            'test-runner pnpm "$ASA_ELECTRONICS_BROWSER_GATE"',
            '-e ASA_ELECTRONICS_EVIDENCE_SUBSET test-runner node tools/run-electronics-836-runtime-three.mjs',
          ),
      },
    ]);
    expect(actual.steps.findIndex((step) => step.name === additions[0])).toBeLessThan(
      actual.steps.findIndex((step) => step.run?.includes('docker compose')),
    );
    expect(actual.steps.findIndex((step) => step.name === additions[0])).toBeLessThan(
      actual.steps.findIndex((step) => step.name === 'Prepare writable evidence directories'),
    );
    actual.steps = actual.steps.filter((step) => !additions.includes(step.name));
    expect(actual).toEqual(browser);
    expect(scoped.concurrency).toEqual({
      group:
        "electronics-ui-679-557-${{ github.ref }}${{ inputs.evidence_subset == '836-runtime-three-v1' && '-836-runtime-three-v1' || '' }}",
      'cancel-in-progress': true,
    });
  });
});
