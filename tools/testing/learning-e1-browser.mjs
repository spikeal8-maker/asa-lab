import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import ts from 'typescript';
import console from 'node:console';
import process from 'node:process';

const firstSelectors = [
  'e2e/learning-author-preview.spec.ts',
  'e2e/learning-course-01.spec.ts',
  'e2e/courses-sharing.spec.ts',
];
const secondSelectors = [
  'e2e/learning-learner-submits-project-assignment.spec.ts',
  'e2e/learning-surface-convergence.spec.ts',
  'e2e/learning-teacher-assigns-activity.spec.ts',
];

// Fixed identities and order; locations must come from this checkout's CLI.
// Exact title equality here is metadata validation, never a text-grep selector.
const manifest = {
  'courses-sharing.spec.ts': [
    'a teacher adds one complete published demo course',
    'named Library exact mixed v1 copy survives source v2 and lost response then delivers owned media and real work',
  ],
  'learning-author-preview.spec.ts': [
    'exact saved and published learner preview ignores late responses and creates no commands',
    'ordered safe task blocks remain pinned in v1 preview at four widths after a future draft edit',
    'draft from historical Course and Activity versions uses the author UI, protects an active draft and publishes root-next versions',
    'content-first image and PDF keep the new draft selectable as a project practice',
    'first-class image block survives draft reload and pins exact published bytes',
    'teacher draft image persists, replaces and deletes',
    'published task image stays immutable across versions',
    'course and section forms preserve later edits after real save receipts without duplicates or rebasing competing changes',
    'Course publication lost response replays the exact V1 after V2 and reload without duplicate versions',
    'Course history compares exact V1–V4 policies and structural before/after changes without current defaults',
  ],
  'learning-course-01.spec.ts': [
    'author-only content keeps exact ID and versions after teaching activation; graded scale and mute are usable',
    'matrix 30 × 10, named exclusions, course filter, individual allowance and mobile viewport',
    'Teacher queue: exact review, settings read/OFF, return/resubmit, accept and exact join approval',
    'ungraded real submission has an official acceptance but no manufactured points or grade',
    'V3 Direct Seat double Start, lost response, second tab and reload keep one work',
    'teacher authors and assigns a canonical activity to the whole class and a learner sees it',
    'teacher authors and selects two learners and the third learner cannot see the assignment',
    'real three-d Seat save → exact submission → teacher returns → new attempt → accepted matrix result',
    'real electronics Seat save → exact submission → teacher returns → new attempt → accepted matrix result',
    'Course Builder preserves typed lesson edits across real hide and show responses',
    'Course Builder duplicates a section and excludes hidden lesson only from future versions',
    'Course Builder persists informational block structural controls into future versions only',
    'private authored course → approved Account → theory and real electronics submission → exact review',
    'private authored course → approved Account → theory and real three-d submission → exact review',
    'Course Activity blocks preserve mixed order and open exact Electronics and 3D runtimes',
    'Course Builder corrects the exact second prepublish block and preserves later edits and published history',
    'Course archive rejects a stale assignment dialog, keeps exact replay and old learning, then restores assignment',
    'Course media errors survive saved author preview and learner delivery with explicit retry',
  ],
  'learning-learner-submits-project-assignment.spec.ts': [
    'learner starts the real project editor and submits one immutable attempt',
    'approved Account starts a Direct assignment by its exact Run without legacy work',
    'old Direct and lesson-level Course handouts cannot create an orphan Project',
    'named audience excludes the third learner from read, start and submit',
    'UX1A4 keeps an exact task image in an independent desktop reference window',
    'A0 desktop Electronics uses a permanent anchor and compact movable task panel',
    'A0 3D shell keeps anchor and panel above the editor while tools remain interactive',
    'A0 Blocks keeps anchor and panel topmost over fullscreen Scratch',
    'A0 mobile shell uses a permanent bottom anchor and bounded sheet at 390 and 320',
  ],
  'learning-surface-convergence.spec.ts': [
    'legacy, revision and selected-result semantics stay equal across learner and teacher surfaces',
  ],
  'learning-teacher-assigns-activity.spec.ts': [
    'teacher assigns a canonical activity to the whole class and a learner sees it',
    'learner sees ordered safe task blocks in direct assignment and project shell',
    'teacher selects two learners and the third learner cannot see the assignment',
    'learner exact published task image stays pinned across v1 and v2',
    'A6 PDF material stays readable through exact direct assignment versions',
  ],
};
const root = process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  check(JSON.stringify(actual) === JSON.stringify(expected), message);
}
function problem(phase, error) {
  console.error(`Learning E1 ${phase}: ${error.message}`);
}
function command(args, report) {
  const child = spawnSync('pnpm', ['exec', 'playwright', 'test', ...args], {
    stdio: 'inherit',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
  });
  if (child.error) {
    problem('process launch failed', child.error);
    return child.status || 1;
  }
  return child.status ?? (child.signal ? 128 + (constants.signals[child.signal] ?? 1) : 1);
}
function identity(spec) {
  return {
    id: spec.id,
    file: spec.file,
    title: spec.title,
    line: spec.line,
    column: spec.column,
    projectId: spec.tests[0].projectId,
    projectName: spec.tests[0].projectName,
  };
}
function cases(report) {
  check(Array.isArray(report.suites), 'Missing report suites.');
  const result = [];
  for (const suite of report.suites) {
    check(Object.hasOwn(manifest, suite.file), 'Unexpected file in report.');
    check(
      suite.suites === undefined || (Array.isArray(suite.suites) && suite.suites.length === 0),
      'Nested suites require review of declaration and execution order.',
    );
    check(Array.isArray(suite.specs) && suite.specs.length > 0, 'Missing file specs.');
    for (const spec of suite.specs) {
      check(spec.file === suite.file && typeof spec.title === 'string', 'Invalid case identity.');
      check(typeof spec.id === 'string' && spec.id.length > 0, 'Missing Playwright case ID.');
      check(
        Number.isInteger(spec.line) &&
          spec.line > 0 &&
          Number.isInteger(spec.column) &&
          spec.column > 0,
        'Invalid declaration location.',
      );
      check(
        Array.isArray(spec.tests) && spec.tests.length === 1,
        'Each case must have exactly one project and repetition.',
      );
      const test = spec.tests[0];
      check(test.projectId === '' && test.projectName === '', 'Unexpected project identity.');
      check(Array.isArray(test.results), 'Missing case results.');
      result.push(spec);
    }
  }
  check(new Set(result.map((spec) => spec.id)).size === result.length, 'Duplicate case IDs.');
  return result;
}
function configuration(report, destination) {
  const config = report.config;
  check(config?.version === '1.55.1', 'Review discovery protocol after Playwright version drift.');
  check(
    config.configFile === path.join(root, 'playwright.config.ts') &&
      config.rootDir === path.join(root, 'e2e'),
    'Unexpected Playwright config or test root.',
  );
  check(
    config.workers === 1 &&
      config.fullyParallel === false &&
      config.shard === null &&
      config.maxFailures === 0 &&
      config.globalTimeout === 0 &&
      config.globalSetup === null &&
      config.globalTeardown === null,
    'Execution isolation, order or timeout configuration changed.',
  );
  equal(
    config.webServer,
    {
      command: 'node e2e/server.mjs',
      url: 'http://127.0.0.1:4612/health/live',
      reuseExistingServer: false,
      timeout: 30000,
    },
    'The ordinary Playwright-managed API lifecycle changed.',
  );
  check(Array.isArray(config.projects) && config.projects.length === 1, 'Unexpected projects.');
  const project = config.projects[0];
  check(
    project.id === '' &&
      project.name === '' &&
      project.repeatEach === 1 &&
      project.retries === 0 &&
      project.timeout === 30000 &&
      project.testDir === path.join(root, 'e2e') &&
      project.outputDir === path.join(destination, 'results'),
    'Project, retries, timeout or isolated output changed.',
  );
  check(
    Array.isArray(report.errors) && report.errors.length === 0,
    'Global Playwright report errors.',
  );
}
function sourceStructure() {
  // JSON --list does not expose .only or serial/parallel modifiers. Keep this
  // bounded matrix flat and reject aliases/modifiers instead of guessing order.
  const allowed = new Set(['use', 'beforeAll', 'afterAll', 'setTimeout']);
  for (const file of Object.keys(manifest)) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(root, 'e2e', file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    let imports = 0;
    function visit(node) {
      if (ts.isIdentifier(node) && node.text === 'test') {
        const parent = node.parent;
        // Property names such as RegExp.test are not references to this import.
        if (ts.isPropertyAccessExpression(parent) && parent.name === node) return;
        if (
          ts.isImportSpecifier(parent) &&
          parent.name === node &&
          !parent.propertyName &&
          parent.parent.parent.parent.moduleSpecifier?.text === '@playwright/test'
        ) {
          imports += 1;
        } else if (ts.isCallExpression(parent) && parent.expression === node) {
          const statement = parent.parent;
          const container = statement.parent;
          check(
            ts.isExpressionStatement(statement) &&
              (ts.isSourceFile(container) ||
                (ts.isForOfStatement(container) && ts.isSourceFile(container.parent)) ||
                (ts.isBlock(container) &&
                  ts.isForOfStatement(container.parent) &&
                  ts.isSourceFile(container.parent.parent))),
            `${file}: review non-root test declarations.`,
          );
        } else {
          check(
            ts.isPropertyAccessExpression(parent) &&
              parent.expression === node &&
              allowed.has(parent.name.text) &&
              ts.isCallExpression(parent.parent) &&
              parent.parent.expression === parent,
            `${file}: review test API alias or modifier.`,
          );
          if (parent.name.text !== 'setTimeout') {
            check(
              ts.isExpressionStatement(parent.parent.parent) &&
                ts.isSourceFile(parent.parent.parent.parent),
              `${file}: review moved hooks or options.`,
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    check(imports === 1, `${file}: expected the original Playwright test import.`);
  }
}
function discover(selectors, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const reportPath = path.join(destination, 'discovery.json');
  check(!fs.existsSync(reportPath), 'Discovery report must be new for this invocation.');
  const status = command(
    [
      ...selectors,
      '--workers=1',
      '--list',
      '--reporter=json',
      '--output',
      path.join(destination, 'results'),
    ],
    reportPath,
  );
  if (status !== 0) {
    const error = new Error(`Discovery process exited ${status}.`);
    error.exitCode = status;
    throw error;
  }
  const report = read(reportPath);
  configuration(report, destination);
  const specs = cases(report);
  for (const spec of specs) {
    const test = spec.tests[0];
    check(
      test.results.length === 0 &&
        test.expectedStatus === 'passed' &&
        Array.isArray(test.annotations) &&
        test.annotations.length === 0,
      'Discovery must contain ordinary, unexecuted cases.',
    );
  }
  return specs.map(identity);
}
function approved(discovered, files) {
  equal(
    discovered.map(({ file, title, projectId, projectName }) => ({
      file,
      title,
      projectId,
      projectName,
    })),
    files.flatMap((file) =>
      manifest[file].map((title) => ({ file, title, projectId: '', projectName: '' })),
    ),
    'Ordered case identity matrix changed; review the complete original batches.',
  );
}
function execution(report, destination, expected) {
  configuration(report, destination);
  const specs = cases(report);
  equal(
    specs.map(identity),
    expected,
    'Execution IDs/order/locations differ from verified discovery.',
  );
  let previousStart = -Infinity;
  for (const spec of specs) {
    const test = spec.tests[0];
    check(
      test.expectedStatus === 'passed' && test.status === 'expected' && test.results.length === 1,
      `${spec.id}: expected exactly one actual passing execution.`,
    );
    const result = test.results[0];
    check(
      result.status === 'passed' &&
        result.retry === 0 &&
        Array.isArray(result.errors) &&
        result.errors.length === 0 &&
        !result.error,
      `${spec.id}: missing, skipped, interrupted, retried or failed execution.`,
    );
    check(
      Array.isArray(test.annotations) &&
        test.annotations.length === 0 &&
        Number.isInteger(result.workerIndex) &&
        result.workerIndex >= 0 &&
        result.parallelIndex === 0,
      `${spec.id}: unexpected execution annotation or worker.`,
    );
    const start = Date.parse(result.startTime);
    check(
      Number.isFinite(start) && start >= previousStart,
      'Actual case starts changed declaration order.',
    );
    previousStart = start;
  }
  equal(
    [report.stats?.expected, report.stats?.skipped, report.stats?.unexpected, report.stats?.flaky],
    [expected.length, 0, 0, 0],
    'Execution summary does not prove every required case passed.',
  );
  return specs.map((spec) => ({
    ...identity(spec),
    expectedStatus: spec.tests[0].expectedStatus,
    results: spec.tests[0].results.map(
      ({ status, retry, startTime, workerIndex, parallelIndex }) => ({
        status,
        retry,
        startTime,
        workerIndex,
        parallelIndex,
      }),
    ),
  }));
}

function main() {
  const expectedScript =
    `playwright test ${firstSelectors.join(' ')} --workers=1 && ` +
    `playwright test ${secondSelectors.join(' ')} --workers=1`;
  check(
    read('package.json').scripts?.['e2e:learning-e1'] === expectedScript,
    'Learning E1 package script changed: review the complete batch matrix before running.',
  );
  sourceStructure();
  const parent = path.join(root, 'reports/playwright/learning-e1');
  fs.mkdirSync(parent, { recursive: true });
  // A fresh run directory makes stale JSON impossible to accept. Every report
  // and snapshot is a sibling of the only output leaf Playwright may clean.
  const evidence = fs.mkdtempSync(path.join(parent, 'run-'));
  const first = discover(firstSelectors, path.join(evidence, 'discovery/full-first'));
  const second = discover(secondSelectors, path.join(evidence, 'discovery/full-second'));
  const files = Object.keys(manifest);
  approved(first, files.slice(0, 3));
  approved(second, files.slice(3));
  const course = first.filter(({ file }) => file === 'learning-course-01.spec.ts');
  const groups = [];
  for (const entry of course) {
    const last = groups.at(-1);
    if (last && last[0].line === entry.line && last[0].column === entry.column) last.push(entry);
    else groups.push([entry]);
  }
  equal(
    groups.map((group) => group.length),
    [1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 1],
    'Review changed course declarations or either parameterized pair.',
  );
  check(
    new Set(groups.map(([entry]) => `${entry.line}:${entry.column}`)).size === 16,
    'A declaration cannot appear in multiple groups.',
  );
  const firstBatches = files.slice(0, 2).map((file, index) => ({
    name: `0${index + 1}-${file.replace('.spec.ts', '')}`,
    selectors: [`e2e/${file}`],
    cases: first.filter((entry) => entry.file === file),
  }));
  const escapedFile = path
    .join(root, 'e2e/learning-course-01.spec.ts')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  groups.forEach((group, index) =>
    firstBatches.push({
      name: `${String(index + 3).padStart(2, '0')}-course-declaration-${String(index + 1).padStart(2, '0')}`,
      selectors: [`^${escapedFile}$:${group[0].line}:${group[0].column}`],
      cases: group,
    }),
  );
  const secondBatch = { name: '19-second-batch', selectors: secondSelectors, cases: second };
  const verified = [];
  // Pre-discover every actual invocation before any browser/server starts.
  for (const batch of [...firstBatches, secondBatch]) {
    const selected = discover(batch.selectors, path.join(evidence, 'discovery', batch.name));
    equal(
      selected,
      batch.cases,
      `${batch.name}: selector does not select exactly its approved group.`,
    );
    if (batch !== secondBatch) verified.push(...selected);
  }
  equal(verified, first, 'Ordered first-batch union must be all 30 cases exactly once.');
  equal(
    firstBatches.slice(2).flatMap((batch) => batch.cases),
    course,
    'Ordered declaration union must be all 18 course cases exactly once.',
  );
  write(path.join(evidence, 'plan.json'), {
    playwright: '1.55.1',
    adaptedFrom: {
      pullRequest: 639,
      sourceSha: '4a651e236e2e7b97aa7c61c59243e92da21b3bf3',
      workflowBlob: '48e323051eacef4284c256cdf6c3016c499ef361',
    },
    first: firstBatches,
    second: secondBatch,
  });

  const receipts = [];
  function run(batch) {
    const destination = path.join(evidence, batch.name);
    const reportPath = path.join(destination, 'execution.json');
    let testExitCode;
    let coverageExitCode = 0;
    let evidenceExitCode = 0;
    let actual = [];
    const failures = [];
    function failed(phase, error) {
      failures.push({ phase, message: error.message });
      problem(`${batch.name} ${phase}`, error);
    }
    console.log(`::group::Learning E1 ${batch.name}`);
    try {
      fs.mkdirSync(destination); // No reused invocation can accept an earlier JSON.
    } catch (error) {
      evidenceExitCode = 1;
      failed('create evidence', error);
    }
    try {
      // Each invocation gets the unchanged, ordinary config.webServer lifecycle.
      // Normal hooks and teacher/sequence/keys reset for each declaration group;
      // both loop pairs stay whole, including normal worker restarts on failure.
      testExitCode = command(
        [
          ...batch.selectors,
          '--workers=1',
          '--reporter=list,json',
          '--output',
          path.join(destination, 'results'),
        ],
        reportPath,
      );
    } catch (error) {
      testExitCode = 1;
      failed('execute', error);
    }
    try {
      actual = execution(read(reportPath), destination, batch.cases);
    } catch (error) {
      coverageExitCode = 1;
      failed('coverage', error);
    }
    // Raw execution.json retains actual IDs/statuses even when strict coverage
    // fails. A missing/broken report or a hook-skipped body can never pass.
    try {
      write(path.join(destination, 'coverage.json'), {
        expected: batch.cases,
        actual,
        coverageExitCode,
        failures,
      });
    } catch (error) {
      evidenceExitCode = 1;
      failed('write coverage', error);
    }
    for (const area of ['learning', 'courses']) {
      try {
        const source = path.join(root, 'e2e/artifacts', area);
        // Existing files are snapshots, not a claim of new screenshots.
        if (fs.existsSync(source))
          fs.cpSync(source, path.join(destination, 'artifact-snapshot', area), {
            recursive: true,
            preserveTimestamps: true,
          });
      } catch (error) {
        evidenceExitCode = 1;
        failed('snapshot', error);
      }
    }
    const receipt = { batch: batch.name, testExitCode, coverageExitCode, evidenceExitCode };
    try {
      write(path.join(destination, 'exit.json'), receipt);
    } catch (error) {
      receipt.evidenceExitCode = 1;
      failed('write exit', error);
    }
    receipts.push(receipt);
    console.log('::endgroup::');
    // Preserve the process exit even if reporting or copying also failed.
    return receipt.testExitCode || receipt.coverageExitCode || receipt.evidenceExitCode;
  }
  let firstExitCode = 0;
  for (const batch of firstBatches) {
    const status = run(batch);
    if (firstExitCode === 0 && status !== 0) firstExitCode = status;
  }
  let secondExitCode = null;
  if (firstExitCode === 0) secondExitCode = run(secondBatch);
  else console.log('First Learning E1 batch failed; the original second batch is NOT_RUN.');
  const exitCode = firstExitCode || secondExitCode || 0;
  try {
    write(path.join(evidence, 'summary.json'), {
      first: { cases: 30, exitCode: firstExitCode, status: firstExitCode ? 'FAIL' : 'PASS' },
      second: {
        cases: 15,
        exitCode: secondExitCode,
        status: secondExitCode === null ? 'NOT_RUN' : secondExitCode ? 'FAIL' : 'PASS',
      },
      invocations: receipts,
    });
  } catch (error) {
    problem('write summary', error);
    process.exitCode = exitCode || 1;
    return;
  }
  process.exitCode = exitCode;
}
try {
  main();
} catch (error) {
  problem('preflight failed', error);
  process.exitCode = error.exitCode || 1;
}
