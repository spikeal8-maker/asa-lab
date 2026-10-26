import { describe, expect, it } from 'vitest';
import {
  PUBLIC_ARTIFACT_V1_LIMITS,
  validatePublicArtifact,
} from '../../../packages/contracts/src/public-artifact.js';

function fixture() {
  return {
    schemaVersion: 1,
    provenance: { publicationId: 'ab123456-1234-1234-1234-123456789abc', revisionNumber: 1 },
    capabilities: { readOnly: true, interactive: false, download: false },
    status: 'static-only',
    viewerFamily: 'electronics',
    reason: 'viewer-not-available',
  };
}

const invalid = { ok: false, reason: 'invalid-public-artifact' };

describe('PublicArtifact v1 runtime schema', () => {
  it.each(['three-d', 'electronics', 'blocks'])('accepts honest static-only %s', (viewerFamily) => {
    const input = { ...fixture(), viewerFamily };
    const result = validatePublicArtifact(input);
    expect(result).toEqual({ ok: true, artifact: input });
    if (!result.ok) throw new Error('expected valid artifact');
    expect(JSON.parse(JSON.stringify(result.artifact))).toEqual(input);
    expect(Object.keys(result.artifact).sort()).toEqual(Object.keys(input).sort());
  });

  it('accepts an explicit unsupported outcome without viewer or download promises', () => {
    const input = {
      ...fixture(),
      status: 'unsupported',
      viewerFamily: null,
      reason: 'unsupported-module',
    };
    expect(validatePublicArtifact(input)).toEqual({ ok: true, artifact: input });
  });

  it('detaches and deeply freezes the validated projection', () => {
    const input = fixture();
    const result = validatePublicArtifact(input);
    if (!result.ok) throw new Error('expected valid artifact');
    input.provenance.revisionNumber = 2;
    input.capabilities.download = true;
    expect(result.artifact.provenance.revisionNumber).toBe(1);
    expect(result.artifact.capabilities.download).toBe(false);
    expect(result.artifact.provenance).not.toBe(input.provenance);
    for (const value of [
      result,
      result.artifact,
      result.artifact.provenance,
      result.artifact.capabilities,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(Object.isFrozen(PUBLIC_ARTIFACT_V1_LIMITS)).toBe(true);
  });

  it.each([undefined, null, [], true, 1, 'raw JSON', new Date(), new Map()])(
    'rejects non-record %s',
    (input) => {
      expect(validatePublicArtifact(input)).toEqual(invalid);
    },
  );

  it.each([0, 2, '1', null, NaN, Infinity])(
    'rejects unsupported/malformed version %s',
    (schemaVersion) => {
      expect(validatePublicArtifact({ ...fixture(), schemaVersion })).toEqual(invalid);
    },
  );

  it.each([0, -1, 1.5, '1', null, NaN, Infinity, -Infinity, 2_147_483_648])(
    'rejects revision %s',
    (revisionNumber) => {
      expect(
        validatePublicArtifact({
          ...fixture(),
          provenance: { ...fixture().provenance, revisionNumber },
        }),
      ).toEqual(invalid);
    },
  );

  it('accepts the exact revision ceiling and rejects a malformed public identifier', () => {
    const input = fixture();
    input.provenance.revisionNumber = PUBLIC_ARTIFACT_V1_LIMITS.maxRevisionNumber;
    expect(validatePublicArtifact(input).ok).toBe(true);
    input.provenance.publicationId = 'private-project-id';
    expect(validatePublicArtifact(input)).toEqual(invalid);
  });

  it.each([
    'payload',
    'project',
    'draft',
    'ownerId',
    'classId',
    'tenantId',
    'studentSeatId',
    'token',
    'secret',
    'write',
    'toJSON',
    '__proto__',
  ])('rejects injected %s at every object boundary', (field) => {
    for (const target of ['root', 'provenance', 'capabilities']) {
      const input = fixture();
      const object = target === 'root' ? input : input[target as 'provenance' | 'capabilities'];
      Object.defineProperty(object, field, { value: 'private', enumerable: true });
      expect(validatePublicArtifact(input)).toEqual(invalid);
    }
  });

  it.each([
    { readOnly: false, interactive: false, download: false },
    { readOnly: true, interactive: true, download: false },
    { readOnly: true, interactive: false, download: true },
    { readOnly: 'true', interactive: false, download: false },
    { readOnly: true, interactive: false },
  ])('rejects elevated or incomplete capabilities %j', (capabilities) => {
    expect(validatePublicArtifact({ ...fixture(), capabilities })).toEqual(invalid);
  });

  it.each([
    { status: 'ready' },
    { viewerFamily: 'unknown' },
    { viewerFamily: null },
    { reason: 'unsupported-module' },
    { status: 'unsupported' },
    { status: 'unsupported', reason: 'unsupported-module' },
  ])('rejects incompatible outcome %j', (change) => {
    expect(validatePublicArtifact({ ...fixture(), ...change })).toEqual(invalid);
  });

  it('rejects missing fields and malformed nested shapes', () => {
    for (const key of Object.keys(fixture())) {
      const input = { ...fixture() } as Record<string, unknown>;
      delete input[key];
      expect(validatePublicArtifact(input)).toEqual(invalid);
    }
    for (const provenance of [null, [], 'id', { publicationId: 'id' }]) {
      expect(validatePublicArtifact({ ...fixture(), provenance })).toEqual(invalid);
    }
  });

  it('fails closed on resource abuse, cycles, non-finite and unserializable values', () => {
    let nested: unknown = {};
    for (let i = 0; i <= PUBLIC_ARTIFACT_V1_LIMITS.maxDepth; i++) nested = { child: nested };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const many = Object.fromEntries(
      Array.from({ length: PUBLIC_ARTIFACT_V1_LIMITS.maxNodes + 1 }, (_, i) => [`k${i}`, i]),
    );
    const bytes = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`k${i}`, '界'.repeat(128)]),
    );
    expect(new TextEncoder().encode(JSON.stringify(bytes)).byteLength).toBeGreaterThan(
      PUBLIC_ARTIFACT_V1_LIMITS.maxBytes,
    );
    for (const abuse of [
      nested,
      cycle,
      many,
      bytes,
      'x'.repeat(129),
      NaN,
      Infinity,
      1n,
      () => 1,
      Symbol('secret'),
    ]) {
      expect(validatePublicArtifact({ ...fixture(), provenance: abuse })).toEqual(invalid);
    }
  });

  it('does not execute accessors or serialization hooks and rejects exotic own properties', () => {
    let called = false;
    const getter = fixture();
    Object.defineProperty(getter, 'status', {
      enumerable: true,
      get: () => {
        called = true;
        return 'static-only';
      },
    });
    const hook = {
      ...fixture(),
      toJSON: () => {
        called = true;
        return fixture();
      },
    };
    const hidden = fixture();
    Object.defineProperty(hidden, 'secret', { value: 'private' });
    const symbol = { ...fixture(), [Symbol('private')]: 'secret' };
    for (const input of [
      getter,
      hook,
      hidden,
      symbol,
      Object.create(fixture()),
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error('private');
          },
        },
      ),
    ]) {
      expect(validatePublicArtifact(input)).toEqual(invalid);
    }
    expect(called).toBe(false);
  });
});
