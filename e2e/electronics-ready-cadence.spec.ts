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
const OWNER_V3_PACE = 0.125;
const OWNER_V3_REGISTRY_REVISION =
  'a794578587a78ead87eea54c20c4d486ba0561368bd4a8bbe194693ed4545c10';
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
  timeoutMs: 20000 | 30000 | 40000;
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
    timeoutMs: 40000,
    dimensions: {},
  },
  {
    site: 'delay-2000-ready-horizon-8100000',
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    stage: 'blink-2000',
    horizonMicroseconds: 8100000,
    timeoutMs: 40000,
    dimensions: {},
  },
  {
    site: 'millis-ready-horizon-2250000',
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    stage: 'millis-independent',
    horizonMicroseconds: 2250000,
    timeoutMs: 30000,
    dimensions: {},
  },
  {
    site: 'delay-1-ready-horizon-1500000',
    title:
      'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
    stage: 'blink-1',
    horizonMicroseconds: 1500000,
    timeoutMs: 20000,
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

// Prospective finite service budgets apply only to these exact named v3 cases.
const OWNER_V3_CASE_BUDGETS = freezeOwnerV3([
  {
    title:
      'Canonical ready cadence: gpio sketch saved, observed completely and reopened with cookies only',
    timeoutMs: 90000,
  },
  {
    title:
      'Owner Arduino timing: blink delay 100 ms, complete ready frames and real LED transitions',
    timeoutMs: 45000,
  },
  {
    title:
      'Owner Arduino timing: blink delay 50 ms, complete ready frames and real LED transitions',
    timeoutMs: 45000,
  },
  {
    title: 'Owner Arduino execution: no-delay realtime, production frames and painted LEDs',
    timeoutMs: 45000,
  },
  {
    title: 'Owner Arduino execution: independent ports, production frames and painted LEDs',
    timeoutMs: 45000,
  },
  {
    title:
      'Owner Arduino Blockly: visible default wait edits 100/50/1 ms, real light and cookies-only reopen',
    timeoutMs: 90000,
  },
  {
    title: 'Owner Arduino temporal: delay 2000 ms, two complete electrical and loaded-image cycles',
    timeoutMs: 100000,
  },
  {
    title:
      'Owner Arduino temporal: delay 1 ms, independent optical integrals and stable loaded-image brightness',
    timeoutMs: 60000,
  },
  {
    title:
      'Owner Arduino temporal: independent millis 500/200/100 ms outputs with different initial phases',
    timeoutMs: 60000,
  },
  {
    title:
      'Owner Arduino temporal: real Arduino Reset restarts setup and clears fast optical history',
    timeoutMs: 60000,
  },
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
  expectedPace: 0.125;
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
  expectedPace: 0.125;
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
  expectedPace: 0.125;
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
  expectedPace: 0.125;
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

// Prospective eighth-pace discovery budgets for eleven existing invocations.
// These retain their original predicates and the original five-second outcome.
// They supplement, and never replace, the unchanged 38 + 4 core registry.
const OWNER_V3_DISCOVERY_SITES = freezeOwnerV3([
  {
    site: 'gpio-initial-complete-indices',
    title: OWNER_V3_CASES[1]!,
    stage: 'gpio-initial',
    timeoutMs: 20000,
    expected: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  {
    site: 'gpio-reopened-complete-indices',
    title: OWNER_V3_CASES[1]!,
    stage: 'gpio-reopened',
    timeoutMs: 20000,
    expected: [0, 1, 2, 3, 4, 5, 6, 7],
  },
  {
    site: 'owner-blink-100-ready-and-light',
    title: OWNER_V3_CASES[3]!,
    stage: 'blink-100',
    timeoutMs: 16000,
    expected: true,
  },
  {
    site: 'owner-blink-50-ready-and-light',
    title: OWNER_V3_CASES[4]!,
    stage: 'blink-50',
    timeoutMs: 16000,
    expected: true,
  },
  {
    site: 'no-delay-execution-ready-1250000',
    title: OWNER_V3_CASES[5]!,
    stage: 'no-delay realtime',
    timeoutMs: 16000,
    expected: true,
  },
  {
    site: 'independent-ports-execution-ready-1250000',
    title: OWNER_V3_CASES[6]!,
    stage: 'independent ports',
    timeoutMs: 16000,
    expected: true,
  },
  {
    site: 'reset-before-ready-1250000',
    title: OWNER_V3_CASES[11]!,
    stage: 'reset-before',
    timeoutMs: 16000,
    expected: true,
  },
  {
    site: 'reset-restarted-ready-1250000',
    title: OWNER_V3_CASES[11]!,
    stage: 'reset-restarted',
    timeoutMs: 16000,
    expected: true,
  },
  {
    site: 'blockly-100-ready-1000000',
    title: OWNER_V3_CASES[7]!,
    stage: 'blockly-100',
    timeoutMs: 12000,
    expected: true,
  },
  {
    site: 'blockly-50-ready-1000000',
    title: OWNER_V3_CASES[7]!,
    stage: 'blockly-50',
    timeoutMs: 12000,
    expected: true,
  },
  {
    site: 'blockly-1-ready-1000000',
    title: OWNER_V3_CASES[7]!,
    stage: 'blockly-1',
    timeoutMs: 12000,
    expected: true,
  },
]);
type OwnerV3DiscoveryInput = {
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
type OwnerV3DiscoveryRecord = {
  input: OwnerV3DiscoveryInput;
  evaluation?: ReturnType<typeof evaluateOwnerV3Discovery>;
  evaluationError?: string;
};
let ownerV3Discoveries: OwnerV3DiscoveryRecord[] = [];

function ownerV3DiscoveryDefinition(title: string, site: string) {
  const definition = OWNER_V3_DISCOVERY_SITES.find((entry) => entry.site === site);
  if (!definition || definition.title !== title)
    throw new Error('Unknown or mismatched classroom discovery invocation.');
  return definition;
}

function evaluateOwnerV3Discovery(input: OwnerV3DiscoveryInput) {
  if (arguments.length !== 1) throw new Error('Discovery accepts no caller-selected limits.');
  const definition = ownerV3DiscoveryDefinition(input.title, input.site);
  if (
    Object.keys(input).sort().join(',') !==
      'clock,endedAt,expectationCompleted,expectedSourceSha256,invocation,registryRevision,rejection,samples,site,stage,startedAt,title' ||
    input.invocation !== 'REACHED' ||
    input.registryRevision !== OWNER_V3_REGISTRY_REVISION ||
    input.stage !== definition.stage ||
    input.clock !== 'node-performance' ||
    !/^[a-f0-9]{64}$/.test(input.expectedSourceSha256) ||
    !Number.isFinite(input.startedAt) ||
    input.startedAt < 0 ||
    input.endedAt === null ||
    !Number.isFinite(input.endedAt) ||
    input.endedAt < input.startedAt ||
    typeof input.expectationCompleted !== 'boolean' ||
    (input.expectationCompleted ? input.rejection !== null : typeof input.rejection !== 'string') ||
    !Array.isArray(input.samples) ||
    input.samples.some(
      (sample, index) =>
        Object.keys(sample).sort().join(',') !== 'at,value' ||
        !Number.isFinite(sample.at) ||
        sample.at < input.startedAt ||
        sample.at > input.endedAt! ||
        (index > 0 && sample.at < input.samples[index - 1]!.at) ||
        (Array.isArray(definition.expected)
          ? !Array.isArray(sample.value) ||
            sample.value.some((value) => !Number.isSafeInteger(value))
          : typeof sample.value !== 'boolean'),
    )
  )
    throw new Error('Invalid classroom discovery clock, provenance or complete samples.');
  const firstSatisfiedAt =
    input.samples.find(
      (sample) => JSON.stringify(sample.value) === JSON.stringify(definition.expected),
    )?.at ?? null;
  const originalDeadlineAt = input.startedAt + 5000;
  const activeDeadlineAt = input.startedAt + definition.timeoutMs;
  const outcome = (deadline: number) =>
    firstSatisfiedAt !== null && firstSatisfiedAt <= deadline
      ? 'PASS'
      : input.endedAt! >= deadline
        ? 'FAIL'
        : 'INCOMPLETE';
  const activeOutcome = outcome(activeDeadlineAt);
  return freezeOwnerV3({
    registryRevision: OWNER_V3_REGISTRY_REVISION,
    site: input.site,
    title: input.title,
    stage: input.stage,
    expectedSourceSha256: input.expectedSourceSha256,
    clock: input.clock,
    originalTimeoutMs: 5000,
    activeTimeoutMs: definition.timeoutMs,
    originalDeadlineAt,
    activeDeadlineAt,
    firstSatisfiedAt,
    originalOutcome: outcome(originalDeadlineAt),
    activeOutcome: !input.expectationCompleted && activeOutcome === 'PASS' ? 'FAIL' : activeOutcome,
    comparisonScope: 'completed-predicate-samples-on-this-execution',
  });
}

function requireOwnerV3DiscoveriesComplete(title: string, records: OwnerV3DiscoveryRecord[]): void {
  const expected = OWNER_V3_DISCOVERY_SITES.filter((entry) => entry.title === title);
  if (!Array.isArray(records)) throw new Error('Missing classroom discovery records.');
  const seen = new Set<string>();
  for (const record of records) {
    if (
      Object.keys(record).sort().join(',') !== 'evaluation,input' ||
      record.input.title !== title ||
      seen.has(record.input.site) ||
      record.evaluationError
    )
      throw new Error('Unknown, duplicate or invalid classroom discovery record.');
    const actual = evaluateOwnerV3Discovery(record.input);
    if (JSON.stringify(record.evaluation) !== JSON.stringify(actual))
      throw new Error('Missing or tampered classroom discovery outcome.');
    if (actual.activeOutcome !== 'PASS' || !record.input.expectationCompleted)
      throw new Error('Classroom discovery did not pass its finite original predicate.');
    seen.add(record.input.site);
  }
  if (expected.some((entry) => !seen.has(entry.site)))
    throw new Error('Required classroom discovery invocation not reached.');
}

function ownerV3DiscoverySample<T extends boolean | number[]>(
  input: OwnerV3DiscoveryInput | null,
  value: T,
): T {
  if (input)
    input.samples.push({ at: performance.now(), value: Array.isArray(value) ? [...value] : value });
  return value;
}

function ownerV3DiscoveryOptions(input: OwnerV3DiscoveryInput | null) {
  return input
    ? { timeout: ownerV3DiscoveryDefinition(input.title, input.site).timeoutMs }
    : undefined;
}

async function withOwnerV3Discovery(
  site: string,
  source: string,
  operation: (input: OwnerV3DiscoveryInput | null) => Promise<void>,
): Promise<void> {
  if (arguments.length !== 3) throw new Error('Discovery accepts no caller-selected limits.');
  if (!ownerV3Ledger) return operation(null);
  assertOwnerV3Identity(ownerV3Ledger, test.info().title);
  const definition = ownerV3DiscoveryDefinition(ownerV3Ledger.title, site);
  if (ownerV3Discoveries.some((record) => record.input.site === site))
    throw new Error('Duplicate classroom discovery invocation.');
  const input: OwnerV3DiscoveryInput = {
    invocation: 'REACHED',
    registryRevision: OWNER_V3_REGISTRY_REVISION,
    title: definition.title,
    site,
    stage: definition.stage,
    expectedSourceSha256: createHash('sha256').update(source).digest('hex'),
    clock: 'node-performance',
    startedAt: performance.now(),
    endedAt: null,
    samples: [],
    expectationCompleted: null,
    rejection: null,
  };
  const record: OwnerV3DiscoveryRecord = { input };
  ownerV3Discoveries.push(record);
  const [execution] = await Promise.allSettled([Promise.resolve().then(() => operation(input))]);
  input.endedAt = performance.now();
  input.expectationCompleted = execution.status === 'fulfilled';
  input.rejection = execution.status === 'rejected' ? String(execution.reason) : null;
  const [retention] = await Promise.allSettled([
    Promise.resolve().then(() => {
      record.evaluation = evaluateOwnerV3Discovery(input);
      freezeOwnerV3(record);
    }),
  ]);
  if (retention.status === 'rejected') record.evaluationError = String(retention.reason);
  // Logging never replaces or swallows the original rejected expectation.
  if (execution.status === 'rejected') throw execution.reason;
  if (retention.status === 'rejected') throw retention.reason;
  if (record.evaluation?.activeOutcome !== 'PASS')
    throw new Error('Classroom discovery did not pass its finite original predicate.');
}

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
  const acquisitionLimitMs = definition.timeoutMs;
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
  const acquisitionLimitMs = definition.timeoutMs;
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
        { intervals: [100], timeout: definition.timeoutMs },
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
  // Serialize every original row inside the page; avoid recursive protocol
  // copying of canonical matrices before the final identical JSON artifact.
  return JSON.parse(
    await page.evaluate(() =>
      JSON.stringify({
        worker: (window as ProbeWindow).__bitwiseWorker ?? [],
        ui: (window as ProbeWindow).__bitwiseUi ?? [],
        paint: (window as ProbeWindow).__ownerPaint ?? [],
        startClicks: (window as ProbeWindow).__ownerStartClicks ?? [],
        reanchors: (window as ProbeWindow).__ledPlayoutReanchors ?? [],
      }),
    ),
  ) as {
    worker: WorkerReceipt[];
    ui: UiReceipt[];
    paint: PaintReceipt[];
    startClicks: NonNullable<ProbeWindow['__ownerStartClicks']>;
    reanchors: NonNullable<ProbeWindow['__ledPlayoutReanchors']>;
  };
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
async function runActualSketch(
  page: Page,
  kind: 'serial' | 'gpio',
  source: string,
  path: string,
  stage: 'initial' | 'reopened',
) {
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
      await withOwnerV3Discovery(`gpio-${stage}-complete-indices`, source, async (input) => {
        await expect
          .poll(
            async () =>
              ownerV3DiscoverySample(
                input,
                (await page.evaluate(compactObservation, { source })).gpio,
              ),
            ownerV3DiscoveryOptions(input),
          )
          .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      });
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
  ownerV3Discoveries = [];
  const profile = ownerQualificationProfile(
    process.env.ASA_ELECTRONICS_QUALIFICATION_PROFILE,
    process.env.ASA_ELECTRONICS_QUALIFICATION_ENTRYPOINT,
  );
  if (
    info.title ===
    'Classroom D2-D4: ordered joint LEDs, five delays, Reset and cookies-only saved reopen'
  ) {
    d2Ledger = {
      schema: 'electronics-classroom-d2-d4-v1',
      title: info.title,
      profile,
      expectedSourceSha: process.env.ASA_ELECTRONICS_EXPECTED_SHA ?? null,
      observerSha256: createHash('sha256')
        .update(readFileSync(resolve('e2e/electronics-ready-cadence.spec.ts')))
        .digest('hex'),
      fixtureSha256: createHash('sha256')
        .update(readFileSync(resolve(D2_FIXTURE_PATH)))
        .digest('hex'),
      stages: [],
      native: [],
      completed: false,
    };
    teacher = await seedTeacher(admin, `ready-cadence-${info.workerIndex}-${info.retry}`);
    return;
  }
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
    const caseBudget = OWNER_V3_CASE_BUDGETS.find((entry) => entry.title === info.title);
    if (caseBudget) test.setTimeout(caseBudget.timeoutMs);
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
  if (
    info.title ===
    'Classroom D2-D4: ordered joint LEDs, five delays, Reset and cookies-only saved reopen'
  ) {
    await retainD2Ledger(info);
    return;
  }
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
        requireOwnerV3DiscoveriesComplete(info.title, ownerV3Discoveries);
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
            discoveryEvidence: {
              registryRevision: OWNER_V3_REGISTRY_REVISION,
              requiredSites: OWNER_V3_DISCOVERY_SITES.filter(
                (entry) => entry.title === info.title,
              ).map((entry) => entry.site),
              records: ownerV3Discoveries,
              unreached: OWNER_V3_DISCOVERY_SITES.filter(
                (entry) =>
                  entry.title === info.title &&
                  !ownerV3Discoveries.some((record) => record.input.site === entry.site),
              ).map((entry) => ({ site: entry.site, outcome: 'NOT_REACHED' })),
            },
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
      'initial',
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
        await runActualSketch(
          reopened,
          kind,
          source,
          resolve(artifactRoot, `${kind}-reopened`),
          'reopened',
        ),
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
        await withOwnerV3Discovery(
          `owner-blink-${delayMs}-ready-and-light`,
          source,
          async (input) => {
            await expect
              .poll(async () => {
                const summary = await page.evaluate(ownerTimingSummary, { source });
                return ownerV3DiscoverySample(
                  input,
                  summary.committed >= 1_250_000 &&
                    summary.visibleChanges >= (delayMs === 100 ? 8 : 16) &&
                    summary.paintHigh &&
                    summary.paintLow,
                );
              }, ownerV3DiscoveryOptions(input))
              .toBe(true);
          },
        );
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
      await withOwnerV3Discovery(
        mode === 'no-delay realtime'
          ? 'no-delay-execution-ready-1250000'
          : 'independent-ports-execution-ready-1250000',
        source,
        async (input) => {
          await expect
            .poll(
              async () =>
                ownerV3DiscoverySample(
                  input,
                  await page.evaluate(
                    ({ source }) => {
                      const probe = window as ProbeWindow;
                      const ready = (probe.__bitwiseWorker ?? []).filter(
                        (row) =>
                          row.requestSource === source && row.advance.executionStatus === 'ready',
                      );
                      return (ready.at(-1)?.advance.committedHorizonMicroseconds ?? 0) >= 1_250_000;
                    },
                    { source },
                  ),
                ),
              ownerV3DiscoveryOptions(input),
            )
            .toBe(true);
        },
      );
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
  return JSON.parse(
    await page.evaluate(() => JSON.stringify((window as TemporalWindow).__ownerTemporal!)),
  ) as TemporalProbe;
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

async function waitForTemporalHorizon(
  page: Page,
  source: string,
  horizon: number,
  discoverySite?: 'reset-before-ready-1250000' | `blockly-${number}-ready-1000000`,
) {
  // Strict/v2 and unselected waits retain the original five-second deadline.
  const observe = async (input: OwnerV3DiscoveryInput | null) => {
    await expect
      .poll(
        async () =>
          ownerV3DiscoverySample(
            input,
            await page.evaluate(
              ({ source, horizon }) =>
                ((window as TemporalWindow).__ownerTemporal?.frames
                  .filter((row) => row.source === source && row.executionStatus === 'ready')
                  .at(-1)?.committedHorizonMicroseconds ?? 0) >= horizon,
              { source, horizon },
            ),
          ),
        { intervals: [100], ...ownerV3DiscoveryOptions(input) },
      )
      .toBe(true);
  };
  if (discoverySite) await withOwnerV3Discovery(discoverySite, source, observe);
  else await observe(null);
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
      await waitForTemporalHorizon(page, source, 1_000_000, `blockly-${half}-ready-1000000`);
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
    await waitForTemporalHorizon(page, session.source, 1_250_000, 'reset-before-ready-1250000');
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
    await withOwnerV3Discovery('reset-restarted-ready-1250000', session.source, async (input) => {
      await expect
        .poll(
          async () =>
            ownerV3DiscoverySample(
              input,
              await page.evaluate((oldGeneration) => {
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
            ),
          ownerV3DiscoveryOptions(input),
        )
        .toBe(true);
    });
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

// Issue 649: one additive classroom case. All preceding D13 cases and helpers
// remain byte-identical to the accepted source. This observer is not a clock.
const D2_CLASSROOM_CASE =
  'Classroom D2-D4: ordered joint LEDs, five delays, Reset and cookies-only saved reopen';
const D2_FIXTURE_PATH = 'docs/product/electronics/examples/D2_D4_3x330ohm_red_LED.schematic.json';
const D2_LESSON_PATH = 'docs/product/electronics/lessons/D2_D4_CLASSROOM.md';
const D2_IDS = ['led0', 'led1', 'led2'] as const;
const D2_PINS = ['d2', 'd3', 'd4'] as const;
const D2_ORDER = ['100', '000', '010', '000', '001', '000'] as const;
const D2_CYCLES = 8;
const D2_WAIT_MS = 150_000;
type D2Stage = { name: string; highMs: number; offMs: number; source: string };
type D2Edge = { at: number; vector: string; receivedAt: number };
type D2PaintEdge = { at: number; vector: string };
type D2LReceipt = {
  at: number;
  activeAttribute: string | null;
  opacity: number | null;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number } | null;
  boardRect: { x: number; y: number; width: number; height: number } | null;
  boardHref: string;
};
type D2Window = TemporalWindow & { __d2L?: D2LReceipt[] };
type D2Metrics = {
  stage: string;
  generationId: number;
  actionAt: number;
  sourceSha256: string;
  readyCount: number;
  firstHorizon: number;
  completeCycles: number;
  medianCycleMs: number;
  phaseMediansMs: Array<{ pin: string; high: number; off: number; ratio: number }>;
  maximumBacklog: number;
  electrical: D2Edge[];
  gpio: D2Edge[];
  painted: D2PaintEdge[];
  causal: ReturnType<typeof temporalPaintCausality>;
};
let d2Ledger: {
  schema: 'electronics-classroom-d2-d4-v1';
  title: string;
  profile: ReturnType<typeof ownerQualificationProfile>;
  expectedSourceSha: string | null;
  observerSha256: string;
  fixtureSha256: string;
  stages: D2Metrics[];
  native: unknown[];
  completed: boolean;
} | null = null;

function d2Sketch(highMs: number, offMs = highMs): string {
  return `const int highMs = ${highMs};
const int offMs = ${offMs};

void setup() {
  pinMode(2, OUTPUT);
  pinMode(3, OUTPUT);
  pinMode(4, OUTPUT);
  digitalWrite(2, LOW);
  digitalWrite(3, LOW);
  digitalWrite(4, LOW);
}

void loop() {
  digitalWrite(2, HIGH);
  delay(highMs);
  digitalWrite(2, LOW);
  delay(offMs);

  digitalWrite(3, HIGH);
  delay(highMs);
  digitalWrite(3, LOW);
  delay(offMs);

  digitalWrite(4, HIGH);
  delay(highMs);
  digitalWrite(4, LOW);
  delay(offMs);
}
`;
}

function d2Fixture(): SchematicDocument {
  const document = JSON.parse(readFileSync(resolve(D2_FIXTURE_PATH), 'utf8')) as SchematicDocument;
  const reference = fixture();
  const intended = {
    ...reference,
    components: reference.components.slice(0, 7).map((component) => ({
      ...component,
      electricalModelId:
        component.id === 'uno'
          ? 'arduino-uno'
          : component.id.startsWith('r')
            ? 'resistor'
            : 'ordinary-led',
      electricalModelVersion: 1,
      modelProfileId:
        component.id === 'uno'
          ? 'arduino-uno-r3'
          : component.id.startsWith('r')
            ? 'axial-resistor'
            : 'generic-red-led',
      modelProfileVersion: 1,
      stateProperties: {
        ...component.stateProperties,
        ...(component.id === 'uno' ? { arduinoSource: d2Sketch(100) } : {}),
      },
    })),
    connections: reference.connections.slice(0, 9),
  };
  // This independent expected object includes every physical/model field; it
  // is not learned from a server response or from the editor's normalization.
  expect(document).toEqual(intended);
  expect(document.components.map((component) => component.id)).toEqual([
    'uno',
    'r0',
    'led0',
    'r1',
    'led1',
    'r2',
    'led2',
  ]);
  // The first complete pupil edit must actually change the initial document.
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: { ...component.stateProperties, arduinoSource: initialSource },
          }
        : component,
    ),
  };
}

type D2SaveResponse = import('@playwright/test').Response;
type D2SavedProject = {
  draft: { revision: number; updatedAt: string; document: SchematicDocument };
};
type D2PersistenceSession = {
  id: string;
  endpoint: string;
  origin: string;
  read: () => Promise<D2SavedProject>;
  persistence: ReturnType<typeof d2ObserveDraftSaves>;
  intendedDocument: SchematicDocument;
};
function retainD2SaveReceipt(name: string, value: unknown): void {
  writeFileSync(
    resolve(artifactRoot, 'd2-d4-' + name + '.json'),
    JSON.stringify(value, null, 2) + '\n',
  );
}

function d2ObserveDraftSaves(page: Page, endpoint: string, origin: string) {
  const responses: D2SaveResponse[] = [];
  const matches = (response: D2SaveResponse) =>
    new URL(response.url()).origin === origin &&
    new URL(response.url()).pathname === endpoint + '/draft' &&
    response.request().method() === 'PUT';
  page.on('response', (response) => {
    if (matches(response)) responses.push(response);
  });
  return { responses, matches };
}

async function d2Save(page: Page, session: D2PersistenceSession, source: string) {
  const previous = await session.read();
  const expected = {
    ...session.intendedDocument,
    components: session.intendedDocument.components.map((component) =>
      component.id === 'uno'
        ? {
            ...component,
            stateProperties: { ...component.stateProperties, arduinoSource: source },
          }
        : component,
    ),
  };
  const matchesSource = (response: D2SaveResponse) => {
    if (!session.persistence.matches(response)) return false;
    const body = response.request().postDataJSON() as { document?: SchematicDocument } | null;
    return (
      body?.document?.components.find((component) => component.id === 'uno')?.stateProperties
        ?.arduinoSource === source
    );
  };
  const observed = session.persistence.responses.findLast(matchesSource);
  // There is no await between the retained lookup and installing the waiter.
  // A saved/disabled label alone cannot satisfy this actual HTTP receipt check.
  const response = observed ?? (await page.waitForResponse(matchesSource));
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  const requestBody = response.request().postDataJSON() as {
    document: SchematicDocument;
    baseRevision: number;
  };
  const responseBody = (await response.json()) as D2SavedProject;
  const saved = await session.read();
  expect(requestBody.document).toEqual(expected);
  expect(responseBody.draft.document).toEqual(expected);
  expect(responseBody.draft.revision).toBe(requestBody.baseRevision + 1);
  expect(saved.draft.document).toEqual(expected);
  expect(saved.draft.revision).toBe(responseBody.draft.revision);
  if (previous.draft.revision === requestBody.baseRevision) {
    expect(saved.draft.revision).toBe(previous.draft.revision + 1);
  } else {
    // The pre-read may already contain this same completed autosave. Require
    // its whole document and the actual PUT's single revision increment.
    expect(previous.draft.revision).toBe(requestBody.baseRevision + 1);
    expect(previous.draft.document).toEqual(expected);
    expect(saved.draft.revision).toBe(previous.draft.revision);
  }
  retainD2SaveReceipt('save-' + session.id + '-' + saved.draft.revision, {
    previous,
    requestBody,
    saved,
    expected,
    responseBody,
    observedAtLookup: observed !== undefined,
    request: {
      method: response.request().method(),
      url: response.url(),
      timing: response.request().timing(),
    },
  });
  return saved;
}

async function d2OpenOwnerTemporalSketch(page: Page, source: string, name: string) {
  const intendedDocument = d2Fixture();
  const document = intendedDocument;
  await page.setViewportSize({ width: 1600, height: 1000 });
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await observeOwnerTemporal(page);
  await d2ObserveL(page);
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
  const persistence = d2ObserveDraftSaves(page, endpoint, origin);
  await page.goto(`/#/home/${id}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
  await page.locator('.arduino-source-editor textarea').fill(source);
  const saved = await d2Save(
    page,
    { id, endpoint, origin, read, persistence, intendedDocument },
    source,
  );
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
  return {
    source,
    name,
    before,
    saved,
    startAt,
    read,
    failures,
    id,
    endpoint,
    origin,
    persistence,
    intendedDocument,
  };
}

async function d2ObserveL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe = window as D2Window;
    const receipts: D2LReceipt[] = [];
    probe.__d2L = receipts;
    const rectangle = (element: Element | null | undefined) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const collect = () => {
      const board = document.querySelector(
        '[data-component-id="uno"] .workbench-production-visual',
      );
      const image = [...(board?.querySelectorAll<SVGImageElement>('image') ?? [])].find(
        (candidate) => !candidate.closest('.workbench-selection-silhouette'),
      );
      const l = board?.querySelector('[data-testid="arduino-led-l"]');
      if (l) {
        let visible = true;
        let parentOpacity = 1;
        for (let parent = l.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          visible &&= style.visibility === 'visible' && style.display !== 'none';
          parentOpacity *= Number(style.opacity);
        }
        const rect = rectangle(l)!;
        receipts.push({
          at: performance.now(),
          activeAttribute: l.getAttribute('data-active'),
          opacity: Number(getComputedStyle(l).opacity),
          visible:
            visible &&
            parentOpacity === 1 &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.x >= 0 &&
            rect.y >= 0 &&
            rect.x + rect.width <= innerWidth &&
            rect.y + rect.height <= innerHeight,
          rect,
          boardRect: rectangle(image),
          boardHref: image?.href.baseVal ?? '',
        });
      }
      requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  });
}

async function d2BuildProvenance(page: Page) {
  const expected = process.env.ASA_ELECTRONICS_EXPECTED_SHA;
  expect(expected, 'the exact candidate SHA is required').toMatch(/^[a-f0-9]{40}$/);
  const response = await page
    .context()
    .request.get(new URL('/build-metadata.json', page.url()).href);
  expect(response.status()).toBe(200);
  const build = (await response.json()) as { revision: string; builtAt?: string };
  expect(build.revision).toBe(expected);
  const evidence = {
    build,
    expected,
    browserVersion: page.context().browser()?.version() ?? null,
    viewport: page.viewportSize(),
    workflowRun: process.env.GITHUB_RUN_ID ?? null,
  };
  writeFileSync(
    resolve(artifactRoot, 'd2-d4-build.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  return evidence;
}

async function d2ClearProbe(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = window as D2Window;
    probe.__bitwiseWorker!.length = 0;
    probe.__bitwiseUi!.length = 0;
    probe.__ownerPaint!.length = 0;
    probe.__ownerStartClicks!.length = 0;
    probe.__d2L!.length = 0;
    const temporal = probe.__ownerTemporal!;
    temporal.frames.length = 0;
    temporal.paintRuns.length = 0;
    temporal.paintFrames.length = 0;
    temporal.resetClicks.length = 0;
    temporal.errors.length = 0;
    temporal.reanchors.length = 0;
    return performance.now();
  });
}

function d2Vector(brightness: readonly number[]): string {
  if (
    brightness.length !== 3 ||
    brightness.some((value) => !Number.isFinite(value) || value < 0 || value > 100)
  )
    throw new Error('D2 joint vector must contain exactly three finite physical brightness values');
  return brightness.map((value) => (value > 0 ? '1' : '0')).join('');
}

function d2ElectricalEdges(ready: readonly TemporalFrame[]): D2Edge[] {
  const edges: D2Edge[] = [];
  let previousSampleAt = -1;
  for (const frame of ready) {
    const channels = D2_IDS.map(
      (id) => frame.ledTemporal!.components.find((row) => row.componentId === id)!.samples,
    );
    const indices = [0, 0, 0];
    const values = [0, 0, 0];
    while (indices.some((index, channel) => index < channels[channel]!.length)) {
      const next = Math.min(
        ...indices.map((index, channel) => channels[channel]![index]?.atMicroseconds ?? Infinity),
      );
      if (!Number.isSafeInteger(next) || next < previousSampleAt)
        throw new Error('D2 physical histories are not chronological');
      previousSampleAt = next;
      // Apply every channel at this single model timestamp before constructing
      // a vector. There is no independently replayed light or sorted state set.
      for (let channel = 0; channel < 3; channel++) {
        const sample = channels[channel]![indices[channel]!];
        if (sample?.atMicroseconds === next) {
          values[channel] = sample.brightness;
          indices[channel]!++;
        }
      }
      const vector = d2Vector(values);
      if (edges.at(-1)?.vector !== vector)
        edges.push({ at: next / 1000, vector, receivedAt: frame.at });
    }
  }
  return edges;
}

function d2GpioEdges(
  rows: readonly WorkerReceipt[],
  source: string,
  generationId: number,
): D2Edge[] {
  const edges: D2Edge[] = [];
  const violations: string[] = [];
  for (const row of rows) {
    if (row.advance.executionStatus !== 'ready') continue;
    const board = row.boards.find((component) => component.componentId === 'uno');
    if (
      row.requestSource !== source ||
      row.generationId !== generationId ||
      board?.loadedSource !== source
    )
      violations.push(row.requestId + ': foreign GPIO source/generation');
    if (!board) {
      violations.push(row.requestId + ': missing Uno');
      continue;
    }
    const voltages = D2_PINS.map((pin) => board.runtime.outputVoltages[pin] ?? 0);
    if (voltages.some((value) => value !== 0 && value !== 5))
      violations.push(row.requestId + ': non-digital output');
    if ((board.runtime.outputVoltages.d13 ?? 0) !== 0)
      violations.push(row.requestId + ': D13 must remain LOW');
    const vector = voltages.map((voltage) => (voltage === 5 ? '1' : '0')).join('');
    const physical = d2Vector(
      D2_IDS.map(
        (id) =>
          row.advance.result?.components.find((component) => component.componentId === id)
            ?.brightness ?? NaN,
      ),
    );
    if (vector !== physical) violations.push(row.requestId + ': GPIO/wiring/current mismatch');
    if (edges.at(-1)?.vector !== vector)
      edges.push({
        at: row.advance.committedHorizonMicroseconds / 1000,
        vector,
        receivedAt: row.at,
      });
  }
  expect(
    violations,
    'every ready GPIO receipt must agree with the complete solved joint state',
  ).toEqual([]);
  return edges;
}

function d2PaintEdges(raw: TemporalProbe, actionAt: number): D2PaintEdge[] {
  const edges: D2PaintEdge[] = [];
  for (const run of validTemporalPaint(raw, actionAt)) {
    const vector = d2Vector(run.first.brightness);
    const at = Math.max(actionAt, run.first.previousFrameAt!);
    if (edges.at(-1)?.vector !== vector) edges.push({ at, vector });
  }
  return edges;
}

function d2AssertPrefix<T extends D2PaintEdge>(edges: readonly T[], label: string): T[] {
  // Permit exactly the initial all-off state. Never search ahead for a good
  // subsequence: a wrong first LED, skipped phase or later reorder must fail.
  const ordered = edges[0]?.vector === '000' ? edges.slice(1) : [...edges];
  expect(
    ordered.length,
    label + ': eight full cycles and the closing D2 state',
  ).toBeGreaterThanOrEqual(D2_CYCLES * 6 + 1);
  expect(
    ordered.map((edge) => edge.vector),
    label + ': complete chronological prefix',
  ).toEqual(ordered.map((_, index) => D2_ORDER[index % D2_ORDER.length]));
  expect(
    ordered.every((edge, index) => index === 0 || edge.at > ordered[index - 1]!.at),
    label + ': strictly increasing phase clock',
  ).toBe(true);
  return ordered;
}

function d2Median(values: readonly number[]): number {
  if (!values.length || values.some((value) => !Number.isFinite(value)))
    throw new Error('missing finite D2 median');
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function d2PhaseMetrics(ordered: readonly D2PaintEdge[], stage: D2Stage) {
  const cycles = Array.from(
    { length: D2_CYCLES },
    (_, cycle) => ordered[(cycle + 1) * 6]!.at - ordered[cycle * 6]!.at,
  );
  const phases = D2_PINS.map((pin, branch) => {
    const high = d2Median(
      Array.from({ length: D2_CYCLES }, (_, cycle) => {
        const index = cycle * 6 + branch * 2;
        return ordered[index + 1]!.at - ordered[index]!.at;
      }),
    );
    // OFF is the immediately following joint all-dark phase. An LED's entire
    // off interval also contains the other branches and is not this delay().
    const off = d2Median(
      Array.from({ length: D2_CYCLES }, (_, cycle) => {
        const index = cycle * 6 + branch * 2;
        return ordered[index + 2]!.at - ordered[index + 1]!.at;
      }),
    );
    const ratio = off / high;
    expect(ratio, stage.name + ' ' + pin + ' adjacent OFF/HIGH').toBeGreaterThanOrEqual(
      stage.highMs === stage.offMs ? 0.8 : 2.4,
    );
    expect(ratio, stage.name + ' ' + pin + ' adjacent OFF/HIGH').toBeLessThanOrEqual(
      stage.highMs === stage.offMs ? 1.25 : 3.6,
    );
    return { pin, high, off, ratio };
  });
  return { medianCycleMs: d2Median(cycles), phaseMediansMs: phases, cycles };
}

function d2MaximumBacklog(
  electrical: readonly D2Edge[],
  painted: readonly D2PaintEdge[],
  from: number,
): number {
  let shown = 0;
  let maximum = 0;
  for (let index = 0; index < electrical.length; index++) {
    const receipt = electrical[index]!;
    if (receipt.receivedAt < from) continue;
    while (shown < painted.length && painted[shown]!.at <= receipt.receivedAt) shown++;
    // Assess at every receipt, including the gaps between painted edges. Prefix
    // identity prevents a later equal-valued cycle from concealing a backlog.
    maximum = Math.max(maximum, index + 1 - shown);
  }
  return maximum;
}

async function d2RetainRaw(
  page: Page,
  session: Awaited<ReturnType<typeof d2OpenOwnerTemporalSketch>>,
  name: string,
  metrics: unknown,
) {
  await retainOwnerTemporalEvidence(page, { ...session, name: 'd2-d4-' + name }, metrics);
  const l = JSON.parse(
    await page.evaluate(() => JSON.stringify((window as D2Window).__d2L ?? [])),
  ) as D2LReceipt[];
  const path = resolve(artifactRoot, 'd2-d4-' + name + '-l-raw.json');
  writeFileSync(path, JSON.stringify(l, null, 2) + '\n');
  await test.info().attach('d2-d4-' + name + '-l-raw', { path, contentType: 'application/json' });
}

async function d2Capture(
  page: Page,
  session: Awaited<ReturnType<typeof d2OpenOwnerTemporalSketch>>,
  stage: D2Stage,
  action: 'start' | 'reset' = 'start',
) {
  let metrics: D2Metrics | undefined;
  try {
    const beforeAction = await page.evaluate(() => performance.now());
    if (action === 'reset') await page.getByTestId('arduino-reset-button').click();
    else await page.getByRole('button', { name: 'Начать моделирование', exact: true }).click();
    const actionAt = await page.evaluate(
      ({ action, beforeAction }) => {
        const probe = window as TemporalWindow;
        const clicks =
          action === 'reset' ? probe.__ownerTemporal!.resetClicks : probe.__ownerStartClicks!;
        const click = clicks.find((row) => row.trusted && row.at >= beforeAction);
        if (!click) throw new Error('D2 acquisition has no trusted UI action');
        return click.at;
      },
      { action, beforeAction },
    );
    await page.waitForFunction(
      ({ source, actionAt, minimumModelUs }) => {
        const raw = (window as TemporalWindow).__ownerTemporal!;
        const ready = raw.frames.filter(
          (row) =>
            row.requestAt !== null &&
            row.requestAt >= actionAt &&
            row.source === source &&
            row.executionStatus === 'ready',
        );
        let previous = '';
        let edges = 0;
        for (const run of raw.paintRuns) {
          if (
            run.lastAt < actionAt ||
            run.first.brightness.length !== 3 ||
            run.first.images.length !== 3 ||
            !run.first.images.every(
              (image, index) =>
                image.decoded &&
                image.visible &&
                image.unoccluded &&
                image.opacity === 1 &&
                image.lit === run.first.brightness[index]! > 0,
            )
          )
            continue;
          const vector = run.first.brightness.map((value) => (value > 0 ? '1' : '0')).join('');
          if (vector !== previous) {
            edges++;
            previous = vector;
          }
        }
        return (ready.at(-1)?.committedHorizonMicroseconds ?? -1) >= minimumModelUs && edges >= 50;
      },
      {
        source: stage.source,
        actionAt,
        minimumModelUs: 3 * (stage.highMs + stage.offMs) * D2_CYCLES * 1000,
      },
      { timeout: D2_WAIT_MS },
    );
    const raw = await temporalObservation(page);
    const full = await observation(page);
    // Reset can complete a pre-click request between clearing buffers and the
    // trusted action. Keep those receipts in full raw evidence and causality;
    // the new acquisition is identified by its actual request clock.
    const acquisition = {
      ...raw,
      frames: raw.frames.filter((row) => row.requestAt !== null && row.requestAt >= actionAt),
    };
    expect(
      acquisition.frames.every((row) => row.source === stage.source),
      'no stale source requested after the pupil action',
    ).toBe(true);
    const ready = assertTemporalFrames(acquisition, stage.source);
    const generationId = ready[0]!.generationId!;
    expect(Number.isSafeInteger(generationId)).toBe(true);
    expect(
      acquisition.frames.every(
        (row) => row.generationId === generationId && row.responseGenerationId === generationId,
      ),
      'one generation throughout the acquisition',
    ).toBe(true);
    expect(ready[0]!.committedHorizonMicroseconds).toBe(0);
    expect(ready[0]!.at - actionAt, 'H0 startup deadline').toBeLessThanOrEqual(5_000);
    const electrical = d2ElectricalEdges(ready);
    const gpio = d2GpioEdges(
      full.worker.filter((row) => row.requestAt !== null && row.requestAt >= actionAt),
      stage.source,
      generationId,
    );
    const painted = d2PaintEdges(raw, actionAt);
    const modelOrdered = d2AssertPrefix(electrical, 'physical current');
    d2AssertPrefix(gpio, 'GPIO D2 D3 D4');
    const paintOrdered = d2AssertPrefix(painted, 'actual loaded native LED images');
    expect(paintOrdered[0]!.at - actionAt, 'first visible D2 phase deadline').toBeLessThanOrEqual(
      5_000,
    );
    const physicalPhases = d2PhaseMetrics(modelOrdered, stage);
    const phases = d2PhaseMetrics(paintOrdered, stage);
    const causal = temporalPaintCausality(raw, stage.source, generationId, actionAt);
    expect(causal.startup.h0ReadyAt).not.toBeNull();
    expect(
      causal.violations,
      'every actual stable frame has a same-moment, current-generation electrical witness within 50ms',
    ).toEqual([]);
    expect(causal.witnesses.length).toBeGreaterThan(0);
    const maximumBacklog = d2MaximumBacklog(electrical, painted, actionAt);
    expect(maximumBacklog, 'maximum unpainted ordered physical states').toBeLessThanOrEqual(2);
    const l = JSON.parse(
      await page.evaluate(() => JSON.stringify((window as D2Window).__d2L ?? [])),
    ) as D2LReceipt[];
    const afterActionL = l.filter((row) => row.at >= actionAt);
    expect(afterActionL.length).toBeGreaterThan(0);
    expect(
      afterActionL.every(
        (row) => row.activeAttribute === 'false' && row.opacity === 0 && row.visible,
      ),
      'D13 L stays off while D2-D4 run',
    ).toBe(true);
    metrics = {
      stage: stage.name,
      generationId,
      actionAt,
      sourceSha256: createHash('sha256').update(stage.source).digest('hex'),
      readyCount: ready.length,
      firstHorizon: ready[0]!.committedHorizonMicroseconds,
      completeCycles: Math.floor((paintOrdered.length - 1) / 6),
      medianCycleMs: phases.medianCycleMs,
      phaseMediansMs: phases.phaseMediansMs,
      maximumBacklog,
      electrical,
      gpio,
      painted,
      causal,
    };
    expect(physicalPhases.cycles.length).toBe(D2_CYCLES);
    d2Ledger!.stages.push(metrics);
    session.failures.assertEmpty();
    return metrics;
  } finally {
    await d2RetainRaw(
      page,
      session,
      stage.name,
      metrics ?? { status: 'FAILED_BEFORE_COMPLETE_METRICS' },
    );
  }
}

async function d2Stop(page: Page): Promise<void> {
  const clickedAt = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Остановить моделирование', exact: true }).click();
  await expect
    .poll(
      async () =>
        page.evaluate((clickedAt) => {
          const probe = window as D2Window;
          const paint = probe.__ownerPaint!.at(-1);
          const l = probe.__d2L!.at(-1);
          return (
            !!paint &&
            paint.stablePreviousFrame &&
            paint.previousFrameAt !== null &&
            paint.previousFrameAt >= clickedAt &&
            paint.previousFrameAt - clickedAt <= 1_000 &&
            paint.brightness.length === 3 &&
            paint.brightness.every((value) => value === 0) &&
            paint.images.length === 3 &&
            paint.images.every(
              (image) =>
                image.decoded &&
                image.visible &&
                image.unoccluded &&
                image.opacity === 1 &&
                !image.lit,
            ) &&
            !!l &&
            l.at >= clickedAt &&
            l.activeAttribute === 'false' &&
            l.opacity === 0 &&
            l.visible
          );
        }, clickedAt),
      { timeout: 1_000, intervals: [25] },
    )
    .toBe(true);
  await expect(
    page.getByRole('button', { name: 'Начать моделирование', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.workbench-simulation-message')).toHaveCount(0);
}

async function d2EditAndSave(
  page: Page,
  session: Awaited<ReturnType<typeof d2OpenOwnerTemporalSketch>>,
  stage: D2Stage,
): Promise<D2SavedProject> {
  await page.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
  await page.locator('.arduino-source-editor textarea').fill(stage.source);
  await expect(page.locator('.arduino-source-editor textarea')).toHaveValue(stage.source);
  const saved = await d2Save(page, session, stage.source);
  await page.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
  await expect(page.locator('.arduino-code-panel')).toHaveClass(/closed/);
  return saved;
}

type D2NativeProbe = {
  source: string;
  epoch: number;
  clicks: Array<{ at: number; trusted: boolean; action: string }>;
  frames: Array<{
    at: number;
    status: string;
    solved: boolean;
    quality: { passed: boolean };
    source: string | null;
    loadedSource: string | null;
    generationId: number;
    requestId: string;
    committedUs: number;
    components: Array<{ componentId: string; brightness?: number; current?: number }>;
  }>;
};
type D2NativeImageWitness = {
  rect: { x: number; y: number; width: number; height: number } | null;
};
type D2NativeGeometry = {
  led: D2NativeImageWitness & { href: string };
  board: D2NativeImageWitness & { href: string };
  lRect: D2NativeImageWitness['rect'];
};
type D2Png = { width: number; height: number; data: Buffer };

type D2NativePixelReference = {
  x: number;
  y: number;
  low: number[];
  high: number[];
};
type D2NativeAssetProof = { state: string; href: string; sha256: string };
type D2NativeElectricalReceipt = {
  requestId: string;
  generationId: number;
  at: number;
  committedUs: number;
  brightness: number;
  current: number;
};
type D2NativeAssetBasis = {
  proof: {
    catalogSha256: string;
    sourceSha256: string;
    epoch: number;
    low: D2NativeAssetProof;
    high: D2NativeAssetProof;
    board: D2NativeAssetProof;
    physicalLow: D2NativeElectricalReceipt;
    physicalHigh: D2NativeElectricalReceipt;
    lHighRgb: [number, number, number];
  };
  encoded: { low: string; high: string; board: string };
};
function d2NativeAssetBasis(raw: D2NativeProbe, componentId: string): D2NativeAssetBasis {
  const click = raw.clicks.find(
    (row) => row.trusted && (row.action === 'start' || row.action === 'reset'),
  );
  if (!click) throw new Error('native basis has no trusted run action');
  // The semantic reference comes from the solved electrical fixture and the
  // retained catalog, independently of the renderer's href, class or data label.
  // No temporal extension is required, so this also observes the old BEFORE.
  const frames = raw.frames.filter((frame) => frame.at >= click.at && frame.status === 'ready');
  if (!frames.length) throw new Error('native basis has no post-action electrical receipt');
  const states: D2NativeElectricalReceipt[] = frames.map((frame) => {
    if (
      !frame.solved ||
      frame.quality?.passed !== true ||
      frame.source !== raw.source ||
      frame.loadedSource !== raw.source ||
      frame.generationId !== frames[0]!.generationId
    )
      throw new Error(
        'native basis contains failed, stale or mixed-generation electrical evidence',
      );
    const led = frame.components.find((component) => component.componentId === componentId);
    const brightness = led?.brightness,
      current = led?.current;
    if (
      typeof brightness !== 'number' ||
      typeof current !== 'number' ||
      !Number.isFinite(brightness) ||
      !Number.isFinite(current) ||
      brightness < 0 ||
      brightness > 100 ||
      (brightness > 0 ? !(current > 0.001 && current < 0.02) : Math.abs(current) >= 0.000001)
    )
      throw new Error('native basis light is inconsistent with solved forward current');
    return {
      requestId: frame.requestId,
      generationId: frame.generationId,
      at: frame.at,
      committedUs: frame.committedUs,
      brightness,
      current,
    };
  });
  const physicalLow = states.find((state) => state.brightness === 0);
  const physicalHigh = states.find((state) => state.brightness > 0);
  if (!physicalLow || !physicalHigh)
    throw new Error('native basis requires both solved LOW and HIGH');
  const level = Math.round(physicalHigh.brightness);
  if (
    level < 1 ||
    states.some((state) => state.brightness > 0 && Math.round(state.brightness) !== level)
  )
    throw new Error('native constant-current fixture has ambiguous HIGH asset level');
  type CatalogAsset = { state?: string; runtimePath: string; runtimeSha256: string };
  const catalogBytes = readFileSync(
    resolve('apps/web/public/assets/electronics/component-database/catalog.json'),
  );
  const catalog = JSON.parse(catalogBytes.toString('utf8')) as {
    components: Array<
      CatalogAsset & {
        componentId: string;
        stateAssets: CatalogAsset[];
        stateContract: { type: string; brightness?: { min: number; max: number; step: number } };
      }
    >;
  };
  const led = catalog.components.find((component) => component.componentId === 'led-5mm');
  const board = catalog.components.find((component) => component.componentId === 'arduino-uno');
  if (
    led?.stateContract.type !== 'ordinary_led' ||
    led.stateContract.brightness?.min !== 0 ||
    led.stateContract.brightness.max !== 100 ||
    led.stateContract.brightness.step !== 1
  )
    throw new Error('native basis requires the retained one-percent ordinary LED catalog contract');
  const ledState = (state: string) => {
    const matches = led.stateAssets.filter((asset) => asset.state === state);
    if (matches.length !== 1)
      throw new Error('native catalog state is missing or ambiguous: ' + state);
    return matches[0]!;
  };
  const read = (asset: CatalogAsset | undefined, state: string, href: string) => {
    if (!asset || asset.runtimePath !== href || !/^[a-f0-9]{64}$/.test(asset.runtimeSha256))
      throw new Error('native catalog asset disagrees with the canonical fixture state: ' + state);
    const bytes = readFileSync(resolve('apps/web/public' + href));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== asset.runtimeSha256)
      throw new Error('native canonical asset SHA mismatch: ' + state);
    return {
      proof: { state, href, sha256 },
      encoded: 'data:image/svg+xml;base64,' + bytes.toString('base64'),
    };
  };
  const ledRoot = '/assets/electronics/component-database/components/led/red/led_red_i';
  const low = read(ledState('red:0'), 'red:0', ledRoot + '000.svg');
  const high = read(
    ledState('red:' + level),
    'red:' + level,
    ledRoot + String(level).padStart(3, '0') + '.svg',
  );
  const uno = read(
    board,
    'arduino-uno:static',
    '/assets/electronics/component-database/components/arduino-uno/arduino-uno/component.svg',
  );
  return {
    proof: {
      catalogSha256: createHash('sha256').update(catalogBytes).digest('hex'),
      sourceSha256: createHash('sha256').update(raw.source).digest('hex'),
      epoch: raw.epoch,
      low: low.proof,
      high: high.proof,
      board: uno.proof,
      physicalLow,
      physicalHigh,
      // Fixed retained UNO L overlay colour, never sampled from live DOM styles.
      lHighRgb: [255, 241, 106],
    },
    encoded: { low: low.encoded, high: high.encoded, board: uno.encoded },
  };
}
type D2NativeReferences = {
  width: number;
  height: number;
  lowHref: string;
  highHref: string;
  boardHref: string;
  basis: D2NativeAssetBasis['proof'];
  led: D2NativePixelReference[];
  l: D2NativePixelReference[];
};
async function d2NativeReferences(
  page: Page,
  geometry: D2NativeGeometry,
  width: number,
  height: number,
  basis: D2NativeAssetBasis,
): Promise<D2NativeReferences> {
  return page.evaluate(
    async ({ geometry, width, height, basis }) => {
      if (
        ![basis.proof.low.href, basis.proof.high.href].includes(geometry.led.href) ||
        geometry.board.href !== basis.proof.board.href ||
        !geometry.led.rect ||
        !geometry.board.rect ||
        !geometry.lRect
      )
        throw new Error(
          'native reference requires canonical body/board assets and actual L geometry',
        );
      const load = async (href: string) => {
        const image = new Image();
        image.src = href;
        await image.decode();
        if (!image.naturalWidth || !image.naturalHeight)
          throw new Error('native reference asset did not decode');
        return image;
      };
      const [lowImage, highImage, boardImage] = await Promise.all([
        load(basis.encoded.low),
        load(basis.encoded.high),
        load(basis.encoded.board),
      ]);
      // A detached canvas supplies the original asset colours at the actual image
      // geometry. It is never mounted and never changes the editor, LED or clock.
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('native reference canvas unavailable');
      const scaleX = width / innerWidth,
        scaleY = height / innerHeight;
      const points = (rect: NonNullable<D2NativeImageWitness['rect']>, vertical: number[]) => {
        const result: Array<{ x: number; y: number }> = [];
        for (const v of vertical)
          for (const u of [0.35, 0.5, 0.65]) {
            const point = {
              x: Math.floor((rect.x + rect.width * u) * scaleX),
              y: Math.floor((rect.y + rect.height * v) * scaleY),
            };
            if (!result.some((row) => row.x === point.x && row.y === point.y)) result.push(point);
          }
        if (result.length < 4)
          throw new Error('native body/L is too small for independent pixel evidence');
        return result;
      };
      const read = (points: Array<{ x: number; y: number }>) =>
        points.map(({ x, y }) => {
          if (x < 0 || y < 0 || x >= width || y >= height)
            throw new Error('native reference point outside screenshot');
          const pixel = [...context.getImageData(x, y, 1, 1).data];
          if (pixel[3] !== 255)
            throw new Error('native reference point is not an opaque body pixel');
          return pixel.slice(0, 3);
        });
      const draw = (image: HTMLImageElement, rect: NonNullable<D2NativeImageWitness['rect']>) => {
        context.clearRect(0, 0, width, height);
        const fit = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        const drawnWidth = image.naturalWidth * fit,
          drawnHeight = image.naturalHeight * fit;
        context.drawImage(
          image,
          (rect.x + (rect.width - drawnWidth) / 2) * scaleX,
          (rect.y + (rect.height - drawnHeight) / 2) * scaleY,
          drawnWidth * scaleX,
          drawnHeight * scaleY,
        );
      };
      const ledPoints = points(geometry.led.rect, [0.3, 0.4, 0.5]);
      draw(lowImage, geometry.led.rect);
      const ledLow = read(ledPoints);
      draw(highImage, geometry.led.rect);
      const ledHigh = read(ledPoints);
      const lPoints = points(geometry.lRect, [0.35, 0.5, 0.65]);
      draw(boardImage, geometry.board.rect);
      const lLow = read(lPoints);
      // Both states use canonical source bytes / a fixed renderer contract.
      // Even swapped hrefs or wrong live CSS cannot relabel the pixel reference.
      context.fillStyle = 'rgb(' + basis.proof.lHighRgb.join(',') + ')';
      context.fillRect(
        geometry.lRect.x * scaleX,
        geometry.lRect.y * scaleY,
        geometry.lRect.width * scaleX,
        geometry.lRect.height * scaleY,
      );
      const lHigh = read(lPoints);
      return {
        width,
        height,
        lowHref: basis.proof.low.href,
        highHref: basis.proof.high.href,
        boardHref: basis.proof.board.href,
        basis: basis.proof,
        led: ledPoints.map((point, index) => ({
          ...point,
          low: ledLow[index]!,
          high: ledHigh[index]!,
        })),
        l: lPoints.map((point, index) => ({ ...point, low: lLow[index]!, high: lHigh[index]! })),
      };
    },
    { geometry, width, height, basis },
  );
}
function d2ClassifyNativePng(png: D2Png, references: D2NativeReferences) {
  const classify = (points: D2NativePixelReference[]) => {
    const actual = points.map(({ x, y }) => {
      const index = (y * png.width + x) * 4;
      return [...png.data.subarray(index, index + 4)];
    });
    const score = (key: 'low' | 'high') => {
      const perPixel = points.map((point, index) =>
        point[key].map((value, channel) => Math.abs(value - actual[index]![channel]!)),
      );
      const errors = perPixel.flat();
      return {
        mean: errors.reduce((sum, value) => sum + value, 0) / errors.length,
        maximum: Math.max(...errors),
        matchingPixels: perPixel.filter((channels) => channels.every((error) => error <= 24))
          .length,
      };
    };
    const low = score('low'),
      high = score('high');
    const separation = points.flatMap((point) =>
      point.low.map((value, channel) => Math.abs(value - point.high[channel]!)),
    );
    const meanSeparation = separation.reduce((sum, value) => sum + value, 0) / separation.length;
    const valid =
      points.length >= 4 &&
      png.width === references.width &&
      png.height === references.height &&
      points.every(
        (point) => point.x >= 0 && point.y >= 0 && point.x < png.width && point.y < png.height,
      ) &&
      actual.every((pixel) => pixel.length === 4 && pixel[3] === 255) &&
      meanSeparation >= 30;
    const matches = (own: typeof low, other: typeof low) =>
      valid &&
      own.mean <= 12 &&
      own.matchingPixels >= Math.ceil(points.length * 0.8) &&
      other.mean - own.mean >= 24;
    const state = matches(high, low) ? 'HIGH' : matches(low, high) ? 'LOW' : 'UNKNOWN';
    return { state, low, high, meanSeparation, actual };
  };
  const led = classify(references.led),
    l = classify(references.l);
  return {
    led,
    l,
    limits: {
      meanError: 12,
      perChannelError: 24,
      matchingPixelFraction: 0.8,
      minimumSeparation: 30,
      winningMargin: 24,
    },
  };
}

async function d2NativeSamples(page: Page, stage: D2Stage, raw: TemporalProbe): Promise<void> {
  const full = await observation(page);
  const ready = raw.frames.filter((frame) => frame.executionStatus === 'ready');
  const generationId = ready[0]!.generationId!;
  const physical: D2NativeProbe = {
    source: stage.source,
    epoch: generationId,
    clicks: full.startClicks.map((click) => ({ ...click, action: 'start' })),
    frames: ready.map((frame) => ({
      at: frame.at,
      status: frame.executionStatus,
      solved: frame.solved,
      quality: { passed: frame.qualityPassed },
      source: frame.source,
      loadedSource:
        full.worker
          .find((row) => row.requestId === frame.requestId)
          ?.boards.find((board) => board.componentId === 'uno')?.loadedSource ?? null,
      generationId: frame.generationId!,
      requestId: frame.requestId,
      committedUs: frame.committedHorizonMicroseconds,
      components: frame.components,
    })),
  };
  const bases = D2_IDS.map((id) => d2NativeAssetBasis(physical, id));
  const { PNG } = await import('pngjs');
  const requested = ['100', '000', '010', '000', '001', '000', '100'];
  let previousShotAt: number | null = null;
  let previousRequested: string | null = null;
  let seekFrom = await page.evaluate(() => performance.now());
  for (let index = 0; index < requested.length; index++) {
    const vector = requested[index]!;
    // Wait for a fresh actually painted phase. Do not rename an ambiguous PNG,
    // retry a failed image or advance the simulation with a separate timer.
    await page.waitForFunction(
      ({ vector, seekFrom }) => {
        const probe = window as D2Window;
        const run = probe.__ownerTemporal!.paintRuns.at(-1);
        const l = probe.__d2L!.at(-1);
        return (
          !!run &&
          run.first.previousFrameAt !== null &&
          run.first.previousFrameAt >= seekFrom &&
          run.first.brightness.map((value) => (value > 0 ? '1' : '0')).join('') === vector &&
          run.first.images.length === 3 &&
          run.first.images.every(
            (image, led) =>
              image.decoded &&
              image.visible &&
              image.unoccluded &&
              image.opacity === 1 &&
              image.lit === run.first.brightness[led]! > 0,
          ) &&
          !!l &&
          l.activeAttribute === 'false' &&
          l.opacity === 0 &&
          l.visible
        );
      },
      { vector, seekFrom },
      { timeout: 20_000 },
    );
    const beforeShot = JSON.parse(
      await page.evaluate(() => {
        const probe = window as D2Window;
        return JSON.stringify({ paint: probe.__ownerPaint!.at(-1)!, l: probe.__d2L!.at(-1)! });
      }),
    ) as { paint: PaintReceipt; l: D2LReceipt };
    const name = `d2-d4-native-${index}-${vector}`;
    const path = resolve(artifactRoot, name + '.png');
    const bytes = await page.screenshot({ path });
    const during = JSON.parse(
      await page.evaluate((from) => {
        const probe = window as D2Window;
        return JSON.stringify({
          paint: probe.__ownerPaint!.filter((row) => row.at >= from),
          l: probe.__d2L!.filter((row) => row.at >= from),
          at: performance.now(),
        });
      }, beforeShot.paint.at),
    ) as { paint: PaintReceipt[]; l: D2LReceipt[]; at: number };
    const png = PNG.sync.read(bytes);
    const references = await Promise.all(
      bases.map((basis, led) =>
        d2NativeReferences(
          page,
          {
            led: {
              href: beforeShot.paint.images[led]!.href,
              rect: beforeShot.paint.images[led]!.rect,
            },
            board: { href: beforeShot.l.boardHref, rect: beforeShot.l.boardRect },
            lRect: beforeShot.l.rect,
          },
          png.width,
          png.height,
          basis,
        ),
      ),
    );
    const pixels = references.map((reference) => d2ClassifyNativePng(png, reference));
    const observedVector = pixels
      .map((pixel) => (pixel.led.state === 'HIGH' ? '1' : pixel.led.state === 'LOW' ? '0' : '?'))
      .join('');
    const sameRect = (
      actual: D2NativeImageWitness['rect'],
      expected: D2NativeImageWitness['rect'],
    ) =>
      actual !== null &&
      expected !== null &&
      (['x', 'y', 'width', 'height'] as const).every(
        (key) => Math.abs(actual[key] - expected[key]) <= 0.25,
      );
    const fixedGeometry =
      during.paint.length >= 2 &&
      during.l.length >= 2 &&
      during.paint.every(
        (paint) =>
          paint.images.length === 3 &&
          paint.images.every((image, led) =>
            sameRect(image.rect, beforeShot.paint.images[led]!.rect),
          ),
      ) &&
      during.l.every(
        (l) => sameRect(l.rect, beforeShot.l.rect) && sameRect(l.boardRect, beforeShot.l.boardRect),
      );
    const coherentWitness = during.paint.some(
      (paint) =>
        paint.stablePreviousFrame &&
        paint.images.length === 3 &&
        paint.images.every(
          (image, led) =>
            image.decoded &&
            image.visible &&
            image.unoccluded &&
            image.opacity === 1 &&
            image.lit === paint.brightness[led]! > 0,
        ) &&
        d2Vector(paint.brightness) === vector,
    );
    const lOff =
      pixels.every((pixel) => pixel.l.state === 'LOW') &&
      during.l.every((l) => l.activeAttribute === 'false' && l.opacity === 0 && l.visible);
    const evidence = {
      name,
      path,
      requestedVector: vector,
      observedVector,
      generationId,
      sourceSha256: createHash('sha256').update(stage.source).digest('hex'),
      beforeShot,
      during,
      references,
      pixels,
      fixedGeometry,
      coherentWitness,
      lOff,
      interpretation:
        'The actual screenshot pixels determine each LED state and D13 L. Labels, requested states and filenames cannot satisfy this check.',
    };
    d2Ledger!.native.push(evidence);
    writeFileSync(resolve(artifactRoot, name + '.json'), JSON.stringify(evidence, null, 2) + '\n');
    await test.info().attach(name + '-native', { path, contentType: 'image/png' });
    expect(fixedGeometry, 'stable actual LED/board/L geometry during PNG capture').toBe(true);
    expect(coherentWitness, 'mounted loaded image witness during native PNG capture').toBe(true);
    expect(observedVector, 'independently classified three-channel PNG').toBe(vector);
    expect(lOff, 'D13 L actual PNG and complete capture window remain dark').toBe(true);
    if (previousShotAt !== null) {
      const recent = await temporalObservation(page);
      const between = d2PaintEdges(recent, previousShotAt).filter(
        (edge) => edge.at <= beforeShot.paint.at,
      );
      expect(
        between.map((edge) => edge.vector),
        'native screenshots must follow adjacent phases of the real joint sequence',
      ).toEqual([previousRequested, vector]);
    }
    previousShotAt = beforeShot.paint.at;
    previousRequested = vector;
    seekFrom = during.at;
  }
  const complete = await temporalObservation(page);
  assertTemporalFrames(complete, stage.source, generationId);
  const actionAt = physical.clicks.find((click) => click.trusted)!.at;
  const causal = temporalPaintCausality(complete, stage.source, generationId, actionAt);
  expect(
    causal.violations,
    'native captures remain within the same-source same-generation physical timeline',
  ).toEqual([]);
  const l = JSON.parse(
    await page.evaluate(() => JSON.stringify((window as D2Window).__d2L ?? [])),
  ) as D2LReceipt[];
  expect(
    l
      .filter((row) => row.at >= actionAt)
      .every((row) => row.activeAttribute === 'false' && row.opacity === 0 && row.visible),
  ).toBe(true);
  writeFileSync(
    resolve(artifactRoot, 'd2-d4-native-causality.json'),
    JSON.stringify(causal, null, 2) + '\n',
  );
}

async function retainD2Ledger(info: import('@playwright/test').TestInfo): Promise<void> {
  if (!d2Ledger) throw new Error('missing dedicated D2 ledger');
  const path = resolve(artifactRoot, `d2-d4-ledger-${info.workerIndex}-${info.retry}.json`);
  const receipt = {
    ...d2Ledger,
    acceptance: info.status === 'passed' && d2Ledger.completed ? 'PASS' : 'FAIL',
    actualStatus: info.status,
    budgets: { acquisitionMs: D2_WAIT_MS, nativeJointVectorMs: 20_000, caseMs: 840_000 },
    fixedProductPace: 0.125,
  };
  writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n');
  await info.attach('classroom-d2-d4-ledger', { path, contentType: 'application/json' });
  if (info.status === 'passed') {
    expect(d2Ledger.completed).toBe(true);
    expect(d2Ledger.stages.map((stage) => stage.stage)).toEqual([
      '100-100',
      '200-200',
      '300-300',
      '150-150',
      '100-300',
      'reset-100-300',
      'reopened-100-300',
    ]);
    expect(d2Ledger.native.length).toBe(7);
  }
}

test.describe('Classroom D2-D4 next visible slice', () => {
  test(D2_CLASSROOM_CASE, async ({ browser, baseURL }) => {
    test.setTimeout(840_000);
    const primaryContext = await browser.newContext({
      baseURL,
      viewport: { width: 1600, height: 1000 },
      recordVideo: {
        dir: resolve(artifactRoot, 'd2-d4-primary-video'),
        size: { width: 1600, height: 1000 },
      },
    });
    let primaryVideo: ReturnType<Page['video']> = null;
    try {
      const page = await primaryContext.newPage();
      primaryVideo = page.video();
      expect(d2Ledger).not.toBeNull();
      const stages: D2Stage[] = [
        [100, 100],
        [200, 200],
        [300, 300],
        [150, 150],
        [100, 300],
      ].map(([highMs, offMs]) => ({
        name: `${highMs}-${offMs}`,
        highMs: highMs!,
        offMs: offMs!,
        source: d2Sketch(highMs!, offMs!),
      }));
      const lesson = readFileSync(resolve(D2_LESSON_PATH), 'utf8');
      for (const stage of stages) expect(lesson).toContain('```cpp\n' + stage.source + '```');
      let session = await d2OpenOwnerTemporalSketch(page, stages[0]!.source, 'next-d2-d4');
      await d2BuildProvenance(page);
      const projectUrl = page.url();
      const initialWiring = session.saved.draft.document.connections;
      for (let index = 0; index < stages.length; index++) {
        const stage = stages[index]!;
        if (index > 0) {
          const saved = await d2EditAndSave(page, session, stage);
          session = { ...session, source: stage.source, saved };
        }
        session.startAt = await d2ClearProbe(page);
        await d2Capture(page, session, stage);
        if (stage.name === '300-300') {
          try {
            await d2NativeSamples(page, stage, await temporalObservation(page));
          } finally {
            await d2RetainRaw(page, session, stage.name + '-native', d2Ledger!.native);
          }
        }
        if (index < stages.length - 1) await d2Stop(page);
      }
      const byName = new Map(d2Ledger!.stages.map((stage) => [stage.stage, stage]));
      const timing = [100, 150, 200, 300].map(
        (delay) => byName.get(`${delay}-${delay}`)!.medianCycleMs,
      );
      expect(timing[0]!).toBeLessThan(timing[1]!);
      expect(timing[1]!).toBeLessThan(timing[2]!);
      expect(timing[2]!).toBeLessThan(timing[3]!);
      for (const [index, low, high] of [
        [1, 1.2, 1.8],
        [2, 1.6, 2.4],
        [3, 2.4, 3.6],
      ]) {
        expect(timing[index!]! / timing[0]!).toBeGreaterThanOrEqual(low!);
        expect(timing[index!]! / timing[0]!).toBeLessThanOrEqual(high!);
      }
      const last = stages.at(-1)!;
      const beforeResetGeneration = d2Ledger!.stages.at(-1)!.generationId;
      session.startAt = await d2ClearProbe(page);
      const reset = await d2Capture(page, session, { ...last, name: 'reset-100-300' }, 'reset');
      expect(reset.generationId).not.toBe(beforeResetGeneration);
      await d2Stop(page);
      expect((await session.read()).draft).toEqual(session.saved.draft);
      expect(session.saved.draft.document.connections).toEqual(initialWiring);
      session.failures.assertEmpty();

      // Cookies alone carry authentication. No storage state, in-memory circuit,
      // local/session storage or saved observer buffers enter the new browser context.
      const context = await browser.newContext({
        viewport: { width: 1600, height: 1000 },
        recordVideo: {
          dir: resolve(artifactRoot, 'd2-d4-reopen-video'),
          size: { width: 1600, height: 1000 },
        },
      });
      let reopenedVideo: ReturnType<Page['video']> = null;
      try {
        await context.addCookies(await page.context().cookies());
        const reopened = await context.newPage();
        reopenedVideo = reopened.video();
        const failures = collectBrowserFailures(reopened, { allowAnonymousSessionProbe: true });
        await observeOwnerTemporal(reopened);
        await d2ObserveL(reopened);
        await reopened.goto(projectUrl);
        await expect(reopened.locator('.workbench-stage')).toBeVisible();
        await expect(reopened.getByTestId('schematic-component')).toHaveCount(7);
        await d2BuildProvenance(reopened);
        const read = async (): Promise<D2SavedProject> => {
          const response = await context.request.get(
            new URL(session.endpoint, session.origin).href,
            {
              headers: { origin: session.origin },
            },
          );
          expect(response.status()).toBe(200);
          return response.json() as Promise<D2SavedProject>;
        };
        expect((await read()).draft).toEqual(session.saved.draft);
        await reopened.getByRole('button', { name: 'Открыть редактор кода', exact: true }).click();
        await expect(reopened.locator('.arduino-source-editor textarea')).toHaveValue(last.source);
        await reopened.getByRole('button', { name: 'Закрыть редактор кода', exact: true }).click();
        await expect(reopened.locator('.arduino-code-panel')).toHaveClass(/closed/);
        const reopenedSession = {
          ...session,
          read,
          failures,
          startAt: await d2ClearProbe(reopened),
        };
        await d2Capture(reopened, reopenedSession, { ...last, name: 'reopened-100-300' });
        await d2Stop(reopened);
        expect((await read()).draft).toEqual(session.saved.draft);
        failures.assertEmpty();
      } finally {
        await context.close();
        if (!reopenedVideo) throw new Error('cookies-only reopen native video missing');
        await test.info().attach('d2-d4-cookies-only-reopen-video', {
          path: await reopenedVideo.path(),
          contentType: 'video/webm',
        });
      }
    } finally {
      await primaryContext.close();
      if (!primaryVideo) throw new Error('D2-D4 primary native video missing');
      await test.info().attach('d2-d4-primary-video', {
        path: await primaryVideo.path(),
        contentType: 'video/webm',
      });
    }
    d2Ledger!.completed = true;
  });
});
