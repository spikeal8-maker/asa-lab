import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
const v3Entrypoint = 'gate:electronics-classroom-d13-v3:browser';
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
  'freezeOwnerV3',
  'ownerV3IdentityError',
  'assertOwnerV3Identity',
  'ownerV3ContextError',
  'rememberOwnerV3Stage',
  'ownerV3RequiredSites',
  'evaluateOwnerV3Timing',
  'recordOwnerV3Timing',
  'evaluateOwnerV3Acquisition',
  'recordOwnerV3Acquisition',
  'retainOwnerV3AcquisitionFailure',
  'requireOwnerV3Acquisition',
  'requireOwnerV3Complete',
  'ownerV3WorkerProvenance',
  'ownerV3TemporalProvenance',
  'assertOwnerV3TemporalClock',
  'waitForOwnerV3Horizon',
  'waitForTemporalHorizon',
  'ownerV3DiscoveryDefinition',
  'evaluateOwnerV3Discovery',
  'requireOwnerV3DiscoveriesComplete',
  'ownerV3DiscoverySample',
  'ownerV3DiscoveryOptions',
  'withOwnerV3Discovery',
  'observation',
  'temporalObservation',
  'validTemporalPaint',
  'temporalPhysicalBrightness',
  'temporalJointWitness',
  'temporalStartupBoundary',
  'temporalPaintCausality',
]);
const constantNames = new Set([
  'OWNER_CLASSROOM_WALL_SITES',
  'OWNER_MILLIS_CASE',
  'OWNER_V3_PROFILE',
  'OWNER_V3_ENTRYPOINT',
  'OWNER_V3_PACE',
  'OWNER_V3_REGISTRY_REVISION',
  'OWNER_V3_TIMING_SITES',
  'OWNER_V3_ACQUISITION_SITES',
  'OWNER_V3_CASES',
  'OWNER_V3_CASE_BUDGETS',
  'OWNER_V3_DISCOVERY_SITES',
  'OWNER_TEMPORAL_PUBLICATION_LAG_MS',
]);
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
   clock: assertTemporalWallClock,
   v3: { sites: OWNER_V3_TIMING_SITES, acquisitions: OWNER_V3_ACQUISITION_SITES,
     cases: OWNER_V3_CASES, caseBudgets: OWNER_V3_CASE_BUDGETS, pace: OWNER_V3_PACE, registry: OWNER_V3_REGISTRY_REVISION,
     evaluate: evaluateOwnerV3Timing, record: recordOwnerV3Timing,
     required: ownerV3RequiredSites, complete: requireOwnerV3Complete,
     acquisition: evaluateOwnerV3Acquisition, recordAcquisition: recordOwnerV3Acquisition,
     requireAcquisition: requireOwnerV3Acquisition, clock: assertOwnerV3TemporalClock,
     causality: temporalPaintCausality,
     discoverySites: OWNER_V3_DISCOVERY_SITES,
     discovery: evaluateOwnerV3Discovery,
     discoveriesComplete: requireOwnerV3DiscoveriesComplete,
     discover: withOwnerV3Discovery, discoverySample: ownerV3DiscoverySample,
     discoveryOptions: ownerV3DiscoveryOptions,
     observation, temporalObservation, waitForTemporalHorizon } });`,
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
function oracle(
  value: Ledger | null = null,
  v3Value: V3Ledger | null = null,
  runtime: {
    now?: () => number;
    discoveries?: V3DiscoveryRecord[];
    window?: Record<string, unknown>;
  } = {},
) {
  return runInNewContext(oracleJavaScript, {
    expect,
    createHash,
    ownerQualificationLedger: value,
    ownerV3Ledger: v3Value,
    ownerV3Discoveries: runtime.discoveries ?? [],
    performance: runtime.now ? { now: runtime.now } : performance,
    window: runtime.window,
    test: { info: () => ({ title: v3Value?.title ?? value?.title ?? '' }) },
  }) as {
    v3: V3Oracle;
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
    expect(actual.profile('classroom-d13-v3', v3Entrypoint)).toBe('classroom-d13-v3');
    expect(() => actual.profile('classroom-d13-v3', entrypoint)).toThrow();
    expect(() => actual.profile('classroom-d13-v2', v3Entrypoint)).toThrow();
    expect(() => actual.profile('classroom-d13-v3')).toThrow();
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
    expect(scripts[v3Entrypoint]).toBe('node tools/run-electronics-classroom-browser.mjs');
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

type V3Definition = {
  site: string;
  title: string;
  stage: string;
  kind: string;
  dimensions: Record<string, string | number | number[]>;
  bounds: { minimumMs?: number; maximumMs?: number; absoluteDeltaMaximumMs?: number };
  binding?: false;
};
type V3AcquisitionDefinition = Omit<V3Definition, 'kind' | 'bounds' | 'binding'> & {
  horizonMicroseconds: number;
  timeoutMs: number;
};
type V3Provenance = {
  sourceSha256: string;
  observedSourceSha256: string;
  generationId: number;
  stage: string;
  dimensions: V3Definition['dimensions'];
};
type V3Ledger = Ledger & {
  expectedPace: number;
  registryRevision: string;
  stages: Array<Omit<V3Provenance, 'dimensions'>>;
  invalidAcquisitions: Array<Record<string, unknown>>;
};
type V3Timing = Record<string, unknown> & {
  rawWallMs: number[];
  samples: Array<{
    index: number;
    rawWallMs: number;
    normalizedWallMs: number;
    strictPassed: boolean;
    v3Passed: boolean;
  }>;
  strictOutcome: string;
  v3Outcome: string;
};
type V3Input = {
  waitStartedAt: number;
  observedAt: number;
  expectationCompleted: boolean;
  readyTimestamps: Array<
    ReadyTimestamp & {
      sourceSha256: string;
      generationId: number | null;
      responseGenerationId: number | null;
    }
  >;
};
type V3Assessment = { ok: true; entry: Record<string, unknown> } | { ok: false; error: string };
type V3DiscoveryDefinition = {
  site: string;
  title: string;
  stage: string;
  timeoutMs: number;
  expected: boolean | number[];
};
type V3DiscoveryInput = {
  invocation: 'REACHED';
  registryRevision: string;
  title: string;
  site: string;
  stage: string;
  expectedSourceSha256: string;
  clock: 'node-performance';
  startedAt: number;
  endedAt: number | null;
  samples: Array<{ at: number; value: boolean | number[] }>;
  expectationCompleted: boolean | null;
  rejection: string | null;
};
type V3DiscoveryRecord = {
  input: V3DiscoveryInput;
  evaluation?: Record<string, unknown>;
  evaluationError?: string;
};
type V3Oracle = {
  sites: V3Definition[];
  acquisitions: V3AcquisitionDefinition[];
  cases: string[];
  caseBudgets: Array<{ title: string; timeoutMs: number }>;
  pace: number;
  registry: string;
  discoverySites: V3DiscoveryDefinition[];
  discovery: (input: V3DiscoveryInput) => Record<string, unknown>;
  discoveriesComplete: (title: string, records: V3DiscoveryRecord[]) => void;
  discover: (
    site: string,
    source: string,
    operation: (input: V3DiscoveryInput | null) => Promise<void>,
  ) => Promise<void>;
  discoverySample: <T extends boolean | number[]>(input: V3DiscoveryInput | null, value: T) => T;
  discoveryOptions: (input: V3DiscoveryInput | null) => { timeout: number } | undefined;
  observation: (page: unknown) => Promise<Record<string, unknown>>;
  temporalObservation: (page: unknown) => Promise<Record<string, unknown>>;
  waitForTemporalHorizon: (
    page: unknown,
    source: string,
    horizon: number,
    discoverySite?: string,
  ) => Promise<void>;
  evaluate: (
    value: V3Ledger | null,
    title: string,
    site: string,
    provenance: V3Provenance,
    raw: number[],
    model?: number | null,
  ) => V3Timing;
  record: V3Oracle['evaluate'];
  required: (title: string) => string[];
  complete: (value: V3Ledger | null, title: string) => void;
  acquisition: (
    value: V3Ledger | null,
    title: string,
    site: string,
    provenance: V3Provenance,
    input: V3Input,
  ) => V3Assessment;
  recordAcquisition: V3Oracle['acquisition'];
  requireAcquisition: (assessment: V3Assessment) => void;
  clock: (
    ready: Array<Record<string, unknown>>,
    minimum: number,
    site: string,
    source: string,
    stage: string,
    dimensions: V3Definition['dimensions'],
  ) => Record<string, unknown>;
  causality: (
    raw: Record<string, unknown>,
    source: string,
    generation: number,
    from: number,
    to?: number,
  ) => {
    witnesses: unknown[];
    violations: Array<{ at: number; reason: string }>;
    startup: {
      h0ReadyAt: number | null;
      h0RequestId: string | null;
      frames: Array<{ at: number; brightness: number[]; status: string; reason: string | null }>;
    };
  };
};
const v3RegistryRevision = 'a794578587a78ead87eea54c20c4d486ba0561368bd4a8bbe194693ed4545c10';
function v3Ledger(title: string): V3Ledger {
  return {
    schema: 'electronics-classroom-qualification-v3',
    profile: 'classroom-d13-v3',
    entrypoint: v3Entrypoint,
    title,
    expectedSourceSha: 'a'.repeat(40),
    observerSha256: 'b'.repeat(64),
    expectedPace: 0.125,
    registryRevision: v3RegistryRevision,
    stages: [],
    entries: [],
    invalidAcquisitions: [],
  };
}
function v3Provenance(definition: V3Definition | V3AcquisitionDefinition): V3Provenance {
  return {
    sourceSha256: 'c'.repeat(64),
    observedSourceSha256: 'c'.repeat(64),
    generationId: 7,
    stage: definition.stage,
    dimensions: { ...definition.dimensions },
  };
}
function validV3Input(definition: V3AcquisitionDefinition): V3Input {
  return {
    waitStartedAt: 100,
    observedAt: 6600,
    expectationCompleted: true,
    readyTimestamps: [
      { at: 90, committedHorizonMicroseconds: 0 },
      { at: 6100, committedHorizonMicroseconds: definition.horizonMicroseconds },
      { at: 6500, committedHorizonMicroseconds: definition.horizonMicroseconds + 1000 },
    ].map((row) => ({
      ...row,
      sourceSha256: 'c'.repeat(64),
      generationId: 7,
      responseGenerationId: 7,
    })),
  };
}
function populateV3(value: V3Ledger): V3Oracle {
  const actual = oracle().v3;
  for (const definition of actual.sites.filter((entry) => entry.title === value.title)) {
    const absolute = definition.kind === 'absolute-wall-model';
    const model = absolute ? 1000 : null;
    const raw = absolute
      ? 8000
      : ((definition.bounds.minimumMs ?? 0) + definition.bounds.maximumMs!) / 2 / 0.125;
    actual.record(value, value.title, definition.site, v3Provenance(definition), [raw], model);
  }
  for (const definition of actual.acquisitions.filter((entry) => entry.title === value.title)) {
    actual.requireAcquisition(
      actual.recordAcquisition(
        value,
        value.title,
        definition.site,
        v3Provenance(definition),
        validV3Input(definition),
      ),
    );
  }
  return actual;
}

describe('fixed v3 normalization over the frozen exhaustive registry', () => {
  it('requires all 38 timing records and 4 acquisitions in the unchanged 12 ready cases', () => {
    const actual = oracle().v3;
    expect(actual.pace).toBe(0.125);
    expect(actual.registry).toBe(v3RegistryRevision);
    expect(actual.sites).toHaveLength(38);
    expect(actual.acquisitions).toHaveLength(4);
    expect(actual.cases).toHaveLength(12);
    expect(new Set([...actual.sites, ...actual.acquisitions].map((entry) => entry.site)).size).toBe(
      42,
    );
    expect(actual.cases.map((title) => actual.required(title).length)).toEqual([
      0, 0, 0, 6, 6, 1, 4, 5, 9, 2, 8, 1,
    ]);
    expect(
      actual.sites
        .filter((entry) => entry.binding === false)
        .map(({ site, title, stage, kind, dimensions, bounds }) => ({
          site,
          title,
          stage,
          kind,
          dimensions,
          bounds,
        })),
    ).toEqual([
      {
        site: 'delay-1-temporal-wall-model',
        title:
          'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
        stage: 'blink-1',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: { absoluteDeltaMaximumMs: 250 },
      },
      {
        site: 'millis-temporal-wall-model',
        title:
          'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
        stage: 'millis-independent',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: { absoluteDeltaMaximumMs: 250 },
      },
      {
        site: 'reset-temporal-wall-model',
        title:
          'Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history',
        stage: 'reset-restarted',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: { absoluteDeltaMaximumMs: 250 },
      },
    ]);
    expect(actual.acquisitions[3]).toEqual({
      site: 'delay-1-ready-horizon-1500000',
      title:
        'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
      stage: 'blink-1',
      horizonMicroseconds: 1500000,
      timeoutMs: 20000,
      dimensions: {},
    });
    for (const definition of [...actual.sites, ...actual.acquisitions]) {
      expect(actual.cases).toContain(definition.title);
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.dimensions)).toBe(true);
      expect(actual.required(definition.title)).toContain(definition.site);
    }
    expect(
      actual.sites.map(({ site, kind, dimensions, bounds }) => ({
        site,
        kind,
        dimensions,
        bounds,
      })),
    ).toEqual([
      {
        site: 'owner-blink-100-dom-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {
          delayMs: 100,
        },
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'owner-blink-100-dom-mean-period',
        kind: 'wall-range',
        dimensions: {
          delayMs: 100,
        },
        bounds: {
          minimumMs: 150.0,
          maximumMs: 250.0,
        },
      },
      {
        site: 'owner-blink-100-dom-transition-gaps',
        kind: 'wall-upper-bound-array',
        dimensions: {
          delayMs: 100,
        },
        bounds: {
          maximumMs: 300,
        },
      },
      {
        site: 'owner-blink-100-dom-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          delayMs: 100,
          surface: 'dom',
        },
        bounds: {
          minimumMs: 50.0,
          maximumMs: 200,
        },
      },
      {
        site: 'owner-blink-100-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          delayMs: 100,
          surface: 'paint',
        },
        bounds: {
          minimumMs: 50.0,
          maximumMs: 200,
        },
      },
      {
        site: 'owner-blink-100-paint-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {
          delayMs: 100,
        },
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'owner-blink-50-dom-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {
          delayMs: 50,
        },
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'owner-blink-50-dom-mean-period',
        kind: 'wall-range',
        dimensions: {
          delayMs: 50,
        },
        bounds: {
          minimumMs: 75.0,
          maximumMs: 125.0,
        },
      },
      {
        site: 'owner-blink-50-dom-transition-gaps',
        kind: 'wall-upper-bound-array',
        dimensions: {
          delayMs: 50,
        },
        bounds: {
          maximumMs: 150,
        },
      },
      {
        site: 'owner-blink-50-dom-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          delayMs: 50,
          surface: 'dom',
        },
        bounds: {
          minimumMs: 25.0,
          maximumMs: 100,
        },
      },
      {
        site: 'owner-blink-50-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          delayMs: 50,
          surface: 'paint',
        },
        bounds: {
          minimumMs: 25.0,
          maximumMs: 100,
        },
      },
      {
        site: 'owner-blink-50-paint-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {
          delayMs: 50,
        },
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'no-delay-execution-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'independent-ports-execution-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'independent-ports-led0-high-periods',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 0,
          arduinoPin: 13,
        },
        bounds: {
          minimumMs: 225,
          maximumMs: 375,
        },
      },
      {
        site: 'independent-ports-led1-high-periods',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 1,
          arduinoPin: 12,
        },
        bounds: {
          minimumMs: 225,
          maximumMs: 375,
        },
      },
      {
        site: 'independent-ports-led2-high-periods',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 2,
          arduinoPin: 11,
        },
        bounds: {
          minimumMs: 225,
          maximumMs: 375,
        },
      },
      {
        site: 'blockly-100-temporal-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {
          halfMs: 100,
          stageOrder: [100, 50, 1],
        },
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'blockly-100-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          halfMs: 100,
          ledIndex: 0,
        },
        bounds: {
          minimumMs: 50.0,
          maximumMs: 200,
        },
      },
      {
        site: 'blockly-50-temporal-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {
          halfMs: 50,
          stageOrder: [100, 50, 1],
        },
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'blockly-50-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          halfMs: 50,
          ledIndex: 0,
        },
        bounds: {
          minimumMs: 25.0,
          maximumMs: 100,
        },
      },
      {
        site: 'blockly-1-temporal-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {
          halfMs: 1,
          stageOrder: [100, 50, 1],
        },
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'delay-2000-temporal-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'delay-2000-led0-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 0,
          arduinoPin: 13,
        },
        bounds: {
          minimumMs: 1750,
          maximumMs: 2250,
        },
      },
      {
        site: 'delay-2000-led0-paint-mean-period',
        kind: 'wall-range',
        dimensions: {
          ledIndex: 0,
          arduinoPin: 13,
        },
        bounds: {
          minimumMs: 3750,
          maximumMs: 4250,
        },
      },
      {
        site: 'delay-2000-led1-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 1,
          arduinoPin: 12,
        },
        bounds: {
          minimumMs: 1750,
          maximumMs: 2250,
        },
      },
      {
        site: 'delay-2000-led1-paint-mean-period',
        kind: 'wall-range',
        dimensions: {
          ledIndex: 1,
          arduinoPin: 12,
        },
        bounds: {
          minimumMs: 3750,
          maximumMs: 4250,
        },
      },
      {
        site: 'delay-2000-led2-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 2,
          arduinoPin: 11,
        },
        bounds: {
          minimumMs: 1750,
          maximumMs: 2250,
        },
      },
      {
        site: 'delay-2000-led2-paint-mean-period',
        kind: 'wall-range',
        dimensions: {
          ledIndex: 2,
          arduinoPin: 11,
        },
        bounds: {
          minimumMs: 3750,
          maximumMs: 4250,
        },
      },
      {
        site: 'delay-1-temporal-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'millis-temporal-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
      {
        site: 'millis-led0-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 0,
          arduinoPin: 13,
          halfMs: 500,
        },
        bounds: {
          minimumMs: 250.0,
          maximumMs: 750.0,
        },
      },
      {
        site: 'millis-led0-paint-mean-period',
        kind: 'wall-range',
        dimensions: {
          ledIndex: 0,
          arduinoPin: 13,
          halfMs: 500,
        },
        bounds: {
          minimumMs: 900.0,
          maximumMs: 1100.0,
        },
      },
      {
        site: 'millis-led1-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 1,
          arduinoPin: 12,
          halfMs: 200,
        },
        bounds: {
          minimumMs: 100.0,
          maximumMs: 300.0,
        },
      },
      {
        site: 'millis-led1-paint-mean-period',
        kind: 'wall-range',
        dimensions: {
          ledIndex: 1,
          arduinoPin: 12,
          halfMs: 200,
        },
        bounds: {
          minimumMs: 360.0,
          maximumMs: 440.00000000000006,
        },
      },
      {
        site: 'millis-led2-paint-half-durations',
        kind: 'wall-range-array',
        dimensions: {
          ledIndex: 2,
          arduinoPin: 11,
          halfMs: 100,
        },
        bounds: {
          minimumMs: 50.0,
          maximumMs: 150.0,
        },
      },
      {
        site: 'millis-led2-paint-mean-period',
        kind: 'wall-range',
        dimensions: {
          ledIndex: 2,
          arduinoPin: 11,
          halfMs: 100,
        },
        bounds: {
          minimumMs: 180.0,
          maximumMs: 220.00000000000003,
        },
      },
      {
        site: 'reset-temporal-wall-model',
        kind: 'absolute-wall-model',
        dimensions: {},
        bounds: {
          absoluteDeltaMaximumMs: 250,
        },
      },
    ]);
  });

  it('measures every original inclusive boundary after the one fixed factor, without extra tolerance', () => {
    const actual = oracle().v3;
    for (const definition of actual.sites) {
      const value = v3Ledger(definition.title);
      const provenance = v3Provenance(definition);
      if (definition.kind === 'absolute-wall-model') {
        for (const raw of [6000, 10000]) {
          const measured = actual.evaluate(
            value,
            value.title,
            definition.site,
            provenance,
            [raw],
            1000,
          );
          expect(measured.v3Outcome, definition.site).toBe('PASS');
          expect(measured.strictOutcome, definition.site).toBe('FAIL');
        }
        for (const raw of [5999.999, 10000.001])
          expect(
            actual.evaluate(value, value.title, definition.site, provenance, [raw], 1000).v3Outcome,
          ).toBe('FAIL');
        const oldPass = actual.evaluate(
          value,
          value.title,
          definition.site,
          provenance,
          [1000],
          1000,
        );
        expect(oldPass.strictOutcome).toBe('PASS');
        expect(oldPass.v3Outcome).toBe('FAIL');
      } else {
        const lower = definition.bounds.minimumMs ?? 0;
        const upper = definition.bounds.maximumMs!;
        for (const bound of [lower, upper])
          expect(
            actual.evaluate(value, value.title, definition.site, provenance, [bound / 0.125])
              .v3Outcome,
          ).toBe('PASS');
        expect(
          actual.evaluate(value, value.title, definition.site, provenance, [
            (upper + 0.001) / 0.125,
          ]).v3Outcome,
        ).toBe('FAIL');
        if (lower > 0)
          expect(
            actual.evaluate(value, value.title, definition.site, provenance, [
              (lower - 0.001) / 0.125,
            ]).v3Outcome,
          ).toBe('FAIL');
      }
    }
  });

  it('retains actual FAIL and mandatory completeness for exactly three prospective throughput findings', () => {
    const actual = oracle().v3;
    // Induced future measurements only. The old delay-1 scalar was UNREACHED;
    // this test does not manufacture a scalar in any historical browser ledger.
    for (const definition of actual.sites.filter((entry) => entry.binding === false)) {
      const value = v3Ledger(definition.title);
      populateV3(value);
      value.entries = value.entries.filter((entry) => entry.site !== definition.site);
      const measured = actual.record(
        value,
        value.title,
        definition.site,
        v3Provenance(definition),
        [16000],
        1000,
      );
      expect(measured).toMatchObject({
        binding: false,
        bounds: { absoluteDeltaMaximumMs: 250 },
        rawWallMs: [16000],
        modelMs: 1000,
        strictOutcome: 'FAIL',
        v3Outcome: 'FAIL',
        samples: [
          {
            rawWallMs: 16000,
            normalizedWallMs: 2000,
            strictComparedMs: 15000,
            v3ComparedMs: 1000,
            strictPassed: false,
            v3Passed: false,
          },
        ],
      });
      actual.complete(value, value.title);
      expect(() =>
        actual.record(value, value.title, definition.site, v3Provenance(definition), [16000], 1000),
      ).toThrow('Duplicate');
      const missing = structuredClone(value);
      missing.entries = missing.entries.filter((entry) => entry.site !== definition.site);
      expect(() => actual.complete(missing, value.title)).toThrow('not reached');
      for (const change of [
        { binding: true },
        { v3Outcome: 'PASS' },
        { strictOutcome: 'PASS' },
        { bounds: { absoluteDeltaMaximumMs: 1000 } },
        { rawWallMs: [3000] },
      ]) {
        const forged = structuredClone(value);
        Object.assign(
          forged.entries.find((entry) => entry.site === definition.site)!,
          change,
        );
        expect(() => actual.complete(forged, value.title)).toThrow('Mismatched');
      }
      const priorRevision = {
        ...value,
        registryRevision: 'e0e6b912853c5c5650f2dc2d6eab4ecb234f73b14c7491a631154e30b956b017',
      };
      expect(() => actual.complete(priorRevision, value.title)).toThrow('invalid v3 ledger');
    }
  });

  it('keeps all other 35 scalar and range failures binding with their original outcomes', () => {
    const actual = oracle().v3;
    const definitions = actual.sites.filter((entry) => entry.binding !== false);
    expect(definitions).toHaveLength(35);
    for (const definition of definitions) {
      const value = v3Ledger(definition.title);
      const absolute = definition.kind === 'absolute-wall-model';
      const raw = absolute ? 16000 : (definition.bounds.maximumMs! + 1) / 0.125;
      expect(() =>
        actual.record(
          value,
          value.title,
          definition.site,
          v3Provenance(definition),
          [raw],
          absolute ? 1000 : null,
        ),
      ).toThrow('fixed-pace');
      expect(value.entries).toHaveLength(1);
      expect(value.entries[0]).toMatchObject({ binding: true, v3Outcome: 'FAIL' });
    }
  });

  it('checks and retains every array element and its index, including an interior outlier', () => {
    const actual = oracle().v3;
    for (const definition of actual.sites.filter((entry) => entry.kind.endsWith('-array'))) {
      const value = v3Ledger(definition.title);
      const good = ((definition.bounds.minimumMs ?? 0) + definition.bounds.maximumMs!) / 2 / 0.125;
      const raw = [good, (definition.bounds.maximumMs! + 0.01) / 0.125, good];
      expect(() =>
        actual.record(value, value.title, definition.site, v3Provenance(definition), raw),
      ).toThrow('fixed-pace');
      const entry = value.entries[0] as V3Timing;
      expect(entry.rawWallMs).toEqual(raw);
      expect(raw).toEqual([good, (definition.bounds.maximumMs! + 0.01) / 0.125, good]);
      expect(entry.samples.map((sample) => sample.index)).toEqual([0, 1, 2]);
      expect(entry.samples.map((sample) => sample.v3Passed)).toEqual([true, false, true]);
      expect(entry.v3Outcome).toBe('FAIL');
      for (const invalid of [[], new Array<number>(3), [good, NaN], [good, Infinity], [-1]])
        expect(() =>
          actual.evaluate(
            v3Ledger(value.title),
            value.title,
            definition.site,
            v3Provenance(definition),
            invalid,
          ),
        ).toThrow();
    }
  });

  it('rejects unknown sites, stage/pin/surface/source mismatch and caller-selected factors or limits', () => {
    const actual = oracle().v3;
    const definition = actual.sites[0]!;
    const value = v3Ledger(definition.title);
    for (const site of ['', '__proto__', 'constructor', 'owner-blink-200-dom-wall-model'])
      expect(() =>
        actual.record(value, value.title, site, v3Provenance(definition), [8000], 1000),
      ).toThrow();
    for (const changed of [
      { stage: 'another-stage' },
      { generationId: -1 },
      { generationId: NaN },
      { sourceSha256: '' },
      { observedSourceSha256: 'd'.repeat(64) },
      { dimensions: {} },
      { dimensions: { delayMs: 200 } },
      { dimensions: { delayMs: 100, arduinoPin: 2 } },
      { pace: 0.1 },
      { maximumMs: 10000 },
    ])
      expect(() =>
        actual.record(
          value,
          value.title,
          definition.site,
          { ...v3Provenance(definition), ...changed } as V3Provenance,
          [8000],
          1000,
        ),
      ).toThrow();
    expect(() =>
      Reflect.apply(actual.record, undefined, [
        value,
        value.title,
        definition.site,
        v3Provenance(definition),
        [8000],
        1000,
        { pace: 1 },
      ]),
    ).toThrow();
    expect(() =>
      actual.record(
        v3Ledger(millisTitle),
        millisTitle,
        definition.site,
        v3Provenance(definition),
        [8000],
        1000,
      ),
    ).toThrow();
  });

  it('cannot pass an omitted, duplicated, forged or partly completed stage in any case', () => {
    const actual = oracle().v3;
    for (const title of actual.cases) {
      const value = v3Ledger(title);
      populateV3(value);
      actual.complete(value, title);
      if (!actual.required(title).length) continue;
      const missing = JSON.parse(JSON.stringify(value)) as V3Ledger;
      missing.entries.pop();
      expect(() => actual.complete(missing, title)).toThrow('not reached');
      const duplicate = JSON.parse(JSON.stringify(value)) as V3Ledger;
      duplicate.entries.push(duplicate.entries[0]!);
      expect(() => actual.complete(duplicate, title)).toThrow('duplicate');
      const forged = JSON.parse(JSON.stringify(value)) as V3Ledger;
      forged.entries[0]!.binding = !forged.entries[0]!.binding;
      expect(() => actual.complete(forged, title)).toThrow('Mismatched');
      const differentGeneration = JSON.parse(JSON.stringify(value)) as V3Ledger;
      differentGeneration.stages[0]!.generationId += 1;
      expect(() => actual.complete(differentGeneration, title)).toThrow();
    }
    const blockly = actual.cases.find((title) => title.includes('Owner Arduino Blockly:'))!;
    const partial = v3Ledger(blockly);
    for (const definition of actual.sites.filter(
      (entry) => entry.title === blockly && entry.stage === 'blockly-100',
    )) {
      actual.record(
        partial,
        blockly,
        definition.site,
        v3Provenance(definition),
        [definition.kind === 'absolute-wall-model' ? 8000 : 800],
        definition.kind === 'absolute-wall-model' ? 1000 : null,
      );
    }
    expect(() => actual.complete(partial, blockly)).toThrow('not reached');
    const definition = actual.sites[0]!;
    for (const [key, changed] of [
      ['schema', 'electronics-classroom-qualification-v2'],
      ['profile', 'strict-real-time'],
      ['entrypoint', entrypoint],
      ['expectedPace', 1],
      ['registryRevision', ''],
      ['expectedSourceSha', ''],
      ['observerSha256', ''],
    ] as const)
      expect(() =>
        actual.record(
          { ...v3Ledger(definition.title), [key]: changed } as V3Ledger,
          definition.title,
          definition.site,
          v3Provenance(definition),
          [8000],
          1000,
        ),
      ).toThrow();
  });
});

describe('v3 original acquisition boundary and complete real prefix', () => {
  it('retains original5s FAIL beside later v3 PASS at all four finite acquisition sites', () => {
    const actual = oracle().v3;
    for (const definition of actual.acquisitions) {
      const value = v3Ledger(definition.title);
      const input = validV3Input(definition);
      const measured = actual.recordAcquisition(
        value,
        value.title,
        definition.site,
        v3Provenance(definition),
        input,
      );
      actual.requireAcquisition(measured);
      expect(measured.ok).toBe(true);
      if (!measured.ok) throw new Error(measured.error);
      expect(measured.entry).toMatchObject({
        waitStartedAt: 100,
        originalDeadlineAt: 5100,
        activeDeadlineAt: 100 + definition.timeoutMs,
        acquisitionLimitMs: definition.timeoutMs,
        strictLimitMs: 5000,
        observedAt: 6600,
        firstHorizonAt: 6100,
        strictOutcome: 'FAIL',
        v3Outcome: 'PASS',
        comparisonScope: 'original-limit-on-this-v3-execution',
        binding: true,
      });
      expect(measured.entry.readyTimestamps).toEqual(input.readyTimestamps);
      const repeated = actual.recordAcquisition(
        value,
        value.title,
        definition.site,
        v3Provenance(definition),
        input,
      );
      expect(() => actual.requireAcquisition(repeated)).toThrow('Duplicate');
      expect(value.invalidAcquisitions).toHaveLength(1);
    }
  });

  it('distinguishes inclusive boundaries, interruption, later sequential starts and a failed expectation', () => {
    const actual = oracle().v3;
    const first = actual.acquisitions[0]!;
    const second = actual.acquisitions[1]!;
    const value = v3Ledger(first.title);
    const atStrict = validV3Input(first);
    atStrict.readyTimestamps[1]!.at = 5100;
    const exact = actual.acquisition(value, value.title, first.site, v3Provenance(first), atStrict);
    expect(exact.ok && exact.entry.strictOutcome).toBe('PASS');
    const interrupted = validV3Input(first);
    interrupted.observedAt = 1000;
    interrupted.expectationCompleted = false;
    interrupted.readyTimestamps = interrupted.readyTimestamps.slice(0, 1);
    const partial = actual.acquisition(
      value,
      value.title,
      first.site,
      v3Provenance(first),
      interrupted,
    );
    expect(partial.ok && partial.entry.strictOutcome).toBe('INCOMPLETE');
    expect(() => actual.requireAcquisition(partial)).toThrow('incomplete');
    const later = validV3Input(second);
    later.waitStartedAt = 6200;
    later.observedAt = 11300;
    later.readyTimestamps = [
      later.readyTimestamps[0]!,
      {
        ...later.readyTimestamps[1]!,
        at: 6100,
        committedHorizonMicroseconds: first.horizonMicroseconds,
      },
      {
        ...later.readyTimestamps[2]!,
        at: 11200,
        committedHorizonMicroseconds: second.horizonMicroseconds,
      },
    ];
    const acquired = actual.acquisition(
      value,
      value.title,
      second.site,
      v3Provenance(second),
      later,
    );
    expect(acquired.ok && acquired.entry.originalDeadlineAt).toBe(11200);
    expect(acquired.ok && acquired.entry.strictOutcome).toBe('PASS');
    const notCompleted = validV3Input(first);
    notCompleted.expectationCompleted = false;
    expect(() =>
      actual.requireAcquisition(
        actual.acquisition(value, value.title, first.site, v3Provenance(first), notCompleted),
      ),
    ).toThrow('incomplete');
    for (const firstAt of [40100, 40100.001]) {
      const last = validV3Input(first);
      last.observedAt = 40300;
      last.readyTimestamps[1]!.at = firstAt;
      last.readyTimestamps[2]!.at = 40200;
      const entry = actual.acquisition(value, value.title, first.site, v3Provenance(first), last);
      expect(entry.ok && entry.entry.v3Outcome).toBe(firstAt === 40100 ? 'PASS' : 'FAIL');
    }
  });

  it('rejects future/unordered rows, nonfinite times, wrong source/generation and undeclared acquisitions', () => {
    const actual = oracle().v3;
    const definition = actual.acquisitions[0]!;
    const value = v3Ledger(definition.title);
    const input = validV3Input(definition);
    const invalid: V3Input[] = [
      { ...input, waitStartedAt: NaN },
      { ...input, observedAt: Infinity },
      { ...input, readyTimestamps: [...input.readyTimestamps].reverse() },
      { ...input, readyTimestamps: new Array<V3Input['readyTimestamps'][number]>(2) },
      ...[
        { at: 6601 },
        { at: -1 },
        { committedHorizonMicroseconds: 1.1 },
        { sourceSha256: 'd'.repeat(64) },
        { generationId: 8 },
        { responseGenerationId: 8 },
      ].map((changed) => ({
        ...input,
        readyTimestamps: [{ ...input.readyTimestamps[1]!, ...changed }],
      })),
    ];
    for (const candidate of invalid)
      expect(() =>
        actual.requireAcquisition(
          actual.acquisition(
            value,
            value.title,
            definition.site,
            v3Provenance(definition),
            candidate,
          ),
        ),
      ).toThrow();
    for (const site of ['__proto__', 'constructor', 'delay-1-ready-horizon-1500001'])
      expect(() =>
        actual.requireAcquisition(
          actual.acquisition(value, value.title, site, v3Provenance(definition), input),
        ),
      ).toThrow();
    const wrongTitle = actual.cases[0]!;
    expect(() =>
      actual.requireAcquisition(
        actual.acquisition(
          v3Ledger(wrongTitle),
          wrongTitle,
          definition.site,
          v3Provenance(definition),
          input,
        ),
      ),
    ).toThrow();
  });
});

describe('v3 preserves real functional publication and native observations', () => {
  // Analytic input for the actual extracted oracle. These induced records are
  // not a browser receipt and never fill missing fields in historical evidence.
  function startupFixture() {
    const frame = (at: number, model: number, brightness: number) => ({
      at,
      requestAt: at - 10,
      source: 'source',
      generationId: 7,
      responseGenerationId: 7,
      requestId: String(at),
      executionStatus: 'ready',
      solved: true,
      qualityPassed: true,
      committedHorizonMicroseconds: model,
      requestedHorizonMicroseconds: model,
      continuationHorizonMicroseconds: model,
      components: [0, 1, 2].map((index) => ({
        componentId: `led${index}`,
        brightness,
        current: brightness > 0 ? 0.01 : 0,
      })),
    });
    const evidence = () => ({
      ledHrefs: [0, 1, 2].map(() => '/assets/led/red/led_red_i000.svg'),
      simulationStatus: 'starting',
      timeText: 'Время моделирования: 00:00:00',
      board: {
        href: '/assets/arduino/uno.svg',
        mountedLoadAt: 5 as number | null,
        visible: true,
        unoccluded: true,
        opacity: 1,
      },
      l: { activeAttribute: 'false', opacity: 0, visible: true },
    });
    const paint = (at: number, brightness: number) => ({
      at,
      brightness: [brightness, brightness, brightness],
      imagesReady: true,
      startupEvidence: evidence() as ReturnType<typeof evidence> | undefined,
    });
    const run = (at: number, brightness: number) => ({
      first: {
        at: at + 16,
        previousFrameAt: at,
        brightness: [brightness, brightness, brightness],
        images: [0, 1, 2].map(() => ({
          decoded: true,
          visible: true,
          unoccluded: true,
          opacity: 1,
          lit: brightness > 0,
        })),
      },
      lastAt: at,
      witnessAt: [at],
    });
    const raw = {
      frames: [frame(100, 0, 0), frame(120, 1000, 80)],
      // The third startup sample is deliberately unstable and has no paintRun.
      paintFrames: [paint(20, 0), paint(95, 0), paint(99, 0), paint(150, 80)],
      paintRuns: [run(20, 0), run(95, 0), run(150, 80)],
    };
    raw.paintFrames[0]!.startupEvidence!.simulationStatus = 'stopped';
    raw.paintFrames[0]!.startupEvidence!.timeText = '';
    raw.paintFrames[3]!.startupEvidence!.simulationStatus = 'running';
    return raw;
  }

  it('classifies every complete dark native startup row without inventing an electrical witness', () => {
    const raw = startupFixture();
    const original = structuredClone(raw);
    const result = oracle().v3.causality(raw, 'source', 7, 0);
    expect(result.violations).toEqual([]);
    expect(result.startup.h0ReadyAt).toBe(100);
    expect(result.startup.h0RequestId).toBe('100');
    expect(result.startup.frames).toEqual(
      [20, 95, 99].map((at) => ({
        at,
        brightness: [0, 0, 0],
        status: 'DARK_STARTUP',
        reason: null,
      })),
    );
    expect(result.witnesses).toEqual([expect.objectContaining({ at: 150, readyAt: 120 })]);
    expect(raw).toEqual(original);
  });

  function resetStartupFixture() {
    const raw = startupFixture();
    raw.frames.unshift({
      ...raw.frames[1]!,
      at: 8,
      requestAt: 5,
      generationId: 6,
      responseGenerationId: 6,
      requestId: 'before-reset',
    });
    return raw;
  }

  it('retains every dark Reset startup row without borrowing a pre-action request', () => {
    const raw = resetStartupFixture();
    const original = structuredClone(raw);
    const result = oracle().v3.causality(raw, 'source', 7, 10);
    expect(result.violations).toEqual([]);
    expect(result.startup.frames).toHaveLength(3);
    expect(result.startup.frames.every((row) => row.status === 'DARK_STARTUP')).toBe(true);
    expect(result.startup.h0ReadyAt).toBe(100);
    expect(result.startup.h0RequestId).toBe('100');
    expect(result.witnesses).toEqual([expect.objectContaining({ at: 150, readyAt: 120 })]);
    expect(raw).toEqual(original);
  });

  it('still rejects old-generation receipts after Reset, bright pre-H0 rows and missing new H0', () => {
    for (const invalid of ['late-old-receipt', 'bright-before-request', 'missing-new-h0']) {
      const raw = resetStartupFixture();
      if (invalid === 'late-old-receipt') raw.frames[0]!.at = 19;
      if (invalid === 'bright-before-request') raw.paintFrames[0]!.brightness[0] = 80;
      if (invalid === 'missing-new-h0') raw.frames.splice(1, 1);
      const original = structuredClone(raw);
      const result = oracle().v3.causality(raw, 'source', 7, 10);
      const reason =
        invalid === 'late-old-receipt'
          ? 'electrical ready state already received before initial H0'
          : invalid === 'bright-before-request'
            ? 'native LEDs are not completely dark and ready before H0'
            : 'initial electrical H0 is missing or invalid';
      expect(result.violations, invalid).toContainEqual(expect.objectContaining({ reason }));
      if (invalid === 'missing-new-h0') expect(result.startup.h0ReadyAt).toBeNull();
      expect(raw, invalid).toEqual(original);
    }
  });

  it('rejects lit, unready, obscured or incomplete native startup and advertised model state', () => {
    type Fixture = ReturnType<typeof startupFixture>;
    const changes: Array<[string, (raw: Fixture) => void]> = [
      [
        'unstable lit LED',
        (raw) => {
          raw.paintFrames[2]!.brightness[0] = 80;
        },
      ],
      [
        'unready LED',
        (raw) => {
          raw.paintFrames[2]!.imagesReady = false;
        },
      ],
      [
        'active LED asset',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.ledHrefs[0] = '/assets/led/red/led_red_i070.svg';
        },
      ],
      [
        'missing LED asset',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.ledHrefs.pop();
        },
      ],
      [
        'missing joint evidence',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence = undefined;
        },
      ],
      [
        'L active',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.l.activeAttribute = 'true';
        },
      ],
      [
        'L opacity',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.l.opacity = 1;
        },
      ],
      [
        'L hidden',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.l.visible = false;
        },
      ],
      [
        'native board not loaded',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.board.mountedLoadAt = null;
        },
      ],
      [
        'native board load in future',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.board.mountedLoadAt = 100;
        },
      ],
      [
        'native board obscured',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.board.unoccluded = false;
        },
      ],
      [
        'native board hidden',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.board.visible = false;
        },
      ],
      [
        'native board faded',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.board.opacity = 0.5;
        },
      ],
      [
        'nonzero advertised time',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.timeText = 'Время моделирования: 00:00:01';
        },
      ],
      [
        'unknown advertised time',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.timeText = '';
        },
      ],
      [
        'modeled running status',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.simulationStatus = 'running';
        },
      ],
      [
        'unknown simulation status',
        (raw) => {
          raw.paintFrames[2]!.startupEvidence!.simulationStatus = '';
        },
      ],
    ];
    for (const [name, change] of changes) {
      const raw = startupFixture();
      change(raw);
      const original = structuredClone(raw);
      const result = oracle().v3.causality(raw, 'source', 7, 0);
      expect(result.violations, name).toEqual([expect.objectContaining({ at: 99 })]);
      expect(result.startup.frames[2]!.status, name).toBe('FAIL');
      expect(result.witnesses, name).toHaveLength(1);
      expect(raw, name).toEqual(original);
    }
  });

  it('rejects absent or invalid H0 instead of accepting an indefinitely dark startup', () => {
    for (const invalid of ['absent', 'positive-first', 'wrong-generation', 'bad-request-clock']) {
      const raw = startupFixture();
      if (invalid === 'absent') raw.frames.length = 0;
      if (invalid === 'positive-first') raw.frames.shift();
      if (invalid === 'wrong-generation') raw.frames[0]!.responseGenerationId = 8;
      if (invalid === 'bad-request-clock') raw.frames[0]!.requestAt = 101;
      const result = oracle().v3.causality(raw, 'source', 7, 0);
      expect(result.startup.h0ReadyAt, invalid).toBe(null);
      expect(result.violations, invalid).toContainEqual(
        expect.objectContaining({ reason: 'initial electrical H0 is missing or invalid' }),
      );
      expect(
        result.startup.frames.every((row) => row.status === 'FAIL'),
        invalid,
      ).toBe(true);
    }
  });

  it('does not exempt foreign requests or an already received ready state before H0', () => {
    for (const kind of ['source', 'generation', 'earlier-ready']) {
      const raw = startupFixture();
      const foreign = {
        ...raw.frames[1]!,
        at: kind === 'earlier-ready' ? 94 : 200,
        requestAt: kind === 'earlier-ready' ? 75 : 92,
        requestId: 'foreign',
        source: kind === 'source' || kind === 'earlier-ready' ? 'foreign' : 'source',
        generationId: kind === 'generation' ? 8 : 7,
        executionStatus: kind === 'earlier-ready' ? 'ready' : 'yielded',
      };
      raw.frames.splice(0, 0, foreign);
      const result = oracle().v3.causality(raw, 'source', 7, 0);
      expect(result.violations, kind).toContainEqual(
        expect.objectContaining({
          reason:
            kind === 'earlier-ready'
              ? 'electrical ready state already received before initial H0'
              : 'foreign source or inactive generation before H0',
        }),
      );
      expect(
        result.startup.frames.some((row) => row.at === 95 && row.status === 'FAIL'),
        kind,
      ).toBe(true);
    }
  });

  it('requires an exact same-RAF startup record and retains post-H0 source and supersession failures', () => {
    const missing = startupFixture();
    missing.paintFrames.splice(1, 1);
    expect(oracle().v3.causality(missing, 'source', 7, 0).violations).toContainEqual(
      expect.objectContaining({ at: 95, reason: 'missing or mismatched same-RAF startup witness' }),
    );
    for (const kind of ['stale', 'source', 'generation']) {
      const raw = startupFixture();
      if (kind === 'stale') {
        raw.paintRuns[2]!.witnessAt = [171];
        raw.paintRuns[2]!.lastAt = 171;
        raw.paintRuns[2]!.first.previousFrameAt = 171;
        raw.paintRuns[2]!.first.brightness = [0, 0, 0];
        for (const image of raw.paintRuns[2]!.first.images) image.lit = false;
      } else {
        raw.frames.push({
          ...raw.frames[1]!,
          at: 200,
          requestAt: 130,
          requestId: 'new-active',
          source: kind === 'source' ? 'foreign' : 'source',
          generationId: kind === 'generation' ? 8 : 7,
          executionStatus: 'yielded',
        });
      }
      const result = oracle().v3.causality(raw, 'source', 7, 0);
      expect(
        result.startup.frames.every((row) => row.status === 'DARK_STARTUP'),
        kind,
      ).toBe(true);
      expect(result.violations, kind).toEqual([
        expect.objectContaining({
          reason:
            kind === 'stale'
              ? 'electrical state superseded more than 50 ms ago'
              : 'foreign source or inactive generation',
        }),
      ]);
    }
  });

  it('keeps the actual supersession allowance at 50 raw wall milliseconds', () => {
    const actual = oracle().v3;
    const frame = (at: number, brightness: number) => ({
      at,
      requestAt: at - 1,
      source: 'source',
      generationId: 7,
      responseGenerationId: 7,
      requestId: String(at),
      executionStatus: 'ready',
      solved: true,
      qualityPassed: true,
      committedHorizonMicroseconds: at * 1000,
      requestedHorizonMicroseconds: at * 1000,
      continuationHorizonMicroseconds: at * 1000,
      components: [0, 1, 2].map((index) => ({ componentId: `led${index}`, brightness })),
    });
    const raw = (at: number) => ({
      frames: [{ ...frame(0, 0), requestAt: 0 }, frame(100, 80), frame(200, 0)],
      paintRuns: [
        {
          first: {
            previousFrameAt: at - 16,
            brightness: [80, 80, 80],
            images: [0, 1, 2].map(() => ({
              decoded: true,
              visible: true,
              unoccluded: true,
              opacity: 1,
              lit: true,
            })),
          },
          lastAt: at,
          witnessAt: [at],
        },
      ],
    });
    expect(actual.causality(raw(250), 'source', 7, 0).violations).toEqual([]);
    expect(actual.causality(raw(250), 'source', 7, 0).witnesses).toHaveLength(1);
    expect(actual.causality(raw(250.001), 'source', 7, 0).violations).toEqual([
      expect.objectContaining({ reason: 'electrical state superseded more than 50 ms ago' }),
    ]);
    expect(readyCompact).toContain('const OWNER_TEMPORAL_PUBLICATION_LAG_MS = 50;');
    expect(readyCompact).toContain(
      'const setupFrom = firstSetup.at + OWNER_TEMPORAL_PUBLICATION_LAG_MS;',
    );
  });

  it('retains the exact primary observer, original model guards and every acquisition outside the allowlist', () => {
    const originalObserver = readFileSync(
      new URL('../../e2e/electronics-classroom-timing.spec.ts', import.meta.url),
    );
    expect(createHash('sha256').update(originalObserver).digest('hex')).toBe(
      'a84a5f2f9d1133c8df0223d011275a7e0fd4e936e00f47cc8acba2529b5cf2cd',
    );
    expect(readyCompact).toContain(
      "if (ownerQualificationLedger?.profile === 'classroom-d13-v2') test.setTimeout(60_000);",
    );
    expect(readyCompact).toContain('expect(first.committedHorizonMicroseconds).toBe(0);');
    expect(readyCompact).toContain('expect(modelMs).toBeGreaterThanOrEqual(minimumModelMs);');
    expect(readyCompact).toContain('expect(half).toBeLessThanOrEqual(2000.01);');
    expect(readyCompact).toContain('expect(Math.abs(half - halfMs)).toBeLessThanOrEqual(0.1);');
    expect(readyText).not.toMatch(/test\.(?:skip|fixme|fail|slow)\(/);
    const calls: ts.CallExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) calls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(readySource);
    expect(
      calls
        .filter((node) => node.expression.getText(readySource) === 'waitForOwnerV3Horizon')
        .map((node) => node.arguments[2]?.getText(readySource)),
    ).toEqual([
      "'delay-2000-ready-horizon-4050000'",
      "'delay-2000-ready-horizon-8100000'",
      "'delay-1-ready-horizon-1500000'",
      "'millis-ready-horizon-2250000'",
    ]);
    expect(
      calls
        .filter((node) => node.expression.getText(readySource) === 'recordOwnerV3Timing')
        .map((node) => node.arguments[2]!.getText(readySource).replace(/\s+/g, ' ')),
    ).toEqual([
      'site',
      '`owner-blink-${delayMs}-dom-wall-model`',
      '`owner-blink-${delayMs}-dom-mean-period`',
      '`owner-blink-${delayMs}-dom-transition-gaps`',
      '`owner-blink-${delayMs}-${surface}-half-durations`',
      '`owner-blink-${delayMs}-paint-wall-model`',
      "mode === 'no-delay realtime' ? 'no-delay-execution-wall-model' : 'independent-ports-execution-wall-model'",
      '`independent-ports-led${pin}-high-periods`',
      '`blockly-${half}-paint-half-durations`',
      '`delay-2000-${id}-paint-half-durations`',
      '`delay-2000-${id}-paint-mean-period`',
      '`millis-${id}-paint-half-durations`',
      '`millis-${id}-paint-mean-period`',
    ]);
    expect(
      calls
        .filter((node) => node.expression.getText(readySource) === 'assertOwnerV3TemporalClock')
        .map((node) => node.arguments[2]!.getText(readySource)),
    ).toEqual([
      '`blockly-${half}-temporal-wall-model`',
      "'delay-2000-temporal-wall-model'",
      "'delay-1-temporal-wall-model'",
      "'millis-temporal-wall-model'",
      "'reset-temporal-wall-model'",
    ]);
  });
});

describe('separately named v3 runner with the complete original browser suite', () => {
  it.each([0, 17])(
    'propagates real v3 child exit %i and immutable source environment',
    (exitCode) => {
      const result = runActualRunner({ exitCode, lifecycle: v3Entrypoint });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(exitCode);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        argv: ['e2e:electronics-simulation'],
        cwd: repositoryRoot.replace(/[\\/]$/, ''),
        profile: 'classroom-d13-v3',
        entrypoint: v3Entrypoint,
        expectedSha: 'd'.repeat(40),
        nxSkip: 'true',
      });
    },
  );
  it('does not turn v3 child signal failure, profile conflicts or filtered invocations into PASS', () => {
    expect(runActualRunner({ signal: true, lifecycle: v3Entrypoint }).status).not.toBe(0);
    for (const options of [
      { args: ['--grep', 'D13'] },
      { args: ['--retries', '3'] },
      { profile: 'classroom-d13-v2' },
      { profile: 'strict-real-time' },
      { profile: 'unknown' },
      { lifecycle: '__proto__' },
      { lifecycle: 'constructor' },
      { inheritedEntrypoint: v3Entrypoint },
      { cli: '' },
      { cli: 'relative-pnpm.cjs' },
    ]) {
      const result = runActualRunner({ lifecycle: v3Entrypoint, ...options });
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe('');
    }
  });
});

type V3LifecycleFrame = {
  at: number;
  source: string;
  executionStatus: string;
  generationId: number | null;
  responseGenerationId: number | null;
  committedHorizonMicroseconds: number;
};
type V3LifecycleReport = {
  ledger: V3Ledger;
  qualificationStatus: string;
  missingSites: string[];
  unreached: Array<{ site: string; outcome: string }>;
  reachedWithoutValidEvidence: Array<{
    site: string;
    outcome: string;
    acquisition: Record<string, unknown>;
  }>;
};
type V3LifecycleInfo = {
  title: string;
  status: string;
  expectedStatus: string;
  workerIndex: number;
  retry: number;
  attach: (name: string, attachment: { path: string; contentType: string }) => Promise<void>;
};
const v3LifecycleSource = 'void loop() { delay(2000); }';
const v3LifecycleSourceSha256 = createHash('sha256').update(v3LifecycleSource).digest('hex');
const actualBeforeEachStatements = readySource.statements.filter(
  (statement) =>
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(readySource) === 'test.beforeEach',
);
if (actualBeforeEachStatements.length !== 1)
  throw new Error('Expected exactly one actual ready-cadence beforeEach callback.');
const v3BeforeEachJavaScript = ts.transpileModule(
  `${declarations.join('\n')}\n${actualBeforeEachStatements[0]!.getText(readySource)}`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;

async function runV3BeforeEach(title: string, profile: string) {
  let before:
    | ((
        fixtures: { browserName: string },
        info: { title: string; workerIndex: number; retry: number },
      ) => Promise<void>)
    | null = null;
  const timeouts: number[] = [];
  let seedCalls = 0;
  // Only the external seed and source read are fixtures; execute the complete
  // actual beforeEach to prove strict/v2 do not receive classroom case budgets.
  const context = {
    createHash,
    resolve,
    readFileSync: () => readyText,
    admin: {},
    teacher: null,
    ownerQualificationLedger: null,
    ownerV3Ledger: null,
    ownerV3Discoveries: [],
    seedTeacher: async () => {
      seedCalls++;
      return {};
    },
    process: {
      env: {
        ASA_ELECTRONICS_QUALIFICATION_PROFILE: profile,
        ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT:
          profile === 'classroom-d13-v3'
            ? v3Entrypoint
            : profile === 'classroom-d13-v2'
              ? entrypoint
              : undefined,
        ASA_ELECTRONICS_EXPECTED_SHA: 'a'.repeat(40),
      },
    },
    test: {
      beforeEach: (callback: typeof before) => {
        before = callback;
      },
      setTimeout: (timeout: number) => {
        timeouts.push(timeout);
      },
    },
  };
  runInNewContext(v3BeforeEachJavaScript, context);
  if (!before) throw new Error('Actual beforeEach did not register.');
  const callback = before as (
    fixtures: { browserName: string },
    info: { title: string; workerIndex: number; retry: number },
  ) => Promise<void>;
  await callback({ browserName: 'chromium' }, { title, workerIndex: 0, retry: 0 });
  return { timeouts, seedCalls, ledger: context.ownerV3Ledger };
}

const actualAfterEachStatements = readySource.statements.filter(
  (statement) =>
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(readySource) === 'test.afterEach',
);
if (actualAfterEachStatements.length !== 1)
  throw new Error('Expected exactly one actual ready-cadence afterEach callback.');
const v3LifecycleJavaScript = ts.transpileModule(
  `${declarations.join('\n')}\n${actualAfterEachStatements[0]!.getText(readySource)}\nwaitForOwnerV3Horizon;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;

