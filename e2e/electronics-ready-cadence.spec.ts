import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import type { ElectronicsTimedState } from '../contexts/electronics/engine';
import type { SimulationTimedAdvancePayload } from '../apps/web/src/electronics/simulation-worker-protocol';
import type { ArduinoRuntimeState } from '../contexts/electronics/domain/arduino-program-runtime';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const serialSketch = `void setup() {
  Serial.begin(9600);
  for (int i = 0; i < 8; i++) {
    unsigned int mask = 1;
    for (int index = 0; index < i; index++) { mask *= 2; }
    Serial.println(mask);
  }
}

void loop() {
}`;
const gpioSketch = `void setup() {
  for (int pin = 2; pin <= 9; pin++) {
    pinMode(pin, OUTPUT);
  }
}

void loop() {
  for (int step = 0; step < 8; step++) {
    for (int bitIndex = 0; bitIndex < 8; bitIndex++) {
      digitalWrite(2 + bitIndex, step == bitIndex);
    }
    delay(250);
  }
}`;
const initialSource = 'void setup() {}\nvoid loop() { delay(100); }';
const ownerCatalog = JSON.parse(
  readFileSync(resolve('apps/web/public/assets/electronics/owner-catalog/manifest.json'), 'utf8'),
) as { components: Array<{ componentId: string; pins: Array<{ id: string }> }> };
const artifactRoot = resolve('e2e/artifacts/electronics-simulation/ready-cadence-539');
let admin: pg.Pool;
let teacher: SeededTeacher;

// Revision 2 is a separately named test qualification, never a product clock.
const OWNER_CLASSROOM_WALL_SITES = {
  'no-delay-execution-wall-model':
    'Owner Arduino execution: no-delay realtime, production frames and painted LEDs',
  'delay-1-temporal-wall-model':
    'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
  'reset-temporal-wall-model':
    'Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history',
} as const;
const OWNER_MILLIS_CASE =
  'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases';
type OwnerQualificationProfile = 'strict-real-time' | 'classroom-d13-v2';
type OwnerQualificationSite = keyof typeof OWNER_CLASSROOM_WALL_SITES;
type OwnerWallQualification = {
  kind: 'absolute-wall-model';
  title: string;
  site: OwnerQualificationSite;
  modelMs: number;
  wallMs: number;
  deltaMs: number;
  strictLimitMs: 250;
  strictPassed: boolean;
  binding: boolean;
};
type OwnerMillisQualification = {
  kind: 'model-horizon-acquisition';
  title: string;
  site: 'millis-ready-horizon-2250000';
  sourceSha256: string;
  waitStartedAt: number;
  observedAt: number;
  horizonMicroseconds: 2250000;
  strictLimitMs: 5000;
  acquisitionLimitMs: 5000 | 45000;
  firstHorizonAt: number | null;
  strictOutcome: 'PASS' | 'FAIL' | 'INCOMPLETE';
  binding: boolean;
  readyTimestamps: Array<{ at: number; committedHorizonMicroseconds: number }>;
};
type OwnerQualificationLedger = {
  schema: 'electronics-classroom-qualification-v2';
  profile: OwnerQualificationProfile;
  entrypoint: string | null;
  title: string;
  expectedSourceSha: string | null;
  observerSha256: string;
  entries: Array<OwnerWallQualification | OwnerMillisQualification>;
};
let ownerQualificationLedger: OwnerQualificationLedger | null = null;

function ownerQualificationProfile(
  value: string | undefined,
  entrypoint?: string,
): OwnerQualificationProfile | 'classroom-d13-v3' {
  const profile = value === undefined ? 'strict-real-time' : value;
  if (
    profile !== 'strict-real-time' &&
    profile !== 'classroom-d13-v2' &&
    profile !== OWNER_V3_PROFILE
  )
    throw new Error(`Unknown Electronics qualification profile: ${value}`);
  if (
    profile === 'classroom-d13-v2'
      ? entrypoint !== 'gate:electronics-classroom-d13:browser'
      : profile === OWNER_V3_PROFILE
        ? entrypoint !== OWNER_V3_ENTRYPOINT
        : entrypoint !== undefined
  )
    throw new Error(
      'Classroom qualification requires its named runner; ambient profile cannot change the strict gate.',
    );
  return profile;
}

function assertOwnerQualificationIdentity(
  ledger: OwnerQualificationLedger | null,
  title: string,
): asserts ledger is OwnerQualificationLedger {
  if (
    !ledger ||
    ledger.schema !== 'electronics-classroom-qualification-v2' ||
    !['strict-real-time', 'classroom-d13-v2'].includes(ledger.profile) ||
    (ledger.profile === 'classroom-d13-v2'
      ? ledger.entrypoint !== 'gate:electronics-classroom-d13:browser'
      : ledger.entrypoint !== null) ||
    ledger.title !== title ||
    !Array.isArray(ledger.entries) ||
    !/^[a-f0-9]{64}$/.test(ledger.observerSha256) ||
    (ledger.profile === 'classroom-d13-v2' &&
      !/^[a-f0-9]{40}$/.test(ledger.expectedSourceSha ?? ''))
  )
    throw new Error('Missing or invalid Electronics qualification ledger/provenance.');
}

function recordOwnerQualifiedWallClock(
  ledger: OwnerQualificationLedger | null,
  title: string,
  site: OwnerQualificationSite,
  modelMs: number,
  wallMs: number,
): OwnerWallQualification {
  assertOwnerQualificationIdentity(ledger, title);
  if (
    !Object.hasOwn(OWNER_CLASSROOM_WALL_SITES, site) ||
    OWNER_CLASSROOM_WALL_SITES[site] !== title ||
    !Number.isFinite(modelMs) ||
    !Number.isFinite(wallMs) ||
    modelMs < 0 ||
    wallMs < 0 ||
    ledger.entries.some((entry) => entry.site === site)
  )
    throw new Error('Unknown, mismatched or duplicate wall/model comparison site or value.');
  const deltaMs = Math.abs(modelMs - wallMs);
  const entry: OwnerWallQualification = {
    kind: 'absolute-wall-model',
    title,
    site,
    modelMs,
    wallMs,
    deltaMs,
    strictLimitMs: 250,
    strictPassed: deltaMs <= 250,
    binding: ledger.profile === 'strict-real-time',
  };
  // Retain the measured strict outcome before the original binding failure.
  ledger.entries.push(entry);
  if (entry.binding && !entry.strictPassed)
    throw new Error(`Strict wall/model comparison failed at ${site}: ${deltaMs} ms > 250 ms.`);
  return entry;
}

function ownerQualificationRequiredSites(title: string): string[] {
  const sites = Object.entries(OWNER_CLASSROOM_WALL_SITES)
    .filter(([, selectedTitle]) => selectedTitle === title)
    .map(([site]) => site);
  if (title === OWNER_MILLIS_CASE) sites.push('millis-ready-horizon-2250000');
  return sites;
}

function ownerQualificationMissingSites(
  ledger: OwnerQualificationLedger | null,
  title: string,
): string[] {
  assertOwnerQualificationIdentity(ledger, title);
  return ownerQualificationRequiredSites(title).filter(
    (site) => !ledger.entries.some((entry) => entry.site === site && entry.title === title),
  );
}

function requireOwnerQualificationComplete(
  ledger: OwnerQualificationLedger | null,
  title: string,
): void {
  const missing = ownerQualificationMissingSites(ledger, title);
  if (missing.length)
    throw new Error(`Required qualification evidence not reached: ${missing.join(', ')}`);
}

function recordOwnerMillisAcquisition(
  ledger: OwnerQualificationLedger | null,
  title: string,
  sourceSha256: string,
  waitStartedAt: number,
  observedAt: number,
  readyTimestamps: OwnerMillisQualification['readyTimestamps'],
): OwnerMillisQualification {
  assertOwnerQualificationIdentity(ledger, title);
  if (
    title !== OWNER_MILLIS_CASE ||
    !/^[a-f0-9]{64}$/.test(sourceSha256) ||
    !Number.isFinite(waitStartedAt) ||
    !Number.isFinite(observedAt) ||
    waitStartedAt < 0 ||
    observedAt < waitStartedAt ||
    !Array.isArray(readyTimestamps) ||
    readyTimestamps.some(
      (row, index) =>
        !Number.isFinite(row.at) ||
        row.at < 0 ||
        row.at > observedAt ||
        (index > 0 && row.at < readyTimestamps[index - 1]!.at) ||
        !Number.isSafeInteger(row.committedHorizonMicroseconds) ||
        row.committedHorizonMicroseconds < 0,
    ) ||
    ledger.entries.some((entry) => entry.site === 'millis-ready-horizon-2250000')
  )
    throw new Error('Invalid millis acquisition case, boundary or complete ready timestamps.');
  const firstHorizonAt =
    readyTimestamps.find((row) => row.committedHorizonMicroseconds >= 2_250_000)?.at ?? null;
  const strictOutcome =
    firstHorizonAt !== null && firstHorizonAt <= waitStartedAt + 5000
      ? 'PASS'
      : observedAt >= waitStartedAt + 5000
        ? 'FAIL'
        : 'INCOMPLETE';
  const entry: OwnerMillisQualification = {
    kind: 'model-horizon-acquisition',
    title,
    site: 'millis-ready-horizon-2250000',
    sourceSha256,
    waitStartedAt,
    observedAt,
    horizonMicroseconds: 2_250_000,
    strictLimitMs: 5000,
    acquisitionLimitMs: ledger.profile === 'classroom-d13-v2' ? 45000 : 5000,
    firstHorizonAt,
    strictOutcome,
    binding: ledger.profile === 'strict-real-time',
    readyTimestamps,
  };
  ledger.entries.push(entry);
  return entry;
}

// Revision 3 is an independently fixed qualification, not a product setting.
// Raw browser timestamps, native witnesses and electrical times stay untouched.
const OWNER_V3_PROFILE = 'classroom-d13-v3';
const OWNER_V3_ENTRYPOINT = 'gate:electronics-classroom-d13-v3:browser';
const OWNER_V3_PACE = 0.5;
const OWNER_V3_REGISTRY_REVISION =
  '06fa47e2744f9c1389e3a709d6b33c88d12a9a25024993afece62b483d0e14dd';
type OwnerV3Dimensions = Readonly<Record<string, string | number | readonly number[]>>;
type OwnerV3Site = {
  site: string;
  title: string;
  stage: string;
  kind: 'absolute-wall-model' | 'wall-range' | 'wall-range-array' | 'wall-upper-bound-array';
  dimensions: OwnerV3Dimensions;
  bounds: { minimumMs?: number; maximumMs?: number; absoluteDeltaMaximumMs?: number };
  // Only the three prospective throughput findings in the sealed registry.
  binding?: false;
};
type OwnerV3AcquisitionSite = {
  site: string;
  title: string;
  stage: string;
  horizonMicroseconds: number;
  dimensions: OwnerV3Dimensions;
};
function freezeOwnerV3<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeOwnerV3(child);
    Object.freeze(value);
  }
  return value;
}
const OWNER_V3_TIMING_SITES: readonly OwnerV3Site[] = freezeOwnerV3([
  {
    site: 'owner-blink-100-dom-wall-model',
    title:
      'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    stage: 'blink-100',
    kind: 'absolute-wall-model',
    dimensions: { delayMs: 100 },
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'owner-blink-100-dom-mean-period',
    title:
      'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    stage: 'blink-100',
    kind: 'wall-range',
    dimensions: { delayMs: 100 },
    bounds: { minimumMs: 150.0, maximumMs: 250.0 },
  },
  {
    site: 'owner-blink-100-dom-transition-gaps',
    title:
      'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    stage: 'blink-100',
    kind: 'wall-upper-bound-array',
    dimensions: { delayMs: 100 },
    bounds: { maximumMs: 300 },
  },
  {
    site: 'owner-blink-100-dom-half-durations',
    title:
      'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    stage: 'blink-100',
    kind: 'wall-range-array',
    dimensions: { delayMs: 100, surface: 'dom' },
    bounds: { minimumMs: 50.0, maximumMs: 200 },
  },
  {
    site: 'owner-blink-100-paint-half-durations',
    title:
      'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    stage: 'blink-100',
    kind: 'wall-range-array',
    dimensions: { delayMs: 100, surface: 'paint' },
    bounds: { minimumMs: 50.0, maximumMs: 200 },
  },
  {
    site: 'owner-blink-100-paint-wall-model',
    title:
      'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    stage: 'blink-100',
    kind: 'absolute-wall-model',
    dimensions: { delayMs: 100 },
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'owner-blink-50-dom-wall-model',
    title:
      'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    stage: 'blink-50',
    kind: 'absolute-wall-model',
    dimensions: { delayMs: 50 },
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'owner-blink-50-dom-mean-period',
    title:
      'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    stage: 'blink-50',
    kind: 'wall-range',
    dimensions: { delayMs: 50 },
    bounds: { minimumMs: 75.0, maximumMs: 125.0 },
  },
  {
    site: 'owner-blink-50-dom-transition-gaps',
    title:
      'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    stage: 'blink-50',
    kind: 'wall-upper-bound-array',
    dimensions: { delayMs: 50 },
    bounds: { maximumMs: 150 },
  },
  {
    site: 'owner-blink-50-dom-half-durations',
    title:
      'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    stage: 'blink-50',
    kind: 'wall-range-array',
    dimensions: { delayMs: 50, surface: 'dom' },
    bounds: { minimumMs: 25.0, maximumMs: 100 },
  },
  {
    site: 'owner-blink-50-paint-half-durations',
    title:
      'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    stage: 'blink-50',
    kind: 'wall-range-array',
    dimensions: { delayMs: 50, surface: 'paint' },
    bounds: { minimumMs: 25.0, maximumMs: 100 },
  },
  {
    site: 'owner-blink-50-paint-wall-model',
    title:
      'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    stage: 'blink-50',
    kind: 'absolute-wall-model',
    dimensions: { delayMs: 50 },
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'no-delay-execution-wall-model',
    title: 'Owner Arduino execution: no-delay realtime, production frames and painted LEDs',
    stage: 'no-delay realtime',
    kind: 'absolute-wall-model',
    dimensions: {},
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'independent-ports-execution-wall-model',
    title: 'Owner Arduino execution: independent ports, production frames and painted LEDs',
    stage: 'independent ports',
    kind: 'absolute-wall-model',
    dimensions: {},
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'independent-ports-led0-high-periods',
    title: 'Owner Arduino execution: independent ports, production frames and painted LEDs',
    stage: 'independent ports',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 0, arduinoPin: 13 },
    bounds: { minimumMs: 225, maximumMs: 375 },
  },
  {
    site: 'independent-ports-led1-high-periods',
    title: 'Owner Arduino execution: independent ports, production frames and painted LEDs',
    stage: 'independent ports',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 1, arduinoPin: 12 },
    bounds: { minimumMs: 225, maximumMs: 375 },
  },
  {
    site: 'independent-ports-led2-high-periods',
    title: 'Owner Arduino execution: independent ports, production frames and painted LEDs',
    stage: 'independent ports',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 2, arduinoPin: 11 },
    bounds: { minimumMs: 225, maximumMs: 375 },
  },
  {
    site: 'blockly-100-temporal-wall-model',
    title:
      'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
    stage: 'blockly-100',
    kind: 'absolute-wall-model',
    dimensions: { halfMs: 100, stageOrder: [100, 50, 1] },
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'blockly-100-paint-half-durations',
    title:
      'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
    stage: 'blockly-100',
    kind: 'wall-range-array',
    dimensions: { halfMs: 100, ledIndex: 0 },
    bounds: { minimumMs: 50.0, maximumMs: 200 },
  },
  {
    site: 'blockly-50-temporal-wall-model',
    title:
      'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
    stage: 'blockly-50',
    kind: 'absolute-wall-model',
    dimensions: { halfMs: 50, stageOrder: [100, 50, 1] },
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'blockly-50-paint-half-durations',
    title:
      'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
    stage: 'blockly-50',
    kind: 'wall-range-array',
    dimensions: { halfMs: 50, ledIndex: 0 },
    bounds: { minimumMs: 25.0, maximumMs: 100 },
  },
  {
    site: 'blockly-1-temporal-wall-model',
    title:
      'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
    stage: 'blockly-1',
    kind: 'absolute-wall-model',
    dimensions: { halfMs: 1, stageOrder: [100, 50, 1] },
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'delay-2000-temporal-wall-model',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    kind: 'absolute-wall-model',
    dimensions: {},
    bounds: { absoluteDeltaMaximumMs: 250 },
  },
  {
    site: 'delay-2000-led0-paint-half-durations',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 0, arduinoPin: 13 },
    bounds: { minimumMs: 1750, maximumMs: 2250 },
  },
  {
    site: 'delay-2000-led0-paint-mean-period',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    kind: 'wall-range',
    dimensions: { ledIndex: 0, arduinoPin: 13 },
    bounds: { minimumMs: 3750, maximumMs: 4250 },
  },
  {
    site: 'delay-2000-led1-paint-half-durations',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 1, arduinoPin: 12 },
    bounds: { minimumMs: 1750, maximumMs: 2250 },
  },
  {
    site: 'delay-2000-led1-paint-mean-period',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    kind: 'wall-range',
    dimensions: { ledIndex: 1, arduinoPin: 12 },
    bounds: { minimumMs: 3750, maximumMs: 4250 },
  },
  {
    site: 'delay-2000-led2-paint-half-durations',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 2, arduinoPin: 11 },
    bounds: { minimumMs: 1750, maximumMs: 2250 },
  },
  {
    site: 'delay-2000-led2-paint-mean-period',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    kind: 'wall-range',
    dimensions: { ledIndex: 2, arduinoPin: 11 },
    bounds: { minimumMs: 3750, maximumMs: 4250 },
  },
  {
    site: 'delay-1-temporal-wall-model',
    title:
      'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
    stage: 'blink-1',
    kind: 'absolute-wall-model',
    dimensions: {},
    bounds: { absoluteDeltaMaximumMs: 250 },
    binding: false,
  },
  {
    site: 'millis-temporal-wall-model',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    kind: 'absolute-wall-model',
    dimensions: {},
    bounds: { absoluteDeltaMaximumMs: 250 },
    binding: false,
  },
  {
    site: 'millis-led0-paint-half-durations',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 0, arduinoPin: 13, halfMs: 500 },
    bounds: { minimumMs: 250.0, maximumMs: 750.0 },
  },
  {
    site: 'millis-led0-paint-mean-period',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    kind: 'wall-range',
    dimensions: { ledIndex: 0, arduinoPin: 13, halfMs: 500 },
    bounds: { minimumMs: 900.0, maximumMs: 1100.0 },
  },
  {
    site: 'millis-led1-paint-half-durations',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 1, arduinoPin: 12, halfMs: 200 },
    bounds: { minimumMs: 100.0, maximumMs: 300.0 },
  },
  {
    site: 'millis-led1-paint-mean-period',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    kind: 'wall-range',
    dimensions: { ledIndex: 1, arduinoPin: 12, halfMs: 200 },
    bounds: { minimumMs: 360.0, maximumMs: 440.00000000000006 },
  },
  {
    site: 'millis-led2-paint-half-durations',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    kind: 'wall-range-array',
    dimensions: { ledIndex: 2, arduinoPin: 11, halfMs: 100 },
    bounds: { minimumMs: 50.0, maximumMs: 150.0 },
  },
  {
    site: 'millis-led2-paint-mean-period',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    kind: 'wall-range',
    dimensions: { ledIndex: 2, arduinoPin: 11, halfMs: 100 },
    bounds: { minimumMs: 180.0, maximumMs: 220.00000000000003 },
  },
  {
    site: 'reset-temporal-wall-model',
    title:
      'Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history',
    stage: 'reset-restarted',
    kind: 'absolute-wall-model',
    dimensions: {},
    bounds: { absoluteDeltaMaximumMs: 250 },
    binding: false,
  },
]);
const OWNER_V3_ACQUISITION_SITES: readonly OwnerV3AcquisitionSite[] = freezeOwnerV3([
  {
    site: 'delay-2000-ready-horizon-4050000',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    horizonMicroseconds: 4050000,
    dimensions: {},
  },
  {
    site: 'delay-2000-ready-horizon-8100000',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    horizonMicroseconds: 8100000,
    dimensions: {},
  },
  {
    site: 'millis-ready-horizon-2250000',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    horizonMicroseconds: 2250000,
    dimensions: {},
  },
  {
    site: 'delay-1-ready-horizon-1500000',
    title:
      'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
    stage: 'blink-1',
    horizonMicroseconds: 1500000,
    dimensions: {},
  },
]);
const OWNER_V3_CASES: readonly string[] = freezeOwnerV3([
  'Canonical ready cadence: serial sketch saved, observed completely and reopened with cookies only',
  'Canonical ready cadence: gpio sketch saved, observed completely and reopened with cookies only',
  'Owner Arduino timing: three HIGH outputs without delay, complete ready frames and real LED transitions',
  'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
  'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
  'Owner Arduino execution: no-delay realtime, production frames and painted LEDs',
  'Owner Arduino execution: independent ports, production frames and painted LEDs',
  'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
  'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
  'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
  'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
  'Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history',
]);

