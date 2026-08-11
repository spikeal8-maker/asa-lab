import { analyseCircuit, type SchematicDocument, type SolveResult } from '../index.js';

/**
 * Live simulation is deliberately independent from draft persistence. The API
 * recomputes the same pure domain function when a draft is saved, while the
 * editor can react immediately to a button, SPDT or potentiometer change.
 */
export function calculateLiveSimulation(
  document: SchematicDocument | null,
  persistedResult: SolveResult | null,
  running: boolean,
): SolveResult | null {
  if (!running || !document) return persistedResult;
  return calculateSimulationPreflight(document);
}

export function calculateSimulationPreflight(document: SchematicDocument): SolveResult {
  return analyseCircuit(document);
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
