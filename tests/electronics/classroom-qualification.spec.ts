import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const readyPath = new URL('../../e2e/electronics-ready-cadence.spec.ts', import.meta.url);
const readyText = readFileSync(readyPath, 'utf8');
const readyCompact = readyText.replace(/\s+/g, ' ');
const readySource = ts.createSourceFile(
  'ready-cadence.ts',
  readyText,
  ts.ScriptTarget.Latest,
  true,
);
const runnerPath = fileURLToPath(
  new URL('../../tools/run-electronics-classroom-browser.mjs', import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const entrypoint = 'gate:electronics-classroom-d13:browser';
const sites = [
  [
    'no-delay-execution-wall-model',
    'Owner Arduino execution: no-delay realtime, production frames and painted LEDs',
  ],
  [
    'delay-1-temporal-wall-model',
    'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
  ],
  [
    'reset-temporal-wall-model',
    'Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history',
  ],
] as const;
const millisTitle =
  'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases';
type Ledger = {
  schema: string;
  profile: string;
  entrypoint: string | null;
  title: string;
  expectedSourceSha: string | null;
  observerSha256: string;
  entries: Array<Record<string, unknown>>;
};
type ReadyTimestamp = { at: number; committedHorizonMicroseconds: number };
type MountedWitness = {
  nativeLoad: (
    element: object,
    href: string,
    at: number,
    trusted: boolean,
    connected: boolean,
  ) => void;
  nativeError: (element: object, trusted: boolean) => void;
  changed: (element: object, previousHref: string, href: string) => void;
  current: (element: object, href: string, connected: boolean) => number | null;
};

// Execute the real pure qualification and native-element witness functions.
// Importing the Playwright spec itself would initialize unrelated DB fixtures.
const functionNames = new Set([
  'ownerQualificationProfile',
  'assertOwnerQualificationIdentity',
  'recordOwnerQualifiedWallClock',
  'ownerQualificationRequiredSites',
  'ownerQualificationMissingSites',
  'requireOwnerQualificationComplete',
  'recordOwnerMillisAcquisition',
  'createOwnerMountedImageWitness',
  'assertTemporalWallClock',
]);
const constantNames = new Set(['OWNER_CLASSROOM_WALL_SITES', 'OWNER_MILLIS_CASE']);
const declarations: string[] = [];
const found = new Set<string>();
function collectDeclarations(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && node.name && functionNames.has(node.name.text)) {
    if (found.has(node.name.text)) throw new Error(`Duplicate actual oracle: ${node.name.text}`);
    found.add(node.name.text);
    declarations.push(node.getText(readySource));
  }
  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && constantNames.has(declaration.name.text)) {
        if (found.has(declaration.name.text))
          throw new Error(`Duplicate actual constant: ${declaration.name.text}`);
        found.add(declaration.name.text);
        declarations.push(node.getText(readySource));
      }
    }
  }
  ts.forEachChild(node, collectDeclarations);
}
collectDeclarations(readySource);
if (found.size !== functionNames.size + constantNames.size)
  throw new Error('Actual qualification oracle is incomplete.');
const oracleJavaScript = ts.transpileModule(
  `${declarations.join('\n')}
({ profile: ownerQualificationProfile, qualify: recordOwnerQualifiedWallClock,
   required: ownerQualificationRequiredSites, complete: requireOwnerQualificationComplete,
   millis: recordOwnerMillisAcquisition, mounted: createOwnerMountedImageWitness,
   clock: assertTemporalWallClock });`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  },
).outputText;

function ledger(title: string = sites[0][1], profile: string = 'classroom-d13-v2'): Ledger {
  return {
    schema: 'electronics-classroom-qualification-v2',
    profile,
    entrypoint: profile === 'classroom-d13-v2' ? entrypoint : null,
    title,
    expectedSourceSha: 'a'.repeat(40),
    observerSha256: 'b'.repeat(64),
    entries: [],
  };
}
function oracle(value: Ledger | null = null) {
  return runInNewContext(oracleJavaScript, {
    expect,
    ownerQualificationLedger: value,
    test: { info: () => ({ title: value?.title ?? '' }) },
  }) as {
    profile: (value?: string, entrypoint?: string) => string;
    qualify: (
      ledger: Ledger | null,
      title: string,
      site: string,
      modelMs: number,
      wallMs: number,
    ) => Record<string, unknown>;
    required: (title: string) => string[];
    complete: (ledger: Ledger | null, title: string) => void;
    millis: (
      ledger: Ledger | null,
      title: string,
      sourceSha: string,
      waitAt: number,
      observedAt: number,
      rows: ReadyTimestamp[],
    ) => Record<string, unknown>;
    mounted: () => MountedWitness;
    clock: (
      ready: ReadyTimestamp[],
      minimumMs: number,
      site?: string,
    ) => { modelMs: number; wallMs: number };
  };
}

