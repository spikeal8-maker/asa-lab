import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

const validator = fileURLToPath(new URL('./validate-electronics-agent-docs.mjs', import.meta.url));
const docs = 'docs/product/electronics';
const id = 'electronics.engine.example';
const taskId = 'TASK-ELECTRONICS-EOPT1A-001';

function taskMarkdown(metadata = {}) {
  return `---\n${YAML.stringify({ task_id: taskId, kind: 'design-decision', risk: 'medium', semantic_change: 'no', roadmap_slice: 'E-OPT-1A', prerequisites: [], acceptance_boundary: 'slice', review: 'self', ...metadata })}---\n# Bounded task\n`;
}

// A disposable repository-shaped fixture: never mutate the checkout/current.yaml.
function check(mutate = () => {}, args = []) {
  const root = mkdtempSync(join(tmpdir(), 'asa-electronics-routing-test-'));
  const component = {
    risk: 'high',
    ownership: 'asa',
    contracts: [`${docs}/README.md#actual-contract`],
    sources: ['contexts/electronics/example.ts'],
    symbols: ['runExample'],
    tests: ['contexts/electronics/example.spec.ts'],
    dependencies: [],
  };
  const fixture = {
    map: {
      areas: { example: 'components/example.yaml' },
      components: { [id]: { card: 'components/example.yaml' } },
    },
    card: { area: 'example', components: { [id]: component } },
    current: { primary_lane: { id: 'electronics' }, task: { id: taskId, status: 'in_progress' } },
    files: {
      [`${docs}/README.md`]: '# Actual contract\n\n```md\n# Not a contract\n```\n',
      [`${docs}/tasks/E-OPT-1A.md`]: taskMarkdown(),
      'contexts/electronics/example.ts': 'export function runExample() {}\n',
      'contexts/electronics/example.spec.ts': 'test fixture\n',
    },
  };
  const put = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  };
  try {
    for (const name of [
      'START_HERE',
      'AGENT_GUIDE',
      'DEVELOPMENT_SPEC',
      'ASA_ELECTRONICS_OPTIMIZATION_PLAN_V2',
    ]) {
      fixture.files[`${docs}/${name}.md`] = '# Fixture\n';
    }
    for (const kind of ['IMPLEMENTATION', 'MAINTENANCE', 'DESIGN', 'DEPLOYMENT']) {
      fixture.files[`${docs}/tasks/${kind}_TASK_TEMPLATE.md`] = '# Template\n';
    }
    mutate(fixture, component);
    put(`${docs}/COMPONENT_MAP.yaml`, YAML.stringify(fixture.map));
    put(`${docs}/components/example.yaml`, YAML.stringify(fixture.card));
    put('docs/execution/current.yaml', YAML.stringify(fixture.current));
    for (const [path, content] of Object.entries(fixture.files)) put(path, content);
    const result = spawnSync(process.execPath, [validator, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20_000,
    });
    assert.ifError(result.error);
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    // This path is created above by mkdtemp, outside every real checkout.
    const tempRelative = relative(resolve(tmpdir()), resolve(root));
    assert.ok(
      tempRelative.startsWith('asa-electronics-routing-test-') &&
        !tempRelative.includes('..') &&
        !isAbsolute(tempRelative),
    );
    rmSync(root, { recursive: true, force: true });
  }
}

test('accepts exact canonical EOPT1A selection and mapped contract/source/test', () => {
  assert.equal(check().status, 0);
});

test('matches GitHub heading anchors with adjacent spaces/punctuation and duplicate headings', () => {
  const result = check((f, c) => {
    f.files[`${docs}/README.md`] = '# E-OPT-1 — Boundary\n# Repeat\n# Repeat\n';
    c.contracts = [`${docs}/README.md#e-opt-1--boundary`, `${docs}/README.md#repeat-1`];
  });
  assert.equal(result.status, 0, result.output);
});