type OwnerV3Provenance = {
  sourceSha256: string;
  observedSourceSha256: string;
  generationId: number;
  stage: string;
  dimensions: OwnerV3Dimensions;
};
type OwnerV3TimingEntry = {
  kind: OwnerV3Site['kind'];
  site: string;
  title: string;
  provenance: OwnerV3Provenance;
  bounds: OwnerV3Site['bounds'];
  expectedPace: 0.5;
  modelMs: number | null;
  rawWallMs: number[];
  samples: Array<{
    index: number;
    rawWallMs: number;
    normalizedWallMs: number;
    strictComparedMs: number;
    v3ComparedMs: number;
    strictPassed: boolean;
    v3Passed: boolean;
  }>;
  strictOutcome: 'PASS' | 'FAIL';
  v3Outcome: 'PASS' | 'FAIL';
  binding: boolean;
};
type OwnerV3ReadyTimestamp = {
  at: number;
  sourceSha256: string;
  generationId: number | null;
  responseGenerationId: number | null;
  committedHorizonMicroseconds: number;
};
type OwnerV3AcquisitionInput = {
  waitStartedAt: number;
  observedAt: number;
  expectationCompleted: boolean;
  readyTimestamps: OwnerV3ReadyTimestamp[];
};
type OwnerV3AcquisitionEntry = {
  kind: 'model-horizon-acquisition';
  site: string;
  title: string;
  provenance: OwnerV3Provenance;
  expectedPace: 0.5;
  horizonMicroseconds: number;
  strictLimitMs: 5000;
  acquisitionLimitMs: number;
  waitStartedAt: number;
  originalDeadlineAt: number;
  activeDeadlineAt: number;
  observedAt: number;
  firstHorizonAt: number | null;
  expectationCompleted: boolean;
  strictOutcome: 'PASS' | 'FAIL' | 'INCOMPLETE';
  v3Outcome: 'PASS' | 'FAIL' | 'INCOMPLETE';
  binding: true;
  readyTimestamps: OwnerV3ReadyTimestamp[];
  comparisonScope: 'original-limit-on-this-v3-execution';
};
type OwnerV3ReachedAcquisition = {
  kind: 'model-horizon-acquisition-attempt';
  invocation: 'REACHED';
  site: string;
  title: string;
  stage: string;
  dimensions: OwnerV3Dimensions;
  expectedSourceSha256: string;
  observedProvenance: OwnerV3Provenance | null;
  expectedPace: 0.5;
  horizonMicroseconds: number;
  strictLimitMs: 5000;
  acquisitionLimitMs: number;
  waitStartedAt: number | null;
  originalDeadlineAt: number | null;
  activeDeadlineAt: number | null;
  observedAt: number | null;
  firstHorizonAt: null;
  expectationCompleted: boolean | null;
  strictOutcome: 'FAIL' | 'INCOMPLETE';
  v3Outcome: 'FAIL' | 'INCOMPLETE';
  readyTimestamps: OwnerV3ReadyTimestamp[] | null;
  evidenceStatus: 'UNAVAILABLE' | 'REJECTED';
  outcomeBasis: 'no-validated-matching-ready-row';
  comparisonScope: 'original-limit-on-this-v3-execution';
};
type OwnerV3AcquisitionFailureInput = {
  waitStartedAt: number | null;
  observedAt: number | null;
  expectationCompleted: boolean | null;
  provenance: OwnerV3Provenance | null;
  readyTimestamps: OwnerV3ReadyTimestamp[] | null;
  rawFrames?: unknown;
};
type OwnerV3Ledger = {
  schema: 'electronics-classroom-qualification-v3';
  profile: 'classroom-d13-v3';
  entrypoint: string;
  title: string;
  expectedSourceSha: string;
  observerSha256: string;
  expectedPace: 0.5;
  registryRevision: string;
  stages: Array<Omit<OwnerV3Provenance, 'dimensions'>>;
  entries: Array<OwnerV3TimingEntry | OwnerV3AcquisitionEntry>;
  invalidAcquisitions: Array<{
    site: string;
    error: string;
    input: unknown;
    reached?: OwnerV3ReachedAcquisition;
  }>;
};
let ownerV3Ledger: OwnerV3Ledger | null = null;

function ownerV3IdentityError(ledger: OwnerV3Ledger | null, title: string): string | null {
  if (
    !ledger ||
    Object.keys(ledger).sort().join(',') !==
      'entries,entrypoint,expectedPace,expectedSourceSha,invalidAcquisitions,observerSha256,profile,registryRevision,schema,stages,title' ||
    ledger.schema !== 'electronics-classroom-qualification-v3' ||
    ledger.profile !== OWNER_V3_PROFILE ||
    ledger.entrypoint !== OWNER_V3_ENTRYPOINT ||
    ledger.expectedPace !== OWNER_V3_PACE ||
    ledger.registryRevision !== OWNER_V3_REGISTRY_REVISION ||
    ledger.title !== title ||
    !OWNER_V3_CASES.includes(title) ||
    !/^[a-f0-9]{40}$/.test(ledger.expectedSourceSha) ||
    !/^[a-f0-9]{64}$/.test(ledger.observerSha256) ||
    !Array.isArray(ledger.entries) ||
    !Array.isArray(ledger.stages) ||
    !Array.isArray(ledger.invalidAcquisitions)
  )
    return 'Missing or invalid v3 ledger, exact case or source provenance.';
  return null;
}

function assertOwnerV3Identity(
  ledger: OwnerV3Ledger | null,
  title: string,
): asserts ledger is OwnerV3Ledger {
  const error = ownerV3IdentityError(ledger, title);
  if (error) throw new Error(error);
}

function ownerV3ContextError(
  ledger: OwnerV3Ledger,
  definition: OwnerV3Site | OwnerV3AcquisitionSite,
  provenance: OwnerV3Provenance,
): string | null {
  if (
    !provenance ||
    Object.keys(provenance).sort().join(',') !==
      'dimensions,generationId,observedSourceSha256,sourceSha256,stage' ||
    provenance.stage !== definition.stage ||
    !/^[a-f0-9]{64}$/.test(provenance.sourceSha256) ||
    provenance.observedSourceSha256 !== provenance.sourceSha256 ||
    !Number.isSafeInteger(provenance.generationId) ||
    provenance.generationId < 0 ||
    !provenance.dimensions ||
    Object.keys(provenance.dimensions).sort().join(',') !==
      Object.keys(definition.dimensions).sort().join(',') ||
    Object.keys(definition.dimensions).some(
      (key) =>
        !Object.hasOwn(provenance.dimensions, key) ||
        JSON.stringify(provenance.dimensions[key]) !== JSON.stringify(definition.dimensions[key]),
    )
  )
    return 'Wrong v3 stage, dimensions, source or generation provenance.';
  const previous = ledger.stages.filter((entry) => entry.stage === provenance.stage);
  if (
    previous.length > 1 ||
    previous.some(
      (entry) =>
        entry.sourceSha256 !== provenance.sourceSha256 ||
        entry.observedSourceSha256 !== provenance.observedSourceSha256 ||
        entry.generationId !== provenance.generationId,
    )
  )
    return 'V3 stage source or generation changed inside the same stage.';
  return null;
}

function rememberOwnerV3Stage(ledger: OwnerV3Ledger, provenance: OwnerV3Provenance): void {
  if (!ledger.stages.some((entry) => entry.stage === provenance.stage)) {
    const { dimensions, ...stage } = provenance;
    void dimensions;
    ledger.stages.push(freezeOwnerV3({ ...stage }));
  }
}

function ownerV3RequiredSites(title: string): string[] {
  if (!OWNER_V3_CASES.includes(title)) throw new Error('Unknown v3 case identity.');
  return [...OWNER_V3_TIMING_SITES, ...OWNER_V3_ACQUISITION_SITES]
    .filter((entry) => entry.title === title)
    .map((entry) => entry.site);
}

function evaluateOwnerV3Timing(
  ledger: OwnerV3Ledger | null,
  title: string,
  site: string,
  provenance: OwnerV3Provenance,
  rawWallMs: readonly number[],
  modelMs: number | null = null,
): OwnerV3TimingEntry {
  if (arguments.length > 6) throw new Error('V3 accepts no caller-selected limits or pace.');
  assertOwnerV3Identity(ledger, title);
  const definition = OWNER_V3_TIMING_SITES.find((entry) => entry.site === site);
  if (!definition || definition.title !== title)
    throw new Error('Unknown or mismatched v3 timing site.');
  const contextError = ownerV3ContextError(ledger, definition, provenance);
  if (contextError) throw new Error(contextError);
  if (
    !Array.isArray(rawWallMs) ||
    rawWallMs.length === 0 ||
    Array.from(rawWallMs).some((value) => !Number.isFinite(value) || value < 0) ||
    (!definition.kind.endsWith('-array') && rawWallMs.length !== 1) ||
    (definition.kind === 'absolute-wall-model'
      ? modelMs === null || !Number.isFinite(modelMs) || modelMs < 0
      : modelMs !== null)
  )
    throw new Error('Invalid v3 raw measurement, scalar/array shape or model duration.');
  const bounds = definition.bounds;
  const within = (value: number) =>
    (bounds.minimumMs === undefined || value >= bounds.minimumMs) &&
    (bounds.maximumMs === undefined || value <= bounds.maximumMs) &&
    (bounds.absoluteDeltaMaximumMs === undefined || value <= bounds.absoluteDeltaMaximumMs);
  const samples = rawWallMs.map((wallMs, index) => {
    const normalizedWallMs = wallMs * OWNER_V3_PACE;
    const strictComparedMs = modelMs === null ? wallMs : Math.abs(modelMs - wallMs);
    const v3ComparedMs = modelMs === null ? normalizedWallMs : Math.abs(modelMs - normalizedWallMs);
    return {
      index,
      rawWallMs: wallMs,
      normalizedWallMs,
      strictComparedMs,
      v3ComparedMs,
      strictPassed: within(strictComparedMs),
      v3Passed: within(v3ComparedMs),
    };
  });
  return freezeOwnerV3({
    kind: definition.kind,
    site,
    title,
    provenance: { ...provenance, dimensions: { ...provenance.dimensions } },
    bounds: { ...bounds },
    expectedPace: OWNER_V3_PACE,
    modelMs,
    rawWallMs: [...rawWallMs],
    samples,
    strictOutcome: samples.every((entry) => entry.strictPassed) ? 'PASS' : 'FAIL',
    v3Outcome: samples.every((entry) => entry.v3Passed) ? 'PASS' : 'FAIL',
    binding: definition.binding !== false,
  });
}

function recordOwnerV3Timing(
  ledger: OwnerV3Ledger | null,
  title: string,
  site: string,
  provenance: OwnerV3Provenance,
  rawWallMs: readonly number[],
  modelMs: number | null = null,
): OwnerV3TimingEntry {
  if (arguments.length > 6) throw new Error('V3 accepts no caller-selected limits or pace.');
  const entry = evaluateOwnerV3Timing(ledger, title, site, provenance, rawWallMs, modelMs);
  assertOwnerV3Identity(ledger, title);
  if (ledger.entries.some((previous) => previous.site === site))
    throw new Error('Duplicate v3 timing site.');
  rememberOwnerV3Stage(ledger, provenance);
  ledger.entries.push(entry);
  // Preserve both measured outcomes, including the three nonbinding throughput
  // findings. Their bounds and raw values never become a synthetic PASS.
  if (entry.binding && entry.v3Outcome !== 'PASS')
    throw new Error(`V3 fixed-pace timing failed at ${site}.`);
  return entry;
}

type OwnerV3AcquisitionAssessment =
  { ok: true; entry: OwnerV3AcquisitionEntry } | { ok: false; error: string };

function evaluateOwnerV3Acquisition(
  ledger: OwnerV3Ledger | null,
  title: string,
  site: string,
  provenance: OwnerV3Provenance | null,
  input: OwnerV3AcquisitionInput,
): OwnerV3AcquisitionAssessment {
  if (arguments.length > 5)
    return { ok: false, error: 'V3 acquisition accepts no extra limits or pace.' };
  const identityError = ownerV3IdentityError(ledger, title);
  if (identityError || !ledger) return { ok: false, error: identityError ?? 'Missing ledger.' };
  const definition = OWNER_V3_ACQUISITION_SITES.find((entry) => entry.site === site);
  if (!definition || definition.title !== title)
    return { ok: false, error: 'Unknown or mismatched v3 acquisition site.' };
  if (provenance === null)
    return { ok: false, error: 'No observed v3 acquisition source/generation provenance.' };
  const contextError = ownerV3ContextError(ledger, definition, provenance);
  if (contextError) return { ok: false, error: contextError };
  if (
    !input ||
    Object.keys(input).sort().join(',') !==
      'expectationCompleted,observedAt,readyTimestamps,waitStartedAt' ||
    !Number.isFinite(input.waitStartedAt) ||
    input.waitStartedAt < 0 ||
    !Number.isFinite(input.observedAt) ||
    input.observedAt < input.waitStartedAt ||
    typeof input.expectationCompleted !== 'boolean' ||
    !Array.isArray(input.readyTimestamps) ||
    Array.from(input.readyTimestamps).some(
      (row, index) =>
        !row ||
        Object.keys(row).sort().join(',') !==
          'at,committedHorizonMicroseconds,generationId,responseGenerationId,sourceSha256' ||
        !Number.isFinite(row.at) ||
        row.at < 0 ||
        row.at > input.observedAt ||
        row.sourceSha256 !== provenance.sourceSha256 ||
        row.generationId !== provenance.generationId ||
        row.responseGenerationId !== provenance.generationId ||
        (index > 0 && row.at < input.readyTimestamps[index - 1]!.at) ||
        !Number.isSafeInteger(row.committedHorizonMicroseconds) ||
        row.committedHorizonMicroseconds < 0 ||
        (index > 0 &&
          row.committedHorizonMicroseconds <
            input.readyTimestamps[index - 1]!.committedHorizonMicroseconds),
    )
  )
    return {
      ok: false,
      error: 'Invalid v3 acquisition boundary or complete ordered ready prefix.',
    };
  const { waitStartedAt, observedAt, readyTimestamps, expectationCompleted } = input;
  const acquisitionLimitMs = 5000 / OWNER_V3_PACE;
  const originalDeadlineAt = waitStartedAt + 5000;
  const activeDeadlineAt = waitStartedAt + acquisitionLimitMs;
  const firstHorizonAt =
    readyTimestamps.find(
      (row) => row.committedHorizonMicroseconds >= definition.horizonMicroseconds,
    )?.at ?? null;
  const outcomeAt = (deadlineAt: number) =>
    firstHorizonAt !== null && firstHorizonAt <= deadlineAt
      ? 'PASS'
      : observedAt >= deadlineAt
        ? 'FAIL'
        : 'INCOMPLETE';
  return {
    ok: true,
    entry: freezeOwnerV3({
      kind: 'model-horizon-acquisition',
      site,
      title,
      provenance: { ...provenance, dimensions: { ...provenance.dimensions } },
      expectedPace: OWNER_V3_PACE,
      horizonMicroseconds: definition.horizonMicroseconds,
      strictLimitMs: 5000,
      acquisitionLimitMs,
      waitStartedAt,
      originalDeadlineAt,
      activeDeadlineAt,
      observedAt,
      firstHorizonAt,
      expectationCompleted,
      strictOutcome: outcomeAt(originalDeadlineAt),
      v3Outcome: outcomeAt(activeDeadlineAt),
      binding: true,
      readyTimestamps: readyTimestamps.map((row) => ({ ...row })),
      comparisonScope: 'original-limit-on-this-v3-execution',
    }),
  };
}

function recordOwnerV3Acquisition(
  ledger: OwnerV3Ledger,
  title: string,
  site: string,
  provenance: OwnerV3Provenance | null,
  input: OwnerV3AcquisitionInput,
): OwnerV3AcquisitionAssessment {
  const assessment = evaluateOwnerV3Acquisition(ledger, title, site, provenance, input);
  const duplicate =
    ledger.entries.some((entry) => entry.site === site) ||
    ledger.invalidAcquisitions.some((entry) => entry.site === site);
  const result: OwnerV3AcquisitionAssessment = duplicate
    ? { ok: false, error: 'Duplicate v3 acquisition site.' }
    : assessment;
  if (result.ok) {
    rememberOwnerV3Stage(ledger, result.entry.provenance);
    ledger.entries.push(result.entry);
  } else
    ledger.invalidAcquisitions.push({ site, error: result.error, input: { provenance, ...input } });
  return result;
}

function retainOwnerV3AcquisitionFailure(
  ledger: OwnerV3Ledger,
  title: string,
  site: string,
  expectedSourceSha256: string,
  input: OwnerV3AcquisitionFailureInput,
  error: string,
): void {
  assertOwnerV3Identity(ledger, title);
  const definition = OWNER_V3_ACQUISITION_SITES.find((entry) => entry.site === site);
  if (!definition || definition.title !== title || !/^[a-f0-9]{64}$/.test(expectedSourceSha256))
    throw new Error('Unknown reached v3 acquisition or expected source.');
  // A measured wait is still reached when there is no trustworthy ready row.
  // Missing provenance and unavailable boundaries stay null; they cannot become
  // a qualified entry, an invented generation, or evidence of a successful wait.
  const waitStartedAt =
    input.waitStartedAt !== null && Number.isFinite(input.waitStartedAt) && input.waitStartedAt >= 0
      ? input.waitStartedAt
      : null;
  const observedAt =
    waitStartedAt !== null &&
    input.observedAt !== null &&
    Number.isFinite(input.observedAt) &&
    input.observedAt >= waitStartedAt
      ? input.observedAt
      : null;
  const acquisitionLimitMs = 5000 / OWNER_V3_PACE;
  const originalDeadlineAt = waitStartedAt === null ? null : waitStartedAt + 5000;
  const activeDeadlineAt = waitStartedAt === null ? null : waitStartedAt + acquisitionLimitMs;
  const outcomeAt = (deadlineAt: number | null): 'FAIL' | 'INCOMPLETE' =>
    observedAt !== null && deadlineAt !== null && observedAt >= deadlineAt ? 'FAIL' : 'INCOMPLETE';
  const reached: OwnerV3ReachedAcquisition = freezeOwnerV3({
    kind: 'model-horizon-acquisition-attempt',
    invocation: 'REACHED',
    site,
    title,
    stage: definition.stage,
    dimensions: { ...definition.dimensions },
    expectedSourceSha256,
    observedProvenance: input.provenance,
    expectedPace: OWNER_V3_PACE,
    horizonMicroseconds: definition.horizonMicroseconds,
    strictLimitMs: 5000,
    acquisitionLimitMs,
    waitStartedAt,
    originalDeadlineAt,
    activeDeadlineAt,
    observedAt,
    firstHorizonAt: null,
    expectationCompleted: input.expectationCompleted,
    strictOutcome: outcomeAt(originalDeadlineAt),
    v3Outcome: outcomeAt(activeDeadlineAt),
    readyTimestamps: input.readyTimestamps,
    evidenceStatus: input.readyTimestamps === null ? 'UNAVAILABLE' : 'REJECTED',
    outcomeBasis: 'no-validated-matching-ready-row',
    comparisonScope: 'original-limit-on-this-v3-execution',
  });
  ledger.invalidAcquisitions.push({ site, error, input, reached });
}

function requireOwnerV3Acquisition(assessment: OwnerV3AcquisitionAssessment): void {
  if (!assessment.ok) throw new Error(assessment.error);
  if (assessment.entry.v3Outcome !== 'PASS' || !assessment.entry.expectationCompleted)
    throw new Error(`V3 acquisition failed or incomplete at ${assessment.entry.site}.`);
}

function requireOwnerV3Complete(ledger: OwnerV3Ledger | null, title: string): void {
  assertOwnerV3Identity(ledger, title);
  const required = ownerV3RequiredSites(title);
  if (ledger.invalidAcquisitions.some((entry) => entry.reached?.invocation === 'REACHED'))
    throw new Error('Reached v3 acquisition has invalid or unavailable ready evidence.');
  const missing = required.filter((site) => !ledger.entries.some((entry) => entry.site === site));
  if (missing.length) throw new Error(`Required v3 evidence not reached: ${missing.join(', ')}`);
  if (
    ledger.entries.length !== required.length ||
    new Set(ledger.entries.map((entry) => entry.site)).size !== ledger.entries.length ||
    ledger.invalidAcquisitions.length !== 0
  )
    throw new Error('Unknown, duplicate or invalid v3 evidence.');
  const stages = new Map<string, Omit<OwnerV3Provenance, 'dimensions'>>();
  for (const entry of ledger.entries) {
    if (!required.includes(entry.site) || entry.title !== title)
      throw new Error('Unknown or mismatched v3 recorded site.');
    if (entry.kind === 'model-horizon-acquisition') {
      const assessment = evaluateOwnerV3Acquisition(ledger, title, entry.site, entry.provenance, {
        waitStartedAt: entry.waitStartedAt,
        observedAt: entry.observedAt,
        expectationCompleted: entry.expectationCompleted,
        readyTimestamps: entry.readyTimestamps,
      });
      requireOwnerV3Acquisition(assessment);
      if (!assessment.ok || JSON.stringify(assessment.entry) !== JSON.stringify(entry))
        throw new Error('Mismatched v3 acquisition record, bounds or outcomes.');
    } else {
      const original = evaluateOwnerV3Timing(
        ledger,
        title,
        entry.site,
        entry.provenance,
        entry.rawWallMs,
        entry.modelMs,
      );
      if (
        (original.binding && original.v3Outcome !== 'PASS') ||
        JSON.stringify(original) !== JSON.stringify(entry)
      )
        throw new Error('Mismatched v3 timing record, bounds or outcomes.');
    }
    const { dimensions, ...stage } = entry.provenance;
    void dimensions;
    stages.set(stage.stage, stage);
  }
  if (
    ledger.stages.length !== stages.size ||
    ledger.stages.some((stage) => JSON.stringify(stages.get(stage.stage)) !== JSON.stringify(stage))
  )
    throw new Error('Missing, duplicate or mismatched v3 stage provenance.');
}

