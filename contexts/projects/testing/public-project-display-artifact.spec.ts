import { describe, expect, it } from 'vitest';
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
