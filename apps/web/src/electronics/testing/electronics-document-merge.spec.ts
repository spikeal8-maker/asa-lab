import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import {
  electronicsDocumentsEqual,
  mergeElectronicsDocuments,
} from '../electronics-document-merge';

function document(): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      { id: 'r1', kind: 'resistor', position: { x: 10, y: 10 }, value: 220, name: 'R1' },
    ],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

describe('electronics collaborative document merge', () => {
  it('recognises a stale local draft that is already identical to the server', () => {
    const server = document();
    const local = JSON.parse(JSON.stringify(server)) as SchematicDocument;
    expect(electronicsDocumentsEqual(local, server)).toBe(true);
  });

  it('does not treat viewport navigation or a local running flag as shared edits', () => {
    const server = document();
    const local: SchematicDocument = {
      ...server,
      viewport: { x: 840, y: -120, zoom: 0.2 },
      simulation: { ...server.simulation, running: true },
    };
    expect(electronicsDocumentsEqual(local, server)).toBe(true);
  });

  it('combines independent component additions without last-write-wins', () => {
    const base = document();
    const local: SchematicDocument = {
      ...base,
      components: [
        ...base.components,
        { id: 'led-local', kind: 'led', position: { x: 50, y: 10 }, value: 2 },
      ],
    };
    const remote: SchematicDocument = {
      ...base,
      components: [
        ...base.components,
        { id: 'source-remote', kind: 'source', position: { x: 0, y: 80 }, value: 3 },
      ],
    };
    const merged = mergeElectronicsDocuments(base, local, remote);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.document.components.map((component) => component.id)).toEqual([
      'r1',
      'source-remote',
      'led-local',
    ]);
  });

  it('combines different properties of the same component', () => {
    const base = document();
    const local: SchematicDocument = {
      ...base,
      components: [{ ...base.components[0]!, value: 1000 }],
    };
    const remote: SchematicDocument = {
      ...base,
      components: [{ ...base.components[0]!, position: { x: 40, y: 20 } }],
    };
    const merged = mergeElectronicsDocuments(base, local, remote);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.document.components[0]).toMatchObject({
      value: 1000,
      position: { x: 40, y: 20 },
    });
  });

  it('refuses two different edits of the same property', () => {
    const base = document();
    const local: SchematicDocument = {
      ...base,
      components: [{ ...base.components[0]!, value: 330 }],
    };
    const remote: SchematicDocument = {
      ...base,
      components: [{ ...base.components[0]!, value: 470 }],
    };
    const merged = mergeElectronicsDocuments(base, local, remote);
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.conflicts).toContainEqual({ path: 'components.r1.value' });
  });

  it('does not merge a wire whose endpoint was deleted remotely', () => {
    const base = document();
    const local: SchematicDocument = {
      ...base,
      components: [
        ...base.components,
        { id: 'led', kind: 'led', position: { x: 60, y: 10 }, value: 2 },
      ],
      connections: [
        {
          id: 'wire-local',
          from: { componentId: 'r1', terminal: 'a' },
          to: { componentId: 'led', terminal: 'a' },
        },
      ],
    };
    const remote: SchematicDocument = { ...base, components: [] };
    const merged = mergeElectronicsDocuments(base, local, remote);
    expect(merged.ok).toBe(false);
  });
});
