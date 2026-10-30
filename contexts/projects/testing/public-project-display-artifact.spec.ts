import { describe, expect, it, vi } from 'vitest';
import { validatePublicProjectDisplayArtifact, validatePublicArtifact } from '@asa-lab/contracts';
function fixture() {
  return {
    schemaVersion: 2,
    status: 'display',
    viewerFamily: 'electronics',
    provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174001', revisionNumber: 1 },
    capabilities: { readOnly: true, interactive: true, download: false },
    components: [{ id: 'r', kind: 'resistor', position: { x: 0, y: 0 }, value: 330 }],
    connections: [],
  };
}
describe('strict Electronics public display v2', () => {
  it('accepts only explicit inert switch/mirror/RGB display configuration', () => {
    const a = fixture();
    Object.assign(a.components[0]!, {
      state: true,
      visualProperties: { mirrorX: true, mirrorY: true, pinLayout: 'BRCG' },
    });
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(true);
    Object.assign(a.components[0]!, { visualProperties: { mirrorX: true, code: 'PRIVATE' } });
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
  });
  it.each([
    { state: 'true' },
    { visualProperties: { mirrorX: 1 } },
    { visualProperties: { mirrorY: 'false' } },
    { visualProperties: { pinLayout: 'https://private.invalid' } },
    { visualProperties: { url: 'https://private.invalid' } },
  ])('rejects unsafe visual configuration %j', (fields) => {
    const a = fixture();
    Object.assign(a.components[0]!, fields);
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
  });

  it('rejects coercible rotations, sparse arrays, and broken endpoints', () => {
    const a = fixture();
    Object.assign(a.components[0]!, { rotation: '90' });
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
    const b = fixture();
    b.components.length = 2;
    expect(validatePublicProjectDisplayArtifact(b).ok).toBe(false);
    const c = fixture();
    Object.assign(c, {
      connections: [
        {
          id: 'w',
          from: { componentId: 'r', terminal: 'a' },
          to: { componentId: 'absent', terminal: 'b' },
        },
      ],
    });
    expect(validatePublicProjectDisplayArtifact(c).ok).toBe(false);
  });

  it('accepts detached deeply frozen display while v1 remains unchanged', () => {
    const input = fixture();
    const r = validatePublicProjectDisplayArtifact(input);
    expect(r.ok).toBe(true);
    expect(validatePublicArtifact(input).ok).toBe(false);
    if (!r.ok) throw Error();
    expect(Object.isFrozen(r.artifact)).toBe(true);
    expect(r.artifact).not.toBe(input);
  });
  it.each(['code', 'html', 'url', 'stateProperties', 'runtime', 'download'])(
    'rejects arbitrary %s field',
    (key) => {
      const a = fixture();
      Object.assign(a.components[0]!, { [key]: 'secret' });
      expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
    },
  );
  it('rejects accessor without invoking it', () => {
    const a = fixture();
    let read = false;
    Object.defineProperty(a.components[0], 'name', {
      get() {
        read = true;
        return 'secret';
      },
      enumerable: true,
    });
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
    expect(read).toBe(false);
  });
  it.each([Infinity, NaN, 100001])('rejects invalid geometry %s', (x) => {
    const a = fixture();
    a.components[0]!.position.x = x;
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
  });
  it('rejects duplicate identities and missing connection endpoints', () => {
    const a = fixture();
    a.components.push(a.components[0]!);
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
  });
  it('rejects oversized components and cycles', () => {
    const a = fixture();
    a.components = Array.from({ length: 301 }, (_, i) => ({ ...a.components[0]!, id: String(i) }));
    expect(validatePublicProjectDisplayArtifact(a).ok).toBe(false);
    const b = fixture();
    Object.assign(b, { cycle: b });
    expect(validatePublicProjectDisplayArtifact(b).ok).toBe(false);
  });
});

describe('public V3 execution projection', () => {
  function simulation() {
    return {
      ...fixture(),
      schemaVersion: 3,
      status: 'simulation',
      solverIterations: 24,
      components: [
        {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          position: { x: 0, y: 0 },
          value: 5,
          stateProperties: {
            arduinoSource:
              'void setup(){/* <readonly> */}\nvoid loop(){digitalWrite(13,LOW);delay(10);}',
            arduinoCodeMode: 'blocks',
          },
        },
      ],
    };
  }
  it('accepts only saved public program as escaped text, detached and frozen', () => {
    const input = simulation();
    const result = validatePublicProjectDisplayArtifact(input);
    expect(result.ok).toBe(true);
    if (!result.ok || result.artifact.schemaVersion !== 3) throw Error();
    expect(result.artifact.components[0]!.stateProperties?.arduinoSource).toBe(
      input.components[0]!.stateProperties.arduinoSource,
    );
    expect(Object.isFrozen(result.artifact.components[0]!.stateProperties)).toBe(true);
  });
  it.each([undefined, '', ' '.repeat(4), 'x'.repeat(65537)])(
    'rejects missing/empty/oversized source without default Blink',
    (source) => {
      const input = simulation();
      Object.assign(input.components[0]!, {
        stateProperties: source === undefined ? {} : { arduinoSource: source },
      });
      expect(validatePublicProjectDisplayArtifact(input).ok).toBe(false);
    },
  );
  it.each(['arduinoWorkspace', 'token', 'url', 'runtime', 'password'])(
    'rejects unclassified public property %s',
    (key) => {
      const input = simulation();
      Object.assign(input.components[0]!.stateProperties, { [key]: 'private' });
      expect(validatePublicProjectDisplayArtifact(input).ok).toBe(false);
    },
  );
  it('does not invoke accessors and rejects invalid V3 model identity', () => {
    const input = simulation();
    const getter = vi.fn();
    Object.defineProperty(input.components[0]!.stateProperties, 'arduinoSource', {
      enumerable: true,
      get: getter,
    });
    expect(validatePublicProjectDisplayArtifact(input).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const second = simulation();
    Object.assign(second.components[0]!, { electricalModelVersion: -1 });
    expect(validatePublicProjectDisplayArtifact(second).ok).toBe(false);
  });
  it('does not publish program-shaped properties of non-Arduino components', () => {
    const input = simulation();
    input.components[0]!.componentTypeId = 'resistor-axial';
    expect(validatePublicProjectDisplayArtifact(input).ok).toBe(false);
    const invalidMode = simulation();
    invalidMode.components[0]!.stateProperties.arduinoCodeMode = 'invented-mode';
    expect(validatePublicProjectDisplayArtifact(invalidMode).ok).toBe(false);
  });
});
