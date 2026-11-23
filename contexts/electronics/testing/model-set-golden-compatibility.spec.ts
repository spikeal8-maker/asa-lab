import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as simulation from '../domain/simulation.js';
import { advanceElectronicsToHorizon, parseElectronicsEngineDocument } from '../engine.js';
import { advanceArduinoCircuitClock } from '../domain/arduino-circuit-scheduler.js';
import type { ElectronicsDocument, SchematicComponent } from '../domain/document.js';
import {
  componentModelIdentityIsInstalled,
  electricalModelIdentityForComponent,
  electricalModelRegistryEntries,
} from '../domain/model-identity.js';
import {
  advanceHcSr04Due,
  isHcSr04RuntimeState,
  observeHcSr04Inputs,
} from '../domain/models/hc-sr04-runtime.js';
import {
  advancePingUltrasonicDue,
  isPingUltrasonicRuntimeState,
  observePingUltrasonicSignal,
} from '../domain/models/ping-ultrasonic-runtime.js';
import {
  HC_SR04_V2_MODEL_SET_DIGEST,
  ULTRASONIC_OUTPUT_MODEL_SET_DIGEST,
  PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST,
  PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
  PRE_HC_SR04_V2_MODEL_SET_DIGEST,
  serializePreHcSr04V2Golden,
  ULTRASONIC_U01_LEGACY_SAMPLES,
} from './fixtures/model-set-golden-compatibility.js';

const UNREVIEWED_MODEL_SET_DIGEST = `sha256:${'0'.repeat(64)}`;

afterEach(() => vi.restoreAllMocks());

describe('reviewed pre-HC-SR04 v2 model-set golden compatibility', () => {
  it('pins the installed complete registry rather than accepting its current value dynamically', () => {
    expect(simulation.simulationModelSetDigest()).toBe(ULTRASONIC_OUTPUT_MODEL_SET_DIGEST);
    expect(ULTRASONIC_OUTPUT_MODEL_SET_DIGEST).not.toBe(PRE_HC_SR04_V2_MODEL_SET_DIGEST);
  });

  it('changes only exact metadata fields and preserves unrelated JSON bytes without mutating the result', () => {
    const savedRuntime =
      '{\n  "modelSetDigest":"' +
      ULTRASONIC_OUTPUT_MODEL_SET_DIGEST +
      '","boards":[{"pc":17}],"thermal":{"origin":0.125}\n}\n';
    const result = Object.freeze({
      before: 'header',
      modelSetDigest: ULTRASONIC_OUTPUT_MODEL_SET_DIGEST,
      nested: Object.freeze([
        Object.freeze({
          z: 3,
          a: 1,
          modelSetDigest: ULTRASONIC_OUTPUT_MODEL_SET_DIGEST,
          note: ULTRASONIC_OUTPUT_MODEL_SET_DIGEST,
        }),
      ]),
      serializedState: savedRuntime,
      simulationInputDigest: ULTRASONIC_OUTPUT_MODEL_SET_DIGEST,
      numericalResidual: 0.000000000000000125,
      voltages: Object.freeze([5, 0.125, -2.75]),
    });
    const original = JSON.stringify(result);
    const expected =
      '{"before":"header","modelSetDigest":"' +
      PRE_HC_SR04_V2_MODEL_SET_DIGEST +
      '","nested":[{"z":3,"a":1,"modelSetDigest":"' +
      PRE_HC_SR04_V2_MODEL_SET_DIGEST +
      '","note":"' +
      ULTRASONIC_OUTPUT_MODEL_SET_DIGEST +
      '"}],"serializedState":' +
      JSON.stringify(savedRuntime) +
      ',"simulationInputDigest":"' +
      ULTRASONIC_OUTPUT_MODEL_SET_DIGEST +
      '","numericalResidual":1.25e-16,"voltages":[5,0.125,-2.75]}';
    expect(serializePreHcSr04V2Golden(result)).toBe(expected);
    expect(JSON.parse(serializePreHcSr04V2Golden(result)).serializedState).toBe(savedRuntime);
    expect(JSON.stringify(result)).toBe(original);
  });

  it('leaves raw digest operation results and ordinary text unchanged', () => {
    for (const value of [
      '853a23db6bd6ff20c999efb888508bd8031e6a4e40e32af61d986fbe18595cd6',
      ULTRASONIC_OUTPUT_MODEL_SET_DIGEST,
      PRE_HC_SR04_V2_MODEL_SET_DIGEST,
      '{"modelSetDigest":"' + ULTRASONIC_OUTPUT_MODEL_SET_DIGEST + '"}',
    ])
      expect(serializePreHcSr04V2Golden(value)).toBe(value);
  });

  it.each([
    PRE_HC_SR04_V2_MODEL_SET_DIGEST,
    HC_SR04_V2_MODEL_SET_DIGEST,
    PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST,
    PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
    UNREVIEWED_MODEL_SET_DIGEST,
    ULTRASONIC_OUTPUT_MODEL_SET_DIGEST + '-suffix',
    null,
    undefined,
    true,
    2,
  ])('rejects an unexpected structured digest field %s instead of erasing it', (modelSetDigest) => {
    expect(() =>
      serializePreHcSr04V2Golden({
        modelSetDigest: ULTRASONIC_OUTPUT_MODEL_SET_DIGEST,
        nested: [{ modelSetDigest }],
      }),
    ).toThrow('Unreviewed modelSetDigest field');
  });

  it.each([
    PRE_HC_SR04_V2_MODEL_SET_DIGEST,
    HC_SR04_V2_MODEL_SET_DIGEST,
    PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST,
    PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
    UNREVIEWED_MODEL_SET_DIGEST,
  ])(
    'rejects an unreviewed installed registry %s even when the result has no metadata',
    (registry) => {
      vi.spyOn(simulation, 'simulationModelSetDigest').mockReturnValue(registry);
      for (const result of [
        { modelSetDigest: ULTRASONIC_OUTPUT_MODEL_SET_DIGEST },
        { current: 0.005, nodes: [5, 0] },
        'unchanged-input-digest',
      ])
        expect(() => serializePreHcSr04V2Golden(result)).toThrow('Unreviewed model registry');
    },
  );
});