function ownerV3WorkerProvenance(
  ready: readonly WorkerReceipt[],
  source: string,
  stage: string,
  dimensions: OwnerV3Dimensions,
): OwnerV3Provenance {
  const generationId = ready[0]?.generationId;
  if (
    !Number.isSafeInteger(generationId) ||
    generationId === null ||
    generationId === undefined ||
    ready.some((row) => row.requestSource !== source || row.generationId !== generationId)
  )
    throw new Error('V3 Worker source/generation provenance is incomplete.');
  return {
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    observedSourceSha256: createHash('sha256').update(ready[0]!.requestSource!).digest('hex'),
    generationId,
    stage,
    dimensions,
  };
}

function ownerV3TemporalProvenance(
  ready: readonly TemporalFrame[],
  source: string,
  stage: string,
  dimensions: OwnerV3Dimensions,
): OwnerV3Provenance {
  const generationId = ready[0]?.generationId;
  if (
    !Number.isSafeInteger(generationId) ||
    generationId === null ||
    generationId === undefined ||
    ready.some(
      (row) =>
        row.source !== source ||
        row.generationId !== generationId ||
        row.responseGenerationId !== generationId,
    )
  )
    throw new Error('V3 temporal source/generation provenance is incomplete.');
  return {
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    observedSourceSha256: createHash('sha256').update(ready[0]!.source!).digest('hex'),
    generationId,
    stage,
    dimensions,
  };
}

function assertOwnerV3TemporalClock(
  ready: readonly TemporalFrame[],
  minimumModelMs: number,
  site: string,
  source: string,
  stage: string,
  dimensions: OwnerV3Dimensions,
) {
  const first = ready[0]!;
  const last = ready.at(-1)!;
  const modelMs = (last.committedHorizonMicroseconds - first.committedHorizonMicroseconds) / 1000;
  const wallMs = last.at - first.at;
  expect(first.committedHorizonMicroseconds).toBe(0);
  expect(modelMs).toBeGreaterThanOrEqual(minimumModelMs);
  recordOwnerV3Timing(
    ownerV3Ledger,
    test.info().title,
    site,
    ownerV3TemporalProvenance(ready, source, stage, dimensions),
    [wallMs],
    modelMs,
  );
  return { first, last, modelMs, wallMs };
}

async function waitForOwnerV3Horizon(page: Page, source: string, site: string): Promise<void> {
  const ledger = ownerV3Ledger;
  assertOwnerV3Identity(ledger, test.info().title);
  const definition = OWNER_V3_ACQUISITION_SITES.find((entry) => entry.site === site);
  if (!definition || definition.title !== ledger.title)
    throw new Error('Unknown or mismatched v3 horizon acquisition.');
  const sourceSha256 = createHash('sha256').update(source).digest('hex');
  const [start] = await Promise.allSettled([page.evaluate(() => performance.now())]);
  if (start.status === 'rejected') {
    retainOwnerV3AcquisitionFailure(
      ledger,
      ledger.title,
      site,
      sourceSha256,
      {
        waitStartedAt: null,
        observedAt: null,
        expectationCompleted: null,
        provenance: null,
        readyTimestamps: null,
      },
      String(start.reason),
    );
    throw start.reason;
  }
  const waitStartedAt = start.value;
  // Observe one finite acquisition and retain its evidence. Both failures are
  // retained separately; a secondary observation failure cannot replace the
  // original rejected expectation. Neither operation is retried.
  const [acquisition] = await Promise.allSettled([
    expect
      .poll(
        () =>
          page.evaluate(
            ({ source, horizon }) =>
              ((window as TemporalWindow).__ownerTemporal?.frames
                .filter((row) => row.source === source && row.executionStatus === 'ready')
                .at(-1)?.committedHorizonMicroseconds ?? 0) >= horizon,
            { source, horizon: definition.horizonMicroseconds },
          ),
        { intervals: [100], timeout: 5000 / OWNER_V3_PACE },
      )
      .toBe(true),
  ]);
  const [observation] = await Promise.allSettled([
    page.evaluate((source) => {
      const frames = ((window as TemporalWindow).__ownerTemporal?.frames ?? []).filter(
        (row) => row.source === source && row.executionStatus === 'ready',
      );
      return {
        observedAt: performance.now(),
        frames: frames.map((row) => ({
          at: row.at,
          source: row.source,
          generationId: row.generationId,
          responseGenerationId: row.responseGenerationId,
          committedHorizonMicroseconds: row.committedHorizonMicroseconds,
        })),
      };
    }, source),
  ]);
  if (observation.status === 'rejected') {
    retainOwnerV3AcquisitionFailure(
      ledger,
      ledger.title,
      site,
      sourceSha256,
      {
        waitStartedAt,
        observedAt: null,
        expectationCompleted: acquisition.status === 'fulfilled',
        provenance: null,
        readyTimestamps: null,
      },
      String(observation.reason),
    );
    if (acquisition.status === 'rejected') throw acquisition.reason;
    throw observation.reason;
  }
  const observed = observation.value;
  const failureInput: OwnerV3AcquisitionFailureInput = {
    waitStartedAt,
    observedAt: observed.observedAt,
    expectationCompleted: acquisition.status === 'fulfilled',
    provenance: null,
    readyTimestamps: null,
    rawFrames: observed.frames,
  };
  const [retention] = await Promise.allSettled([
    Promise.resolve().then(() => {
      const first = observed.frames[0];
      const provenance: OwnerV3Provenance | null =
        first &&
        typeof first.source === 'string' &&
        Number.isSafeInteger(first.generationId) &&
        first.generationId !== null &&
        first.generationId >= 0
          ? {
              sourceSha256,
              observedSourceSha256: createHash('sha256').update(first.source).digest('hex'),
              generationId: first.generationId,
              stage: definition.stage,
              dimensions: definition.dimensions,
            }
          : null;
      failureInput.provenance = provenance;
      const input: OwnerV3AcquisitionInput = {
        waitStartedAt,
        observedAt: observed.observedAt,
        expectationCompleted: acquisition.status === 'fulfilled',
        readyTimestamps: observed.frames.map((row) => ({
          at: row.at,
          sourceSha256: createHash('sha256')
            .update(row.source ?? '')
            .digest('hex'),
          generationId: row.generationId,
          responseGenerationId: row.responseGenerationId,
          committedHorizonMicroseconds: row.committedHorizonMicroseconds,
        })),
      };
      failureInput.readyTimestamps = input.readyTimestamps;
      const assessment = evaluateOwnerV3Acquisition(ledger, ledger.title, site, provenance, input);
      if (assessment.ok)
        return recordOwnerV3Acquisition(ledger, ledger.title, site, provenance, input);
      retainOwnerV3AcquisitionFailure(
        ledger,
        ledger.title,
        site,
        sourceSha256,
        failureInput,
        assessment.error,
      );
      return assessment;
    }),
  ]);
  if (retention.status === 'rejected') {
    retainOwnerV3AcquisitionFailure(
      ledger,
      ledger.title,
      site,
      sourceSha256,
      failureInput,
      String(retention.reason),
    );
    if (acquisition.status === 'rejected') throw acquisition.reason;
    throw retention.reason;
  }
  if (acquisition.status === 'rejected') throw acquisition.reason;
  requireOwnerV3Acquisition(retention.value);
}

type BoardReceipt = {
  componentId: string;
  loadedSource?: string | null;
  runtime: ArduinoRuntimeState;
};
type WorkerReceipt = {
  worker: number;
  requestId: string;
  requestAt: number | null;
  generationId: number | null;
  requestSource: string | null;
  at: number;
  advance: Omit<SimulationTimedAdvancePayload, 'state'>;
  boards: BoardReceipt[];
  state: ElectronicsTimedState;
  computeMs: number | null;
};
type UiReceipt = { at: number; time: string; brightness: number[]; serial: string[] };
type StartupPaintEvidence = {
  ledHrefs: string[];
  simulationStatus: string | null;
  timeText: string;
  board: {
    href: string;
    mountedLoadAt: number | null;
    visible: boolean;
    unoccluded: boolean;
    opacity: number;
  } | null;
  l: { activeAttribute: string | null; opacity: number | null; visible: boolean } | null;
};
type PaintReceipt = {
  at: number;
  previousFrameAt: number | null;
  brightness: number[];
  images: Array<{
    href: string;
    decoded: boolean;
    opacity: number;
    visible: boolean;
    unoccluded: boolean;
    rect: { x: number; y: number; width: number; height: number } | null;
    hitTargets: string[];
    lit: boolean;
  }>;
  imageDiagnostics: Array<{ href: string; resourceDecoded: boolean; mountedLoadAt: number | null }>;
  stablePreviousFrame: boolean;
  startupEvidence?: StartupPaintEvidence;
};
type ProbeWindow = Window & {
  __bitwiseWorker?: WorkerReceipt[];
  __bitwiseUi?: UiReceipt[];
  __ownerPaint?: PaintReceipt[];
  __ownerStartClicks?: Array<{ at: number; trusted: boolean }>;
  __ledPlayoutReanchors?: Array<{ at: number; count: number }>;
};

