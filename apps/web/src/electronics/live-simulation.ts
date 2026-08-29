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

/**
 * Advances an already running transient without resetting stored capacitor
 * voltage when a button, switch or other runtime control changes the topology.
 * A runtime topology change at the same clock sample is resolved immediately
 * through one deterministic 1 ms event step. This keeps capacitor voltage and
 * removes the visible 100 ms button/switch latency without tying physics to FPS.
 */
export function advanceLiveSimulation(
  document: SchematicDocument,
  previous: SolveResult | null,
  simulationTimeMs: number,
): SolveResult {
  const previousState = previous?.transientState;
  const previousTimeMs = previousState?.simulationTimeMs;
  if (previous && previousState && previousTimeMs !== undefined) {
    if (!Number.isFinite(simulationTimeMs)) return previous;
    if (simulationTimeMs <= previousTimeMs) {
      const currentInputAtPreviousTime = simulationInputDigest(document, previousTimeMs);
      if (currentInputAtPreviousTime === previous.simulationInputDigest) return previous;
      return analyseCircuit(document, {
        simulationTimeMs: previousTimeMs + 1,
        transientState: previousState,
      }) as SolveResult;
    }
  }
  return analyseCircuit(document, {
    simulationTimeMs,
    ...(previous?.transientState ? { transientState: previous.transientState } : {}),
  }) as SolveResult;
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
