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
    expect(scoped.on).toEqual({ workflow_dispatch: null });
    expect(scoped.permissions).toEqual(original.permissions);
    expect(scoped.env).toEqual(original.env);
    expect(Object.keys(scoped.jobs)).toEqual(['focused', 'benchmark', 'browser']);
    for (const job of ['focused', 'benchmark'])
      expect(scoped.jobs[job]).toEqual(original.jobs[job]);
    // The full browser CI now requires two independent shards. This scoped
    // six-case UI qualification deliberately runs a single whole-suite child.
    // Require every new full-gate control before projecting only its known
    // sharding differences; keep all shared transport/runtime steps identical.
    const browser = structuredClone(original.jobs.browser);
    const matrix = browser.strategy?.matrix?.browser_case;
    expect(Object.keys(browser.strategy)).toEqual(['fail-fast', 'matrix']);
    expect(browser.strategy['fail-fast']).toBe(false);
    expect(Object.keys(browser.strategy.matrix)).toEqual(['browser_case']);
    expect(matrix).toContain('classroom-d13-v2');
    expect(matrix).toContain('classroom-d13-v3');
    expect(matrix).toContain('arduino-editor-error');
    expect(matrix).toContain('"label":"whole","shard":""');
    expect(matrix).toContain('"label":"s1","shard":"1/2"');
    expect(matrix).toContain('"label":"s2","shard":"2/2"');
    expect(matrix.match(/"label"/g)).toHaveLength(3);
    expect(browser.env.ASA_ELECTRONICS_BROWSER_SHARD).toBe('${{ matrix.browser_case.shard }}');
    expect(browser.env.COMPOSE_PROJECT_NAME).toBe(
      'asa-lab-electronics-${{ github.run_id }}-${{ matrix.browser_case.label }}',
    );
    expect(browser['timeout-minutes']).toBe(50);
    expect(browser['continue-on-error']).toBeUndefined();
    expect(scoped.jobs.browser.strategy).toBeUndefined();
    expect(scoped.jobs.browser.env.ASA_ELECTRONICS_BROWSER_SHARD).toBeUndefined();

    const shardCli = ' ${ASA_ELECTRONICS_BROWSER_SHARD:+--shard=$ASA_ELECTRONICS_BROWSER_SHARD}';
    const gate = browser.steps.find(
      (step: { name: string }) => step.name === 'Selected Electronics browser qualification',
    );
    expect(gate?.run.endsWith(shardCli)).toBe(true);
    delete browser.strategy;
    delete browser.env.ASA_ELECTRONICS_BROWSER_SHARD;
    browser.env.COMPOSE_PROJECT_NAME = 'asa-lab-electronics-${{ github.run_id }}';
    browser.name = 'Scoped six-case UI qualification (not full Electronics)';
    browser.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE = 'strict-real-time';
    browser.env.ASA_ELECTRONICS_BROWSER_GATE = 'gate:electronics-ui-679-557:browser';
    for (const step of browser.steps) {
      if (step.name === 'Selected Electronics browser qualification') {
        step.run = step.run.slice(0, -shardCli.length);
        step.name = 'Six existing native cases, unchanged assertions';
      }
      if (step.name === 'Upload browser evidence')
        step.with.name = 'electronics-ui-679-557-browser-${{ github.run_id }}';
    }
    expect(scoped.jobs.browser).toEqual(browser);
  });
});