function fixture(): SchematicDocument {
  const components: SchematicDocument['components'][number][] = [
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      variantId: 'arduino-uno',
      name: 'Arduino Uno',
      position: { x: 140, y: 140 },
      rotation: 0,
      value: 5,
      pinIds: ownerCatalog.components
        .find((row) => row.componentId === 'arduino-uno')!
        .pins.map((pin) => pin.id),
      stateProperties: {
        arduinoSource: initialSource,
        arduinoCodeMode: 'text',
        arduinoWorkspace: '',
        arduinoSerialOpen: true,
        arduinoBaudRate: 9600,
      },
    },
  ];
  const connections: SchematicDocument['connections'][number][] = [];
  for (let index = 0; index < 8; index++) {
    const position = { x: 580 + (index % 4) * 150, y: 180 + Math.floor(index / 4) * 240 };
    components.push({
      id: `r${index}`,
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: `R${index + 1}`,
      position,
      rotation: 90,
      value: 330,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом', powerRatingWatt: 0.25 },
    });
    components.push({
      id: `led${index}`,
      kind: 'led',
      componentTypeId: 'led-5mm',
      variantId: 'led-5mm',
      name: `LED${index + 1}`,
      position: { x: position.x, y: position.y + 90 },
      rotation: 0,
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: { colour: 'red', ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
    });
    for (const [from, fromPin, to, toPin] of [
      ['uno', `d${index + 2}`, `r${index}`, 'lead-1'],
      [`r${index}`, 'lead-2', `led${index}`, 'anode'],
      [`led${index}`, 'cathode', 'uno', 'power-gnd-1'],
    ]) {
      connections.push({
        id: `w${connections.length}`,
        from: { componentId: from!, terminal: fromPin! },
        to: { componentId: to!, terminal: toPin! },
        color: '#149447',
        vertices: [],
      });
    }
  }
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

async function observeRealWorkerAndUi(page: Page, ledCount = 8): Promise<void> {
  await page.addInitScript((ledCount) => {
    const probe = window as ProbeWindow;
    // Prefix assertions need every original receipt, UI frame and generation.
    // Keep page-local histories lossless; polling still returns compact summaries.
    const workers: WorkerReceipt[] = [];
    const ui: UiReceipt[] = [];
    probe.__bitwiseWorker = workers;
    probe.__bitwiseUi = ui;
    const reanchors: NonNullable<ProbeWindow['__ledPlayoutReanchors']> = [];
    probe.__ledPlayoutReanchors = reanchors;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name !== 'asa-electronics-led-playout-reanchor') continue;
        reanchors.push({
          at: entry.startTime,
          count: Number((entry as PerformanceMark).detail?.count),
        });
      }
    }).observe({ type: 'mark', buffered: true });
    let workerId = 0;
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const id = ++workerId;
        const sources = new Map<
          string,
          { source: string; at: number; generationId: number | null }
        >();
        const post = worker.postMessage.bind(worker);
        worker.postMessage = ((...args: unknown[]) => {
          const message = args[0] as {
            kind?: string;
            requestId: string;
            generationId?: number;
            document?: SchematicDocument;
          };
          if (message.kind === 'advance')
            sources.set(message.requestId, {
              source: String(
                message.document?.components.find((row) => row.id === 'uno')?.stateProperties?.[
                  'arduinoSource'
                ] ?? '',
              ),
              at: performance.now(),
              generationId: message.generationId ?? null,
            });
          Reflect.apply(post, worker, args);
        }) as Worker['postMessage'];
        worker.addEventListener('message', (event: MessageEvent) => {
          const response = event.data as {
            ok?: boolean;
            kind?: string;
            requestId: string;
            advance?: SimulationTimedAdvancePayload;
            metrics?: { computeMs?: number };
          };
          if (!response.ok || response.kind !== 'advance' || !response.advance) return;
          const { state, ...advance } = response.advance;
          const serialized = state.continuation?.serializedState;
          const boards = serialized
            ? (JSON.parse(serialized) as { boards: BoardReceipt[] }).boards
            : [];
          workers.push({
            worker: id,
            requestId: response.requestId,
            requestAt: sources.get(response.requestId)?.at ?? null,
            generationId: sources.get(response.requestId)?.generationId ?? null,
            requestSource: sources.get(response.requestId)?.source ?? null,
            at: performance.now(),
            advance,
            boards,
            state,
            computeMs:
              typeof response.metrics?.computeMs === 'number' ? response.metrics.computeMs : null,
          });
          sources.delete(response.requestId);
        });
        return worker;
      },
    });
    const collect = () => {
      const elements = Array.from({ length: ledCount }, (_, index) =>
        document.querySelector(
          `[data-testid="schematic-component"][data-component-id="led${index}"] .workbench-production-visual`,
        ),
      );
      if (elements.some((element) => !element)) return;
      ui.push({
        at: performance.now(),
        time: document.querySelector('.workbench-simulation-time')?.textContent ?? '',
        serial: Array.from(document.querySelectorAll('.arduino-serial-output > div')).map(
          (node) => node.textContent ?? '',
        ),
        brightness: elements.map((element) =>
          Number(element!.getAttribute('data-led-brightness') ?? '0'),
        ),
      });
    };
    new MutationObserver(collect).observe(document, {
      subtree: true,
      attributes: true,
      childList: true,
      characterData: true,
      attributeFilter: ['data-led-brightness'],
    });
    // Only the three owner cases collect paint. The original generic journeys
    // retain their original observer cost and raw predicate semantics.
    if (ledCount === 3) {
      const paints: PaintReceipt[] = [];
      probe.__ownerPaint = paints;
      const startClicks: Array<{ at: number; trusted: boolean }> = [];
      probe.__ownerStartClicks = startClicks;
      document.addEventListener(
        'click',
        (event) => {
          if ((event.target as Element | null)?.closest('[aria-label="Начать моделирование"]'))
            startClicks.push({ at: performance.now(), trusted: event.isTrusted });
        },
        true,
      );
      const decoded = new Map<string, boolean>();
      // The detached decoder below is a resource diagnostic. Readiness must
      // instead belong to this mounted SVG image and its current href.
      function createOwnerMountedImageWitness<T extends object>() {
        const loaded = new WeakMap<T, { href: string; at: number }>();
        return {
          nativeLoad(element: T, href: string, at: number, trusted: boolean, connected: boolean) {
            if (!trusted || !connected || !href || !Number.isFinite(at) || at < 0) return;
            loaded.set(element, { href, at });
          },
          nativeError(element: T, trusted: boolean) {
            if (trusted) loaded.delete(element);
          },
          changed(element: T, previousHref: string, href: string) {
            if (previousHref !== href) loaded.delete(element);
          },
          current(element: T, href: string, connected: boolean): number | null {
            const witness = loaded.get(element);
            return connected && witness?.href === href ? witness.at : null;
          },
        };
      }
      const mounted = createOwnerMountedImageWitness<SVGImageElement>();
      const observeHrefChanges = (records: MutationRecord[]) => {
        for (const record of records) {
          if (record.target instanceof SVGImageElement)
            mounted.changed(record.target, record.oldValue ?? '', record.target.href.baseVal);
        }
      };
      const hrefChanges = new MutationObserver(observeHrefChanges);
      hrefChanges.observe(document, {
        subtree: true,
        attributes: true,
        attributeFilter: ['href', 'xlink:href'],
        attributeOldValue: true,
      });
      document.addEventListener(
        'load',
        (event) => {
          const image = event.target;
          if (
            !(image instanceof SVGImageElement) ||
            (!image.matches('.workbench-led-asset') &&
              (!image.closest('[data-component-id="uno"] .workbench-production-visual') ||
                image.closest('.workbench-selection-silhouette')))
          )
            return;
          observeHrefChanges(hrefChanges.takeRecords());
          mounted.nativeLoad(
            image,
            image.href.baseVal,
            performance.now(),
            event.isTrusted,
            image.isConnected,
          );
        },
        true,
      );
      document.addEventListener(
        'error',
        (event) => {
          const image = event.target;
          if (image instanceof SVGImageElement) mounted.nativeError(image, event.isTrusted);
        },
        true,
      );
      // A separate same-RAF startup witness; it never changes the modeled-paint
      // signature, physical timing, source identity or supersession allowance.
      const readStartupEvidence = (ledHrefs: string[]): StartupPaintEvidence => {
        const simulationStatus =
          document
            .querySelector('.workbench-pill.simulate')
            ?.getAttribute('data-simulation-status') ?? null;
        const timeText = document.querySelector('.workbench-simulation-time')?.textContent ?? '';
        // Modeled frames retain their original native observer. Do not add board
        // hit tests to steady-state timing; a pre-H0 running/missing status fails.
        if (simulationStatus !== 'stopped' && simulationStatus !== 'starting')
          return { ledHrefs, simulationStatus, timeText, board: null, l: null };
        const board = document.querySelector<SVGSVGElement>(
          '[data-component-id="uno"] .workbench-production-visual',
        );
        const image = [...(board?.querySelectorAll<SVGImageElement>('image') ?? [])].find(
          (candidate) => !candidate.closest('.workbench-selection-silhouette'),
        );
        const visibleStyle = (element: Element | null) => {
          let visible = !!element;
          let opacity = 1;
          for (let current = element; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            visible &&= style.display !== 'none' && style.visibility === 'visible';
            opacity *= Number(style.opacity);
          }
          return { visible, opacity };
        };
        const inViewport = (box: DOMRect | undefined) =>
          !!box &&
          box.width > 0 &&
          box.height > 0 &&
          box.left >= 0 &&
          box.top >= 0 &&
          box.right <= innerWidth &&
          box.bottom <= innerHeight;
        const style = visibleStyle(image ?? null);
        const box = image?.getBoundingClientRect();
        const component = board?.closest('[data-component-id]');
        const hits: Array<Element | undefined> = [];
        if (image && box) {
          const originalStyle = image.getAttribute('style');
          try {
            image.style.setProperty('pointer-events', 'all', 'important');
            for (const fraction of [0.35, 0.5, 0.65])
              hits.push(
                document.elementsFromPoint(
                  box.left + box.width * fraction,
                  box.top + box.height * 0.5,
                )[0],
              );
          } finally {
            image.setAttribute('style', originalStyle ?? '');
            if (originalStyle === null) image.removeAttribute('style');
          }
        }
        const l = board?.querySelector<SVGRectElement>('[data-testid="arduino-led-l"]');
        const lStyle = visibleStyle(l?.parentElement ?? null);
        observeHrefChanges(hrefChanges.takeRecords());
        const href = image?.href.baseVal ?? '';
        return {
          ledHrefs,
          simulationStatus,
          timeText,
          board: {
            href,
            mountedLoadAt: image ? mounted.current(image, href, image.isConnected) : null,
            visible:
              style.visible &&
              inViewport(box) &&
              image?.getAttribute('data-owner-image-status') !== 'failed',
            unoccluded:
              hits.length === 3 && hits.every((hit) => !!hit && !!component?.contains(hit)),
            opacity: style.opacity,
          },
          l: {
            activeAttribute: l?.getAttribute('data-active') ?? null,
            opacity: l ? Number(getComputedStyle(l).opacity) : null,
            visible:
              lStyle.visible && lStyle.opacity === 1 && inViewport(l?.getBoundingClientRect()),
          },
        };
      };
      let previous = '';
      let previousFrameAt: number | null = null;
      const paint = () => {
        const elements = Array.from({ length: ledCount }, (_, index) =>
          document.querySelector<SVGSVGElement>(
            `[data-component-id="led${index}"] .workbench-production-visual`,
          ),
        );
        if (elements.every((element) => element)) {
          const brightness = elements.map((element) =>
            Number(element!.getAttribute('data-led-brightness') ?? '0'),
          );
          const imageDiagnostics: PaintReceipt['imageDiagnostics'] = [];
          const images = elements.map((element) => {
            const image = element!.querySelector<SVGImageElement>('.workbench-led-asset');
            const href = image?.href.baseVal ?? '';
            if (href && !decoded.has(href)) {
              decoded.set(href, false);
              const resource = new Image();
              resource.src = href;
              void resource.decode().then(
                () => decoded.set(href, resource.naturalWidth > 0 && resource.naturalHeight > 0),
                () => decoded.set(href, false),
              );
            }
            observeHrefChanges(hrefChanges.takeRecords());
            const mountedLoadAt = image ? mounted.current(image, href, image.isConnected) : null;
            imageDiagnostics.push({
              href,
              resourceDecoded: decoded.get(href) === true,
              mountedLoadAt,
            });
            let opacity = 1;
            let visible = !!image;
            for (
              let ancestor: Element | null = image ?? null;
              ancestor;
              ancestor = ancestor.parentElement
            ) {
              const style = getComputedStyle(ancestor);
              opacity *= Number(style.opacity);
              visible &&= style.display !== 'none' && style.visibility === 'visible';
            }
            const box = image?.getBoundingClientRect();
            visible &&=
              !!box &&
              box.width > 0 &&
              box.height > 0 &&
              box.right > 0 &&
              box.bottom > 0 &&
              box.left < innerWidth &&
              box.top < innerHeight;
            const lit = element!.classList.contains('is-lit');
            visible &&= image?.getAttribute('data-owner-image-status') !== 'failed';
            const component = element!.closest('[data-component-id]');
            // Production image pixels deliberately ignore pointer input. Let
            // this image participate in the synchronous hit test, then restore
            // its exact inline style before yielding or painting. Transparent
            // wire targets below the image must not look like visual blockers;
            // an editor panel above it must still make the same samples fail.
            const hits: Array<Element | undefined> = [];
            if (image && box) {
              const originalStyle = image.getAttribute('style');
              try {
                image.style.setProperty('pointer-events', 'all', 'important');
                for (const fraction of [0.35, 0.5, 0.65]) {
                  hits.push(
                    document.elementsFromPoint(
                      box.left + box.width * fraction,
                      box.top + box.height * 0.5,
                    )[0],
                  );
                }
              } finally {
                // Synchronize SVG's CSSOM before removing an originally
                // absent attribute; removeAttribute alone leaves style="".
                image.setAttribute('style', originalStyle ?? '');
                if (originalStyle === null) image.removeAttribute('style');
              }
            }
            const unoccluded =
              hits.length === 3 &&
              hits.every((hit) => !!hit && !!component?.contains(hit)) &&
              !!box &&
              box.left >= 0 &&
              box.top >= 0 &&
              box.right <= innerWidth &&
              box.bottom <= innerHeight;
            return {
              href,
              decoded: mountedLoadAt !== null,
              opacity,
              visible,
              lit,
              unoccluded,
              rect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
              hitTargets: hits.map(
                (hit) =>
                  hit?.closest('[data-component-id]')?.getAttribute('data-component-id') ??
                  hit?.tagName ??
                  'none',
              ),
            };
          });
          const signature = JSON.stringify({ brightness, images });
          const startupEvidence = readStartupEvidence(images.map((image) => image.href));
          const at = performance.now();
          paints.push({
            at,
            previousFrameAt,
            brightness,
            images,
            imageDiagnostics,
            stablePreviousFrame: signature === previous,
            startupEvidence,
          });
          previous = signature;
          previousFrameAt = at;
        }
        requestAnimationFrame(paint);
      };
      requestAnimationFrame(paint);
    }
  }, ledCount);
}
async function observation(page: Page) {
  return page.evaluate(() => ({
    worker: (window as ProbeWindow).__bitwiseWorker ?? [],
    ui: (window as ProbeWindow).__bitwiseUi ?? [],
    paint: (window as ProbeWindow).__ownerPaint ?? [],
    startClicks: (window as ProbeWindow).__ownerStartClicks ?? [],
    reanchors: (window as ProbeWindow).__ledPlayoutReanchors ?? [],
  }));
}
// Keep polling beside the full receipts: transporting their canonical state on
// every attempt can cross the deadline after the required frame already exists.
function compactObservation({
  source,
  raw,
}: {
  source: string;
  raw?: { worker: WorkerReceipt[]; ui: UiReceipt[] };
}) {
  const observed = raw ?? {
    worker: (window as ProbeWindow).__bitwiseWorker ?? [],
    ui: (window as ProbeWindow).__bitwiseUi ?? [],
  };
  function highIndex(row: WorkerReceipt): number {
    if (row.advance.executionStatus !== 'ready' || !row.advance.result?.solved) return -1;
    const board = row.boards.find((board) => board.componentId === 'uno');
    if (!board) return -1;
    const voltages = Array.from(
      { length: 8 },
      (_, index) => board.runtime.outputVoltages[`d${index + 2}` as 'd2'] ?? 0,
    );
    const high = voltages
      .map((value, index) => (value === 5 ? index : -1))
      .filter((index) => index >= 0);
    return high.length === 1 && voltages.every((value) => value === 0 || value === 5)
      ? high[0]!
      : -1;
  }
  function visibleIndices(rows: UiReceipt[]): number[] {
    return [
      ...new Set(
        rows.flatMap((row) => {
          const high = row.brightness
            .map((value, index) => (value > 0 ? index : -1))
            .filter((index) => index >= 0);
          return high.length === 1 ? high : [];
        }),
      ),
    ].sort((a, b) => a - b);
  }
  const ready = observed.worker.filter(
    (row) =>
      row.requestSource === source &&
      row.advance.executionStatus === 'ready' &&
      row.advance.committedHorizonMicroseconds === row.advance.requestedHorizonMicroseconds,
  );
  return {
    serial:
      ready
        .at(-1)
        ?.advance.serial.find((board) => board.componentId === 'uno')
        ?.tx.map((entry) => entry.text) ?? [],
    gpio: [...new Set(ready.map(highIndex).filter((index) => index >= 0))].sort((a, b) => a - b),
    visible: visibleIndices(observed.ui),
  };
}
async function runActualSketch(page: Page, kind: 'serial' | 'gpio', source: string, path: string) {
  let raw: Awaited<ReturnType<typeof observation>>;
  try {
    await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    if (kind === 'serial') {
      await expect
        .poll(async () => (await page.evaluate(compactObservation, { source })).serial)
        .toEqual([1, 2, 4, 8, 16, 32, 64, 128].map((value) => `${value}\n`));
      await expect(page.locator('.arduino-serial-output > div')).toHaveText(
        [1, 2, 4, 8, 16, 32, 64, 128].map(String),
      );
    } else {
      await expect
        .poll(async () => (await page.evaluate(compactObservation, { source })).gpio)
        .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      await expect
        .poll(async () => (await page.evaluate(compactObservation, { source })).visible)
        .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  } finally {
    // Preserve complete canonical state/events/quality even when a predicate fails.
    raw = await observation(page);
    writeFileSync(
      `${path}.json`,
      JSON.stringify(
        { kind, source, sourceSha256: createHash('sha256').update(source).digest('hex'), ...raw },
        null,
        2,
      ) + '\n',
    );
  }
  await page.screenshot({ path: `${path}.png` });
  const ready = raw.worker.filter(
    (row) => row.requestSource === source && row.advance.executionStatus === 'ready',
  );
  expect(ready.length).toBeGreaterThan(0);
  for (const row of ready) {
    expect(row.advance.committedHorizonMicroseconds).toBe(row.advance.requestedHorizonMicroseconds);
    expect(row.advance.result?.solved).toBe(true);
    expect(row.advance.result?.quality?.passed).toBe(true);
    expect(row.advance.diagnostics).toEqual([]);
    expect(row.computeMs).not.toBeNull();
    expect(Number.isFinite(row.computeMs)).toBe(true);
    expect(row.computeMs).toBeGreaterThanOrEqual(0);
    const board = row.boards.find((board) => board.componentId === 'uno')!;
    expect(board.loadedSource).toBe(source);
    expect(board.runtime.programFingerprint).toMatch(/^arduino-v1-/);
    expect(board.runtime.clockProfile).toBe('instruction-us-v1');
  }
  for (const row of raw.worker.filter((row) => row.advance.executionStatus === 'yielded'))
    expect(row.advance.result).toBeNull();
  if (kind === 'gpio') {
    for (let index = 0; index < 8; index++) {
      const row = ready.find((row) =>
        compactObservation({ source, raw: { worker: [row], ui: [] } }).gpio.includes(index),
      )!;
      for (let led = 0; led < 8; led++) {
        const result = row.advance.result!.components.find(
          (component) => component.componentId === `led${led}`,
        )!;
        expect(result).toBeDefined();
        if (led === index) expect(result.brightness ?? 0).toBeGreaterThan(0);
        else expect(result.brightness ?? 0).toBe(0);
        if (led === index) {
          expect(result.current).toBeGreaterThan(0.001);
          expect(result.current).toBeLessThan(0.02);
        } else expect(Math.abs(result.current)).toBeLessThan(0.000001);
        expect(result.stressState).not.toBe('burned');
      }
    }
  }
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  await expect(page.locator('.workbench-simulation-message')).toHaveCount(0);
  return ready[0]!.boards.find((board) => board.componentId === 'uno')!.runtime.programFingerprint;
}

test.beforeAll(() => {
  admin = e2eAdminPool();
  mkdirSync(artifactRoot, { recursive: true });
});
test.beforeEach(async ({ browserName }, info) => {
  void browserName;
  ownerQualificationLedger = null;
  ownerV3Ledger = null;
  const profile = ownerQualificationProfile(
    process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE,
    process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT,
  );
  if (profile === OWNER_V3_PROFILE) {
    ownerV3Ledger = {
      schema: 'electronics-classroom-qualification-v3',
      profile,
      entrypoint: process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT ?? '',
      title: info.title,
      expectedSourceSha: process.env.ASA_ELECTRONICS_EXPECTED_SHA ?? '',
      observerSha256: createHash('sha256')
        .update(readFileSync(resolve('e2e/electronics-ready-cadence.spec.ts')))
        .digest('hex'),
      expectedPace: OWNER_V3_PACE,
      registryRevision: OWNER_V3_REGISTRY_REVISION,
      stages: [],
      entries: [],
      invalidAcquisitions: [],
    };
    assertOwnerV3Identity(ownerV3Ledger, info.title);
  } else {
    ownerQualificationLedger = {
      schema: 'electronics-classroom-qualification-v2',
      profile,
      entrypoint: process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT ?? null,
      title: info.title,
      expectedSourceSha: process.env.ASA_ELECTRONICS_EXPECTED_SHA ?? null,
      observerSha256: createHash('sha256')
        .update(readFileSync(resolve('e2e/electronics-ready-cadence.spec.ts')))
        .digest('hex'),
      entries: [],
    };
    assertOwnerQualificationIdentity(ownerQualificationLedger, info.title);
  }
  teacher = await seedTeacher(admin, `ready-cadence-${info.workerIndex}-${info.retry}`);
});

test.afterEach(async ({ browserName }, info) => {
  void browserName;
  if (ownerV3Ledger !== null) {
    const ledger = ownerV3Ledger;
    const requiredSites = ownerV3RequiredSites(info.title);
    const missingSites = requiredSites.filter(
      (site) => !ledger.entries.some((entry) => entry.site === site),
    );
    const reachedWithoutValidEvidence = ledger.invalidAcquisitions
      .filter(
        (entry) =>
          entry.reached?.invocation === 'REACHED' &&
          entry.reached.site === entry.site &&
          entry.reached.title === info.title &&
          requiredSites.includes(entry.site),
      )
      .map((entry) => ({
        site: entry.site,
        outcome: 'REACHED_WITH_INVALID_EVIDENCE',
        error: entry.error,
        acquisition: entry.reached!,
      }));
    let complete = false;
    try {
      if (info.status === 'passed') {
        requireOwnerV3Complete(ledger, info.title);
        complete = true;
      }
    } finally {
      mkdirSync(artifactRoot, { recursive: true });
      const titleHash = createHash('sha256').update(info.title).digest('hex').slice(0, 16);
      const path = resolve(
        artifactRoot,
        `qualification-v3-${titleHash}-${info.workerIndex}-${info.retry}.json`,
      );
      writeFileSync(
        path,
        JSON.stringify(
          {
            ledger,
            caseStatusBeforeLedgerCheck: info.status,
            expectedStatus: info.expectedStatus,
            qualificationStatus: complete ? 'PASS' : 'FAIL_OR_INCOMPLETE',
            requiredSites,
            missingSites,
            reachedWithoutValidEvidence,
            unreached: missingSites
              .filter((site) => !reachedWithoutValidEvidence.some((entry) => entry.site === site))
              .map((site) => ({ site, outcome: 'NOT_REACHED' })),
            strictComparisonScope:
              'original-limits-on-this-v3-execution; actual strict run is separate',
          },
          null,
          2,
        ) + '\n',
      );
      await info.attach('electronics-qualification-v3-ledger', {
        path,
        contentType: 'application/json',
      });
    }
    return;
  }
  const ledger = ownerQualificationLedger;
  const requiredSites = ownerQualificationRequiredSites(info.title);
  const missingSites = ledger
    ? requiredSites.filter((site) => !ledger.entries.some((entry) => entry.site === site))
    : requiredSites;
  mkdirSync(artifactRoot, { recursive: true });
  const titleHash = createHash('sha256').update(info.title).digest('hex').slice(0, 16);
  const path = resolve(
    artifactRoot,
    `qualification-${titleHash}-${info.workerIndex}-${info.retry}.json`,
  );
  writeFileSync(
    path,
    JSON.stringify(
      {
        ledger,
        caseStatus: info.status,
        expectedStatus: info.expectedStatus,
        requiredSites,
        missingSites,
      },
      null,
      2,
    ) + '\n',
  );
  await info.attach('electronics-qualification-ledger', { path, contentType: 'application/json' });
  // An earlier failing assertion stays a failure and its unreached site is
  // explicit. A case cannot claim PASS after omitting its mandatory ledger.
  if (info.status === 'passed') requireOwnerQualificationComplete(ledger, info.title);
});
test.afterAll(async () => {
  await admin.end();
});
for (const kind of ['serial', 'gpio'] as const) {
  test(`Canonical ready cadence: ${kind} sketch saved, observed completely and reopened with cookies only`, async ({
    page,
    browser,
  }) => {
    const source = kind === 'serial' ? serialSketch : gpioSketch;
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await observeRealWorkerAndUi(page);
    await loginWithOrganization(page, teacher);
    const origin = new URL(page.url()).origin;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin, 'idempotency-key': `cadence-${crypto.randomUUID()}` },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Canonical ${kind} ready observations`,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { project: { id: string } }).project.id;
    const endpoint = `/api/projects/${id}`;
    const read = async () => {
      const response = await page.context().request.get(endpoint, { headers: { origin } });
      expect(response.status()).toBe(200);
      return response.json() as Promise<{
        draft: { revision: number; updatedAt: string; document: SchematicDocument };
      }>;
    };
    const empty = await read();
    const savedFixture = await page.context().request.put(`${endpoint}/draft`, {
      headers: { origin },
      data: {
        document: fixture(),
        baseRevision: empty.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(savedFixture.status()).toBe(200);
    const before = await read();
    await page.goto(`/#/home/${id}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
    await expect(page.locator('.arduino-source-editor textarea')).toHaveValue(initialSource);
    await page.locator('.arduino-source-editor textarea').fill(source);
    await expect(page.locator('.arduino-source-editor textarea')).toHaveValue(source);
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/draft` &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await saveResponse).status()).toBe(200);
    const after = await read();
    const expected = {
      ...before.draft.document,
      components: before.draft.document.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, arduinoSource: source },
            }
          : component,
      ),
    };
    writeFileSync(
      resolve(artifactRoot, `${kind}-saved.json`),
      JSON.stringify({ projectId: id, before, after, expected }, null, 2) + '\n',
    );
    expect(after.draft.document).toEqual(expected);
    expect(after.draft.revision).toBe(before.draft.revision + 1);
    const fingerprint = await runActualSketch(
      page,
      kind,
      source,
      resolve(artifactRoot, `${kind}-initial`),
    );
    const originalAfterRun = await read();
    expect(originalAfterRun.draft.document).toEqual(after.draft.document);
    expect(originalAfterRun.draft.revision).toBe(after.draft.revision);
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      const reopened = await context.newPage();
      const reopenFailures = collectBrowserFailures(reopened, { allowAnonymousSessionProbe: true });
      await observeRealWorkerAndUi(reopened);
      await context.addCookies(await page.context().cookies());
      await reopened.goto(`${origin}/#/home/${id}`);
      await expect(reopened.locator('.workbench-stage')).toBeVisible();
      await reopened.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
      await expect(reopened.locator('.arduino-source-editor textarea')).toHaveValue(source);
      expect(
        await runActualSketch(reopened, kind, source, resolve(artifactRoot, `${kind}-reopened`)),
      ).toBe(fingerprint);
      const finalResponse = await context.request.get(endpoint, { headers: { origin } });
      expect(finalResponse.status()).toBe(200);
      const final = (await finalResponse.json()) as typeof after;
      writeFileSync(
        resolve(artifactRoot, `${kind}-final.json`),
        JSON.stringify({ after, final }, null, 2) + '\n',
      );
      expect(final.draft.document).toEqual(after.draft.document);
      expect(final.draft.revision).toBe(after.draft.revision);
      expect(final.draft.updatedAt).toBe(after.draft.updatedAt);
      reopenFailures.assertEmpty();
    } finally {
      await context.close();
    }
    failures.assertEmpty();
  });
}

// These are the owner's three-pin programmes, not shortened substitutes for
// the eight-pin GPIO/Serial cases above. Runtime events establish logical
// timing; real DOM transitions separately establish visible publication.
function threeLedFixture(includeSteadyLed = false): SchematicDocument {
  const original = fixture();
  const keep = new Set(['uno', 'r0', 'led0', 'r1', 'led1', 'r2', 'led2']);
  if (includeSteadyLed) {
    keep.add('r3');
    keep.add('led3');
  }
  return {
    ...original,
    components: original.components
      .filter((component) => keep.has(component.id))
      .map((component) =>
        component.id === 'r3' || component.id === 'led3'
          ? { ...component, position: { x: 730, y: component.id === 'r3' ? 570 : 660 } }
          : component,
      ),
    connections: original.connections
      .filter(
        (connection) =>
          keep.has(connection.from.componentId) && keep.has(connection.to.componentId),
      )
      .map((connection) =>
        connection.from.componentId === 'uno'
          ? {
              ...connection,
              from: {
                ...connection.from,
                terminal:
                  connection.to.componentId === 'r3'
                    ? 'power-5v'
                    : (`d${13 - Number(connection.to.componentId.slice(1))}` as 'd13'),
              },
            }
          : connection,
      ),
  };
}

const owner100msSource = `void setup()
{
pinMode(13, OUTPUT);
pinMode(12, OUTPUT);
pinMode(11, OUTPUT);
}

void loop()
{
digitalWrite(13, HIGH);
digitalWrite(12, HIGH);
digitalWrite(11, HIGH);
delay(100);
digitalWrite(13, LOW);
digitalWrite(12, LOW);
digitalWrite(11, LOW);
delay(100);
}`;

function threeLedSource(delayMs: number | null): string {
  if (delayMs === 100) return owner100msSource;
  return `void setup() {
  pinMode(13, OUTPUT);
  pinMode(12, OUTPUT);
  pinMode(11, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
  digitalWrite(12, HIGH);
  digitalWrite(11, HIGH);${
    delayMs === null
      ? ''
      : `
  delay(${delayMs});
  digitalWrite(13, LOW);
  digitalWrite(12, LOW);
  digitalWrite(11, LOW);
  delay(${delayMs});`
  }
}`;
}

function ownerTimingSummary({ source }: { source: string }) {
  const probe = window as ProbeWindow;
  const worker = (probe.__bitwiseWorker ?? []).filter((row) => row.requestSource === source);
  const ready = worker.filter(
    (row) =>
      row.advance.executionStatus === 'ready' &&
      row.advance.committedHorizonMicroseconds === row.advance.requestedHorizonMicroseconds &&
      row.advance.result?.solved &&
      row.advance.result.quality?.passed,
  );
  const ui = probe.__bitwiseUi ?? [];
  const paint = (probe.__ownerPaint ?? []).filter(
    (row) =>
      row.stablePreviousFrame &&
      row.images.length === 3 &&
      row.brightness.length === 3 &&
      row.images.every(
        (image, index) =>
          image.decoded &&
          image.visible &&
          image.unoccluded &&
          image.opacity === 1 &&
          image.lit === row.brightness[index]! > 0,
      ),
  );
  const changes: number[] = [];
  for (const row of ui) {
    const level = row.brightness.every((value) => value > 0)
      ? 1
      : row.brightness.every((value) => value === 0)
        ? 0
        : -1;
    if (level >= 0 && level !== changes.at(-1)) changes.push(level);
  }
  return {
    committed: ready.at(-1)?.advance.committedHorizonMicroseconds ?? 0,
    completeAllHigh: ready.some((row) =>
      [0, 1, 2].every(
        (index) =>
          (row.advance.result?.components.find(
            (component) => component.componentId === `led${index}`,
          )?.brightness ?? 0) > 0,
      ),
    ),
    visibleAllHigh: ui.some((row) => row.brightness.every((value) => value > 0)),
    visibleChanges: changes.length,
    readyCount: ready.length,
    wallSpan: ready.length ? ready.at(-1)!.at - ready[0]!.at : 0,
    paintHigh: paint.some((row) => row.brightness.every((value) => value > 0)),
    paintLow: paint.some((row) => row.brightness.every((value) => value === 0)),
  };
}

