import {
  ELECTRONICS_ENGINE_DESCRIPTOR,
  analyseElectronicsSnapshot,
  parseElectronicsEngineDocument,
  prepareElectronicsSnapshot,
  type ElectronicsEngineDocument,
} from '@asa-lab/electronics/engine';
import { describe, expect, it } from 'vitest';

const SIMPLE_OHM_LAW: ElectronicsEngineDocument = {
  schemaVersion: 4,
  components: [
    { id: 'source', kind: 'source', position: { x: 0, y: 0 }, value: 5 },
    { id: 'resistor', kind: 'resistor', position: { x: 100, y: 0 }, value: 1000 },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'source', terminal: 'a' },
      to: { componentId: 'resistor', terminal: 'a' },
    },
    {
      id: 'negative',
      from: { componentId: 'resistor', terminal: 'b' },
      to: { componentId: 'source', terminal: 'b' },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};

describe('Electronics engine direct API consumer contract', () => {
  it('consumes the published non-temporal engine surface end to end', () => {
    expect(ELECTRONICS_ENGINE_DESCRIPTOR.contractVersion).toBe(1);
    expect(ELECTRONICS_ENGINE_DESCRIPTOR.capabilities).toEqual([
      'parse-document',
      'prepare-topology',
      'analyse-snapshot',
    ]);

    const parsed = parseElectronicsEngineDocument(SIMPLE_OHM_LAW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const prepared = prepareElectronicsSnapshot(parsed.document);
    expect(prepared.sourceIds).toEqual(['source']);
    expect(prepared.netCount).toBeGreaterThan(0);

    const result = analyseElectronicsSnapshot(parsed.document);
    expect(result.status).toBe('solved');
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.005, 9);
  });
});