const rejections = [
  [
    'canonical EOPT1A task with no declared card',
    (f) => {
      f.files[`${docs}/tasks/E-OPT-1A.md`] = '# Inventory\n';
    },
    /must map to exactly one task card/,
  ],
  [
    'task ID mentioned only in prose',
    (f) => {
      f.files[`${docs}/tasks/E-OPT-1A.md`] = `Later: ${taskId}\n`;
    },
    /must map to exactly one task card/,
  ],
  [
    'duplicate declared task cards',
    (f) => {
      f.files[`${docs}/tasks/duplicate.md`] = f.files[`${docs}/tasks/E-OPT-1A.md`];
    },
    /must map to exactly one task card/,
  ],
  [
    'missing source outside old recognized path prefixes',
    (_, c) => {
      c.sources = ['missing/example.ts'];
    },
    /sources path does not exist/,
  ],
  [
    'traversal route even to an existing file',
    (_, c) => {
      c.tests = ['contexts/electronics/../electronics/example.spec.ts'];
    },
    /tests path does not exist/,
  ],
  [
    'directory used as an exact test',
    (_, c) => {
      c.tests = ['contexts/electronics'];
    },
    /tests path does not exist/,
  ],
  [
    'broad test wildcard',
    (_, c) => {
      c.tests = ['contexts/electronics/**'];
    },
    /tests must be exact/,
  ],
  [
    'question-mark test glob',
    (_, c) => {
      c.tests = ['contexts/electronics/example.spec.?s'];
    },
    /tests must be exact/,
  ],
  [
    'broad runtime source preload',
    (_, c) => {
      c.sources = ['contexts/electronics/**'];
    },
    /sources must name exact files/,
  ],
  [
    'nonexistent contract anchor',
    (_, c) => {
      c.contracts = [`${docs}/README.md#missing`];
    },
    /markdown heading does not exist/,
  ],
  [
    'heading inside a code fence',
    (_, c) => {
      c.contracts = [`${docs}/README.md#not-a-contract`];
    },
    /markdown heading does not exist/,
  ],
  [
    'full README as default contract',
    (_, c) => {
      c.contracts = [`${docs}/README.md`];
    },
    /must name an exact heading/,
  ],
  [
    'component with no contract',
    (_, c) => {
      c.contracts = [];
    },
    /at least one exact contract/,
  ],
  [
    'invalid risk enum',
    (_, c) => {
      c.risk = 'safe';
    },
    /risk invalid/,
  ],
  [
    'invalid ownership enum',
    (_, c) => {
      c.ownership = 'someone';
    },
    /ownership invalid/,
  ],
  [
    'missing source symbol',
    (_, c) => {
      c.symbols = ['notThere'];
    },
    /symbol declaration is not present/,
  ],
  [
    'large source whose only routed symbol is in another file',
    (f, c) => {
      f.files['contexts/electronics/large.ts'] = '// long source\n'.repeat(4000);
      c.sources.push('contexts/electronics/large.ts');
    },
    /large source without a matching symbol/,
  ],
  [
    'unmapped dependency',
    (_, c) => {
      c.dependencies = ['electronics.missing'];
    },
    /depends on unmapped/,
  ],
  [
    'dependency cycle',
    (_, c) => {
      c.dependencies = [id];
    },
    /dependency cycle/,
  ],
  [
    'malformed dependencies',
    (_, c) => {
      c.dependencies = 3;
    },
    /dependencies must be an array/,
  ],
  [
    'progress state in a routing card',
    (_, c) => {
      c.implementation_state = 'done';
    },
    /must not duplicate/,
  ],
  [
    'live CI status in a routing card',
    (_, c) => {
      c.ci_status = 'PASS';
    },
    /must not duplicate/,
  ],
  [
    'empty component map',
    (f) => {
      f.map.components = {};
    },
    /components must be a non-empty mapping/,
  ],
  [
    'map/card mismatch',
    (f) => {
      f.card.components = {};
    },
    /missing from routed card/,
  ],
  [
    'duplicate YAML component IDs',
    (f) => {
      f.files[`${docs}/components/example.yaml`] =
        `area: example\ncomponents:\n  ${id}: {}\n  ${id}: {}\n`;
    },
    /invalid yaml/,
  ],
];

for (const [name, mutate, expected] of rejections) {
  test(`rejects ${name}`, () => {
    const result = check(mutate);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, expected);
    assert.doesNotMatch(result.output, /TypeError:|ENOENT:/);
  });
}