function blinkWallMetrics(rows: ReadonlyArray<{ at: number; level: number }>, delayMs: number) {
  const first = rows.findIndex((row) => row.level === 1);
  const last = rows.findLastIndex((row) => row.level === 1);
  const completeCycles = first < 0 ? [] : rows.slice(first, last + 1);
  const halves: number[] = [];
  const duration = { high: 0, low: 0 };
  for (let index = 1; index < completeCycles.length; index++) {
    const half = completeCycles[index]!.at - completeCycles[index - 1]!.at;
    halves.push(half);
    duration[completeCycles[index - 1]!.level === 1 ? 'high' : 'low'] += half;
  }
  return {
    halves,
    halfBoundsPassed:
      halves.length > 0 && halves.every((half) => half >= delayMs * 0.5 && half <= delayMs * 2),
    // Whole HIGH -> HIGH cycles avoid bias from a truncated last LOW. At least
    // four cycles average the 16.7ms browser paint quantisation; 40/60 duty fails.
    cycles: (completeCycles.length - 1) / 2,
    duty: duration.high / (duration.high + duration.low),
  };
}

function witnessedPaintFrames(rows: ReadonlyArray<PaintReceipt>, startAt: number) {
  return rows.flatMap((row) =>
    row.stablePreviousFrame && row.previousFrameAt !== null && row.previousFrameAt >= startAt
      ? [{ ...row, at: row.previousFrameAt, confirmedAt: row.at }]
      : [],
  );
}

for (const delayMs of [null, 100, 50] as const) {
  const label = delayMs === null ? 'three HIGH outputs without delay' : `blink delay ${delayMs} ms`;
  test(`Owner Arduino timing: ${label}, complete ready frames and real LED transitions`, async ({
    page,
  }) => {
    const source = threeLedSource(delayMs);
    const name = delayMs === null ? 'no-delay' : `blink-${delayMs}`;
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await observeRealWorkerAndUi(page, 3);
    await loginWithOrganization(page, teacher);
    const origin = new URL(page.url()).origin;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin, 'idempotency-key': `owner-timing-${crypto.randomUUID()}` },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Owner Arduino ${name}`,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { project: { id: string } }).project.id;
    const endpoint = `/api/projects/${id}`;
    const read = async () => {
      const response = await page.context().request.get(endpoint, { headers: { origin } });
      expect(response.status()).toBe(200);
      return response.json() as Promise<{
        draft: { revision: number; updatedAt: string; document: SchematicDocument };
      }>;
    };
    const empty = await read();
    const seeded = await page.context().request.put(`${endpoint}/draft`, {
      headers: { origin },
      data: {
        document: threeLedFixture(delayMs === 100),
        baseRevision: empty.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(seeded.status()).toBe(200);
    const before = await read();
    await page.goto(`/#/home/${id}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
    await page.locator('.arduino-source-editor textarea').fill(source);
    const savedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/draft` &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await savedResponse).status()).toBe(200);
    const saved = await read();
    const expected = {
      ...before.draft.document,
      components: before.draft.document.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, arduinoSource: source },
            }
          : component,
      ),
    };
    expect(saved.draft.document).toEqual(expected);
    expect(saved.draft.revision).toBe(before.draft.revision + 1);
    // A pupil closes the saved source pane so all three LEDs can actually be seen.
    await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
    await expect(page.locator('.arduino-code-panel')).toHaveClass(/closed/);
    expect((await read()).draft).toEqual(saved.draft);
    const startAt = await page.evaluate(() => {
      const probe = window as ProbeWindow;
      if (probe.__bitwiseWorker) probe.__bitwiseWorker.length = 0;
      if (probe.__bitwiseUi) probe.__bitwiseUi.length = 0;
      if (probe.__ownerPaint) probe.__ownerPaint.length = 0;
      return performance.now();
    });
    let raw: Awaited<ReturnType<typeof observation>> | null = null;
    let primary: unknown;
    try {
      await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
      if (delayMs === null) {
        await expect
          .poll(async () => {
            const summary = await page.evaluate(ownerTimingSummary, { source });
            return {
              ready: summary.completeAllHigh,
              visible: summary.visibleAllHigh,
              paint: summary.paintHigh,
              // Repeated genuine checkpoints and actual paint over one wall
              // second, not a realtime claim from the first 256us checkpoint.
              sustained:
                summary.readyCount >= 8 && summary.committed >= 1_024 && summary.wallSpan >= 1_000,
            };
          })
          .toEqual({ ready: true, visible: true, paint: true, sustained: true });
      } else {
        // A correct GPIO event log alone cannot pass a hidden/aliased blink.
        // Both on and off states must actually reach the production DOM.
        await expect
          .poll(async () => {
            const summary = await page.evaluate(ownerTimingSummary, { source });
            return (
              summary.committed >= 1_250_000 &&
              summary.visibleChanges >= (delayMs === 100 ? 8 : 16) &&
              summary.paintHigh &&
              summary.paintLow
            );
          })
          .toBe(true);
      }
    } catch (error) {
      primary = error;
    } finally {
      try {
        raw = await observation(page);
        writeFileSync(
          resolve(artifactRoot, `owner-${name}-raw.json`),
          JSON.stringify(
            {
              source,
              sourceSha256: createHash('sha256').update(source).digest('hex'),
              startAt,
              collectedAt: await page.evaluate(() => performance.now()),
              before,
              saved,
              expected,
              primaryError: primary instanceof Error ? primary.message : null,
              ...raw,
            },
            null,
            2,
          ) + '\n',
        );
      } catch (evidenceError) {
        if (primary === undefined) primary = evidenceError;
        writeFileSync(
          resolve(artifactRoot, `owner-${name}-evidence-error.json`),
          JSON.stringify({
            primaryError: primary instanceof Error ? primary.message : String(primary),
            evidenceError:
              evidenceError instanceof Error ? evidenceError.message : String(evidenceError),
          }) + '\n',
        );
      }
    }
    if (primary !== undefined) throw primary;
    const ready = raw!.worker.filter(
      (row) => row.requestSource === source && row.advance.executionStatus === 'ready',
    );
    expect(raw!.startClicks).toHaveLength(1);
    expect(raw!.reanchors.filter((row) => row.at >= startAt)).toEqual([]);
    expect(raw!.startClicks[0]!.trusted).toBe(true);
    expect(ready.some((row) => row.advance.committedHorizonMicroseconds === 0)).toBe(true);
    for (const row of ready) {
      expect(row.advance.committedHorizonMicroseconds).toBe(
        row.advance.requestedHorizonMicroseconds,
      );
      expect(row.advance.result?.solved).toBe(true);
      expect(row.advance.result?.quality?.passed).toBe(true);
      expect(row.advance.diagnostics).toEqual([]);
      expect(Number.isFinite(row.computeMs)).toBe(true);
      if (delayMs === 100) {
        expect(
          row.advance.result?.components.find((component) => component.componentId === 'led3'),
        ).toMatchObject({ lit: true });
        expect(
          row.advance.result?.components.find((component) => component.componentId === 'led3')
            ?.brightness,
        ).toBeGreaterThan(0);
      }
    }
    if (delayMs === 100) {
      const steady = page.locator('[data-component-id="led3"] .workbench-production-visual');
      await expect(steady).toBeVisible();
      await expect(steady).toHaveClass(/is-lit/);
      expect(Number(await steady.getAttribute('data-led-brightness'))).toBeGreaterThan(0);
    }
    for (const row of raw!.worker.filter((row) => row.advance.executionStatus === 'yielded'))
      expect(row.advance.result).toBeNull();
    expect(
      raw!.worker.filter(
        (row) => row.requestSource === source && row.advance.executionStatus === 'fault',
      ),
    ).toEqual([]);
    const events = new Map<number, ArduinoRuntimeState['eventQueue'][number]>();
    for (const row of raw!.worker.filter((row) => row.requestSource === source))
      for (const event of row.boards.find((board) => board.componentId === 'uno')?.runtime
        .eventQueue ?? [])
        if (event.kind === 'output-change' && ['d13', 'd12', 'd11'].includes(event.terminal))
          events.set(event.sequence, event);
    const pinEdges = ['d13', 'd12', 'd11'].map((terminal) =>
      [...events.values()]
        .filter((event) => event.terminal === terminal)
        .sort((a, b) => a.sequence - b.sequence)
        .filter((event, index, rows) => index === 0 || event.voltage !== rows[index - 1]!.voltage),
    );
    const edges = pinEdges[0]!;
    for (let pin = 0; pin < pinEdges.length; pin++) {
      expect(pinEdges[pin]![0]).toMatchObject({ voltage: 0, atMicroseconds: pin });
      expect(pinEdges[pin]![1]).toMatchObject({ voltage: 5, atMicroseconds: 4 + pin });
    }
    if (delayMs !== null) {
      expect(edges.length).toBeGreaterThanOrEqual(delayMs === 100 ? 10 : 20);
      // Initial LOW@0 -> first HIGH@4us configures the outputs. Anchor the
      // regular blink at that HIGH; retain its initialization evidence above.
      for (const pin of pinEdges)
        for (let index = 2; index < pin.length; index++) {
          const interval = pin[index]!.atMicroseconds - pin[index - 1]!.atMicroseconds;
          expect(interval).toBeGreaterThanOrEqual(delayMs * 1000);
          expect(interval).toBeLessThanOrEqual(delayMs * 1000 + 10);
        }
    }
    const transitions: Array<{
      at: number;
      level: number;
      readyAt: number;
      committed: number;
      publicationMs: number;
    }> = [];
    for (const row of raw!.ui.filter((row) => row.at >= startAt)) {
      const level = row.brightness.every((value) => value > 0)
        ? 1
        : row.brightness.every((value) => value === 0)
          ? 0
          : -1;
      if (level < 0 || level === transitions.at(-1)?.level) continue;
      const matching = ready
        .filter(
          (frame) =>
            frame.at <= row.at &&
            row.brightness.every((value, index) => {
              const physical =
                frame.advance.result?.components.find(
                  (component) => component.componentId === `led${index}`,
                )?.brightness ?? 0;
              return value === Math.round(Math.max(0, Math.min(100, physical)));
            }),
        )
        .at(-1);
      // The pre-Run dark DOM is not a simulated publication.
      if (!matching) {
        expect(level).toBe(0);
        continue;
      }
      transitions.push({
        at: row.at,
        level,
        readyAt: matching.at,
        committed: matching.advance.committedHorizonMicroseconds,
        publicationMs: row.at - matching.at,
      });
    }
    expect(transitions.some((row) => row.level === 1)).toBe(true);
    // A stable second RAF witnesses the preceding frame. Its confirmation
    // time is retained separately; it is not that frame's presentation onset.
    const painted = witnessedPaintFrames(raw!.paint, startAt).filter(
      (row) =>
        row.at >= startAt &&
        row.stablePreviousFrame &&
        row.images.length === 3 &&
        row.brightness.length === 3 &&
        row.images.every(
          (image, index) =>
            image.decoded &&
            image.visible &&
            image.unoccluded &&
            image.opacity === 1 &&
            image.lit === row.brightness[index]! > 0,
        ),
    );
    expect(painted.some((row) => row.brightness.every((value) => value > 0))).toBe(true);
    const paintTransitions: Array<(typeof transitions)[number] & { confirmedAt: number }> = [];
    for (const row of painted) {
      const level = row.brightness.every((value) => value > 0)
        ? 1
        : row.brightness.every((value) => value === 0)
          ? 0
          : -1;
      if (level < 0 || level === paintTransitions.at(-1)?.level) continue;
      const matching = ready
        .filter(
          (frame) =>
            frame.at <= row.at &&
            row.brightness.every(
              (value, index) =>
                value ===
                Math.round(
                  Math.max(
                    0,
                    Math.min(
                      100,
                      frame.advance.result?.components.find(
                        (component) => component.componentId === `led${index}`,
                      )?.brightness ?? 0,
                    ),
                  ),
                ),
            ),
        )
        .at(-1);
      if (!matching) {
        expect(level).toBe(0);
        continue;
      }
      paintTransitions.push({
        at: row.at,
        confirmedAt: row.confirmedAt,
        level,
        readyAt: matching.at,
        committed: matching.advance.committedHorizonMicroseconds,
        publicationMs: row.at - matching.at,
      });
    }
    if (delayMs !== null) {
      expect(transitions.length).toBeGreaterThanOrEqual(delayMs === 100 ? 8 : 16);
      const first = transitions[0]!;
      const last = transitions.at(-1)!;
      const modelSpanMs = (last.committed - first.committed) / 1000;
      const wallSpanMs = last.at - first.at;
      expect(modelSpanMs).toBeGreaterThanOrEqual(750);
      // The five-second discovery deadline is not permission to play one
      // logical second over five real seconds. This is a separate rate check.
      if (ownerV3Ledger)
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `owner-blink-${delayMs}-dom-wall-model`,
          ownerV3WorkerProvenance(ready, source, `blink-${delayMs}`, { delayMs }),
          [wallSpanMs],
          modelSpanMs,
        );
      else expect(Math.abs(wallSpanMs - modelSpanMs)).toBeLessThanOrEqual(250);
      const sameLevel = transitions.filter((row) => row.level === 1);
      const wallPeriodMs = (sameLevel.at(-1)!.at - sameLevel[0]!.at) / (sameLevel.length - 1);
      if (ownerV3Ledger) {
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `owner-blink-${delayMs}-dom-mean-period`,
          ownerV3WorkerProvenance(ready, source, `blink-${delayMs}`, { delayMs }),
          [wallPeriodMs],
        );
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `owner-blink-${delayMs}-dom-transition-gaps`,
          ownerV3WorkerProvenance(ready, source, `blink-${delayMs}`, { delayMs }),
          transitions.slice(1).map((row, index) => row.at - transitions[index]!.at),
        );
      } else {
        expect(wallPeriodMs).toBeGreaterThanOrEqual(delayMs * 2 * 0.75);
        expect(wallPeriodMs).toBeLessThanOrEqual(delayMs * 2 * 1.25);
        for (let index = 1; index < transitions.length; index++)
          expect(transitions[index]!.at - transitions[index - 1]!.at).toBeLessThanOrEqual(
            delayMs * 3,
          );
      }
      // Independently challenge effective image presentation. Check each
      // half, both polarities and duty; a good mean cannot hide 5ms bursts or
      // a dark second. Time-zero configuration is reported separately.
      const firstPaintHigh = paintTransitions.findIndex((row) => row.level === 1);
      expect(firstPaintHigh).toBeGreaterThanOrEqual(0);
      const steady = paintTransitions.slice(firstPaintHigh);
      expect(steady.length).toBeGreaterThanOrEqual(delayMs === 100 ? 8 : 16);
      for (const phases of [transitions, paintTransitions]) {
        const wall = blinkWallMetrics(phases, delayMs);
        expect(wall.cycles).toBeGreaterThanOrEqual(4);
        if (ownerV3Ledger) {
          const surface = phases === transitions ? 'dom' : 'paint';
          recordOwnerV3Timing(
            ownerV3Ledger,
            test.info().title,
            `owner-blink-${delayMs}-${surface}-half-durations`,
            ownerV3WorkerProvenance(ready, source, `blink-${delayMs}`, { delayMs, surface }),
            wall.halves,
          );
        } else expect(wall.halfBoundsPassed).toBe(true);
        expect(wall.duty).toBeGreaterThanOrEqual(0.45);
        expect(wall.duty).toBeLessThanOrEqual(0.55);
      }
      const paintFirst = steady[0]!;
      const paintLast = steady.at(-1)!;
      if (ownerV3Ledger)
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `owner-blink-${delayMs}-paint-wall-model`,
          ownerV3WorkerProvenance(ready, source, `blink-${delayMs}`, { delayMs }),
          [paintLast.at - paintFirst.at],
          (paintLast.committed - paintFirst.committed) / 1000,
        );
      else
        expect(
          Math.abs(
            paintLast.at - paintFirst.at - (paintLast.committed - paintFirst.committed) / 1000,
          ),
        ).toBeLessThanOrEqual(250);
    } else {
      const lit = ready.filter((row) => row.advance.committedHorizonMicroseconds > 0);
      expect(lit.length).toBeGreaterThanOrEqual(7);
      expect(lit.at(-1)!.advance.committedHorizonMicroseconds).toBeGreaterThan(
        lit[0]!.advance.committedHorizonMicroseconds,
      );
      expect(lit.at(-1)!.at - ready[0]!.at).toBeGreaterThanOrEqual(1_000);
      for (const row of lit) {
        for (let index = 0; index < 3; index++)
          expect(
            row.advance.result?.components.find(
              (component) => component.componentId === `led${index}`,
            )?.brightness,
          ).toBeGreaterThan(0);
      }
    }
    writeFileSync(
      resolve(artifactRoot, `owner-${name}-timing.json`),
      JSON.stringify(
        {
          startAt,
          startClicks: raw!.startClicks,
          firstRequestAt: ready[0]!.requestAt,
          firstReadyAt: ready[0]!.at,
          firstPaintAt: painted.find((row) => row.brightness.every((value) => value > 0))!.at,
          firstReadyMs: ready[0]!.at - startAt,
          firstLedMs: transitions.find((row) => row.level === 1)!.at - startAt,
          requestedPeriodUs: delayMs === null ? null : delayMs * 2000,
          edges,
          pinEdges,
          wallMetrics:
            delayMs === null
              ? null
              : {
                  dom: blinkWallMetrics(transitions, delayMs),
                  paint: blinkWallMetrics(paintTransitions, delayMs),
                },
          transitions,
          paintTransitions,
          painted,
          horizonTimeline: raw!.worker.map((row) => ({
            at: row.at,
            requestAt: row.requestAt,
            generationId: row.generationId,
            requestId: row.requestId,
            computeMs: row.computeMs,
            executionStatus: row.advance.executionStatus,
            requested: row.advance.requestedHorizonMicroseconds,
            committed: row.advance.committedHorizonMicroseconds,
          })),
          finalWallMs: ready.at(-1)!.at - startAt,
          finalModelMs: ready.at(-1)!.advance.committedHorizonMicroseconds / 1000,
          modelToWallRatio:
            ready.at(-1)!.advance.committedHorizonMicroseconds /
            1000 /
            (ready.at(-1)!.at - startAt),
        },
        null,
        2,
      ) + '\n',
    );
    // Native screenshots occur after the measured raw snapshot; screenshot
    // transport must not distort the timing sample it is meant to illustrate.
    const screenshots: unknown[] = [];
    // Neutral names are deliberate: asynchronous native capture can cross a
    // blink edge. Before/after receipts bound it; reviewers classify real pixels.
    const requestedLevels = delayMs === null ? [1] : [1, 0, 1, 0, 1, 0];
    for (const [index, level] of requestedLevels.entries()) {
      await page.waitForFunction((level) => {
        const row = (window as ProbeWindow).__ownerPaint?.at(-1);
        return (
          !!row?.stablePreviousFrame &&
          row.images.every(
            (image, index) =>
              image.decoded &&
              image.visible &&
              image.unoccluded &&
              image.opacity === 1 &&
              image.lit === row.brightness[index]! > 0,
          ) &&
          row.brightness.every((value) => (level ? value > 0 : value === 0))
        );
      }, level);
      const beforeScreenshot = await page.evaluate(() =>
        (window as ProbeWindow).__ownerPaint?.at(-1),
      );
      const path = resolve(artifactRoot, `owner-${name}-frame-${index + 1}.png`);
      await page.screenshot({ path });
      const afterScreenshot = await page.evaluate(() =>
        (window as ProbeWindow).__ownerPaint?.at(-1),
      );
      screenshots.push({
        requestedLevel: level,
        capturedPixelPhase: 'requires independent visual classification',
        path,
        beforeScreenshot,
        afterScreenshot,
      });
    }
    writeFileSync(
      resolve(artifactRoot, `owner-${name}-paint-screenshots.json`),
      JSON.stringify(screenshots, null, 2) + '\n',
    );
    await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
    const final = await read();
    expect(final.draft).toEqual(saved.draft);
    failures.assertEmpty();
  });
}

const independentPortsSource = `void setup(){pinMode(13,OUTPUT);pinMode(12,OUTPUT);pinMode(11,OUTPUT);}
void loop(){digitalWrite(13,HIGH);digitalWrite(12,LOW);digitalWrite(11,LOW);delay(100);
digitalWrite(13,LOW);digitalWrite(12,HIGH);delay(100);digitalWrite(12,LOW);digitalWrite(11,HIGH);delay(100);}`;

for (const mode of ['no-delay realtime', 'independent ports'] as const) {
  test(`Owner Arduino execution: ${mode}, production frames and painted LEDs`, async ({ page }) => {
    const source = mode === 'no-delay realtime' ? threeLedSource(null) : independentPortsSource;
    await page.setViewportSize({ width: 1600, height: 1000 });
    const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
    await observeRealWorkerAndUi(page, 3);
    await loginWithOrganization(page, teacher);
    const origin = new URL(page.url()).origin;
    const created = await page.context().request.post('/api/projects', {
      headers: { origin, 'idempotency-key': crypto.randomUUID() },
      data: {
        scope: 'personal',
        classroomId: null,
        module: 'electronics',
        title: `Arduino ${mode}`,
      },
    });
    expect(created.status()).toBe(201);
    const id = ((await created.json()) as { project: { id: string } }).project.id;
    const endpoint = `/api/projects/${id}`;
    const get = async () => {
      const response = await page.context().request.get(endpoint, { headers: { origin } });
      expect(response.status()).toBe(200);
      return response.json() as Promise<{
        draft: { revision: number; document: SchematicDocument };
      }>;
    };
    const initial = await get();
    const seeded = await page.context().request.put(`${endpoint}/draft`, {
      headers: { origin },
      data: {
        document: threeLedFixture(false),
        baseRevision: initial.draft.revision,
        mutationId: crypto.randomUUID(),
      },
    });
    expect(seeded.status()).toBe(200);
    await page.goto(`/#/home/${id}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
    await page.locator('.arduino-source-editor textarea').fill(source);
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/draft` &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await saved).status()).toBe(200);
    const persisted = await get();
    expect(
      persisted.draft.document.components.find((c) => c.id === 'uno')?.stateProperties?.[
        'arduinoSource'
      ],
    ).toBe(source);
    await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
    const startAt = await page.evaluate(() => {
      const probe = window as ProbeWindow;
      if (probe.__bitwiseWorker) probe.__bitwiseWorker.length = 0;
      if (probe.__bitwiseUi) probe.__bitwiseUi.length = 0;
      if (probe.__ownerPaint) probe.__ownerPaint.length = 0;
      return performance.now();
    });
    let raw: Awaited<ReturnType<typeof observation>> | undefined;
    let assetsReadyAt = startAt;
    try {
      await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
      await page.waitForFunction(() => {
        const row = (window as ProbeWindow).__ownerPaint?.at(-1);
        return (
          !!row &&
          row.brightness.some((value) => value > 0) &&
          row.images.every(
            (image) => image.decoded && image.visible && image.unoccluded && image.opacity === 1,
          )
        );
      });
      assetsReadyAt = await page.evaluate(() => performance.now());
      await expect
        .poll(() =>
          page.evaluate(
            ({ source }) => {
              const probe = window as ProbeWindow;
              const ready = (probe.__bitwiseWorker ?? []).filter(
                (row) => row.requestSource === source && row.advance.executionStatus === 'ready',
              );
              return (ready.at(-1)?.advance.committedHorizonMicroseconds ?? 0) >= 1_250_000;
            },
            { source },
          ),
        )
        .toBe(true);
    } finally {
      raw = await observation(page);
      writeFileSync(
        resolve(artifactRoot, `owner-execution-${mode.replaceAll(' ', '-')}-raw.json`),
        JSON.stringify({ source, startAt, assetsReadyAt, persisted, ...raw }, null, 2) + '\n',
      );
    }
    const ready = raw.worker.filter(
      (row) => row.requestSource === source && row.advance.executionStatus === 'ready',
    );
    expect(raw.reanchors.filter((row) => row.at >= startAt)).toEqual([]);
    expect(ready.length).toBeGreaterThanOrEqual(8);
    for (const frame of ready) {
      expect(frame.advance.committedHorizonMicroseconds).toBe(
        frame.advance.requestedHorizonMicroseconds,
      );
      expect(frame.advance.result?.solved).toBe(true);
      expect(frame.advance.result?.quality?.passed).toBe(true);
    }
    const first = ready[0]!,
      last = ready.at(-1)!;
    const modelMs =
      (last.advance.committedHorizonMicroseconds - first.advance.committedHorizonMicroseconds) /
      1000;
    const wallMs = last.at - first.at;
    expect(modelMs).toBeGreaterThanOrEqual(1250);
    if (ownerV3Ledger)
      recordOwnerV3Timing(
        ownerV3Ledger,
        test.info().title,
        mode === 'no-delay realtime'
          ? 'no-delay-execution-wall-model'
          : 'independent-ports-execution-wall-model',
        ownerV3WorkerProvenance(ready, source, mode, {}),
        [wallMs],
        modelMs,
      );
    else if (mode === 'no-delay realtime')
      recordOwnerQualifiedWallClock(
        ownerQualificationLedger,
        test.info().title,
        'no-delay-execution-wall-model',
        modelMs,
        wallMs,
      );
    else expect(Math.abs(modelMs - wallMs)).toBeLessThanOrEqual(250);
    const paint = witnessedPaintFrames(raw.paint, assetsReadyAt);
    for (const row of paint)
      for (const [index, image] of row.images.entries()) {
        expect(image.decoded).toBe(true);
        expect(image.visible).toBe(true);
        expect(image.unoccluded).toBe(true);
        expect(image.opacity).toBe(1);
        expect(image.lit).toBe(row.brightness[index]! > 0);
      }
    expect(paint.length).toBeGreaterThan(0);
    if (mode === 'no-delay realtime') {
      for (const frame of ready.filter(
        (frame) => frame.advance.committedHorizonMicroseconds >= 25_000,
      ))
        for (const id of ['led0', 'led1', 'led2'])
          expect(
            frame.advance.result?.components.find((c) => c.componentId === id)?.brightness,
          ).toBeGreaterThan(0);
      expect(paint.some((row) => row.brightness.every((value) => value > 0))).toBe(true);
    } else {
      const vectors = paint.map((row) => row.brightness.map((value) => Number(value > 0)).join(''));
      for (const pattern of ['100', '010', '001'])
        expect(vectors.filter((value) => value === pattern).length).toBeGreaterThanOrEqual(3);
      for (let pin = 0; pin < 3; pin++) {
        const changes: Array<{ at: number; level: number }> = [];
        for (const row of paint) {
          const level = Number(row.brightness[pin]! > 0);
          if (changes.at(-1)?.level !== level) changes.push({ at: row.at, level });
        }
        const highs = changes.filter((row) => row.level === 1);
        expect(highs.length).toBeGreaterThanOrEqual(4);
        if (ownerV3Ledger)
          recordOwnerV3Timing(
            ownerV3Ledger,
            test.info().title,
            `independent-ports-led${pin}-high-periods`,
            ownerV3WorkerProvenance(ready, source, mode, { ledIndex: pin, arduinoPin: 13 - pin }),
            highs.slice(1).map((row, index) => row.at - highs[index]!.at),
          );
        else {
          for (let i = 1; i < highs.length; i++)
            expect(highs[i]!.at - highs[i - 1]!.at).toBeGreaterThanOrEqual(225);
          for (let i = 1; i < highs.length; i++)
            expect(highs[i]!.at - highs[i - 1]!.at).toBeLessThanOrEqual(375);
        }
      }
      for (const frame of ready.filter(
        (frame) => frame.advance.committedHorizonMicroseconds >= 10,
      )) {
        const at = frame.advance.committedHorizonMicroseconds;
        const phase = (at - 4) % 300011;
        const expected = [
          phase < 100004,
          phase >= 100005 && phase < 200007,
          phase >= 200008 || phase < 2,
        ];
        // Exclude only the exact instruction-wide setup/transitions, which retain their raw GPIO evidence.
        if ([0, 1, 2, 100004, 100005, 200007, 200008].includes(phase)) continue;
        expected.forEach((lit, index) =>
          expect(
            (frame.advance.result?.components.find((c) => c.componentId === `led${index}`)
              ?.brightness ?? 0) > 0,
          ).toBe(lit),
        );
      }
    }
    await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
    expect((await get()).draft).toEqual(persisted.draft);
    failures.assertEmpty();
  });
}

// R18 evidence is collected only by the additional owner journeys below. The
// seven earlier programmes, deadlines, raw rings and observers stay unchanged.
type TemporalFrame = {
  at: number;
  requestAt: number | null;
  requestId: string;
  source: string | null;
  generationId: number | null;
  responseGenerationId: number;
  protocolVersion: number;
  engineRevision: string | null;
  projectSessionId: string;
  executionStatus: SimulationTimedAdvancePayload['executionStatus'];
  requestedHorizonMicroseconds: number;
  committedHorizonMicroseconds: number;
  continuationHorizonMicroseconds: number | null;
  computeMs: number | null;
  solved: boolean;
  qualityPassed: boolean;
  diagnostics: SimulationTimedAdvancePayload['diagnostics'];
  components: NonNullable<SimulationTimedAdvancePayload['result']>['components'];
  ledTemporal: SimulationTimedAdvancePayload['ledTemporal'] | null;
};
type TemporalPaintRun = {
  first: PaintReceipt;
  lastAt: number;
  frames: number;
  maxGapMs: number;
  witnessAt: number[];
};
type TemporalProbe = {
  frames: TemporalFrame[];
  paintRuns: TemporalPaintRun[];
  paintFrames: Array<{
    at: number;
    brightness: number[];
    imagesReady: boolean;
    startupEvidence?: StartupPaintEvidence;
  }>;
  resetClicks: Array<{ at: number; trusted: boolean }>;
  errors: Array<{ at: number; code: string; requestId: string }>;
  reanchors: NonNullable<ProbeWindow['__ledPlayoutReanchors']>;
};
type TemporalWindow = ProbeWindow & { __ownerTemporal?: TemporalProbe };

async function observeOwnerTemporal(page: Page): Promise<void> {
  await observeRealWorkerAndUi(page, 3);
  await page.addInitScript(() => {
    const probe = window as TemporalWindow;
    const captured: TemporalProbe = {
      frames: [],
      paintRuns: [],
      paintFrames: [],
      resetClicks: [],
      errors: [],
      reanchors: probe.__ledPlayoutReanchors!,
    };
    probe.__ownerTemporal = captured;
    // Capture the complete compact response stream on delivery, independently
    // of the canonical-state history consumed by the generic journeys.
    // No canonical matrix/state is copied or polled for each intermediate frame.
    window.Worker = new Proxy(window.Worker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget) as Worker;
        if ((args[1] as WorkerOptions | undefined)?.name !== 'asa-electronics-simulation')
          return worker;
        const requests = new Map<
          string,
          { at: number; source: string; generationId: number; engineRevision: string }
        >();
        const post = worker.postMessage.bind(worker);
        worker.postMessage = ((...args: unknown[]) => {
          const request = args[0] as {
            kind?: string;
            requestId: string;
            generationId: number;
            engineRevision: string;
            document?: SchematicDocument;
          };
          if (request.kind === 'advance')
            requests.set(request.requestId, {
              at: performance.now(),
              source: String(
                request.document?.components.find((row) => row.id === 'uno')?.stateProperties?.[
                  'arduinoSource'
                ] ?? '',
              ),
              generationId: request.generationId,
              engineRevision: request.engineRevision,
            });
          Reflect.apply(post, worker, args);
        }) as Worker['postMessage'];
        worker.addEventListener('message', (event: MessageEvent) => {
          const response = event.data as {
            ok: boolean;
            kind?: string;
            code?: string;
            requestId: string;
            generationId: number;
            protocolVersion: number;
            projectSessionId: string;
            advance?: SimulationTimedAdvancePayload;
            metrics?: { computeMs?: number };
          };
          const request = requests.get(response.requestId);
          requests.delete(response.requestId);
          if (!response.ok) {
            captured.errors.push({
              at: performance.now(),
              requestId: response.requestId,
              code: response.code ?? 'unknown',
            });
            return;
          }
          if (response.kind !== 'advance' || !response.advance) return;
          const advance = response.advance;
          captured.frames.push({
            at: performance.now(),
            requestAt: request?.at ?? null,
            requestId: response.requestId,
            source: request?.source ?? null,
            generationId: request?.generationId ?? null,
            responseGenerationId: response.generationId,
            protocolVersion: response.protocolVersion,
            engineRevision: request?.engineRevision ?? null,
            projectSessionId: response.projectSessionId,
            executionStatus: advance.executionStatus,
            requestedHorizonMicroseconds: advance.requestedHorizonMicroseconds,
            committedHorizonMicroseconds: advance.committedHorizonMicroseconds,
            continuationHorizonMicroseconds:
              advance.state.continuation?.committedHorizonMicroseconds ?? null,
            computeMs: response.metrics?.computeMs ?? null,
            solved: advance.result?.solved === true,
            qualityPassed: advance.result?.quality?.passed === true,
            diagnostics: advance.diagnostics,
            components:
              advance.result?.components.filter((row) => /^led[0-2]$/.test(row.componentId)) ?? [],
            ledTemporal: advance.ledTemporal ?? null,
          });
        });
        return worker;
      },
    });
    document.addEventListener(
      'click',
      (event) => {
        if ((event.target as Element | null)?.closest('[data-testid="arduino-reset-button"]'))
          captured.resetClicks.push({ at: performance.now(), trusted: event.isTrusted });
      },
      true,
    );
    let seenAt = -1;
    let signature = '';
    const collectPaint = () => {
      const row = probe.__ownerPaint?.at(-1);
      if (row && row.at > seenAt) {
        seenAt = row.at;
        captured.paintFrames.push({
          at: row.at,
          brightness: row.brightness,
          startupEvidence: row.startupEvidence,
          imagesReady:
            row.images.length === 3 &&
            row.images.every(
              (image, index) =>
                image.decoded &&
                image.visible &&
                image.unoccluded &&
                image.opacity === 1 &&
                image.lit === row.brightness[index]! > 0,
            ),
        });
        if (row.stablePreviousFrame && row.previousFrameAt !== null) {
          const next = JSON.stringify([row.brightness, row.images]);
          const previous = captured.paintRuns.at(-1);
          if (previous && next === signature) {
            previous.maxGapMs = Math.max(previous.maxGapMs, row.previousFrameAt - previous.lastAt);
            previous.lastAt = row.previousFrameAt;
            previous.frames++;
            previous.witnessAt.push(row.previousFrameAt);
          } else {
            captured.paintRuns.push({
              first: row,
              lastAt: row.previousFrameAt,
              frames: 1,
              maxGapMs: 0,
              witnessAt: [row.previousFrameAt],
            });
          }
          signature = next;
        }
      }
      requestAnimationFrame(collectPaint);
    };
    requestAnimationFrame(collectPaint);
  });
}

async function openOwnerTemporalSketch(
  page: Page,
  source: string,
  name: string,
  document: SchematicDocument = threeLedFixture(),
) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await observeOwnerTemporal(page);
  await loginWithOrganization(page, teacher);
  const origin = new URL(page.url()).origin;
  const created = await page.context().request.post('/api/projects', {
    headers: { origin, 'idempotency-key': crypto.randomUUID() },
    data: { scope: 'personal', classroomId: null, module: 'electronics', title: `R18 ${name}` },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { project: { id: string } }).project.id;
  const endpoint = `/api/projects/${id}`;
  const read = async () => {
    const response = await page.context().request.get(endpoint, { headers: { origin } });
    expect(response.status()).toBe(200);
    return response.json() as Promise<{
      draft: { revision: number; updatedAt: string; document: SchematicDocument };
    }>;
  };
  const initial = await read();
  const seeded = await page.context().request.put(`${endpoint}/draft`, {
    headers: { origin },
    data: { document, baseRevision: initial.draft.revision, mutationId: crypto.randomUUID() },
  });
  expect(seeded.status()).toBe(200);
  const before = await read();
  await page.goto(`/#/home/${id}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
  await page.locator('.arduino-source-editor textarea').fill(source);
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${endpoint}/draft` &&
      response.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
  expect((await response).status()).toBe(200);
  const saved = await read();
  expect(saved.draft.document).toEqual({
    ...before.draft.document,
    components: before.draft.document.components.map((row) =>
      row.id === 'uno'
        ? { ...row, stateProperties: { ...row.stateProperties, arduinoSource: source } }
        : row,
    ),
  });
  expect(saved.draft.revision).toBe(before.draft.revision + 1);
  await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
  await expect(page.locator('.arduino-code-panel')).toHaveClass(/closed/);
  const startAt = await page.evaluate(() => {
    const probe = window as TemporalWindow;
    probe.__bitwiseWorker!.length = 0;
    probe.__bitwiseUi!.length = 0;
    probe.__ownerPaint!.length = 0;
    const temporal = probe.__ownerTemporal!;
    temporal.frames.length = 0;
    temporal.paintRuns.length = 0;
    temporal.paintFrames.length = 0;
    temporal.resetClicks.length = 0;
    temporal.errors.length = 0;
    temporal.reanchors.length = 0;
    return performance.now();
  });
  return { source, name, before, saved, startAt, read, failures };
}

async function temporalObservation(page: Page) {
  return page.evaluate(() => (window as TemporalWindow).__ownerTemporal!);
}

async function retainOwnerTemporalEvidence(
  page: Page,
  session: Awaited<ReturnType<typeof openOwnerTemporalSketch>>,
  metrics: unknown,
): Promise<void> {
  const raw = await observation(page);
  const temporal = await temporalObservation(page);
  const path = resolve(artifactRoot, `owner-r18-${session.name}-raw.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        source: session.source,
        sourceSha256: createHash('sha256').update(session.source).digest('hex'),
        startAt: session.startAt,
        collectedAt: await page.evaluate(() => performance.now()),
        before: session.before,
        saved: session.saved,
        metrics,
        temporal,
        ...raw,
      },
      null,
      2,
    ) + '\n',
  );
  await test
    .info()
    .attach(`owner-r18-${session.name}-raw`, { path, contentType: 'application/json' });
  // Native pixels are captured only after the timing records have been frozen.
  const screenshot = resolve(artifactRoot, `owner-r18-${session.name}-frame.png`);
  await page.screenshot({ path: screenshot });
  await test.info().attach(`owner-r18-${session.name}-frame`, {
    path: screenshot,
    contentType: 'image/png',
  });
}