describe('explicit classroom qualification identity and original strict outcomes', () => {
  it('defaults to strict and rejects an ambient classroom profile without its named runner', () => {
    const actual = oracle();
    expect(actual.profile()).toBe('strict-real-time');
    expect(actual.profile('strict-real-time')).toBe('strict-real-time');
    expect(actual.profile('classroom-d13-v2', entrypoint)).toBe('classroom-d13-v2');
    for (const profile of ['', 'classroom', 'unknown', 'Classroom-d13-v2'])
      expect(() => actual.profile(profile, entrypoint)).toThrow();
    expect(() => actual.profile('classroom-d13-v2')).toThrow();
    expect(() => actual.profile('classroom-d13-v2', 'gate:electronics-m1:browser')).toThrow();
    expect(() => actual.profile('strict-real-time', entrypoint)).toThrow();
    expect(() => actual.profile(undefined, entrypoint)).toThrow();
  });

  it.each(sites)(
    'records %s before a strict failure and only that exact classroom comparison is nonbinding',
    (site, title) => {
      const strict = ledger(title, 'strict-real-time');
      expect(() => oracle().qualify(strict, title, site, 1500, 2100)).toThrow('600 ms > 250 ms');
      expect(strict.entries).toEqual([
        {
          kind: 'absolute-wall-model',
          title,
          site,
          modelMs: 1500,
          wallMs: 2100,
          deltaMs: 600,
          strictLimitMs: 250,
          strictPassed: false,
          binding: true,
        },
      ]);
      const classroom = ledger(title);
      expect(oracle().qualify(classroom, title, site, 1500, 2100)).toEqual({
        ...strict.entries[0],
        binding: false,
      });
      oracle().complete(classroom, title);
      expect(() => oracle().qualify(classroom, title, site, 1500, 1500)).toThrow('duplicate');
    },
  );

  it.each(sites)('preserves the exact inclusive 250 ms limit at %s', (site, title) => {
    const exact = ledger(title, 'strict-real-time');
    expect(oracle().qualify(exact, title, site, 1500, 1750).strictPassed).toBe(true);
    const above = ledger(title, 'strict-real-time');
    expect(() => oracle().qualify(above, title, site, 1500, 1750.001)).toThrow();
    expect(above.entries[0]?.strictPassed).toBe(false);
  });

  it('rejects unknown sites, wrong case identities and nonfinite values even inside the limit', () => {
    const [site, title] = sites[0];
    for (const unknown of ['millis-wall-model', '__proto__', 'no-delay', '']) {
      const value = ledger(title);
      expect(() => oracle().qualify(value, title, unknown, 1000, 1000)).toThrow();
      expect(value.entries).toEqual([]);
    }
    for (const otherTitle of [millisTitle, sites[1][1], title + ' ', 'independent ports'])
      expect(() => oracle().qualify(ledger(otherTitle), otherTitle, site, 1000, 1000)).toThrow();
    for (const invalid of [NaN, Infinity, -Infinity, -1]) {
      expect(() => oracle().qualify(ledger(title), title, site, invalid, 1000)).toThrow();
      expect(() => oracle().qualify(ledger(title), title, site, 1000, invalid)).toThrow();
    }
  });

  it('cannot pass with a missing ledger, missing required site, wrong profile or missing source provenance', () => {
    const [site, title] = sites[0];
    expect(() => oracle().qualify(null, title, site, 1000, 1000)).toThrow();
    expect(() => oracle().complete(null, title)).toThrow();
    for (const [key, value] of [
      ['profile', 'unknown'],
      ['profile', undefined],
      ['entrypoint', null],
      ['expectedSourceSha', null],
      ['expectedSourceSha', 'not-a-sha'],
      ['observerSha256', ''],
    ] as const) {
      const missing = { ...ledger(title), [key]: value } as Ledger;
      expect(() => oracle().qualify(missing, title, site, 1000, 1000)).toThrow();
    }
    for (const [, selectedTitle] of sites) {
      expect(oracle().required(selectedTitle)).toHaveLength(1);
      expect(() => oracle().complete(ledger(selectedTitle), selectedTitle)).toThrow('not reached');
    }
    expect(() => oracle().complete(ledger(millisTitle), millisTitle)).toThrow('not reached');
  });

  it('keeps Blockly, delay2000 and millis wall/model comparisons binding in the real shared helper', () => {
    for (const [title, minimumMs] of [
      [
        'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
        1000,
      ],
      [
        'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
        8100,
      ],
      [millisTitle, 2250],
    ] as const) {
      const value = ledger(title);
      expect(() =>
        oracle(value).clock(
          [
            { at: 100, committedHorizonMicroseconds: 0 },
            { at: 100 + minimumMs + 300, committedHorizonMicroseconds: minimumMs * 1000 },
          ],
          minimumMs,
        ),
      ).toThrow();
      expect(value.entries).toEqual([]);
    }
  });

  it('selected temporal comparison still requires model zero and full original model coverage', () => {
    const [site, title] = sites[1];
    for (const ready of [
      [
        { at: 0, committedHorizonMicroseconds: 1 },
        { at: 2000, committedHorizonMicroseconds: 1_500_001 },
      ],
      [
        { at: 0, committedHorizonMicroseconds: 0 },
        { at: 2000, committedHorizonMicroseconds: 1_499_999 },
      ],
    ]) {
      const value = ledger(title);
      expect(() => oracle(value).clock(ready, 1500, site)).toThrow();
      expect(value.entries).toEqual([]);
    }
    const value = ledger(title);
    expect(
      oracle(value).clock(
        [
          { at: 0, committedHorizonMicroseconds: 0 },
          { at: 2000, committedHorizonMicroseconds: 1_500_000 },
        ],
        1500,
        site,
      ),
    ).toEqual(expect.objectContaining({ modelMs: 1500, wallMs: 2000 }));
  });

  it('wires only the two selected temporal sites and the conditional no-delay site', () => {
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(readySource);
    const clockCalls = calls.filter(
      (node) => node.expression.getText(readySource) === 'assertTemporalWallClock',
    );
    expect(
      clockCalls.map((node) => node.arguments.slice(1).map((arg) => arg.getText(readySource))),
    ).toEqual([
      ['1000'],
      ['8100'],
      ['1500', "'delay-1-temporal-wall-model'"],
      ['2250'],
      ['1250', "'reset-temporal-wall-model'"],
    ]);
    const directSites = calls
      .filter((node) => node.expression.getText(readySource) === 'recordOwnerQualifiedWallClock')
      .map((node) => node.arguments[2]?.getText(readySource));
    expect(directSites).toEqual(["'no-delay-execution-wall-model'", 'qualificationSite']);
    expect(readyText).toContain("if (mode === 'no-delay realtime')");
    expect(readyText).toContain(
      'else expect(Math.abs(modelMs - wallMs)).toBeLessThanOrEqual(250);',
    );
    expect(readyCompact).toContain(
      "if (info.status === 'passed') requireOwnerQualificationComplete(ledger, info.title);",
    );
  });
});