function parsedDocument(value: unknown): ElectronicsDocument {
  const parsed = parseElectronicsEngineDocument(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
const identityKeys = new Set([
  'electricalModelId',
  'electricalModelVersion',
  'modelProfileId',
  'modelProfileVersion',
]);
function projectData(document: ElectronicsDocument) {
  return {
    ...document,
    components: document.components.map((component) =>
      Object.fromEntries(Object.entries(component).filter(([key]) => !identityKeys.has(key))),
    ),
  };
}
function withSensor(
  document: ElectronicsDocument,
  change: Partial<SchematicComponent>,
): ElectronicsDocument {
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === 'sensor' ? { ...component, ...change } : component,
    ),
  };
}

describe('U01 exact identity transition and genuine continuation rejection', () => {
  it('pins the new full registry and keeps model/profile IDs and model family versions', () => {
    const entries = electricalModelRegistryEntries();
    expect(entries.find((entry) => entry.componentTypeId === 'ultrasonic-hc-sr04')).toEqual({
      componentTypeId: 'ultrasonic-hc-sr04',
      electricalModelId: 'hc-sr04-distance-sensor',
      electricalModelVersion: 1,
      modelProfileId: 'hc-sr04-canonical-echo-v1',
      modelProfileVersion: 3,
    });
    expect(entries.find((entry) => entry.componentTypeId === 'ultrasonic-sensor')).toEqual({
      componentTypeId: 'ultrasonic-sensor',
      electricalModelId: 'ping-ultrasonic-distance-sensor',
      electricalModelVersion: 1,
      modelProfileId: 'ping-3pin-canonical-echo-v1',
      modelProfileVersion: 2,
    });
    expect(simulation.simulationModelSetDigest()).toBe(ULTRASONIC_OUTPUT_MODEL_SET_DIGEST);
    expect(ULTRASONIC_OUTPUT_MODEL_SET_DIGEST).not.toBe(PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST);
  });

  for (const sample of ULTRASONIC_U01_LEGACY_SAMPLES) {
    for (const sourceVersion of sample.kind === 'hc'
      ? ([1, 2, 'placeholder'] as const)
      : ([1, 'placeholder'] as const)) {
      it(`upgrades only known ${sample.kind} ${sourceVersion} documents while preserving user data for a fresh Run`, () => {
        const original = JSON.parse(JSON.stringify(sample.document)) as ElectronicsDocument;
        const withSettings: ElectronicsDocument = {
          ...original,
          components: original.components.map((component) => ({
            ...component,
            stateProperties: {
              ...component.stateProperties,
              ...(component.id === 'uno'
                ? {
                    arduinoWorkspace: '{"blocks":{"languageVersion":0}}',
                    arduinoCodeMode: 'blocks',
                    arduinoInputPins: ['2', 'A0'],
                  }
                : { echoAvailable: true, ownerCalibration: 17 }),
            },
          })),
        };
        const sensor = withSettings.components.find((component) => component.id === 'sensor')!;
        const saved = withSensor(
          withSettings,
          sourceVersion === 'placeholder'
            ? {
                electricalModelId: 'unsupported',
                electricalModelVersion: 1,
                modelProfileId: `unsupported-${sensor.componentTypeId}`,
                modelProfileVersion: 1,
              }
            : { modelProfileVersion: sourceVersion },
        );
        const unchanged = JSON.stringify(saved);
        const reopened = parsedDocument(saved);
        expect(projectData(reopened)).toEqual(projectData(saved));
        expect(JSON.stringify(saved)).toBe(unchanged);
        const upgraded = reopened.components.find((component) => component.id === 'sensor')!;
        expect(componentModelIdentityIsInstalled(upgraded)).toBe(true);
        expect(electricalModelIdentityForComponent(upgraded).modelProfileVersion).toBe(
          sample.kind === 'hc' ? 3 : 2,
        );
        let run = advanceElectronicsToHorizon(reopened, {
          requestedHorizonMicroseconds: 40000,
          maxEvents: 1024,
        });
        for (let count = 0; run.executionStatus === 'yielded' && count < 10000; count++)
          run = advanceElectronicsToHorizon(reopened, {
            requestedHorizonMicroseconds: 40000,
            maxEvents: 1024,
            state: JSON.parse(JSON.stringify(run.state)),
          });
        expect(run.executionStatus).toBe('ready');
        expect(run.state.continuation?.modelSetDigest).toBe(ULTRASONIC_OUTPUT_MODEL_SET_DIGEST);
        expect(
          JSON.parse(run.state.continuation!.serializedState).boards[0].runtime.variables.duration,
        ).toBe(5800);
      });
    }

    it(`keeps the captured ${sample.kind} opaque bytes authentic`, () => {
      expect(sample.publicState.continuation.modelSetDigest).toBe(
        PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
      );
      expect(
        createHash('sha256').update(sample.publicState.continuation.serializedState).digest('hex'),
      ).toBe(
        sample.kind === 'hc'
          ? '3eb916f612e6b1d5e759d76104ec2edf9916631339c88e95647b8a5b87cb9309'
          : 'e569883a27e200bfab2269d7f31eae3c39381a2c29d6b96f22c2462e7fe9105e',
      );
    });

    for (const explicit of [true, false]) {
      it(`rejects unchanged old ${sample.kind} public and scheduler continuations, explicit identity=${explicit}`, () => {
        const saved = (
          explicit ? JSON.parse(JSON.stringify(sample.document)) : projectData(sample.document)
        ) as ElectronicsDocument;
        const opaqueBefore = JSON.stringify(sample.publicState);
        const publicResult = advanceElectronicsToHorizon(saved, {
          requestedHorizonMicroseconds: 200,
          maxEvents: 1024,
          state: sample.publicState,
        });
        expect(publicResult.executionStatus).toBe('fault');
        expect(publicResult.diagnostics.map((entry) => entry.code)).toContain(
          'invalid_timed_continuation',
        );
        const oldClock = JSON.parse(sample.publicState.continuation.serializedState);
        const schedulerResult = advanceArduinoCircuitClock(saved, 200, oldClock, {
          maxClockEvents: 1024,
        });
        expect(schedulerResult.executionStatus).toBe('fault');
        expect(schedulerResult.diagnostics.map((entry) => entry.code)).toContain(
          'invalid_clock_continuation',
        );
        expect(JSON.stringify(sample.publicState)).toBe(opaqueBefore);
        expect(JSON.stringify(oldClock)).toBe(sample.publicState.continuation.serializedState);
      });
    }

    it(`rejects the genuine version 1 ${sample.kind} state in direct runtime calls`, () => {
      const clock = JSON.parse(sample.publicState.continuation.serializedState);
      if (sample.kind === 'hc') {
        const old = clock.hcSr04[0].runtime;
        expect(isHcSr04RuntimeState(old)).toBe(false);
        expect(() => advanceHcSr04Due(old, 200)).toThrow('Invalid HC-SR04 runtime continuation');
        expect(() => observeHcSr04Inputs(old, 200, true, false, 1)).toThrow(
          'Invalid HC-SR04 runtime continuation',
        );
      } else {
        const old = clock.pingUltrasonic[0].runtime;
        expect(isPingUltrasonicRuntimeState(old)).toBe(false);
        expect(() => advancePingUltrasonicDue(old, 200)).toThrow(
          'Invalid PING ultrasonic runtime continuation',
        );
        expect(() => observePingUltrasonicSignal(old, 200, true, false, 1)).toThrow(
          'Invalid PING ultrasonic runtime continuation',
        );
      }
    });

    for (const invalid of [
      { modelProfileVersion: sample.kind === 'hc' ? 4 : 3 },
      { modelProfileId: 'unknown-ultrasonic-profile' },
      { electricalModelVersion: 2 },
      { electricalModelId: 'unknown-ultrasonic-model' },
      {
        electricalModelId: 'unsupported',
        modelProfileId: `unsupported-${sample.kind === 'hc' ? 'ultrasonic-hc-sr04' : 'ultrasonic-sensor'}`,
        modelProfileVersion: 2,
      },
    ]) {
      it(`rejects unlisted ${sample.kind} tuple ${JSON.stringify(invalid)}`, () => {
        const document = parsedDocument(
          withSensor(JSON.parse(JSON.stringify(sample.document)), invalid),
        );
        expect(
          componentModelIdentityIsInstalled(
            document.components.find((component) => component.id === 'sensor')!,
          ),
        ).toBe(false);
        const result = advanceElectronicsToHorizon(document, {
          requestedHorizonMicroseconds: 200,
          maxEvents: 1024,
        });
        expect(result.executionStatus).toBe('fault');
        expect(result.diagnostics.length).toBeGreaterThan(0);
      });
    }
  }

  it('preserves invalid legacy PING distance=4m and refuses the new run instead of clamping it', () => {
    const saved = ULTRASONIC_U01_LEGACY_SAMPLES.find((sample) => sample.kind === 'ping')!.document;
    const document = parsedDocument(withSensor(saved, { stateProperties: { distanceMeters: 4 } }));
    expect(
      document.components.find((component) => component.id === 'sensor')?.stateProperties
        ?.distanceMeters,
    ).toBe(4);
    const result = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 200,
      maxEvents: 1024,
    });
    expect(result.executionStatus).toBe('fault');
    expect(result.diagnostics.map((entry) => entry.code)).toContain(
      'invalid_ping_ultrasonic_distance',
    );
  });
});
