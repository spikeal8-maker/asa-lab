import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT, parseElectronicsDocument } from '../domain/document';

function base(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    components: [],
    connections: [],
    ...overrides,
  };
}

function component(id: string, kind: 'source' | 'resistor' | 'led' | 'wire' = 'resistor') {
  return { id, kind, position: { x: 20, y: 30 }, value: kind === 'source' ? 3 : kind === 'led' ? 2 : kind === 'wire' ? 0 : 300 };
}

function connection(
  id: string,
  from: { componentId: string; terminal: unknown },
  to: { componentId: string; terminal: unknown },
) {
  return { id, from, to };
}

describe('Electronics geometry profile compatibility', () => {
  it('creates new documents with the physical breadboard profile', () => {
    expect(EMPTY_DOCUMENT.geometryProfile).toBe('breadboard-2.54mm-v1');
  });

  it('interprets first-foundation documents without a profile as legacy geometry', () => {
    const parsed = parseElectronicsDocument(base());
    expect(parsed).toEqual({
      ok: true,
      document: {
        schemaVersion: 1,
        geometryProfile: 'legacy-pixel-v1',
        components: [],
        connections: [],
      },
    });
  });

  it('preserves the physical profile when it is explicitly stored', () => {
    const parsed = parseElectronicsDocument(
      base({ geometryProfile: 'breadboard-2.54mm-v1' }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document.geometryProfile).toBe('breadboard-2.54mm-v1');
  });

  it.each(['pixels', 'breadboard', 1, null, true, {}])(
    'rejects unsupported geometry profile %j',
    (geometryProfile) => {
      const parsed = parseElectronicsDocument(base({ geometryProfile }));
      expect(parsed).toEqual({ ok: false, message: 'unsupported document geometryProfile' });
    },
  );
});

describe('stable terminal identity validation', () => {
  it('preserves legacy a/b terminal IDs for existing documents', () => {
    const parsed = parseElectronicsDocument(
      base({
        components: [component('r1'), component('led1', 'led')],
        connections: [
          connection(
            'wire-1',
            { componentId: 'r1', terminal: 'b' },
            { componentId: 'led1', terminal: 'a' },
          ),
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.connections[0]?.from.terminal).toBe('b');
      expect(parsed.document.connections[0]?.to.terminal).toBe('a');
    }
  });

  it('rejects an unknown terminal on a known component', () => {
    const parsed = parseElectronicsDocument(
      base({
        components: [component('r1'), component('led1', 'led')],
        connections: [
          connection(
            'wire-1',
            { componentId: 'r1', terminal: 'lead-2' },
            { componentId: 'led1', terminal: 'a' },
          ),
        ],
      }),
    );
    expect(parsed).toEqual({
      ok: false,
      message: 'connection from references unsupported terminal lead-2 on resistor',
    });
  });

  it.each(['', ' terminal', 'a/b', 'a b', 'x'.repeat(65), 3, null, {}])(
    'rejects unsafe terminal identity %j',
    (terminal) => {
      const parsed = parseElectronicsDocument(
        base({
          components: [component('r1'), component('led1', 'led')],
          connections: [
            connection(
              'wire-1',
              { componentId: 'r1', terminal },
              { componentId: 'led1', terminal: 'a' },
            ),
          ],
        }),
      );
      expect(parsed).toEqual({
        ok: false,
        message: 'connection from must contain a componentId and safe terminal ID',
      });
    },
  );

  it('rejects a dangling component endpoint before netlist construction', () => {
    const parsed = parseElectronicsDocument(
      base({
        components: [component('r1')],
        connections: [
          connection(
            'wire-1',
            { componentId: 'r1', terminal: 'a' },
            { componentId: 'missing', terminal: 'b' },
          ),
        ],
      }),
    );
    expect(parsed).toEqual({
      ok: false,
      message: 'connection to must reference an existing component',
    });
  });

  it('rejects a terminal connected directly to itself', () => {
    const parsed = parseElectronicsDocument(
      base({
        components: [component('r1')],
        connections: [
          connection(
            'wire-1',
            { componentId: 'r1', terminal: 'a' },
            { componentId: 'r1', terminal: 'a' },
          ),
        ],
      }),
    );
    expect(parsed).toEqual({
      ok: false,
      message: 'connection cannot join a terminal to itself',
    });
  });

  it('rejects duplicate endpoint pairs even if direction is reversed', () => {
    const parsed = parseElectronicsDocument(
      base({
        components: [component('r1'), component('led1', 'led')],
        connections: [
          connection(
            'wire-1',
            { componentId: 'r1', terminal: 'b' },
            { componentId: 'led1', terminal: 'a' },
          ),
          connection(
            'wire-2',
            { componentId: 'led1', terminal: 'a' },
            { componentId: 'r1', terminal: 'b' },
          ),
        ],
      }),
    );
    expect(parsed).toEqual({
      ok: false,
      message: 'duplicate connection endpoints are not allowed',
    });
  });

  it('keeps wire colour and bounded vertices inside the document contract', () => {
    const valid = parseElectronicsDocument(
      base({
        components: [component('r1'), component('led1', 'led')],
        connections: [
          {
            ...connection(
              'wire-1',
              { componentId: 'r1', terminal: 'b' },
              { componentId: 'led1', terminal: 'a' },
            ),
            color: '#2c62c9',
            vertices: [{ x: 100, y: 100 }],
          },
        ],
      }),
    );
    expect(valid.ok).toBe(true);

    const invalidColor = parseElectronicsDocument(
      base({
        components: [component('r1'), component('led1', 'led')],
        connections: [
          {
            ...connection(
              'wire-1',
              { componentId: 'r1', terminal: 'b' },
              { componentId: 'led1', terminal: 'a' },
            ),
            color: 'red',
          },
        ],
      }),
    );
    expect(invalidColor).toEqual({
      ok: false,
      message: 'wire color must be a six-digit hex color',
    });
  });
});
