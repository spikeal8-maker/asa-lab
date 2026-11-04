import { describe, expect, it } from 'vitest';
import { parseElectronicsDocument } from '@asa-lab/electronics';
import type { SchematicDocument, SchematicAnnotation } from '../../api';
import {
  annotationOnlyDocumentChange,
  boundedAnnotation,
  createAnnotationRuntimeDocumentSelector,
  retainAnnotationVersion,
  setDocumentAnnotations,
} from '../workbench-annotations';
import {
  electronicsDocumentsEqual,
  mergeElectronicsDocuments,
} from '../electronics-document-merge';
import { normalizeLoadedDocument } from '../use-workbench-project-state';

const base: SchematicDocument = {
  schemaVersion: 4,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};
const note = (id = 'note-1'): SchematicAnnotation => ({
  id,
  text: '<script>alert(1)</script> 😀',
  position: { x: 10, y: 20 },
  size: { width: 240, height: 96 },
  fontSize: 18,
});

describe('annotation document operations and electrical observation identity', () => {
  it('keeps the old document object through note-only changes and undo, but never masks physical changes', () => {
    const select = createAnnotationRuntimeDocumentSelector();
    expect(select(base)).toBe(base);
    const added = setDocumentAnnotations(base, [note()]);
    expect(select(added)).toBe(base);
    const edited = setDocumentAnnotations(added, [{ ...note(), text: 'changed', fontSize: 24 }]);
    expect(select(edited)).toBe(base);
    const undone = retainAnnotationVersion(edited, base);
    expect(undone).toEqual({ ...base, schemaVersion: 5, annotations: [] });
    expect(select(undone)).toBe(base);
    for (const changed of [
      { ...undone, viewport: { x: 1, y: 0, zoom: 1 } },
      {
        ...undone,
        components: [{ id: 'r1', kind: 'resistor' as const, value: 100, position: { x: 0, y: 0 } }],
      },
      { ...undone, simulation: { ...undone.simulation, maxIterations: 25 } },
    ]) {
      expect(annotationOnlyDocumentChange(base, changed)).toBe(false);
      expect(select(changed)).not.toBe(base);
    }
    expect(select(null)).toBeNull();
    expect(select(base)).toBe(base);
  });

  it('produces a detached electrical version 4 projection when the first load already contains notes', () => {
    const select = createAnnotationRuntimeDocumentSelector();
    const loaded = setDocumentAnnotations(base, [note()]);
    const runtime = select(loaded);
    expect(runtime).toEqual(base);
    expect(runtime).not.toBe(loaded);
    const server = parseElectronicsDocument(JSON.parse(JSON.stringify(loaded)));
    expect(server.ok).toBe(true);
    if (server.ok)
      expect(select(normalizeLoadedDocument(server.document as SchematicDocument))).toBe(runtime);
    expect(select(setDocumentAnnotations(loaded, []))).toBe(runtime);
  });

  it('repairs invalid text and finite bounds, including an emoji cut at the text limit', () => {
    const bounded = boundedAnnotation({
      ...note(),
      text: 'a'.repeat(4095) + '😀',
      position: { x: Infinity, y: -Infinity },
      size: { width: NaN, height: 1 },
      fontSize: 1000,
    });
    expect(bounded.text).toBe('a'.repeat(4095) + '\ufffd');
    expect(bounded.position).toEqual({ x: 0, y: 0 });
    expect(bounded.size).toEqual({ width: 240, height: 24 });
    expect(bounded.fontSize).toBe(128);
    expect(boundedAnnotation({ ...note(), text: '\u0000😀\n\\u0000' }).text).toBe('😀\n\\u0000');
  });

  it('treats note-only changes as shared dirty content and merges independent notes', () => {
    const local = setDocumentAnnotations(base, [note('local')]);
    const remote = setDocumentAnnotations(base, [note('remote')]);
    expect(electronicsDocumentsEqual(local, base)).toBe(false);
    const merged = mergeElectronicsDocuments(base, local, remote);
    expect(merged.ok).toBe(true);
    if (merged.ok)
      expect(merged.document.annotations?.map((value) => value.id).sort()).toEqual([
        'local',
        'remote',
      ]);
  });

  it('reports conflicting edits and preserves intentional last-note deletion as version 5', () => {
    const original = setDocumentAnnotations(base, [note()]);
    expect(
      mergeElectronicsDocuments(
        original,
        setDocumentAnnotations(original, [{ ...note(), text: 'local' }]),
        setDocumentAnnotations(original, [{ ...note(), text: 'remote' }]),
      ).ok,
    ).toBe(false);
    const deleted = mergeElectronicsDocuments(
      original,
      setDocumentAnnotations(original, []),
      original,
    );
    expect(deleted.ok).toBe(true);
    if (deleted.ok) expect(deleted.document).toMatchObject({ schemaVersion: 5, annotations: [] });
  });
});
