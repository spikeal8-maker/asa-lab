import { describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT } from '../domain/document';
import { analyseCircuit, compileCircuit } from '../domain/simulation';
import {
  ELECTRONICS_ENGINE_CAPABILITIES,
  ELECTRONICS_ENGINE_CONTRACT_VERSION,
  ELECTRONICS_ENGINE_DESCRIPTOR,
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
    const compiled = compileCircuit(EMPTY_DOCUMENT);
    expect(prepareElectronicsSnapshot(EMPTY_DOCUMENT)).toEqual({
      topologySignature: compiled.topologySignature,
      componentIds: compiled.componentIds,
      sourceIds: compiled.sourceIds,
      unsupportedComponentIds: compiled.unsupportedComponentIds,
      netCount: compiled.netlist.nodeCount,
    });
  });

  it('preserves snapshot analysis while withholding continuation state', () => {
    const direct = analyseCircuit(EMPTY_DOCUMENT);
    const snapshot = analyseElectronicsSnapshot(EMPTY_DOCUMENT);
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

  it('does not expose timed control operations', async () => {
    const facade = await import('../engine');
    const exported = Object.keys(facade);
    expect(exported.some((name) => /advance|clock|pause|resume|reset/i.test(name))).toBe(false);
  });
});