describe('millis original five-second outcome beside explicit classroom acquisition', () => {
  const sourceSha = 'c'.repeat(64);
  const rows = [
    { at: 90, committedHorizonMicroseconds: 0 },
    { at: 5000, committedHorizonMicroseconds: 2_000_000 },
    { at: 6100, committedHorizonMicroseconds: 2_250_000 },
    { at: 6500, committedHorizonMicroseconds: 2_400_000 },
  ];
  it('does not turn a later horizon into original5s PASS and preserves every actual ready timestamp', () => {
    const value = ledger(millisTitle);
    const entry = oracle().millis(value, millisTitle, sourceSha, 100, 6600, rows);
    expect(entry).toEqual({
      kind: 'model-horizon-acquisition',
      title: millisTitle,
      site: 'millis-ready-horizon-2250000',
      sourceSha256: sourceSha,
      waitStartedAt: 100,
      observedAt: 6600,
      horizonMicroseconds: 2_250_000,
      strictLimitMs: 5000,
      acquisitionLimitMs: 45000,
      firstHorizonAt: 6100,
      strictOutcome: 'FAIL',
      binding: false,
      readyTimestamps: rows,
    });
    expect(entry.readyTimestamps).toBe(rows);
    oracle().complete(value, millisTitle);
  });
  it('records exact5s PASS, early incomplete evidence and the unchanged strict budget separately', () => {
    expect(
      oracle().millis(ledger(millisTitle), millisTitle, sourceSha, 100, 7000, [
        ...rows.slice(0, 2),
        { at: 5100, committedHorizonMicroseconds: 2_250_000 },
      ]).strictOutcome,
    ).toBe('PASS');
    expect(
      oracle().millis(ledger(millisTitle), millisTitle, sourceSha, 100, 1000, [rows[0]!])
        .strictOutcome,
    ).toBe('INCOMPLETE');
    const strict = oracle().millis(
      ledger(millisTitle, 'strict-real-time'),
      millisTitle,
      sourceSha,
      100,
      6600,
      rows,
    );
    expect(strict.strictOutcome).toBe('FAIL');
    expect(strict.acquisitionLimitMs).toBe(5000);
    expect(strict.binding).toBe(true);
    expect(
      oracle().millis(ledger(millisTitle), millisTitle, sourceSha, 100, 200, [
        { at: 90, committedHorizonMicroseconds: 2_250_000 },
      ]).strictOutcome,
    ).toBe('PASS');
  });
  it('rejects wrong case, missing or unordered timestamps, nonfinite boundaries and invented future rows', () => {
    expect(() => oracle().millis(ledger(), sites[0][1], sourceSha, 100, 6600, rows)).toThrow();
    for (const invalid of [
      [...rows].reverse(),
      [{ at: NaN, committedHorizonMicroseconds: 0 }],
      [{ at: 6601, committedHorizonMicroseconds: 2_250_000 }],
      [{ at: 100, committedHorizonMicroseconds: 1.1 }],
    ])
      expect(() =>
        oracle().millis(ledger(millisTitle), millisTitle, sourceSha, 100, 6600, invalid),
      ).toThrow();
    expect(() =>
      oracle().millis(ledger(millisTitle), millisTitle, sourceSha, NaN, 6600, rows),
    ).toThrow();
  });
});