test('rejects owner-asset directory in readable sources', () => {
  const result = check((f, c) => {
    c.ownership = 'owner_asset';
    c.sources = ['contexts/electronics/**'];
    c.symbols = [];
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /sources must name exact files/);
});

test('accepts separate protected asset_roots without preloading sources', () => {
  const result = check((f, c) => {
    c.ownership = 'owner_asset';
    c.sources = [];
    c.symbols = [];
    c.asset_roots = ['apps/web/public/assets/electronics/owner-audit'];
    f.files[`${c.asset_roots[0]}/manifest.json`] = '{}';
  });
  assert.equal(result.status, 0, result.output);
});

for (const kind of [
  'implementation',
  'maintenance',
  'repair',
  'design-decision',
  'component/peripheral',
  'deployment',
]) {
  const selectedId = `TASK-ELECTRONICS-${kind.replace(/[^a-z]/g, '').toUpperCase()}-001`;
  test(`rejects active ${kind} without its concrete card`, () => {
    const result = check((f) => {
      f.current.task.id = selectedId;
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /must map to exactly one task card/);
  });
  test(`accepts selected ${kind} with matching metadata`, () => {
    const result = check(
      (f) => {
        f.current.task.id = selectedId;
        f.files[`${docs}/tasks/E-OPT-1A.md`] = taskMarkdown({
          task_id: selectedId,
          kind,
          risk: kind === 'deployment' ? 'critical' : 'medium',
          review: kind === 'deployment' ? 'independent' : 'self',
        });
      },
      ['--task', selectedId],
    );
    assert.equal(result.status, 0, result.output);
  });
}

for (const [name, source] of [
  ['comment', '// export function runExample() {}'],
  ['string', 'const text = "export function runExample() {}";'],
  ['substring', 'export function runExampleExtra() {}'],
  ['import', 'import {runExample} from "./other";'],
  ['re-export', 'export {runExample} from "./other";'],
]) {
  test(`rejects symbol present only in ${name}`, () => {
    const result = check((f) => {
      f.files['contexts/electronics/example.ts'] = source;
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /symbol declaration is not present/);
  });
}

test('accepts exported and internal declarations in TS/TSX/JS/MJS', () => {
  const result = check((f, c) => {
    c.sources = [
      'contexts/electronics/a.ts',
      'contexts/electronics/b.tsx',
      'contexts/electronics/c.js',
      'contexts/electronics/d.mjs',
    ];
    c.symbols = [
      'runExample',
      'Example',
      'Mode',
      'Port',
      'internalValue',
      'javascriptFn',
      'workerFn',
    ];
    f.files[c.sources[0]] =
      'function runExample() {} export class Example {} type Mode = number; interface Port {}';
    f.files[c.sources[1]] = 'const internalValue = <div />;';
    f.files[c.sources[2]] = 'export const javascriptFn = () => {};';
    f.files[c.sources[3]] = 'export function workerFn() {}';
  });
  assert.equal(result.status, 0, result.output);
});

for (const [name, metadata, expected] of [
  ['wrong semantic flag', { semantic_change: 'maybe' }, /invalid semantic_change/],
  ['boolean semantic flag', { semantic_change: false }, /invalid semantic_change/],
  ['unknown task kind', { kind: 'anything' }, /invalid task kind/],
  ['malformed task ID', { task_id: 'TASK-ELECTRONICS-BROKEN' }, /invalid task_id/],
  [
    'wrong declared Task ID',
    { task_id: 'TASK-ELECTRONICS-OTHER-001' },
    /must map to exactly one task card/,
  ],
  [
    'HIGH semantic change without review',
    { risk: 'high', semantic_change: 'yes' },
    /independent review is required/,
  ],
  ['CRITICAL operation without review', { risk: 'critical' }, /independent review is required/],
  [
    'milestone acceptance without review',
    { acceptance_boundary: 'milestone' },
    /independent review is required/,
  ],
  ['lowered deployment risk', { kind: 'deployment' }, /deployment risk must be critical/],
  ['competing progress state', { status: 'in_progress' }, /unknown task metadata status/],
]) {
  test(`rejects metadata: ${name}`, () => {
    const result = check((f) => {
      f.files[`${docs}/tasks/E-OPT-1A.md`] = taskMarkdown(metadata);
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, expected);
  });
}

test('allows planned card during governance but rejects executing that unselected card', () => {
  const mutate = (f) => {
    f.current.task.id = 'TASK-ELECTRONICS-GOVERNANCE-002';
  };
  assert.equal(check(mutate).status, 0);
  const result = check(mutate, ['--task', taskId]);
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /is not selected for execution/);
});

test('in-review task cannot be started as in-progress', () => {
  const result = check(
    (f) => {
      f.current.task.status = 'in_review';
    },
    ['--task', taskId],
  );
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /is not selected for execution/);
});

test('rejects duplicate YAML metadata keys', () => {
  const result = check((f) => {
    f.files[`${docs}/tasks/E-OPT-1A.md`] = taskMarkdown().replace(
      'kind: design-decision',
      'kind: maintenance\nkind: design-decision',
    );
  });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /malformed task declaration/);
});

for (const [name, assetRoot, ownership] of [
  ['unprotected directory', 'contexts/electronics', 'owner_asset'],
  ['asset root glob', 'apps/web/public/assets/electronics/owner-audit/**', 'owner_asset'],
  ['root on non-asset component', 'apps/web/public/assets/electronics/owner-audit', 'asa'],
  ['missing protected root', 'apps/web/public/assets/electronics/owner-audit', 'owner_asset'],
]) {
  test(`rejects ${name}`, () => {
    const result = check((f, c) => {
      c.ownership = ownership;
      c.asset_roots = [assetRoot];
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /invalid owner asset_root/);
  });
}