// Exercise the actual acquisition wrapper and actual afterEach together. Only
// the browser clock/Worker prefix, rejecting poll and artifact sink are fixtures.
// This is a control-flow regression, not a browser or visible-product result.
async function runV3Lifecycle(
  definition: V3AcquisitionDefinition,
  options: {
    value?: V3Ledger;
    waitStartedAt?: number;
    observedAt?: number;
    frames?: V3LifecycleFrame[];
    primaryError?: Error;
    observationError?: Error;
    startError?: Error;
    afterStatus?: string;
  } = {},
) {
  const value = options.value ?? v3Ledger(definition.title);
  value.observerSha256 = createHash('sha256').update(readyText).digest('hex');
  const waitStartedAt = options.waitStartedAt ?? 100;
  const observedAt = options.observedAt ?? waitStartedAt + definition.timeoutMs + 1;
  let browserNow = waitStartedAt;
  let evaluateCalls = 0;
  let afterEachCallback:
    ((fixtures: { browserName: string }, info: V3LifecycleInfo) => Promise<void>) | null = null;
  let report: V3LifecycleReport | null = null;
  const attachments: string[] = [];
  const polls: Array<{
    timeout: number;
    intervals: number[];
    predicateResult: unknown;
    expected: unknown;
  }> = [];
  const page = {
    evaluate: async (callback: (argument?: unknown) => unknown, argument?: unknown) => {
      evaluateCalls++;
      if (evaluateCalls === 1 && options.startError) throw options.startError;
      if (typeof argument === 'string') {
        if (options.observationError) throw options.observationError;
        browserNow = observedAt;
      }
      return callback(argument);
    },
  };
  const invoke = runInNewContext(v3LifecycleJavaScript, {
    createHash,
    ownerQualificationLedger: null,
    ownerV3Ledger: value,
    ownerV3Discoveries: [],
    artifactRoot: '/v3-lifecycle-fixture',
    resolve,
    mkdirSync: () => undefined,
    writeFileSync: (_path: string, body: string) => {
      report = JSON.parse(body) as V3LifecycleReport;
    },
    performance: { now: () => browserNow },
    window: { __ownerTemporal: { frames: options.frames ?? [] } },
    test: {
      info: () => ({ title: value.title }),
      afterEach: (callback: typeof afterEachCallback) => {
        afterEachCallback = callback;
      },
    },
    expect: {
      poll: (
        predicate: () => Promise<unknown>,
        configuration: { timeout: number; intervals: number[] },
      ) => ({
        toBe: async (expected: unknown) => {
          const predicateResult = await predicate();
          polls.push({ ...configuration, predicateResult, expected });
          if (options.primaryError) throw options.primaryError;
          expect(predicateResult).toBe(expected);
        },
      }),
    },
  }) as (page: unknown, source: string, site: string) => Promise<void>;
  const [acquisition] = await Promise.allSettled([
    invoke(page, v3LifecycleSource, definition.site),
  ]);
  if (!afterEachCallback) throw new Error('Actual afterEach did not register.');
  const callback = afterEachCallback as (
    fixtures: { browserName: string },
    info: V3LifecycleInfo,
  ) => Promise<void>;
  const [afterEachResult] = await Promise.allSettled([
    callback(
      { browserName: 'chromium' },
      {
        title: value.title,
        status: options.afterStatus ?? (acquisition.status === 'rejected' ? 'failed' : 'passed'),
        expectedStatus: 'passed',
        workerIndex: 0,
        retry: 0,
        attach: async (name) => {
          attachments.push(name);
        },
      },
    ),
  ]);
  if (!report) throw new Error('Actual afterEach did not retain its artifact.');
  return {
    value,
    report: report as V3LifecycleReport,
    polls,
    evaluateCalls,
    attachments,
    acquisitionError: acquisition.status === 'rejected' ? (acquisition.reason as unknown) : null,
    afterEachError:
      afterEachResult.status === 'rejected' ? (afterEachResult.reason as unknown) : null,
  };
}