async function waitForTemporalHorizon(page: Page, source: string, horizon: number) {
  // Each poll retains the existing default five-second assertion deadline. The
  // slow case observes two successive four-second cycles, within the unchanged
  // default 30-second case budget; it does not lengthen an old case or timeout.
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ source, horizon }) =>
            ((window as TemporalWindow).__ownerTemporal?.frames
              .filter((row) => row.source === source && row.executionStatus === 'ready')
              .at(-1)?.committedHorizonMicroseconds ?? 0) >= horizon,
          { source, horizon },
        ),
      { intervals: [100] },
    )
    .toBe(true);
}

async function waitForOwnerMillisHorizon(page: Page, source: string): Promise<void> {
  const ledger = ownerQualificationLedger;
  assertOwnerQualificationIdentity(ledger, test.info().title);
  const waitStartedAt = await page.evaluate(() => performance.now());
  try {
    if (ledger.profile === 'classroom-d13-v2') {
      // A distinct, selected acquisition budget, not a caught strict failure.
      // Only this millis acquisition receives 45 s; its later 250 ms, physical,
      // phase, image and lifecycle assertions remain unchanged and binding.
      await expect
        .poll(
          () =>
            page.evaluate(
              (source) =>
                ((window as TemporalWindow).__ownerTemporal?.frames
                  .filter((row) => row.source === source && row.executionStatus === 'ready')
                  .at(-1)?.committedHorizonMicroseconds ?? 0) >= 2_250_000,
              source,
            ),
          { intervals: [100], timeout: 45_000 },
        )
        .toBe(true);
    } else {
      await waitForTemporalHorizon(page, source, 2_250_000);
    }
  } finally {
    const observed = await page.evaluate(
      (source) => ({
        observedAt: performance.now(),
        readyTimestamps: ((window as TemporalWindow).__ownerTemporal?.frames ?? [])
          .filter((row) => row.source === source && row.executionStatus === 'ready')
          .map((row) => ({
            at: row.at,
            committedHorizonMicroseconds: row.committedHorizonMicroseconds,
          })),
      }),
      source,
    );
    recordOwnerMillisAcquisition(
      ledger,
      test.info().title,
      createHash('sha256').update(source).digest('hex'),
      waitStartedAt,
      observed.observedAt,
      observed.readyTimestamps,
    );
  }
}

