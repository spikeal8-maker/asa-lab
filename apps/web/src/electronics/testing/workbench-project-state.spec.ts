import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import {
  configureProductionLibrary,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import { normalizeLoadedDocument } from '../use-workbench-project-state';

beforeAll(() => {
  const root = resolve(process.cwd(), 'apps/web/public/assets/electronics/component-database');
  configureProductionLibrary(
    JSON.parse(readFileSync(resolve(root, 'catalog.json'), 'utf8')) as OwnerCatalogManifest,
  );
});

describe('loaded Electronics project migration', () => {
  it('migrates legacy component pins and wire endpoints together before saving', () => {
    const legacy = {
      schemaVersion: 3,
      components: [
        {
          id: 'battery',
          kind: 'source',
          name: 'Battery',
          position: { x: 100, y: 120 },
          rotation: 0,
          value: 3,
          pinIds: ['a', 'b'],
        },
        {
          id: 'resistor',
          kind: 'resistor',
          name: 'Resistor',
          position: { x: 340, y: 120 },
          rotation: 0,
          value: 220,
          pinIds: ['a', 'b'],
        },
      ],
      connections: [
        {
          id: 'wire-legacy',
          from: { componentId: 'battery', terminal: 'a' },
          to: { componentId: 'resistor', terminal: 'b' },
          color: '#149447',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    } as SchematicDocument;

    const normalized = normalizeLoadedDocument(legacy);

    expect(normalized.components.find((item) => item.id === 'battery')?.pinIds).toEqual([
      'BAT-',
      'BAT+',
    ]);
    expect(normalized.components.find((item) => item.id === 'resistor')?.pinIds).toEqual([
      'lead-1',
      'lead-2',
    ]);
    expect(normalized.connections[0]).toMatchObject({
      from: { componentId: 'battery', terminal: 'BAT+' },
      to: { componentId: 'resistor', terminal: 'lead-2' },
    });
  });
});