function v3LifecycleFrame(at: number, horizon: number): V3LifecycleFrame {
  return {
    at,
    source: v3LifecycleSource,
    executionStatus: 'ready',
    generationId: 7,
    responseGenerationId: 7,
    committedHorizonMicroseconds: horizon,
  };
}

describe('actual v3 acquisition and afterEach preserve reached failures without invented provenance', () => {
  it('retains both elapsed deadlines for every invoked zero-ready acquisition and preserves the original rejection', async () => {
    // The second delay-2000 acquisition is isolated here; this does not claim a
    // complete preceding browser sequence. Its invocation still has real bounds.
    for (const definition of oracle().v3.acquisitions) {
      const primary = new Error(`primary timeout: ${definition.site}`);
      const result = await runV3Lifecycle(definition, { primaryError: primary });
      expect(result.acquisitionError).toBe(primary);
      expect(result.afterEachError).toBeNull();
      expect(result.polls).toEqual([
        { timeout: definition.timeoutMs, intervals: [100], predicateResult: false, expected: true },
      ]);
      expect(result.evaluateCalls).toBe(3);
      expect(result.value.entries).toEqual([]);
      expect(result.value.stages).toEqual([]);
      expect(result.value.invalidAcquisitions).toHaveLength(1);
      expect(result.value.invalidAcquisitions[0]!.reached).toMatchObject({
        invocation: 'REACHED',
        site: definition.site,
        title: definition.title,
        stage: definition.stage,
        dimensions: definition.dimensions,
        expectedSourceSha256: v3LifecycleSourceSha256,
        observedProvenance: null,
        expectedPace: 0.125,
        horizonMicroseconds: definition.horizonMicroseconds,
        waitStartedAt: 100,
        originalDeadlineAt: 5100,
        activeDeadlineAt: 100 + definition.timeoutMs,
        observedAt: 100 + definition.timeoutMs + 1,
        firstHorizonAt: null,
        strictLimitMs: 5000,
        acquisitionLimitMs: definition.timeoutMs,
        strictOutcome: 'FAIL',
        v3Outcome: 'FAIL',
        expectationCompleted: false,
        readyTimestamps: [],
        evidenceStatus: 'REJECTED',
        outcomeBasis: 'no-validated-matching-ready-row',
      });
      expect(result.report.qualificationStatus).toBe('FAIL_OR_INCOMPLETE');
      expect(result.report.missingSites).toContain(definition.site);
      expect(result.report.unreached.some((entry) => entry.site === definition.site)).toBe(false);
      expect(result.report.reachedWithoutValidEvidence).toHaveLength(1);
      expect(result.report.reachedWithoutValidEvidence[0]).toMatchObject({
        site: definition.site,
        outcome: 'REACHED_WITH_INVALID_EVIDENCE',
      });
      expect(result.report.unreached).toHaveLength(
        oracle().v3.required(definition.title).length - 1,
      );
      expect(result.attachments).toEqual(['electronics-qualification-v3-ledger']);
    }
  });

  it('uses the actual invocation boundary for cancellation and the inclusive original and active deadlines', async () => {
    const definitions = oracle().v3.acquisitions;
    for (const definition of definitions) {
      const start = definition === definitions[1] ? 6200 : 100;
      for (const [elapsed, strictOutcome, v3Outcome] of [
        [900, 'INCOMPLETE', 'INCOMPLETE'],
        [4999.999, 'INCOMPLETE', 'INCOMPLETE'],
        [5000, 'FAIL', 'INCOMPLETE'],
        [definition.timeoutMs - 0.001, 'FAIL', 'INCOMPLETE'],
        [definition.timeoutMs, 'FAIL', 'FAIL'],
      ] as const) {
        const primary = new Error('cancelled or expired actual acquisition');
        const result = await runV3Lifecycle(definition, {
          waitStartedAt: start,
          observedAt: start + elapsed,
          primaryError: primary,
        });
        expect(result.acquisitionError).toBe(primary);
        expect(result.value.invalidAcquisitions[0]!.reached).toMatchObject({
          waitStartedAt: start,
          observedAt: start + elapsed,
          originalDeadlineAt: start + 5000,
          activeDeadlineAt: start + definition.timeoutMs,
          strictOutcome,
          v3Outcome,
          observedProvenance: null,
        });
        expect(result.report.unreached.some((entry) => entry.site === definition.site)).toBe(false);
      }
    }
  });

  it('retains malformed, wrong-generation and stale-source prefixes as reached failures, with no qualified entry', async () => {
    const definition = oracle().v3.acquisitions[0]!;
    const row = v3LifecycleFrame(6100, definition.horizonMicroseconds);
    const candidates = [
      { frames: [{ ...row, at: NaN }] },
      { frames: [{ ...row, at: 40102 }] },
      { frames: [{ ...row, committedHorizonMicroseconds: 1.5 }] },
      { frames: [row, { ...row, at: 6000 }] },
      { frames: [{ ...row, generationId: null }] },
      { frames: [{ ...row, responseGenerationId: 8 }] },
      { frames: [row, { ...row, at: 6500, generationId: 8, responseGenerationId: 8 }] },
      { frames: [{ ...row, generationId: 6, responseGenerationId: 6 }], previousGeneration: 7 },
      { frames: [{ ...row, source: 'stale source' }] },
    ];
    for (const candidate of candidates) {
      const value = v3Ledger(definition.title);
      if (candidate.previousGeneration !== undefined)
        value.stages.push({
          stage: definition.stage,
          sourceSha256: v3LifecycleSourceSha256,
          observedSourceSha256: v3LifecycleSourceSha256,
          generationId: candidate.previousGeneration,
        });
      const primary = new Error('primary remains primary despite invalid retained prefix');
      const result = await runV3Lifecycle(definition, {
        value,
        frames: candidate.frames,
        primaryError: primary,
      });
      expect(result.acquisitionError).toBe(primary);
      expect(result.value.entries).toEqual([]);
      expect(result.value.invalidAcquisitions[0]!.reached).toMatchObject({
        site: definition.site,
        invocation: 'REACHED',
        waitStartedAt: 100,
        observedAt: 100 + definition.timeoutMs + 1,
        originalDeadlineAt: 5100,
        activeDeadlineAt: 100 + definition.timeoutMs,
        firstHorizonAt: null,
        strictOutcome: 'FAIL',
        v3Outcome: 'FAIL',
      });
      expect(result.report.unreached.some((entry) => entry.site === definition.site)).toBe(false);
      expect(result.report.qualificationStatus).toBe('FAIL_OR_INCOMPLETE');
    }
  });

  it('cannot promote a fulfilled poll with invalid ready provenance or a mislabeled passed case to PASS', async () => {
    const definition = oracle().v3.acquisitions[0]!;
    const result = await runV3Lifecycle(definition, {
      frames: [
        { ...v3LifecycleFrame(6100, definition.horizonMicroseconds), responseGenerationId: 8 },
      ],
      afterStatus: 'passed',
    });
    expect(result.polls[0]!.predicateResult).toBe(true);
    expect(String(result.acquisitionError)).toContain('Invalid v3 acquisition');
    expect(result.afterEachError).not.toBeNull();
    expect(String(result.afterEachError)).toContain('Reached v3 acquisition');
    expect(result.value.entries).toEqual([]);
    expect(result.value.invalidAcquisitions[0]!.reached).toMatchObject({
      expectationCompleted: true,
      strictOutcome: 'FAIL',
      v3Outcome: 'FAIL',
    });
    expect(result.report.qualificationStatus).toBe('FAIL_OR_INCOMPLETE');
    expect(result.report.unreached.some((entry) => entry.site === definition.site)).toBe(false);
  });

  it('keeps unavailable clock or retention boundaries explicit and preserves the primary failure', async () => {
    const definition = oracle().v3.acquisitions[0]!;
    const primary = new Error('primary acquisition rejection');
    const secondary = new Error('observation unavailable');
    const result = await runV3Lifecycle(definition, {
      primaryError: primary,
      observationError: secondary,
    });
    expect(result.acquisitionError).toBe(primary);
    expect(result.value.invalidAcquisitions[0]!.error).toContain('observation unavailable');
    expect(result.value.invalidAcquisitions[0]!.reached).toMatchObject({
      invocation: 'REACHED',
      waitStartedAt: 100,
      originalDeadlineAt: 5100,
      activeDeadlineAt: 100 + definition.timeoutMs,
      observedAt: null,
      observedProvenance: null,
      readyTimestamps: null,
      strictOutcome: 'INCOMPLETE',
      v3Outcome: 'INCOMPLETE',
      evidenceStatus: 'UNAVAILABLE',
    });
    expect(result.report.unreached.some((entry) => entry.site === definition.site)).toBe(false);
    const start = await runV3Lifecycle(definition, { startError: secondary });
    expect(start.acquisitionError).toBe(secondary);
    expect(start.polls).toEqual([]);
    expect(start.value.invalidAcquisitions[0]!.reached).toMatchObject({
      invocation: 'REACHED',
      waitStartedAt: null,
      originalDeadlineAt: null,
      activeDeadlineAt: null,
      observedAt: null,
      expectationCompleted: null,
      strictOutcome: 'INCOMPLETE',
      v3Outcome: 'INCOMPLETE',
    });
    expect(start.report.unreached.some((entry) => entry.site === definition.site)).toBe(false);
  });

  it('still permits a genuine complete acquisition while preserving its original5s failure', async () => {
    const actual = oracle().v3;
    const definition = actual.acquisitions[2]!;
    const value = v3Ledger(definition.title);
    for (const timing of actual.sites.filter((entry) => entry.title === value.title)) {
      const absolute = timing.kind === 'absolute-wall-model';
      const raw = absolute
        ? 8000
        : ((timing.bounds.minimumMs ?? 0) + timing.bounds.maximumMs!) / 2 / 0.125;
      actual.record(
        value,
        value.title,
        timing.site,
        {
          ...v3Provenance(timing),
          sourceSha256: v3LifecycleSourceSha256,
          observedSourceSha256: v3LifecycleSourceSha256,
        },
        [raw],
        absolute ? 1000 : null,
      );
    }
    const result = await runV3Lifecycle(definition, {
      value,
      observedAt: 6600,
      frames: [
        v3LifecycleFrame(90, 0),
        v3LifecycleFrame(6100, definition.horizonMicroseconds),
        v3LifecycleFrame(6500, definition.horizonMicroseconds + 1000),
      ],
    });
    expect(result.acquisitionError).toBeNull();
    expect(result.afterEachError).toBeNull();
    expect(result.value.invalidAcquisitions).toEqual([]);
    expect(result.value.entries.at(-1)).toMatchObject({
      site: definition.site,
      strictOutcome: 'FAIL',
      v3Outcome: 'PASS',
      firstHorizonAt: 6100,
      originalDeadlineAt: 5100,
      activeDeadlineAt: 100 + definition.timeoutMs,
    });
    expect(result.report.qualificationStatus).toBe('PASS');
    expect(result.report.missingSites).toEqual([]);
    expect(result.report.unreached).toEqual([]);
    expect(result.report.reachedWithoutValidEvidence).toEqual([]);
  });
});