test('Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await observeOwnerTemporal(page);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await loginWithOrganization(page, teacher);
  const origin = new URL(page.url()).origin;
  const created = await page.context().request.post('/api/projects', {
    headers: { origin, 'idempotency-key': crypto.randomUUID() },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title: 'Arduino Blockly optical timing',
    },
  });
  expect(created.status()).toBe(201);
  const id = ((await created.json()) as { project: { id: string } }).project.id;
  const endpoint = `/api/projects/${id}`;
  const read = async () => {
    const response = await page.context().request.get(endpoint, { headers: { origin } });
    expect(response.status()).toBe(200);
    return response.json() as Promise<{ draft: { revision: number; document: SchematicDocument } }>;
  };
  const initial = await read();
  // Seed only the existing electrical fixture. The pupil's programme is created
  // by the production mode switch/default blocks and edited through visible fields.
  const circuit = threeLedFixture();
  expect(
    circuit.components.find((row) => row.id === 'uno')!.stateProperties!['arduinoWorkspace'],
  ).toBe('');
  const seeded = await page.context().request.put(`${endpoint}/draft`, {
    headers: { origin },
    data: {
      document: circuit,
      baseRevision: initial.draft.revision,
      mutationId: crypto.randomUUID(),
    },
  });
  expect(seeded.status()).toBe(200);
  await page.goto(`/#/home/${id}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
  await page.locator('.arduino-mode-menu summary').click();
  await page.getByRole('button', { name: 'Блоки с текстом', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Продолжить?', exact: true })
    .getByRole('button', { name: 'Продолжить', exact: true })
    .click();
  const workspace = page.getByTestId('arduino-block-workspace');
  const canvas = workspace.locator(
    ':scope > .injectionDiv > svg.blocklySvg > .blocklyWorkspace > .blocklyBlockCanvas',
  );
  const waits = await canvas
    .locator('text.blocklyText')
    .filter({ hasText: /^ожидать$/ })
    .evaluateAll((nodes) =>
      nodes.map((node) => node.closest('[data-id]')!.getAttribute('data-id')!),
    );
  expect(waits).toHaveLength(2);
  const generated = page.getByRole('textbox', { name: 'Сгенерированный код Arduino', exact: true });
  await expect(generated).toHaveAttribute('readonly');
  const receipts: unknown[] = [];
  for (const half of [100, 50, 1]) {
    if (half !== 100)
      await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
    for (const blockId of waits) {
      const block = canvas.locator(`[data-id="${blockId}"]`);
      await block.locator('.blocklyTextInputField').first().dblclick();
      const input = page.locator('input.blocklyHtmlInput');
      await expect(input).toBeVisible();
      await input.fill(String(half));
      await input.press('Enter');
      if (half === 100) {
        await block.locator('.blocklyDropdownField').first().click();
        await page
          .locator('.blocklyDropDownDiv, .blocklyWidgetDiv')
          .getByText('мс', { exact: true })
          .click();
      }
    }
    await expect
      .poll(
        async () =>
          (await generated.inputValue()).match(new RegExp(`delay\\(${half}\\);`, 'g'))?.length ?? 0,
        { intervals: [100] },
      )
      .toBe(2);
    const source = await generated.inputValue();
    expect(source).toContain('digitalWrite(LED_BUILTIN, HIGH);');
    expect(source).toContain('digitalWrite(LED_BUILTIN, LOW);');
    const before = await read();
    const saving = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${endpoint}/draft` &&
        response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Сохранить проект', exact: true }).click();
    expect((await saving).status()).toBe(200);
    const saved = await read();
    const properties = saved.draft.document.components.find(
      (row) => row.id === 'uno',
    )!.stateProperties!;
    expect(properties['arduinoSource']).toBe(source);
    expect(properties['arduinoCodeMode']).toBe('blocks-text');
    const workspaceJson = String(properties['arduinoWorkspace']);
    const waitFields: Array<{ TIME: unknown; UNIT: unknown }> = [];
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      if (row['type'] === 'asa_wait')
        waitFields.push(row['fields'] as { TIME: unknown; UNIT: unknown });
      Object.values(row).forEach(inspect);
    };
    inspect(JSON.parse(workspaceJson));
    expect(waitFields.map((fields) => [Number(fields.TIME), fields.UNIT])).toEqual([
      [half, 'MILLISECONDS'],
      [half, 'MILLISECONDS'],
    ]);
    expect(saved.draft.revision).toBeGreaterThanOrEqual(before.draft.revision);
    await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
    const startAt = await page.evaluate(() => {
      const temporal = (window as TemporalWindow).__ownerTemporal!;
      for (const rows of Object.values(temporal)) rows.length = 0;
      return performance.now();
    });
    let raw: TemporalProbe | undefined;
    try {
      await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
      await waitForTemporalHorizon(page, source, 1_000_000);
      raw = await temporalObservation(page);
      const ready = assertTemporalFrames(raw, source);
      if (ownerV3Ledger)
        assertOwnerV3TemporalClock(
          ready,
          1000,
          `blockly-${half}-temporal-wall-model`,
          source,
          `blockly-${half}`,
          { halfMs: half, stageOrder: [100, 50, 1] },
        );
      else assertTemporalWallClock(ready, 1000);
      const edges = opticalEdges(ready, 'led0');
      const paint = validTemporalPaint(raw, startAt);
      expect(paint.length).toBeGreaterThan(0);
      expect(
        raw.paintFrames.filter((row) => row.at >= startAt).every((row) => row.imagesReady),
      ).toBe(true);
      if (half > 1) {
        const model = blinkWallMetrics(edges, half);
        const visible = blinkWallMetrics(paintEdges(paint, 0), half);
        expect(model.cycles).toBeGreaterThanOrEqual(4);
        expect(visible.cycles).toBeGreaterThanOrEqual(4);
        if (ownerV3Ledger)
          recordOwnerV3Timing(
            ownerV3Ledger,
            test.info().title,
            `blockly-${half}-paint-half-durations`,
            ownerV3TemporalProvenance(ready, source, `blockly-${half}`, {
              halfMs: half,
              ledIndex: 0,
            }),
            visible.halves,
          );
        else expect(visible.halfBoundsPassed).toBe(true);
        expect(visible.duty).toBeGreaterThanOrEqual(0.45);
        expect(visible.duty).toBeLessThanOrEqual(0.55);
        expect(
          temporalPaintCausality(raw, source, ready[0]!.generationId!, startAt).violations,
        ).toEqual([]);
      } else {
        const first = edges.findIndex((row) => row.level === 1 && row.at >= 100);
        const last = edges.findLastIndex((row) => row.level === 1);
        const energy = opticalIntegral(ready, 'led0', edges[first]!.at, edges[last]!.at);
        const mean = energy.integral / energy.durationMicroseconds;
        expect((last - first) / 2).toBeGreaterThanOrEqual(400);
        const settledAt = ready.find((row) => row.committedHorizonMicroseconds >= 100_000)!.at;
        const rendered = raw.paintFrames.filter((row) => row.at >= settledAt);
        expect(rendered.length).toBeGreaterThanOrEqual(30);
        expect(rendered.every((row) => Math.abs(row.brightness[0]! - Math.round(mean)) <= 1)).toBe(
          true,
        );
      }
    } finally {
      raw ??= await temporalObservation(page);
      receipts.push({ half, source, before, saved, startAt, raw });
      writeFileSync(
        resolve(artifactRoot, 'owner-blockly-wait-edits-raw.json'),
        JSON.stringify(receipts, null, 2) + '\n',
      );
      await page.screenshot({ path: resolve(artifactRoot, `owner-blockly-${half}ms-frame.png`) });
    }
    await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
    expect((await read()).draft).toEqual(saved.draft);
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      await context.addCookies(await page.context().cookies());
      const reopened = await context.newPage();
      await reopened.goto(`${origin}/#/home/${id}`);
      await expect(reopened.locator('.workbench-stage')).toBeVisible();
      await reopened.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
      await expect(
        reopened.getByRole('textbox', { name: 'Сгенерированный код Arduino', exact: true }),
      ).toHaveValue(source);
      for (const blockId of waits) {
        await expect(
          reopened
            .getByTestId('arduino-block-workspace')
            .locator(`[data-id="${blockId}"] .blocklyTextInputField`)
            .first(),
        ).toHaveText(String(half));
        await expect(
          reopened
            .getByTestId('arduino-block-workspace')
            .locator(`[data-id="${blockId}"] .blocklyDropdownField`)
            .first(),
        ).toHaveText('мс');
      }
      expect((await read()).draft).toEqual(saved.draft);
    } finally {
      await context.close();
    }
  }
  failures.assertEmpty();
});

function assertTemporalFrames(raw: TemporalProbe, source: string, generationId?: number) {
  expect(raw.reanchors).toEqual([]);
  const frames = raw.frames.filter(
    (row) =>
      row.source === source && (generationId === undefined || row.generationId === generationId),
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(raw.errors.filter((row) => row.code !== 'cancelled')).toEqual([]);
  const ready = frames.filter((row) => row.executionStatus === 'ready');
  expect(ready.length).toBeGreaterThanOrEqual(8);
  // Check every receipt/sample, but report violations together. Tens of
  // thousands of individual Playwright steps would consume the unchanged case
  // budget after an otherwise complete eight-second physical observation.
  const violations: string[] = [];
  const check = (valid: boolean, location: string) => {
    if (!valid && violations.length < 30) violations.push(location);
  };
  let previous: TemporalFrame | undefined;
  for (const frame of frames) {
    const id = frame.requestId;
    check(frame.executionStatus !== 'fault', `${id}: fault`);
    check(frame.generationId === frame.responseGenerationId, `${id}: generation`);
    check(frame.protocolVersion === 2, `${id}: protocol`);
    check(/^asa-electronics-solver-v\d+$/.test(frame.engineRevision ?? ''), `${id}: engine`);
    check(frame.projectSessionId.length > 0, `${id}: session`);
    check(frame.requestAt !== null && frame.at >= frame.requestAt, `${id}: request clock`);
    check(
      frame.computeMs !== null && Number.isFinite(frame.computeMs) && frame.computeMs >= 0,
      `${id}: compute`,
    );
    if (frame.executionStatus === 'yielded') {
      check(
        frame.components.length === 0 && !frame.solved && frame.ledTemporal === null,
        `${id}: yielded optical publication`,
      );
      continue;
    }
    check(frame.solved && frame.qualityPassed && frame.diagnostics.length === 0, `${id}: quality`);
    check(
      frame.committedHorizonMicroseconds === frame.requestedHorizonMicroseconds,
      `${id}: incomplete ready`,
    );
    check(
      frame.continuationHorizonMicroseconds === frame.committedHorizonMicroseconds,
      `${id}: continuation clock`,
    );
    const optical = frame.ledTemporal;
    check(optical !== null, `${id}: missing temporal metadata`);
    if (!optical) continue;
    check(optical.profile === 'ordinary-led-held-v1', `${id}: optical profile`);
    check(optical.toMicroseconds === frame.committedHorizonMicroseconds, `${id}: optical horizon`);
    if (previous?.generationId === frame.generationId)
      check(
        optical.fromMicroseconds === previous.committedHorizonMicroseconds,
        `${id}: optical continuity`,
      );
    check(
      optical.components
        .map((row) => row.componentId)
        .sort()
        .join(',') === 'led0,led1,led2',
      `${id}: component identity`,
    );
    for (const led of optical.components) {
      const at = `${id}/${led.componentId}`;
      check(!led.truncated && led.samples.length > 0, `${at}: missing/truncated samples`);
      if (!led.samples.length) continue;
      check(led.samples[0]!.atMicroseconds === optical.fromMicroseconds, `${at}: first sample`);
      check(led.samples.at(-1)!.atMicroseconds === optical.toMicroseconds, `${at}: final sample`);
      let integral = 0;
      let litDuration = 0;
      let transitions = 0;
      for (let index = 0; index < led.samples.length; index++) {
        const sample = led.samples[index]!;
        check(sample.brightness >= 0 && sample.brightness <= 100, `${at}/${index}: brightness`);
        check(
          sample.brightness > 0
            ? sample.current > 0.001 && sample.current < 0.02
            : Math.abs(sample.current) < 0.000001,
          `${at}/${index}: physical current`,
        );
        const next = led.samples[index + 1];
        if (!next) continue;
        const duration = next.atMicroseconds - sample.atMicroseconds;
        check(Number.isSafeInteger(duration) && duration > 0, `${at}/${index}: duration`);
        integral += sample.brightness * duration;
        if (sample.brightness > 0) litDuration += duration;
        if (sample.brightness !== next.brightness) transitions++;
      }
      check(
        Math.abs(led.brightnessIntegral - integral) < 0.000005,
        `${at}: nonlinear optical integral`,
      );
      check(led.litDurationMicroseconds === litDuration, `${at}: lit duration`);
      check(led.transitionCount === transitions, `${at}: transition count`);
      const final = frame.components.find((row) => row.componentId === led.componentId);
      check(
        !!final &&
          final.brightness === led.samples.at(-1)!.brightness &&
          final.current === led.samples.at(-1)!.current &&
          final.stressState !== 'burned',
        `${at}: final physical state`,
      );
    }
    previous = frame;
  }
  expect(violations, 'actual Worker/optical receipt contract violations').toEqual([]);
  return ready;
}

function opticalEdges(ready: readonly TemporalFrame[], componentId: string) {
  const edges: Array<{ at: number; level: number; brightness: number; current: number }> = [];
  for (const frame of ready)
    for (const sample of frame.ledTemporal!.components.find(
      (row) => row.componentId === componentId,
    )!.samples) {
      const level = Number(sample.brightness > 0);
      if (edges.at(-1)?.level !== level)
        edges.push({
          at: sample.atMicroseconds / 1000,
          level,
          brightness: sample.brightness,
          current: sample.current,
        });
    }
  return edges;
}

function opticalIntegral(
  ready: readonly TemporalFrame[],
  componentId: string,
  fromMs: number,
  toMs: number,
) {
  let integral = 0;
  let durationMicroseconds = 0;
  let litMicroseconds = 0;
  for (const frame of ready) {
    const samples = frame.ledTemporal!.components.find(
      (row) => row.componentId === componentId,
    )!.samples;
    for (let index = 1; index < samples.length; index++) {
      const previous = samples[index - 1]!;
      const duration = Math.max(
        0,
        Math.min(toMs * 1000, samples[index]!.atMicroseconds) -
          Math.max(fromMs * 1000, previous.atMicroseconds),
      );
      integral += previous.brightness * duration;
      durationMicroseconds += duration;
      if (previous.brightness > 0) litMicroseconds += duration;
    }
  }
  return { integral, durationMicroseconds, litMicroseconds };
}

function validTemporalPaint(raw: TemporalProbe, from: number, to = Infinity) {
  return raw.paintRuns.filter((run) => {
    const row = run.first;
    return (
      row.previousFrameAt !== null &&
      run.lastAt >= from &&
      row.previousFrameAt <= to &&
      row.brightness.length === 3 &&
      row.images.length === 3 &&
      row.images.every(
        (image, index) =>
          image.decoded &&
          image.visible &&
          image.unoccluded &&
          image.opacity === 1 &&
          image.lit === row.brightness[index]! > 0,
      )
    );
  });
}

function paintEdges(runs: readonly TemporalPaintRun[], index: number) {
  const edges: Array<{ at: number; level: number }> = [];
  for (const run of runs) {
    const level = Number(run.first.brightness[index]! > 0);
    if (edges.at(-1)?.level !== level) edges.push({ at: run.first.previousFrameAt!, level });
  }
  return edges;
}

// This publication allowance is independent of the 250 ms model/wall bound.
// It permits React/RAF handoff, but never an earlier cycle or another generation.
const OWNER_TEMPORAL_PUBLICATION_LAG_MS = 50;

function temporalPhysicalBrightness(frame: TemporalFrame): number[] {
  return ['led0', 'led1', 'led2'].map((id) => {
    const value = frame.components.find((row) => row.componentId === id)?.brightness;
    return typeof value === 'number' ? Math.round(Math.max(0, Math.min(100, value))) : NaN;
  });
}

function temporalJointWitness(
  frame: TemporalFrame,
  brightness: readonly number[],
): number | undefined {
  const to = frame.committedHorizonMicroseconds;
  const ids = ['led0', 'led1', 'led2'];
  const electrical = ids.map((id) => frame.components.find((row) => row.componentId === id));
  if (
    brightness.length !== ids.length ||
    frame.executionStatus !== 'ready' ||
    !frame.solved ||
    !frame.qualityPassed ||
    frame.generationId === null ||
    !Number.isSafeInteger(frame.generationId) ||
    frame.responseGenerationId !== frame.generationId ||
    !Number.isSafeInteger(to) ||
    to < 0 ||
    frame.requestedHorizonMicroseconds !== to ||
    frame.continuationHorizonMicroseconds !== to ||
    electrical.some(
      (row) =>
        !row ||
        !Number.isFinite(row.brightness) ||
        row.presentationState === 'failed' ||
        row.deviceHealth === 'failed_open' ||
        row.damageState === 'failed',
    )
  )
    return undefined;
  if (temporalPhysicalBrightness(frame).every((value, index) => value === brightness[index]))
    return to;
  const observation = frame.ledTemporal;
  if (
    !observation ||
    observation.profile !== 'ordinary-led-held-v1' ||
    observation.toMicroseconds !== to ||
    !Number.isSafeInteger(observation.fromMicroseconds) ||
    observation.fromMicroseconds < 0 ||
    observation.fromMicroseconds > to
  )
    return undefined;
  const channels = ids.map((id) => observation.components.find((row) => row.componentId === id));
  if (
    channels.some((channel, index) => {
      if (!channel || channel.samples.length < 1 || channel.samples.length > 513) return true;
      const samples = channel.samples;
      return (
        (!channel.truncated && samples[0]!.atMicroseconds !== observation.fromMicroseconds) ||
        samples.at(-1)!.atMicroseconds !== to ||
        samples.at(-1)!.brightness !== electrical[index]!.brightness ||
        samples.at(-1)!.current !== electrical[index]!.current ||
        samples.some(
          (sample, sampleIndex) =>
            !Number.isSafeInteger(sample.atMicroseconds) ||
            sample.atMicroseconds < observation.fromMicroseconds ||
            sample.atMicroseconds > to ||
            !Number.isFinite(sample.brightness) ||
            sample.brightness < 0 ||
            sample.brightness > 100 ||
            !Number.isFinite(sample.current) ||
            (sample.brightness > 0 && sample.current <= 0) ||
            (sampleIndex > 0 && samples[sampleIndex - 1]!.atMicroseconds >= sample.atMicroseconds),
        )
      );
    })
  )
    return undefined;
  const start = Math.max(...channels.map((channel) => channel!.samples[0]!.atMicroseconds));
  const times = new Set<number>([start]);
  for (const channel of channels)
    for (const sample of channel!.samples)
      if (sample.atMicroseconds >= start) times.add(sample.atMicroseconds);
  const indices = channels.map(() => 0);
  // Independent oracle: visit the union of real change times, and inspect all
  // held electrical channels at that ONE time inside this completed request.
  for (const at of [...times].sort((left, right) => left - right)) {
    const joint = channels.map((channel, index) => {
      const samples = channel!.samples;
      while (
        indices[index]! + 1 < samples.length &&
        samples[indices[index]! + 1]!.atMicroseconds <= at
      )
        indices[index] = indices[index]! + 1;
      return Math.round(samples[indices[index]!]!.brightness);
    });
    if (joint.every((value, index) => value === brightness[index])) return at;
  }
  return undefined;
}

function temporalStartupBoundary(
  raw: TemporalProbe,
  ready: readonly TemporalFrame[],
  source: string,
  generationId: number,
  from: number,
  to: number,
) {
  const first = ready[0];
  const initial =
    first &&
    Number.isFinite(first.at) &&
    first.requestAt !== null &&
    Number.isFinite(first.requestAt) &&
    first.requestAt >= 0 &&
    first.requestAt <= first.at &&
    first.committedHorizonMicroseconds === 0 &&
    temporalJointWitness(first, [0, 0, 0]) === 0
      ? first
      : null;
  const violations: Array<{ at: number; brightness: number[]; reason: string }> = [];
  if (!initial)
    violations.push({
      at: from,
      brightness: [],
      reason: 'initial electrical H0 is missing or invalid',
    });
  // Keep every compact RAF sample, including unstable/unready ones. Historical
  // records without this joint native LED/L/header witness cannot become PASS.
  const frames = (raw.paintFrames ?? [])
    .filter((row) => row.at >= from && row.at <= to && (!initial || row.at < initial.at))
    .map((row) => {
      const evidence = row.startupEvidence;
      const active = raw.frames
        .filter((frame) => frame.requestAt !== null && frame.requestAt <= row.at)
        .reduce<TemporalFrame | undefined>(
          (latest, frame) => (!latest || frame.requestAt! > latest.requestAt! ? frame : latest),
          undefined,
        );
      let reason: string | null = null;
      if (!initial) reason = 'initial electrical H0 is missing or invalid';
      else if (active && (active.source !== source || active.generationId !== generationId))
        reason = 'foreign source or inactive generation before H0';
      else if (
        raw.frames.some(
          (frame) => frame.executionStatus === 'ready' && frame.at >= from && frame.at <= row.at,
        )
      )
        reason = 'electrical ready state already received before initial H0';
      else if (!evidence) reason = 'insufficient native LED/L/header startup evidence';
      else if (
        row.brightness.length !== 3 ||
        row.brightness.some((value) => value !== 0) ||
        !row.imagesReady ||
        evidence.ledHrefs.length !== 3 ||
        evidence.ledHrefs.some((href) => !/_i000\.svg(?:\?|$)/.test(href))
      )
        reason = 'native LEDs are not completely dark and ready before H0';
      else if (!(
        (evidence.simulationStatus === 'stopped' && evidence.timeText === '') ||
        (evidence.simulationStatus === 'starting' &&
          evidence.timeText.replace(/\s+/g, ' ').trim() === 'Время моделирования: 00:00:00')
      ))
        reason = 'modeled status or nonzero/unknown advertised clock before H0';
      else if (
        !evidence.board ||
        !evidence.board.href ||
        evidence.board.mountedLoadAt === null ||
        !Number.isFinite(evidence.board.mountedLoadAt) ||
        evidence.board.mountedLoadAt < 0 ||
        evidence.board.mountedLoadAt > row.at ||
        !evidence.board.visible ||
        !evidence.board.unoccluded ||
        evidence.board.opacity !== 1 ||
        !evidence.l ||
        evidence.l.activeAttribute !== 'false' ||
        evidence.l.opacity !== 0 ||
        !evidence.l.visible
      )
        reason = 'native board/L is not completely dark and ready before H0';
      if (reason) violations.push({ at: row.at, brightness: row.brightness, reason });
      return {
        at: row.at,
        brightness: row.brightness,
        status: reason ? 'FAIL' : 'DARK_STARTUP',
        reason,
      };
    });
  return {
    h0ReadyAt: initial?.at ?? null,
    h0RequestId: initial?.requestId ?? null,
    frames,
    violations,
  };
}

function temporalPaintCausality(
  raw: TemporalProbe,
  source: string,
  generationId: number,
  from: number,
  to = Infinity,
) {
  const ready = raw.frames.filter(
    (row) =>
      row.source === source &&
      row.generationId === generationId &&
      row.responseGenerationId === generationId &&
      row.executionStatus === 'ready' &&
      row.solved &&
      row.qualityPassed &&
      row.committedHorizonMicroseconds === row.requestedHorizonMicroseconds,
  );
  const witnesses: Array<{
    at: number;
    brightness: number[];
    requestId: string;
    generationId: number;
    committedHorizonMicroseconds: number;
    modelTimeMicroseconds: number;
    readyAt: number;
    supersededAt: number | null;
  }> = [];
  const startup = temporalStartupBoundary(raw, ready, source, generationId, from, to);
  const startupByAt = new Map(startup.frames.map((row) => [row.at, row]));
  const violations: Array<{ at: number; brightness: number[]; reason: string }> = [
    ...startup.violations,
  ];
  for (const run of validTemporalPaint(raw, from, to)) {
    for (const at of run.witnessAt.filter((at) => at >= from && at <= to)) {
      const brightness = run.first.brightness;
      if (startup.h0ReadyAt !== null && at < startup.h0ReadyAt) {
        const row = startupByAt.get(at);
        if (!row || row.brightness.some((value, index) => value !== brightness[index]))
          violations.push({
            at,
            brightness,
            reason: 'missing or mismatched same-RAF startup witness',
          });
        // The row was explicitly assessed above; it is not an electrical witness.
        continue;
      }
      // Use the actual request clock to establish the active generation. A late
      // old-generation response cannot become current merely by arriving last.
      const active = raw.frames
        .filter((row) => row.requestAt !== null && row.requestAt <= at)
        .reduce<TemporalFrame | undefined>(
          (latest, row) => (!latest || row.requestAt! > latest.requestAt! ? row : latest),
          undefined,
        );
      if (active?.source !== source || active.generationId !== generationId) {
        violations.push({ at, brightness, reason: 'foreign source or inactive generation' });
        continue;
      }
      const available = ready.filter((row) => row.at <= at);
      const matching = available.findLastIndex(
        (row) => temporalJointWitness(row, brightness) !== undefined,
      );
      if (matching < 0) {
        violations.push({ at, brightness, reason: 'no causally preceding electrical state' });
        continue;
      }
      // A completed window can witness a real intermediate joint state. If its
      // closing vector differs, supersession is already visible on THIS receipt.
      const frame = available[matching]!;
      const finalMatches = temporalPhysicalBrightness(frame).every(
        (value, index) => value === brightness[index],
      );
      const supersededAt = finalMatches ? (available[matching + 1]?.at ?? null) : frame.at;
      if (supersededAt !== null && at - supersededAt > OWNER_TEMPORAL_PUBLICATION_LAG_MS) {
        violations.push({
          at,
          brightness,
          reason: 'electrical state superseded more than 50 ms ago',
        });
        continue;
      }
      witnesses.push({
        at,
        brightness,
        requestId: frame.requestId,
        generationId,
        committedHorizonMicroseconds: frame.committedHorizonMicroseconds,
        modelTimeMicroseconds: temporalJointWitness(frame, brightness)!,
        readyAt: frame.at,
        supersededAt,
      });
    }
  }
  return { witnesses, violations, startup };
}

function resetSetupPaintViolations(
  raw: TemporalProbe,
  from: number,
  to: number,
  brightness: readonly number[],
) {
  const frames = raw.paintFrames.filter((row) => row.at >= from && row.at < to);
  return {
    frames,
    violations: frames.filter(
      (row) =>
        !row.imagesReady ||
        row.brightness.length !== 3 ||
        row.brightness.some((value, index) => value !== brightness[index]),
    ),
  };
}

function assertTemporalWallClock(
  ready: readonly TemporalFrame[],
  minimumModelMs: number,
  qualificationSite?: OwnerQualificationSite,
) {
  const first = ready[0]!;
  const last = ready.at(-1)!;
  const modelMs = (last.committedHorizonMicroseconds - first.committedHorizonMicroseconds) / 1000;
  const wallMs = last.at - first.at;
  expect(first.committedHorizonMicroseconds).toBe(0);
  expect(modelMs).toBeGreaterThanOrEqual(minimumModelMs);
  if (qualificationSite !== undefined)
    recordOwnerQualifiedWallClock(
      ownerQualificationLedger,
      test.info().title,
      qualificationSite,
      modelMs,
      wallMs,
    );
  else expect(Math.abs(modelMs - wallMs)).toBeLessThanOrEqual(250);
  return { first, last, modelMs, wallMs };
}

test('Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles', async ({
  page,
}) => {
  const session = await openOwnerTemporalSketch(page, threeLedSource(2000), 'blink-2000');
  let metrics: unknown;
  try {
    await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    if (ownerV3Ledger) {
      await waitForOwnerV3Horizon(page, session.source, 'delay-2000-ready-horizon-4050000');
      await waitForOwnerV3Horizon(page, session.source, 'delay-2000-ready-horizon-8100000');
    } else {
      await waitForTemporalHorizon(page, session.source, 4_050_000);
      await waitForTemporalHorizon(page, session.source, 8_100_000);
    }
    const raw = await temporalObservation(page);
    const ready = assertTemporalFrames(raw, session.source);
    const clock = ownerV3Ledger
      ? assertOwnerV3TemporalClock(
          ready,
          8100,
          'delay-2000-temporal-wall-model',
          session.source,
          'blink-2000',
          {},
        )
      : assertTemporalWallClock(ready, 8100);
    const painted = validTemporalPaint(raw, session.startAt);
    const causal = temporalPaintCausality(
      raw,
      session.source,
      ready[0]!.generationId!,
      ready[0]!.at,
    );
    expect(causal.witnesses.length).toBeGreaterThan(0);
    expect(causal.violations).toEqual([]);
    const perLed = ['led0', 'led1', 'led2'].map((id, index) => {
      const model = opticalEdges(ready, id);
      const paint = paintEdges(painted, index);
      const modelMetrics = blinkWallMetrics(model, 2000);
      const paintMetrics = blinkWallMetrics(paint, 2000);
      for (const measured of [modelMetrics, paintMetrics]) {
        expect(measured.cycles).toBeGreaterThanOrEqual(2);
        expect(measured.duty).toBeGreaterThanOrEqual(0.45);
        expect(measured.duty).toBeLessThanOrEqual(0.55);
      }
      for (const half of modelMetrics.halves) {
        expect(half).toBeGreaterThanOrEqual(2000);
        expect(half).toBeLessThanOrEqual(2000.01);
      }
      if (ownerV3Ledger)
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `delay-2000-${id}-paint-half-durations`,
          ownerV3TemporalProvenance(ready, session.source, 'blink-2000', {
            ledIndex: index,
            arduinoPin: 13 - index,
          }),
          paintMetrics.halves,
        );
      else
        for (const half of paintMetrics.halves) {
          expect(half).toBeGreaterThanOrEqual(1750);
          expect(half).toBeLessThanOrEqual(2250);
        }
      const highs = paint.filter((row) => row.level === 1);
      const periodMs = (highs.at(-1)!.at - highs[0]!.at) / (highs.length - 1);
      if (ownerV3Ledger)
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `delay-2000-${id}-paint-mean-period`,
          ownerV3TemporalProvenance(ready, session.source, 'blink-2000', {
            ledIndex: index,
            arduinoPin: 13 - index,
          }),
          [periodMs],
        );
      else {
        expect(periodMs).toBeGreaterThanOrEqual(3750);
        expect(periodMs).toBeLessThanOrEqual(4250);
      }
      return { id, model, paint, modelMetrics, paintMetrics, periodMs };
    });
    metrics = { clock, perLed, causal };
    session.failures.assertEmpty();
  } finally {
    await retainOwnerTemporalEvidence(page, session, metrics);
  }
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  expect((await session.read()).draft).toEqual(session.saved.draft);
});