describe('actual mounted SVG load witness', () => {
  it('requires a native load for this connected element and current href; detached decode cannot supply it', () => {
    const actual = oracle().mounted();
    const element = {};
    expect(actual.current(element, 'high.webp', true)).toBeNull();
    actual.nativeLoad(element, 'high.webp', 10, false, true);
    expect(actual.current(element, 'high.webp', true)).toBeNull();
    actual.nativeLoad(element, 'high.webp', 11, true, false);
    expect(actual.current(element, 'high.webp', true)).toBeNull();
    actual.nativeLoad(element, 'high.webp', 12, true, true);
    expect(actual.current(element, 'high.webp', true)).toBe(12);
    expect(actual.current(element, 'low.webp', true)).toBeNull();
    expect(actual.current(element, 'high.webp', false)).toBeNull();
    expect(actual.current({}, 'high.webp', true)).toBeNull();
  });
  it('invalidates native error and every real href change, including a return to the former asset', () => {
    const actual = oracle().mounted();
    const element = {};
    actual.nativeLoad(element, 'high.webp', 12, true, true);
    actual.changed(element, 'high.webp', 'high.webp');
    expect(actual.current(element, 'high.webp', true)).toBe(12);
    actual.nativeError(element, false);
    expect(actual.current(element, 'high.webp', true)).toBe(12);
    actual.changed(element, 'high.webp', 'low.webp');
    actual.changed(element, 'low.webp', 'high.webp');
    expect(actual.current(element, 'high.webp', true)).toBeNull();
    actual.nativeLoad(element, 'high.webp', 25, true, true);
    actual.nativeError(element, true);
    expect(actual.current(element, 'high.webp', true)).toBeNull();
  });
  it('keeps diagnostic decode outside painted signatures and retains actual load/error/href wiring', () => {
    expect(readyText).toContain("attributeFilter: ['href', 'xlink:href']");
    expect(readyText).toContain('attributeOldValue: true');
    expect(readyText).toContain('observeHrefChanges(hrefChanges.takeRecords())');
    expect(readyText).toContain('event.isTrusted');
    expect(readyText).toContain('decoded: mountedLoadAt !== null');
    expect(readyText).toContain('resourceDecoded: decoded.get(href) === true');
    expect(readyText).toContain('const signature = JSON.stringify({ brightness, images });');
    expect(readyText).toContain('imageDiagnostics,');
    expect(readyCompact).toContain(
      'raw.paintFrames.filter((row) => row.at >= startAt).every((row) => row.imagesReady)',
    );
  });
});

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function runActualRunner(
  options: {
    exitCode?: number;
    signal?: boolean;
    args?: string[];
    profile?: string;
    lifecycle?: string;
    cli?: string;
    inheritedEntrypoint?: string;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'asa-classroom-qualification-'));
  temporaryDirectories.push(directory);
  const fakePnpm = join(directory, 'pnpm-fixture.cjs');
  writeFileSync(
    fakePnpm,
    `process.stdout.write(JSON.stringify({
    argv: process.argv.slice(2), cwd: process.cwd(),
    profile: process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE,
    entrypoint: process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT,
    expectedSha: process.env.ASA_ELECTRONICS_EXPECTED_SHA,
    nxSkip: process.env.NX_SKIP_NX_CACHE
  }) + '\\n', () => {\n${options.signal ? "process.kill(process.pid, 'SIGTERM');" : `process.exit(${options.exitCode ?? 0});`}\n});`,
  );
  const env = { ...process.env };
  // Windows workers may contain both NPM_* and npm_* spellings. Remove only
  // this fixture's controlled names before setting them; Node chooses the
  // first case-insensitive key when it creates a Windows child environment.
  const controlledNames = new Set([
    'npm_execpath',
    'npm_lifecycle_event',
    'asa_electronics_qualification_profile',
    'asa_electronics_qualification_entrypoint',
  ]);
  for (const key of Object.keys(env)) if (controlledNames.has(key.toLowerCase())) delete env[key];
  env.npm_execpath = options.cli ?? fakePnpm;
  env.npm_lifecycle_event = options.lifecycle ?? entrypoint;
  env.ASA_ELECTRONICS_EXPECTED_SHA = 'd'.repeat(40);
  env.NX_SKIP_NX_CACHE = 'true';
  if (options.profile !== undefined) env.ASA_ELECTRONICS_QUALIFICATION_PROFILE = options.profile;
  if (options.inheritedEntrypoint !== undefined)
    env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT = options.inheritedEntrypoint;
  return spawnSync(process.execPath, [runnerPath, ...(options.args ?? [])], {
    cwd: directory,
    env,
    encoding: 'utf8',
    timeout: 5000,
  });
}

