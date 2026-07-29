import { describe, expect, it } from 'vitest';
import { parseElectronicsDocument } from '../domain/document';

function base(
  breadboardAttachments: unknown,
  connections: unknown[] = [],
) {
  return {
    schemaVersion: 1,
    geometryProfile: 'breadboard-2.54mm-v1',
    components: [
      { id: 'board', kind: 'breadboard', position: { x: 0, y: 0 }, value: 0 },
      { id: 'r1', kind: 'resistor', position: { x: 20, y: 20 }, value: 300 },
      { id: 'led1', kind: 'led', position: { x: 40, y: 20 }, value: 2 },
      { id: 'legacy-wire', kind: 'wire', position: { x: 0, y: 0 }, value: 0 },
    ],
    connections,
    breadboardAttachments,
  };
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att-1',
    breadboardComponentId: 'board',
    breadboardTerminalId: 'half-400:terminal:1:a',
    componentId: 'r1',
    componentTerminalId: 'a',
    footprintKey: 'axial-resistor-10-pitch',
    insertionDepthMm: 3,
    ...overrides,
  };
}

function wireToBoard(
  id: string,
  componentId: string,
  componentTerminalId: string,
  boardTerminalId: string,
) {
  return {
    id,
    from: { componentId, terminal: componentTerminalId },
    to: { componentId: 'board', terminal: boardTerminalId },
  };
}

describe('breadboard attachment document contract', () => {
  it('preserves a valid hidden physical insertion edge', () => {
    const parsed = parseElectronicsDocument(base([attachment()]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.breadboardAttachments).toEqual([attachment()]);
    expect(parsed.document.connections).toEqual([]);
  });

  it('requires the physical breadboard geometry profile', () => {
    const value = base([attachment()]);
    value.geometryProfile = 'legacy-pixel-v1';
    expect(parseElectronicsDocument(value)).toEqual({
      ok: false,
      message: 'breadboardAttachments require the breadboard-2.54mm-v1 geometry profile',
    });
  });

  it('rejects duplicate component-terminal attachments', () => {
    expect(
      parseElectronicsDocument(
        base([
          attachment(),
          attachment({
            id: 'att-2',
            breadboardTerminalId: 'half-400:terminal:2:a',
          }),
        ]),
      ),
    ).toEqual({
      ok: false,
      message: 'component terminal can have only one breadboard attachment',
    });
  });

  it('rejects two hidden conductors inserted into one physical hole', () => {
    expect(
      parseElectronicsDocument(
        base([
          attachment(),
          attachment({
            id: 'att-2',
            componentId: 'led1',
            componentTerminalId: 'a',
          }),
        ]),
      ),
    ).toEqual({
      ok: false,
      message: 'breadboard physical hole can contain only one conductor',
    });
  });

  it('rejects two visible wire endpoints inserted into one physical hole', () => {
    expect(
      parseElectronicsDocument(
        base([], [
          wireToBoard('wire-1', 'r1', 'a', 'half-400:terminal:1:a'),
          wireToBoard('wire-2', 'led1', 'a', 'half-400:terminal:1:a'),
        ]),
      ),
    ).toEqual({
      ok: false,
      message: 'breadboard physical hole can contain only one conductor',
    });
  });

  it('rejects a visible wire endpoint and a hidden lead in the same physical hole', () => {
    expect(
      parseElectronicsDocument(
        base(
          [attachment()],
          [wireToBoard('wire-1', 'led1', 'a', 'half-400:terminal:1:a')],
        ),
      ),
    ).toEqual({
      ok: false,
      message: 'breadboard physical hole can contain only one conductor',
    });
  });

  it.each([
    [
      'unknown board terminal',
      attachment({ breadboardTerminalId: 'half-400:terminal:99:z' }),
      'breadboard attachment must reference a valid breadboard terminal',
    ],
    [
      'unknown component terminal',
      attachment({ componentTerminalId: 'lead-one' }),
      'breadboard attachment must reference a valid component terminal',
    ],
    [
      'non-board parent',
      attachment({ breadboardComponentId: 'r1' }),
      'breadboard attachment must reference an existing breadboard component',
    ],
    [
      'board as attached part',
      attachment({ componentId: 'board' }),
      'breadboard attachment target must be an attachable non-board component',
    ],
    [
      'wire as attached part',
      attachment({ componentId: 'legacy-wire' }),
      'breadboard attachment target must be an attachable non-board component',
    ],
    [
      'unsafe attachment id',
      attachment({ id: '../foreign' }),
      'breadboard attachment id must be unique, safe and non-empty',
    ],
    [
      'unsafe footprint key',
      attachment({ footprintKey: '../foreign' }),
      'breadboard attachment footprintKey is invalid',
    ],
    [
      'invalid insertion depth',
      attachment({ insertionDepthMm: 30 }),
      'breadboard attachment insertionDepthMm must be between 0 and 20',
    ],
    [
      'over-posted tenant field',
      attachment({ tenantId: 'foreign' }),
      'breadboard attachment contains unsupported field: tenantId',
    ],
  ])('rejects %s', (_name, value, message) => {
    expect(parseElectronicsDocument(base([value]))).toEqual({ ok: false, message });
  });

  it('rejects duplicate attachment IDs independently of endpoints', () => {
    expect(
      parseElectronicsDocument(
        base([
          attachment(),
          attachment({
            breadboardTerminalId: 'half-400:terminal:2:a',
            componentId: 'led1',
            componentTerminalId: 'a',
          }),
        ]),
      ),
    ).toEqual({
      ok: false,
      message: 'breadboard attachment id must be unique, safe and non-empty',
    });
  });
});