test('Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness', async ({
  page,
}) => {
  const document = threeLedFixture();
  // Real unequal loads expose accidental sharing of one LED's averaged light.
  const loaded = {
    ...document,
    components: document.components.map((row) =>
      /^r[0-2]$/.test(row.id) ? { ...row, value: [330, 680, 1000][Number(row.id.slice(1))]! } : row,
    ),
  };
  const session = await openOwnerTemporalSketch(page, threeLedSource(1), 'blink-1', loaded);
  let metrics: unknown;
  try {
    await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    if (ownerV3Ledger)
      await waitForOwnerV3Horizon(page, session.source, 'delay-1-ready-horizon-1500000');
    else await waitForTemporalHorizon(page, session.source, 1_500_000);
    const raw = await temporalObservation(page);
    const ready = assertTemporalFrames(raw, session.source);
    const clock = ownerV3Ledger
      ? assertOwnerV3TemporalClock(
          ready,
          1500,
          'delay-1-temporal-wall-model',
          session.source,
          'blink-1',
          {},
        )
      : assertTemporalWallClock(ready, 1500, 'delay-1-temporal-wall-model');
    const settledAt = ready.find((row) => row.committedHorizonMicroseconds >= 100_000)!.at;
    const paint = validTemporalPaint(raw, settledAt);
    const rendered = (await page.evaluate(() => (window as ProbeWindow).__ownerPaint ?? [])).filter(
      (row) => row.at >= settledAt,
    );
    expect(paint.length).toBeGreaterThan(0);
    expect(
      paint.at(-1)!.lastAt - Math.max(settledAt, paint[0]!.first.previousFrameAt!),
    ).toBeGreaterThanOrEqual(1000);
    expect(paint.reduce((sum, row) => sum + row.frames, 0)).toBeGreaterThanOrEqual(30);
    expect(rendered.length).toBeGreaterThanOrEqual(30);
    expect(
      rendered.every(
        (row) =>
          row.images.length === 3 &&
          row.images.every(
            (image, index) =>
              image.decoded &&
              image.visible &&
              image.unoccluded &&
              image.opacity === 1 &&
              image.lit === row.brightness[index]! > 0,
          ),
      ),
    ).toBe(true);
    const perLed = ['led0', 'led1', 'led2'].map((id, index) => {
      const edges = opticalEdges(ready, id);
      const firstHigh = edges.findIndex((row) => row.level === 1);
      const lastHigh = edges.findLastIndex((row) => row.level === 1);
      const cycles = edges.slice(firstHigh, lastHigh + 1);
      expect((cycles.length - 1) / 2).toBeGreaterThanOrEqual(500);
      const halves: number[] = [];
      for (let edge = 1; edge < cycles.length; edge++) {
        const previous = cycles[edge - 1]!;
        const duration = cycles[edge]!.at - previous.at;
        halves.push(duration);
      }
      expect(Math.min(...halves)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...halves)).toBeLessThanOrEqual(1.01);
      const span = cycles.at(-1)!.at - cycles[0]!.at;
      // Sum every held optical sample, including amplitude changes within a
      // lit half; binary edge times alone cannot establish nonlinear light.
      const energy = opticalIntegral(ready, id, cycles[0]!.at, cycles.at(-1)!.at);
      expect(energy.durationMicroseconds).toBeCloseTo(span * 1000, 5);
      const meanBrightness = energy.integral / energy.durationMicroseconds;
      const duty = energy.litMicroseconds / energy.durationMicroseconds;
      expect(duty).toBeGreaterThanOrEqual(0.49);
      expect(duty).toBeLessThanOrEqual(0.51);
      // Also challenge single-frame beats which never form a stable two-RAF
      // run. The stable runs independently witness loaded, visible image paint.
      const paintedBrightness = rendered.map((row) => row.brightness[index]!);
      for (const value of paintedBrightness)
        expect(Math.abs(value - Math.round(meanBrightness))).toBeLessThanOrEqual(1);
      expect(Math.max(...paintedBrightness) - Math.min(...paintedBrightness)).toBeLessThanOrEqual(
        1,
      );
      return { id, edges, energy, meanBrightness, duty, paintedBrightness };
    });
    expect(perLed[0]!.meanBrightness).toBeGreaterThan(perLed[1]!.meanBrightness + 1);
    expect(perLed[1]!.meanBrightness).toBeGreaterThan(perLed[2]!.meanBrightness + 1);
    metrics = { clock, settledAt, perLed, paint, rendered };
    session.failures.assertEmpty();
  } finally {
    await retainOwnerTemporalEvidence(page, session, metrics);
  }
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  expect((await session.read()).draft).toEqual(session.saved.draft);
});

const independentlyTimedMillisSource = `unsigned long next13 = 500;
unsigned long next12 = 125;
unsigned long next11 = 50;
bool light13 = HIGH;
bool light12 = LOW;
bool light11 = HIGH;
void setup() {
  pinMode(13, OUTPUT); pinMode(12, OUTPUT); pinMode(11, OUTPUT);
  digitalWrite(13, light13); digitalWrite(12, light12); digitalWrite(11, light11);
}
void loop() {
  unsigned long now = millis();
  if (now >= next13) { next13 += 500; light13 = !light13; digitalWrite(13, light13); }
  if (now >= next12) { next12 += 200; light12 = !light12; digitalWrite(12, light12); }
  if (now >= next11) { next11 += 100; light11 = !light11; digitalWrite(11, light11); }
}`;

test('Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases', async ({
  page,
}) => {
  if (ownerQualificationLedger?.profile === 'classroom-d13-v2') test.setTimeout(60_000);
  const session = await openOwnerTemporalSketch(
    page,
    independentlyTimedMillisSource,
    'millis-independent',
  );
  let metrics: unknown;
  try {
    await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    if (ownerV3Ledger)
      await waitForOwnerV3Horizon(page, session.source, 'millis-ready-horizon-2250000');
    else await waitForOwnerMillisHorizon(page, session.source);
    const raw = await temporalObservation(page);
    const ready = assertTemporalFrames(raw, session.source);
    const clock = ownerV3Ledger
      ? assertOwnerV3TemporalClock(
          ready,
          2250,
          'millis-temporal-wall-model',
          session.source,
          'millis-independent',
          {},
        )
      : assertTemporalWallClock(ready, 2250);
    const paint = validTemporalPaint(raw, session.startAt);
    const causal = temporalPaintCausality(
      raw,
      session.source,
      ready[0]!.generationId!,
      ready[0]!.at,
    );
    expect(causal.witnesses.length).toBeGreaterThan(0);
    expect(causal.violations).toEqual([]);
    const firstRunning = ready.find((row) => row.committedHorizonMicroseconds >= 10_000)!;
    expect(firstRunning.components.map((row) => Number((row.brightness ?? 0) > 0))).toEqual([
      1, 0, 1,
    ]);
    const perLed = [500, 200, 100].map((halfMs, index) => {
      const id = `led${index}`;
      const model = opticalEdges(ready, id);
      const visible = paintEdges(paint, index);
      // LED2 begins halfway through its first HIGH. Exclude only that stated
      // initial partial phase; all regular halves and complete cycles remain.
      const modelStart =
        index === 2 ? model.findIndex((row) => row.level === 0 && row.at >= 49) : 0;
      const paintStart = index === 2 ? visible.findIndex((row, i) => row.level === 0 && i > 0) : 0;
      const modelMetrics = blinkWallMetrics(model.slice(modelStart), halfMs);
      const paintMetrics = blinkWallMetrics(visible.slice(paintStart), halfMs);
      expect(modelMetrics.cycles).toBeGreaterThanOrEqual(2);
      expect(paintMetrics.cycles).toBeGreaterThanOrEqual(2);
      for (const half of modelMetrics.halves)
        expect(Math.abs(half - halfMs)).toBeLessThanOrEqual(0.1);
      if (ownerV3Ledger)
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `millis-${id}-paint-half-durations`,
          ownerV3TemporalProvenance(ready, session.source, 'millis-independent', {
            ledIndex: index,
            arduinoPin: 13 - index,
            halfMs,
          }),
          paintMetrics.halves,
        );
      else
        for (const half of paintMetrics.halves) {
          expect(half).toBeGreaterThanOrEqual(halfMs * 0.5);
          expect(half).toBeLessThanOrEqual(halfMs * 1.5);
        }
      expect(paintMetrics.duty).toBeGreaterThanOrEqual(0.45);
      expect(paintMetrics.duty).toBeLessThanOrEqual(0.55);
      const highs = visible.slice(paintStart).filter((row) => row.level === 1);
      const periodMs = (highs.at(-1)!.at - highs[0]!.at) / (highs.length - 1);
      if (ownerV3Ledger)
        recordOwnerV3Timing(
          ownerV3Ledger,
          test.info().title,
          `millis-${id}-paint-mean-period`,
          ownerV3TemporalProvenance(ready, session.source, 'millis-independent', {
            ledIndex: index,
            arduinoPin: 13 - index,
            halfMs,
          }),
          [periodMs],
        );
      else {
        expect(periodMs).toBeGreaterThanOrEqual(halfMs * 2 * 0.9);
        expect(periodMs).toBeLessThanOrEqual(halfMs * 2 * 1.1);
      }
      return { id, halfMs, model, visible, modelMetrics, paintMetrics, periodMs };
    });
    const vectors = new Set(
      paint.map((row) => row.first.brightness.map((value) => Number(value > 0)).join('')),
    );
    for (const vector of ['101', '100', '110', '111', '000'])
      expect(vectors.has(vector)).toBe(true);
    metrics = { clock, perLed, vectors: [...vectors], causal };
    session.failures.assertEmpty();
  } finally {
    await retainOwnerTemporalEvidence(page, session, metrics);
  }
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  expect((await session.read()).draft).toEqual(session.saved.draft);
});

const temporalResetSource = `void setup() {
  pinMode(13, OUTPUT); pinMode(12, OUTPUT); pinMode(11, OUTPUT);
  digitalWrite(13, LOW); digitalWrite(12, HIGH); digitalWrite(11, LOW);
  delay(500);
}
void loop() {
  digitalWrite(13, HIGH); digitalWrite(12, HIGH); digitalWrite(11, HIGH); delay(1);
  digitalWrite(13, LOW); digitalWrite(12, LOW); digitalWrite(11, LOW); delay(1);
}`;

test('Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history', async ({
  page,
}) => {
  const session = await openOwnerTemporalSketch(page, temporalResetSource, 'arduino-reset');
  let metrics: unknown;
  try {
    await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    await waitForTemporalHorizon(page, session.source, 1_250_000);
    const before = await temporalObservation(page);
    const previous = assertTemporalFrames(before, session.source);
    const oldGeneration = previous.at(-1)!.generationId!;
    const oldPaint = validTemporalPaint(
      before,
      previous.find((row) => row.committedHorizonMicroseconds >= 600_000)!.at,
    );
    expect(
      oldPaint.some((run) => run.first.brightness.every((value) => value > 0 && value < 60)),
    ).toBe(true);
    await page.getByTestId('arduino-reset-button').click();
    await expect
      .poll(() =>
        page.evaluate((oldGeneration) => {
          const ready = (window as TemporalWindow).__ownerTemporal!.frames.filter(
            (row) => row.executionStatus === 'ready',
          );
          const last = ready.at(-1);
          return (
            !!last &&
            last.generationId !== oldGeneration &&
            last.committedHorizonMicroseconds >= 1_250_000
          );
        }, oldGeneration),
      )
      .toBe(true);
    const raw = await temporalObservation(page);
    expect(raw.resetClicks).toHaveLength(1);
    expect(raw.resetClicks[0]!.trusted).toBe(true);
    const clickedAt = raw.resetClicks[0]!.at;
    const newGeneration = raw.frames
      .filter((row) => row.executionStatus === 'ready')
      .at(-1)!.generationId!;
    expect(newGeneration).not.toBe(oldGeneration);
    const restarted = assertTemporalFrames(raw, session.source, newGeneration);
    const clock = ownerV3Ledger
      ? assertOwnerV3TemporalClock(
          restarted,
          1250,
          'reset-temporal-wall-model',
          session.source,
          'reset-restarted',
          {},
        )
      : assertTemporalWallClock(restarted, 1250, 'reset-temporal-wall-model');
    expect(restarted[0]!.at).toBeGreaterThanOrEqual(clickedAt);
    expect(restarted[0]!.ledTemporal!.fromMicroseconds).toBe(0);
    const startup = restarted.filter(
      (row) =>
        row.committedHorizonMicroseconds >= 25_000 && row.committedHorizonMicroseconds < 500_000,
    );
    expect(startup.length).toBeGreaterThanOrEqual(4);
    for (const row of startup)
      expect(row.components.map((led) => Number((led.brightness ?? 0) > 0))).toEqual([0, 1, 0]);
    const firstLoop = restarted.find((row) => row.committedHorizonMicroseconds >= 500_000)!;
    const firstSetup = restarted.find((row) =>
      temporalPhysicalBrightness(row).every((value, index) =>
        index === 1 ? value > 60 : value === 0,
      ),
    )!;
    const setupFrom = firstSetup.at + OWNER_TEMPORAL_PUBLICATION_LAG_MS;
    const setupPaint = validTemporalPaint(raw, setupFrom, firstLoop.at);
    const setupFrames = resetSetupPaintViolations(
      raw,
      setupFrom,
      firstLoop.at,
      temporalPhysicalBrightness(firstSetup),
    );
    expect(setupFrames.frames.length).toBeGreaterThanOrEqual(8);
    expect(setupFrames.violations).toEqual([]);
    const setupCausal = temporalPaintCausality(
      raw,
      session.source,
      newGeneration,
      setupFrom,
      firstLoop.at,
    );
    expect(setupCausal.violations).toEqual([]);
    expect(setupCausal.witnesses.length).toBeGreaterThanOrEqual(8);
    expect(setupPaint.length).toBeGreaterThan(0);
    const settledAt = restarted.find((row) => row.committedHorizonMicroseconds >= 600_000)!.at;
    const resumedPaint = validTemporalPaint(raw, settledAt);
    expect(resumedPaint.length).toBeGreaterThan(0);
    for (const run of resumedPaint)
      for (const value of run.first.brightness) {
        expect(value).toBeGreaterThan(20);
        expect(value).toBeLessThan(60);
      }
    metrics = {
      clickedAt,
      oldGeneration,
      newGeneration,
      clock,
      setupFrom,
      setupPaint,
      setupFrames,
      setupCausal,
      resumedPaint,
    };
    session.failures.assertEmpty();
  } finally {
    await retainOwnerTemporalEvidence(page, session, metrics);
  }
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  expect((await session.read()).draft).toEqual(session.saved.draft);
});