describe('named cross-platform runner of the complete existing suite', () => {
  it.each([0, 17])(
    'executes the real runner and propagates child exit %i unchanged',
    (exitCode) => {
      const result = runActualRunner({ exitCode });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(exitCode);
      const witness = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      expect(witness).toEqual({
        argv: ['e2e:electronics-simulation'],
        cwd: repositoryRoot.replace(/[\\/]$/, ''),
        profile: 'classroom-d13-v2',
        entrypoint,
        expectedSha: 'd'.repeat(40),
        nxSkip: 'true',
      });
    },
  );
  it('keeps child signal failure nonzero', () => {
    const result = runActualRunner({ signal: true });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
  });
  it('rejects filters, unknown/conflicting ambient profiles, non-named invocation and missing CLI', () => {
    for (const options of [
      { args: ['--grep', 'D13'] },
      { args: ['--retries', '3'] },
      { profile: 'unknown' },
      { profile: 'strict-real-time' },
      { lifecycle: 'gate:electronics-m1:browser' },
      { cli: '' },
      { cli: 'relative-pnpm.cjs' },
      { inheritedEntrypoint: entrypoint },
    ]) {
      const result = runActualRunner(options);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
    }
  });
  it('preserves the original strict gate and every existing case in both suite aliases', () => {
    const scripts = (
      JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['gate:electronics-m1:browser']).toBe('corepack pnpm e2e:electronics-simulation');
    expect(scripts[entrypoint]).toBe('node tools/run-electronics-classroom-browser.mjs');
    const required = [
      'e2e/electronics-simulation.spec.ts',
      'e2e/electronics-interactions.spec.ts',
      'e2e/electronics-simulation-time.spec.ts',
      'e2e/electronics-piezo-clock.spec.ts',
      'e2e/electronics-native-wheel.spec.ts',
      'e2e/electronics-ready-cadence.spec.ts',
      'e2e/electronics-classroom-timing.spec.ts',
    ];
    for (const alias of ['e2e:electronics', 'e2e:electronics-simulation']) {
      const words = scripts[alias]!.split(/\s+/);
      expect(words.slice(0, 2)).toEqual(['playwright', 'test']);
      for (const file of required) expect(words.slice(2)).toContain(file);
      expect(words.slice(2).every((word) => /^e2e\/[a-zA-Z0-9_./-]+\.spec\.ts$/.test(word))).toBe(
        true,
      );
    }
  });
});
