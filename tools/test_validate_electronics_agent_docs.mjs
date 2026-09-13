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

// A disposable repository-shaped fixture: never mutate the checkout/current.yaml.
function check(mutate = () => {}) {
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
      [`${docs}/tasks/E-OPT-1A.md`]: `- **Execution task ID:** \`${taskId}\`\n`,
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
    const result = spawnSync(process.execPath, [validator], {
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
    /symbol is not present/,
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

test('preserves read-only owner-asset directory routing', () => {
  const result = check((f, c) => {
    c.ownership = 'owner_asset';
    c.sources = ['contexts/electronics/**'];
    c.symbols = [];
  });
  assert.equal(result.status, 0, result.output);
});
