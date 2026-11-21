import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT, parseElectronicsDocument } from '../domain/document';
import { parseCanvasAnnotations } from '../domain/canvas-annotations';
import { simulationInputDigest } from '../domain/simulation-input-digest';
import { analyseCircuit } from '../domain/simulation';
import { ELECTRONICS_MODULE } from '../module';

const note = {
  id: 'note-1',
  text: 'Привет 😀\n<script>alert(1)</script>',
  position: { x: -12, y: 20 },
  size: { width: 240, height: 96 },
  fontSize: 18,
};
const annotated = () => ({
  ...EMPTY_DOCUMENT,
  schemaVersion: 5 as const,
  annotations: [structuredClone(note)],
});

describe('persisted non-electrical canvas annotations', () => {
  it('keeps the canonical empty/default format and accepts explicit version 5', () => {
    expect(EMPTY_DOCUMENT.schemaVersion).toBe(4);
    expect(ELECTRONICS_MODULE.manifest.schemaVersion).toBe(4);
    expect(ELECTRONICS_MODULE.provider!.validate(EMPTY_DOCUMENT).ok).toBe(true);
    const parsed = parseElectronicsDocument(JSON.parse(JSON.stringify(annotated())));
    expect(parsed).toMatchObject({ ok: true, migrated: false, document: annotated() });
    expect(ELECTRONICS_MODULE.provider!.validate(annotated()).ok).toBe(true);
    for (const schemaVersion of [1, 2, 3, 4]) {
      const legacy = parseElectronicsDocument({ ...EMPTY_DOCUMENT, schemaVersion });
      expect(legacy).toMatchObject({
        ok: true,
        migrated: schemaVersion < 4,
        document: EMPTY_DOCUMENT,
      });
      if (legacy.ok) expect(JSON.stringify(legacy.document)).toBe(JSON.stringify(EMPTY_DOCUMENT));
      expect(parseElectronicsDocument({ ...annotated(), schemaVersion }).ok).toBe(false);
    }
  });

  it('does not change the electrical digest or complete numerical result', () => {
    expect(simulationInputDigest(annotated())).toBe(simulationInputDigest(EMPTY_DOCUMENT));
    expect(analyseCircuit(annotated())).toEqual(analyseCircuit(EMPTY_DOCUMENT));
  });

  it('preserves the complete connected circuit and its numerical result through version 5 JSON roundtrip', () => {
    const old = parseElectronicsDocument({
      ...EMPTY_DOCUMENT,
      components: [
        { id: 'source', kind: 'source', position: { x: 0, y: 0 }, value: 5 },
        { id: 'resistor', kind: 'resistor', position: { x: 100, y: 0 }, value: 1000 },
      ],
      connections: [
        {
          id: 'p',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'resistor', terminal: 'a' },
        },
        {
          id: 'n',
          from: { componentId: 'resistor', terminal: 'b' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    });
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    const next = parseElectronicsDocument(
      JSON.parse(JSON.stringify({ ...old.document, schemaVersion: 5, annotations: [note] })),
    );
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.document.components).toEqual(old.document.components);
    expect(next.document.connections).toEqual(old.document.connections);
    expect(analyseCircuit(next.document)).toEqual(analyseCircuit(old.document));
    expect(simulationInputDigest(next.document)).toBe(simulationInputDigest(old.document));
  });

  it.each([
    { annotations: undefined },
    { annotations: null },
    { annotations: new Array(201).fill(note) },
    { annotations: [note, note] },
    { annotations: [{ ...note, id: '<svg>' }] },
    { annotations: [{ ...note, position: { x: Infinity, y: 0 } }] },
    { annotations: [{ ...note, position: { x: 1_000_001, y: 0 } }] },
    { annotations: [{ ...note, size: { width: 39, height: 96 } }] },
    { annotations: [{ ...note, fontSize: 18.5 }] },
    { annotations: [{ ...note, fontSize: 129 }] },
    { annotations: [{ ...note, text: 'x'.repeat(4097) }] },
    { annotations: [{ ...note, text: '\u0000' }] },
    { annotations: [{ ...note, text: '\ud800' }] },
    { annotations: [{ ...note, text: '\udc00' }] },
    { annotations: [{ ...note, href: 'javascript:alert(1)' }] },
    { annotations: [{ ...note, size: { width: 240, height: 96, unknown: true } }] },
  ])('rejects malformed annotations without silently dropping them (%j)', (extra) => {
    expect(parseElectronicsDocument({ ...annotated(), ...extra }).ok).toBe(false);
  });

  it('preserves valid Unicode, newline, tab and literal backslash-u text', () => {
    const text = 'Русский 😀\n\t\\u0000 <img src=x onerror=alert(1)>';
    expect(parseCanvasAnnotations([{ ...note, text }])).toEqual([{ ...note, text }]);
  });

  it('rejects IDs colliding with electrical components', () => {
    expect(
      parseElectronicsDocument({
        ...annotated(),
        components: [{ id: note.id, kind: 'resistor', value: 1000, position: { x: 0, y: 0 } }],
      }).ok,
    ).toBe(false);
  });

  it('protects annotation and future format floors, allowing intentional empty version 5', () => {
    const guard = ELECTRONICS_MODULE.provider!.validateReplacement!;
    expect(guard(EMPTY_DOCUMENT, annotated())).toEqual({ ok: true });
    expect(guard(annotated(), { ...annotated(), annotations: [] })).toEqual({ ok: true });
    expect(guard(annotated(), EMPTY_DOCUMENT).ok).toBe(false);
    expect(guard({ schemaVersion: 6 }, annotated()).ok).toBe(false);
    expect(guard(null, annotated()).ok).toBe(false);
  });
});
