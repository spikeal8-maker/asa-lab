import { analyseCircuit } from '@asa-lab/electronics';
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
): SolveResult | null {
  if (!running || !document) return persistedResult;
  return calculateSimulationPreflight(document);
}

export function calculateSimulationPreflight(document: SchematicDocument): SolveResult {
  return analyseCircuit(document) as SolveResult;
}

export function canStartSimulation(result: SolveResult): boolean {
  return result.solved && result.status === 'solved';
}