function discoveryInput(definition: V3DiscoveryDefinition, firstAt = 6100): V3DiscoveryInput {
  return {
    invocation: 'REACHED',
    registryRevision: v3RegistryRevision,
    title: definition.title,
    site: definition.site,
    stage: definition.stage,
    expectedSourceSha256: 'c'.repeat(64),
    clock: 'node-performance',
    startedAt: 100,
    endedAt: firstAt + 1,
    expectationCompleted: true,
    rejection: null,
    samples: [
      { at: 100, value: Array.isArray(definition.expected) ? [] : false },
      { at: firstAt, value: structuredClone(definition.expected) },
    ],
  };
}

type DiscoveryOperation = {
  site: string;
  startedAt: number;
  endedAt: number;
  samples: V3DiscoveryInput['samples'];
  error?: Error;
};
type DiscoveryReport = V3LifecycleReport & {
  discoveryEvidence: {
    registryRevision: string;
    requiredSites: string[];
    records: V3DiscoveryRecord[];
    unreached: Array<{ site: string; outcome: string }>;
  };
};

// Execute the actual wrapper and actual afterEach. Manual predicate completion
// times are an analytic fixture, never a browser timing or native-paint claim.
async function runDiscoveryLifecycle(operations: DiscoveryOperation[], afterStatus?: string) {
  const definitions = oracle().v3.discoverySites.slice(0, 2);
  const value = v3Ledger(definitions[0]!.title);
  const records: V3DiscoveryRecord[] = [];
  const observedOptions: unknown[] = [];
  let now = 0;
  let report: DiscoveryReport | null = null;
  let after: ((fixtures: { browserName: string }, info: V3LifecycleInfo) => Promise<void>) | null =
    null;
  const actual = runInNewContext(
    `${v3LifecycleJavaScript}\n({ discover: withOwnerV3Discovery, sample: ownerV3DiscoverySample, options: ownerV3DiscoveryOptions });`,
    {
      createHash,
      expect,
      ownerQualificationLedger: null,
      ownerV3Ledger: value,
      ownerV3Discoveries: records,
      performance: { now: () => now },
      artifactRoot: '/quarter-discovery-fixture',
      resolve,
      mkdirSync: () => undefined,
      writeFileSync: (_path: string, body: string) => {
        report = JSON.parse(body) as DiscoveryReport;
      },
      test: {
        info: () => ({ title: value.title }),
        afterEach: (callback: typeof after) => {
          after = callback;
        },
      },
    },
  ) as {
    discover: V3Oracle['discover'];
    sample: V3Oracle['discoverySample'];
    options: V3Oracle['discoveryOptions'];
  };
  const errors: unknown[] = [];
  for (const operation of operations) {
    now = operation.startedAt;
    const [result] = await Promise.allSettled([
      actual.discover(operation.site, v3LifecycleSource, async (input) => {
        observedOptions.push(actual.options(input));
        for (const sample of operation.samples) {
          now = sample.at;
          expect(actual.sample(input, sample.value)).toBe(sample.value);
        }
        now = operation.endedAt;
        if (operation.error) throw operation.error;
      }),
    ]);
    if (result.status === 'rejected') errors.push(result.reason);
  }
  if (!after) throw new Error('Actual discovery afterEach did not register.');
  const callback = after as (
    fixtures: { browserName: string },
    info: V3LifecycleInfo,
  ) => Promise<void>;
  const [afterResult] = await Promise.allSettled([
    callback(
      { browserName: 'chromium' },
      {
        title: value.title,
        status: afterStatus ?? (errors.length ? 'failed' : 'passed'),
        expectedStatus: 'passed',
        workerIndex: 0,
        retry: 0,
        attach: async () => undefined,
      },
    ),
  ]);
  if (!report) throw new Error('Actual discovery afterEach did not retain its artifact.');
  return {
    errors,
    records,
    observedOptions,
    report: report as DiscoveryReport,
    afterError: afterResult.status === 'rejected' ? (afterResult.reason as unknown) : null,
  };
}

