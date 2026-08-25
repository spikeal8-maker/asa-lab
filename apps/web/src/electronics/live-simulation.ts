import { analyseCircuit, simulationInputDigest } from '@asa-lab/electronics/simulation';
import type { SchematicDocument, SolveResult } from '../api';

/**
 * Live simulation is deliberately independent from draft persistence. The API
 * recomputes the same pure domain function when a draft is saved, while the
 * editor can react immediately to a button, SPDT or potentiometer change.
 */
export function calculateLiveSimulation(
  document: SchematicDocument | null,
  persistedResult: SolveResult | null,
  running: boolean,
  simulationTimeMs = 0,
): SolveResult | null {
  if (!document) return null;
  if (!running) {
    return persistedResult?.simulationInputDigest === simulationInputDigest(document)
      ? persistedResult
      : null;
  }
  return calculateSimulationPreflight(document, simulationTimeMs);
}

export function calculateSimulationPreflight(
  document: SchematicDocument,
  simulationTimeMs = 0,
): SolveResult {
  return analyseCircuit(document, { simulationTimeMs }) as SolveResult;
}

export function prepareLiveSimulationStart(document: SchematicDocument): {
  readonly document: SchematicDocument;
  readonly result: SolveResult;
} {
  const runningDocument: SchematicDocument = {
    ...document,
    simulation: { ...document.simulation, running: true },
  };
  const result = calculateSimulationPreflight(runningDocument);
  return {
    document: runningDocument,
    result,
  };
}
