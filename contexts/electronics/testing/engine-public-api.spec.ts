import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT } from '../domain/document';
import { analyseCircuit, compileCircuit } from '../domain/simulation';
import {
  ELECTRONICS_ENGINE_CAPABILITIES,
  ELECTRONICS_ENGINE_CONTRACT_VERSION,
  ELECTRONICS_ENGINE_DESCRIPTOR,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceRequest,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedContinuation,
  analyseElectronicsSnapshot,
  parseElectronicsEngineDocument,
  prepareElectronicsSnapshot,
} from '../engine';

const TIMED_KEYS = [
  'simulationTimeMs',
  'transientState',
  'controllerState',
  'transientAnalysis',
] as const;

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

describe('Electronics non-temporal engine facade', () => {
  it('publishes a small versioned capability descriptor', () => {
    expect(ELECTRONICS_ENGINE_CONTRACT_VERSION).toBe(1);
    expect(ELECTRONICS_ENGINE_DESCRIPTOR).toEqual({
      contractVersion: 1,
      documentSchemaVersion: 4,
      capabilities: ELECTRONICS_ENGINE_CAPABILITIES,
    });
  });
  it('delegates document parsing without host concerns', () => {
    const parsed = parseElectronicsEngineDocument(EMPTY_DOCUMENT);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document).toEqual(EMPTY_DOCUMENT);
  });

  it('projects compile output into a structural topology summary', () => {
    const compiled = compileCircuit(SIMPLE_OHM_LAW);
    expect(prepareElectronicsSnapshot(SIMPLE_OHM_LAW)).toEqual({
      topologySignature: compiled.topologySignature,
      componentIds: compiled.componentIds,
      sourceIds: compiled.sourceIds,
      unsupportedComponentIds: compiled.unsupportedComponentIds,
      netCount: compiled.netlist.nodeCount,
    });
  });

  it('preserves solved snapshot analysis while withholding continuation state', () => {
    const direct = analyseCircuit(SIMPLE_OHM_LAW);
    const snapshot = analyseElectronicsSnapshot(SIMPLE_OHM_LAW);
    expect(direct.status).toBe('solved');
    expect(snapshot).toEqual({
      solved: direct.solved,
      status: direct.status,
      current: direct.current,
      components: direct.components,
      nodes: direct.nodes,
      diagnostics: direct.diagnostics,
      iterations: direct.iterations,
      numericalResidual: direct.numericalResidual,
      numericalTolerance: direct.numericalTolerance,
      quality: direct.quality,
      topologySignature: direct.topologySignature,
      simulationInputDigest: direct.simulationInputDigest,
      solverRevision: direct.solverRevision,
      modelSetDigest: direct.modelSetDigest,
      analysis: direct.analysis,
    });
    for (const key of TIMED_KEYS) expect(key in snapshot).toBe(false);
  });

  it('defines a serializable canonical timed contract shape before exposing host controls', () => {
    const continuation: ElectronicsTimedContinuation = {
      version: 1,
      clockContractVersion: 1,
      engineContractVersion: 1,
      clockProfileId: 'canonical-us-v1',
      documentDigest: 'sha256:document',
      modelSetDigest: 'sha256:models',
      committedHorizonMicroseconds: 1250,
      serializedState: '{"version":1}',
    };
    const request: ElectronicsTimedAdvanceRequest = {
      requestedHorizonMicroseconds: 2000,
      continuation,
      inputEvents: [
        {
          atMicroseconds: 1500,
          targetId: 'switch-1',
          operation: 'state',
          payload: true,
        },
      ],
      maxEvents: 32,
    };
    const result: ElectronicsTimedAdvanceResult = {
      executionStatus: 'yielded',
      requestedHorizonMicroseconds: 2000,
      committedHorizonMicroseconds: 1250,
      continuation,
      observation: null,
      diagnostics: [],
    };
    expect(JSON.parse(JSON.stringify({ request, result }))).toEqual({ request, result });
  });

  it('exposes only the canonical timed advance operation, not host lifecycle controls', async () => {
    const facade = await import('../engine');
    const exported = Object.keys(facade);
    expect(exported).toContain('advanceElectronicsToHorizon');
    expect(exported.some((name) => /pause|resume|reset|clock/i.test(name))).toBe(false);
  });
});