describe('prospective eighth-pace discovery and lossless transport', () => {
  it('applies exactly the selected finite case and acquisition budgets only in the named v3 beforeEach', async () => {
    const actual = oracle().v3;
    expect(actual.acquisitions.map(({ site, timeoutMs }) => [site, timeoutMs])).toEqual([
      ['delay-2000-ready-horizon-4050000', 40000],
      ['delay-2000-ready-horizon-8100000', 40000],
      ['millis-ready-horizon-2250000', 30000],
      ['delay-1-ready-horizon-1500000', 20000],
    ]);
    expect(actual.caseBudgets).toEqual([
      { title: actual.cases[1], timeoutMs: 90000 },
      { title: actual.cases[3], timeoutMs: 45000 },
      { title: actual.cases[4], timeoutMs: 45000 },
      { title: actual.cases[5], timeoutMs: 45000 },
      { title: actual.cases[6], timeoutMs: 45000 },
      { title: actual.cases[7], timeoutMs: 90000 },
      { title: actual.cases[8], timeoutMs: 100000 },
      { title: actual.cases[9], timeoutMs: 60000 },
      { title: actual.cases[10], timeoutMs: 60000 },
      { title: actual.cases[11], timeoutMs: 60000 },
    ]);
    expect(Object.isFrozen(actual.caseBudgets)).toBe(true);
    for (const budget of actual.caseBudgets) expect(Object.isFrozen(budget)).toBe(true);
    for (const title of actual.cases) {
      const result = await runV3BeforeEach(title, 'classroom-d13-v3');
      const budget = actual.caseBudgets.find((entry) => entry.title === title);
      expect(result.timeouts).toEqual(budget ? [budget.timeoutMs] : []);
      expect(result.seedCalls).toBe(1);
      expect(result.ledger).toMatchObject({
        title,
        expectedPace: 0.125,
        registryRevision: v3RegistryRevision,
      });
      for (const profile of ['strict-real-time', 'classroom-d13-v2']) {
        const original = await runV3BeforeEach(title, profile);
        expect(original.timeouts).toEqual([]);
        expect(original.seedCalls).toBe(1);
      }
    }
    for (const title of ['', '__proto__', actual.cases[1] + ' ', actual.cases[7] + ' extra']) {
      const [result] = await Promise.allSettled([runV3BeforeEach(title, 'classroom-d13-v3')]);
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected')
        throw new Error('Unknown case acquired a classroom budget.');
      expect(String(result.reason)).toContain('invalid v3 ledger');
    }
  });

  it('executes all three actual Blockly discovery waits with the original source/horizon predicate and retains original5s failure', async () => {
    const definitions = oracle().v3.discoverySites.filter((entry) =>
      entry.site.startsWith('blockly-'),
    );
    expect(definitions.map((entry) => entry.site)).toEqual([
      'blockly-100-ready-1000000',
      'blockly-50-ready-1000000',
      'blockly-1-ready-1000000',
    ]);
    const value = v3Ledger(definitions[0]!.title);
    const records: V3DiscoveryRecord[] = [];
    let now = 100;
    let source = '';
    const frames: Array<{
      source: string;
      executionStatus: string;
      committedHorizonMicroseconds: number;
    }> = [];
    const options: unknown[] = [];
    const actual = runInNewContext(oracleJavaScript, {
      createHash,
      ownerQualificationLedger: null,
      ownerV3Ledger: value,
      ownerV3Discoveries: records,
      performance: { now: () => now },
      window: { __ownerTemporal: { frames } },
      test: { info: () => ({ title: value.title }) },
      expect: {
        poll: (predicate: () => Promise<boolean>, configuration: unknown) => ({
          toBe: async (expected: boolean) => {
            options.push(configuration);
            expect(await predicate()).toBe(false);
            now += 8000;
            frames.push({
              source,
              executionStatus: 'ready',
              committedHorizonMicroseconds: 1000000,
            });
            expect(await predicate()).toBe(expected);
          },
        }),
      },
    }) as { v3: V3Oracle };
    const page = {
      evaluate: async (callback: (argument: unknown) => unknown, argument: unknown) =>
        callback(argument),
    };
    for (const definition of definitions) {
      source = `generated source ${definition.stage}`;
      frames.length = 0;
      frames.push(
        {
          source: 'foreign source',
          executionStatus: 'ready',
          committedHorizonMicroseconds: 2000000,
        },
        { source, executionStatus: 'yielded', committedHorizonMicroseconds: 2000000 },
        { source, executionStatus: 'ready', committedHorizonMicroseconds: 999999 },
      );
      await actual.v3.waitForTemporalHorizon(page, source, 1000000, definition.site);
      now += 100;
    }
    expect(options).toEqual(definitions.map(() => ({ intervals: [100], timeout: 12000 })));
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(record.input.samples.map((sample) => sample.value)).toEqual([false, true]);
      expect(record.evaluation).toMatchObject({
        originalTimeoutMs: 5000,
        activeTimeoutMs: 12000,
        originalOutcome: 'FAIL',
        activeOutcome: 'PASS',
      });
    }
    actual.v3.discoveriesComplete(value.title, records);
  });

  it('seals exactly eleven finite existing discoveries without changing the 42 core records', () => {
    const actual = oracle().v3;
    expect(actual.sites.length + actual.acquisitions.length).toBe(42);
    expect(
      actual.discoverySites.map(({ site, stage, timeoutMs, expected }) => ({
        site,
        stage,
        timeoutMs,
        expected,
      })),
    ).toEqual([
      {
        site: 'gpio-initial-complete-indices',
        stage: 'gpio-initial',
        timeoutMs: 20000,
        expected: [0, 1, 2, 3, 4, 5, 6, 7],
      },
      {
        site: 'gpio-reopened-complete-indices',
        stage: 'gpio-reopened',
        timeoutMs: 20000,
        expected: [0, 1, 2, 3, 4, 5, 6, 7],
      },
      {
        site: 'owner-blink-100-ready-and-light',
        stage: 'blink-100',
        timeoutMs: 16000,
        expected: true,
      },
      {
        site: 'owner-blink-50-ready-and-light',
        stage: 'blink-50',
        timeoutMs: 16000,
        expected: true,
      },
      {
        site: 'no-delay-execution-ready-1250000',
        stage: 'no-delay realtime',
        timeoutMs: 16000,
        expected: true,
      },
      {
        site: 'independent-ports-execution-ready-1250000',
        stage: 'independent ports',
        timeoutMs: 16000,
        expected: true,
      },
      {
        site: 'reset-before-ready-1250000',
        stage: 'reset-before',
        timeoutMs: 16000,
        expected: true,
      },
      {
        site: 'reset-restarted-ready-1250000',
        stage: 'reset-restarted',
        timeoutMs: 16000,
        expected: true,
      },
      {
        site: 'blockly-100-ready-1000000',
        stage: 'blockly-100',
        timeoutMs: 12000,
        expected: true,
      },
      {
        site: 'blockly-50-ready-1000000',
        stage: 'blockly-50',
        timeoutMs: 12000,
        expected: true,
      },
      {
        site: 'blockly-1-ready-1000000',
        stage: 'blockly-1',
        timeoutMs: 12000,
        expected: true,
      },
    ]);
    expect(
      actual.cases.map(
        (title) => actual.discoverySites.filter((site) => site.title === title).length,
      ),
    ).toEqual([0, 2, 0, 1, 1, 1, 1, 3, 0, 0, 0, 2]);
    expect(Object.isFrozen(actual.discoverySites)).toBe(true);
    for (const definition of actual.discoverySites) expect(Object.isFrozen(definition)).toBe(true);
    expect(readyCompact).toContain('if (caseBudget) test.setTimeout(caseBudget.timeoutMs);');
    expect(readyCompact).toContain(
      "if (ownerQualificationLedger?.profile === 'classroom-d13-v2') test.setTimeout(60_000);",
    );
    // The prior profile is not silently reinterpreted as the new quarter pace.
    const old = {
      ...v3Ledger(actual.cases[1]!),
      registryRevision: '06fa47e2744f9c1389e3a709d6b33c88d12a9a25024993afece62b483d0e14dd',
      expectedPace: 0.5,
    };
    expect(() => actual.complete(old, old.title)).toThrow('invalid v3 ledger');
  });

  it('retains exact original and active inclusive deadlines, interruption and every ordered sample', () => {
    const actual = oracle().v3;
    for (const definition of actual.discoverySites) {
      for (const [at, originalOutcome, activeOutcome] of [
        [5100, 'PASS', 'PASS'],
        [5100.001, 'FAIL', 'PASS'],
        [100 + definition.timeoutMs, 'FAIL', 'PASS'],
        [100.001 + definition.timeoutMs, 'FAIL', 'FAIL'],
      ] as const) {
        const input = discoveryInput(definition, at);
        const before = structuredClone(input);
        expect(actual.discovery(input)).toMatchObject({
          originalOutcome,
          activeOutcome,
          originalDeadlineAt: 5100,
          activeDeadlineAt: 100 + definition.timeoutMs,
          originalTimeoutMs: 5000,
          activeTimeoutMs: definition.timeoutMs,
          firstSatisfiedAt: at,
        });
        expect(input).toEqual(before);
      }
      for (const [elapsed, originalOutcome, activeOutcome] of [
        [900, 'INCOMPLETE', 'INCOMPLETE'],
        [5000, 'FAIL', 'INCOMPLETE'],
        [definition.timeoutMs, 'FAIL', 'FAIL'],
      ] as const) {
        const input = {
          ...discoveryInput(definition),
          samples: [],
          endedAt: 100 + elapsed,
          expectationCompleted: false,
          rejection: 'actual cancellation or timeout',
        };
        expect(actual.discovery(input)).toMatchObject({
          originalOutcome,
          activeOutcome,
          firstSatisfiedAt: null,
        });
      }
      const rejected = {
        ...discoveryInput(definition),
        expectationCompleted: false,
        rejection: 'original rejection',
      };
      expect(actual.discovery(rejected).activeOutcome).toBe('FAIL');
    }
  });

  it('rejects missing, duplicate, unknown, malformed and tampered discoveries without accepting caller limits', () => {
    const actual = oracle().v3;
    for (const title of actual.cases) {
      const records = actual.discoverySites
        .filter((definition) => definition.title === title)
        .map((definition) => {
          const input = discoveryInput(definition);
          return { input, evaluation: actual.discovery(input) };
        });
      actual.discoveriesComplete(title, records);
      if (!records.length) continue;
      expect(() => actual.discoveriesComplete(title, records.slice(1))).toThrow('not reached');
      expect(() => actual.discoveriesComplete(title, [...records, records[0]!])).toThrow(
        'duplicate',
      );
      for (const changed of [
        { activeOutcome: 'FAIL' },
        { originalOutcome: 'PASS' },
        { activeTimeoutMs: 60000 },
      ]) {
        const forged = structuredClone(records);
        Object.assign(forged[0]!.evaluation, changed);
        expect(() => actual.discoveriesComplete(title, forged)).toThrow('tampered');
      }
      expect(() =>
        actual.discoveriesComplete(title, [
          { ...records[0]!, waiver: true } as V3DiscoveryRecord,
          ...records.slice(1),
        ]),
      ).toThrow('invalid');
    }
    const input = discoveryInput(actual.discoverySites[0]!);
    for (const changed of [
      { site: '__proto__' },
      { title: actual.cases[0]! },
      { stage: 'reopened' },
      { registryRevision: '06fa47e2744f9c1389e3a709d6b33c88d12a9a25024993afece62b483d0e14dd' },
      { expectedSourceSha256: '' },
      { clock: 'browser-performance' },
      { startedAt: NaN },
      { endedAt: 5000 },
      { samples: [{ at: 99, value: input.samples[1]!.value }] },
      { samples: [...input.samples].reverse() },
      { timeoutMs: 60000 },
    ])
      expect(() => actual.discovery({ ...input, ...changed } as V3DiscoveryInput)).toThrow();
    expect(() => Reflect.apply(actual.discovery, undefined, [input, { timeout: 60000 }])).toThrow(
      'caller-selected',
    );
    const wrongOrder = structuredClone(input);
    wrongOrder.samples[1]!.value = [1, 0, 2, 3, 4, 5, 6, 7];
    expect(actual.discovery(wrongOrder).activeOutcome).toBe('INCOMPLETE');
  });

  it('executes the actual wrapper and afterEach with late success, missing invocation and reached empty-prefix failures', async () => {
    const definitions = oracle().v3.discoverySites.slice(0, 2);
    const operations = definitions.map((definition, index) => ({
      site: definition.site,
      startedAt: 100 + index * 7000,
      endedAt: 6200 + index * 7000,
      samples: [{ at: 6100 + index * 7000, value: definition.expected }],
    }));
    const success = await runDiscoveryLifecycle(operations);
    expect(success.errors).toEqual([]);
    expect(success.afterError).toBeNull();
    expect(success.observedOptions).toEqual([{ timeout: 20000 }, { timeout: 20000 }]);
    expect(success.report.qualificationStatus).toBe('PASS');
    expect(success.report.discoveryEvidence.unreached).toEqual([]);
    expect(success.report.discoveryEvidence.records.map((record) => record.evaluation)).toEqual(
      success.records.map((record) => record.evaluation),
    );
    for (const record of success.records)
      expect(record.evaluation).toMatchObject({ originalOutcome: 'FAIL', activeOutcome: 'PASS' });
    const missing = await runDiscoveryLifecycle(operations.slice(0, 1), 'passed');
    expect(String(missing.afterError)).toContain('not reached');
    expect(missing.report.qualificationStatus).toBe('FAIL_OR_INCOMPLETE');
    for (const [endedAt, originalOutcome, activeOutcome] of [
      [1000, 'INCOMPLETE', 'INCOMPLETE'],
      [20101, 'FAIL', 'FAIL'],
    ] as const) {
      const primary = new Error('original actual discovery rejection');
      const failed = await runDiscoveryLifecycle([
        { site: definitions[0]!.site, startedAt: 100, endedAt, samples: [], error: primary },
      ]);
      expect(failed.errors).toEqual([primary]);
      expect(failed.errors[0]).toBe(primary);
      expect(failed.afterError).toBeNull();
      expect(failed.records[0]!.input).toMatchObject({
        invocation: 'REACHED',
        samples: [],
        expectationCompleted: false,
      });
      expect(failed.records[0]!.evaluation).toMatchObject({
        originalOutcome,
        activeOutcome,
        firstSatisfiedAt: null,
      });
      expect(failed.report.discoveryEvidence.unreached).toEqual([
        { site: definitions[1]!.site, outcome: 'NOT_REACHED' },
      ]);
    }
    // A fulfilled callback with no matching predicate sample still cannot pass.
    const empty = await runDiscoveryLifecycle([
      { site: definitions[0]!.site, startedAt: 100, endedAt: 6200, samples: [] },
    ]);
    expect(String(empty.errors[0])).toContain('did not pass');
    expect(empty.report.qualificationStatus).toBe('FAIL_OR_INCOMPLETE');
  });

  it('keeps strict/v2 discovery options and predicates on the original default path', async () => {
    for (const profile of ['strict-real-time', 'classroom-d13-v2']) {
      const records: V3DiscoveryRecord[] = [];
      const actual = oracle(ledger(sites[0][1], profile), null, { discoveries: records }).v3;
      const primary = new Error('strict original assertion');
      const [result] = await Promise.allSettled([
        actual.discover('no-delay-execution-ready-1250000', 'source', async (input) => {
          expect(input).toBeNull();
          expect(actual.discoveryOptions(input)).toBeUndefined();
          expect(actual.discoverySample(input, false)).toBe(false);
          throw primary;
        }),
      ]);
      expect(result.status === 'rejected' ? result.reason : null).toBe(primary);
      expect(records).toEqual([]);
    }
  });

  it('serializes every original wire and temporal row inside the page with identical final JSON bytes', async () => {
    const worker = [0, 1].flatMap((generationId) =>
      [0, 12500].map((horizon) => ({
        at: 50 + generationId * 100 + horizon / 1000,
        generationId,
        requestSource: `sketch-${generationId}`,
        sourceSha256: `${generationId}`.repeat(64),
        advance: {
          committedHorizonMicroseconds: horizon,
          requestedHorizonMicroseconds: horizon,
          result: {
            solved: true,
            quality: { passed: true },
            values: {
              current: 0.01,
              missing: undefined,
              invalid: NaN,
              bounds: [Infinity, -Infinity, -0, undefined],
            },
          },
          state: {
            clocks: [0, 1],
            matrix: [
              [0, 5],
              [2, 3],
            ],
            boards: [{ runtime: { outputVoltages: { d13: horizon ? 5 : 0 } } }],
          },
          ledTemporal: {
            fromMicroseconds: 0,
            toMicroseconds: horizon,
            samples: [{ atMicroseconds: 0, brightness: [0, 0, 0], currents: [0, 0, 0] }],
          },
        },
      })),
    );
    const ui = [
      {
        at: 10,
        brightness: [0, 0, 0],
        startupEvidence: { board: { dark: true }, advertisedModelTimeMs: null },
      },
      { at: 200, brightness: [40, 0, 0] },
    ];
    const paint = [
      {
        at: 205,
        images: [{ href: '/led.png', element: 7, loadedAt: 180, decoded: true, visible: true }],
        brightness: [40, 0, 0],
      },
    ];
    const startClicks = [{ at: 1, trusted: true }],
      reanchors = [{ at: 20, count: 0 }];
    const temporal = {
      frames: worker,
      paintFrames: paint,
      paintRuns: [{ first: paint[0], lastAt: 230 }],
      resetClicks: [{ at: 300, trusted: true }],
      errors: [],
      reanchors,
    };
    const snapshot = { worker, ui, paint, startClicks, reanchors };
    const actual = oracle(null, null, {
      window: {
        __bitwiseWorker: worker,
        __bitwiseUi: ui,
        __ownerPaint: paint,
        __ownerStartClicks: startClicks,
        __ledPlayoutReanchors: reanchors,
        __ownerTemporal: temporal,
      },
    }).v3;
    const transported: unknown[] = [];
    const page = {
      evaluate: async (callback: () => unknown) => {
        const payload = callback();
        transported.push(payload);
        return payload;
      },
    };
    const captured = await actual.observation(page),
      capturedTemporal = await actual.temporalObservation(page);
    expect(transported.map((payload) => typeof payload)).toEqual(['string', 'string']);
    expect(JSON.stringify({ temporal: capturedTemporal, ...captured }, null, 2) + '\n').toBe(
      JSON.stringify({ temporal, ...snapshot }, null, 2) + '\n',
    );
    expect(captured.worker).toEqual(JSON.parse(JSON.stringify(worker)));
    expect(capturedTemporal.frames).toEqual(captured.worker);
    expect(
      (captured.worker as Array<{ generationId: number }>).map((row) => row.generationId),
    ).toEqual([0, 0, 1, 1]);
  });
});
