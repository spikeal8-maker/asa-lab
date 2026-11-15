import { afterEach, describe, expect, it, vi } from 'vitest';
import * as simulation from '../domain/simulation.js';
import {
  HC_SR04_V2_MODEL_SET_DIGEST,
  PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
  PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST,
  PRE_HC_SR04_V2_MODEL_SET_DIGEST,
  serializePreHcSr04V2Golden,
} from './fixtures/model-set-golden-compatibility.js';

const UNREVIEWED_MODEL_SET_DIGEST = `sha256:${'0'.repeat(64)}`;

afterEach(() => vi.restoreAllMocks());

describe('reviewed pre-HC-SR04 v2 model-set golden compatibility', () => {
  it('pins the installed complete registry rather than accepting its current value dynamically', () => {
    expect(simulation.simulationModelSetDigest()).toBe(PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST);
    expect(PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST).not.toBe(PRE_HC_SR04_V2_MODEL_SET_DIGEST);
  });

  it('changes only exact metadata fields and preserves unrelated JSON bytes without mutating the result', () => {
    const savedRuntime =
      '{\n  "modelSetDigest":"' +
      PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST +
      '","boards":[{"pc":17}],"thermal":{"origin":0.125}\n}\n';
    const result = Object.freeze({
      before: 'header',
      modelSetDigest: PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
      nested: Object.freeze([
        Object.freeze({
          z: 3,
          a: 1,
          modelSetDigest: PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
          note: PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
        }),
      ]),
      serializedState: savedRuntime,
      simulationInputDigest: PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
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
      PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST +
      '"}],"serializedState":' +
      JSON.stringify(savedRuntime) +
      ',"simulationInputDigest":"' +
      PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST +
      '","numericalResidual":1.25e-16,"voltages":[5,0.125,-2.75]}';
    expect(serializePreHcSr04V2Golden(result)).toBe(expected);
    expect(JSON.parse(serializePreHcSr04V2Golden(result)).serializedState).toBe(savedRuntime);
    expect(JSON.stringify(result)).toBe(original);
  });

  it('leaves raw digest operation results and ordinary text unchanged', () => {
    for (const value of [
      '853a23db6bd6ff20c999efb888508bd8031e6a4e40e32af61d986fbe18595cd6',
      PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
      PRE_HC_SR04_V2_MODEL_SET_DIGEST,
      '{"modelSetDigest":"' + PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST + '"}',
    ])
      expect(serializePreHcSr04V2Golden(value)).toBe(value);
  });

  it.each([
    PRE_HC_SR04_V2_MODEL_SET_DIGEST,
    HC_SR04_V2_MODEL_SET_DIGEST,
    PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST,
    UNREVIEWED_MODEL_SET_DIGEST,
    PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST + '-suffix',
    null,
    undefined,
    true,
    2,
  ])('rejects an unexpected structured digest field %s instead of erasing it', (modelSetDigest) => {
    expect(() =>
      serializePreHcSr04V2Golden({
        modelSetDigest: PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
        nested: [{ modelSetDigest }],
      }),
    ).toThrow('Unreviewed modelSetDigest field');
  });

  it.each([
    PRE_HC_SR04_V2_MODEL_SET_DIGEST,
    HC_SR04_V2_MODEL_SET_DIGEST,
    PHOTORESISTOR_THERMAL_MODEL_SET_DIGEST,
    UNREVIEWED_MODEL_SET_DIGEST,
  ])(
    'rejects an unreviewed installed registry %s even when the result has no metadata',
    (registry) => {
      vi.spyOn(simulation, 'simulationModelSetDigest').mockReturnValue(registry);
      for (const result of [
        { modelSetDigest: PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST },
        { current: 0.005, nodes: [5, 0] },
        'unchanged-input-digest',
      ])
        expect(() => serializePreHcSr04V2Golden(result)).toThrow('Unreviewed model registry');
    },
  );
});
