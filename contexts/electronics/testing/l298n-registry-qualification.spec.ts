import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalElectricalModelRegistry,
  electricalModelRegistryEntries,
} from '../domain/model-identity.js';
import { simulationModelSetDigest } from '../domain/simulation.js';
import {
  L298N_MODEL_SET_DIGEST,
  PRE_L298N_REGISTRY_SHA256,
  PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST,
  serializePreHcSr04V2Golden,
} from './fixtures/model-set-golden-compatibility.js';

const L298N_IDENTITY = 'l298n-motor-driver';
const sha256 = (value: string): string =>
  'sha256:' + createHash('sha256').update(value, 'utf8').digest('hex');

describe('L298N explicit model-set migration evidence', () => {
  it('computes separate pinned hashes for new model registry and unaffected historical entries', () => {
    const registry = JSON.parse(canonicalElectricalModelRegistry()) as {
      registryVersion: number;
      entries: Array<{
        componentTypeId: string;
        electricalModelId: string;
        modelProfileId: string;
      }>;
    };
    const l298n = registry.entries.filter((entry) => entry.componentTypeId === L298N_IDENTITY);
    expect(l298n).toEqual([
      expect.objectContaining({
        componentTypeId: L298N_IDENTITY,
        electricalModelId: 'l298n-dual-hbridge',
        modelProfileId: 'l298n-red-43mm-v1',
      }),
    ]);
    expect(electricalModelRegistryEntries()).toEqual(registry.entries);
    const prior = {
      registryVersion: registry.registryVersion,
      entries: registry.entries.filter((entry) => entry.componentTypeId !== L298N_IDENTITY),
    };
    const oldProjection = sha256(JSON.stringify(prior));
    const currentDigest = simulationModelSetDigest();
    expect(prior.entries).toHaveLength(43);
    expect(registry.entries).toHaveLength(44);
    expect(oldProjection).toBe(PRE_L298N_REGISTRY_SHA256);
    expect(currentDigest).toBe(L298N_MODEL_SET_DIGEST);
    expect(currentDigest).not.toBe(PHOTORESISTOR_OPTICAL_MODEL_SET_DIGEST);
    // No historic benchmark is rewritten: only exact modelSetDigest metadata
    // gets an explicit, reviewed comparison transformation.
    const old = Object.freeze({
      modelSetDigest: currentDigest,
      savedProgram: '{"modelSetDigest":"' + currentDigest + '"}',
      voltage: 5,
    });
    const converted = JSON.parse(serializePreHcSr04V2Golden(old)) as Record<string, unknown>;
    expect(converted.modelSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(converted.savedProgram).toBe(old.savedProgram);
    expect(converted.voltage).toBe(5);
    expect(oldProjection).not.toBe(sha256(canonicalElectricalModelRegistry()));
  });
});
