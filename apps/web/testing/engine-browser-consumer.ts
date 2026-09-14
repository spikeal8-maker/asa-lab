import {
  ELECTRONICS_ENGINE_DESCRIPTOR,
  analyseElectronicsSnapshot,
  parseElectronicsEngineDocument,
  prepareElectronicsSnapshot,
  type ElectronicsEngineDocument,
} from '@asa-lab/electronics/engine';

const DOCUMENT: ElectronicsEngineDocument = {
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

export function runEngineBrowserConsumerContract() {
  const parsed = parseElectronicsEngineDocument(DOCUMENT);
  if (!parsed.ok) throw new Error('engine browser fixture rejected its valid document');

  const prepared = prepareElectronicsSnapshot(parsed.document);
  const result = analyseElectronicsSnapshot(parsed.document);

  return {
    contractVersion: ELECTRONICS_ENGINE_DESCRIPTOR.contractVersion,
    capabilities: [...ELECTRONICS_ENGINE_DESCRIPTOR.capabilities],
    netCount: prepared.netCount,
    status: result.status,
    solved: result.solved,
    current: result.current,
  };
}
