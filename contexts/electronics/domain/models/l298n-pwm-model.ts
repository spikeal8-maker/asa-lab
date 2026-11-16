import type { ElectronicsDocument } from '../document.js';
import { terminalKey } from '../netlist.js';

/**
 * Canonical, deterministic PWM level for Uno outputs wired to an L298N
 * control pad. No private clock: the caller supplies the solver's timestamp.
 * Other Arduino consumers retain their existing mean-voltage semantics.
 */
export function sampleL298nArduinoPwmVoltage(
  terminal: string,
  meanVoltage: number,
  simulationTimeMs: number,
): number {
  const frequencies: Readonly<Record<string, number>> = {
    d3: 490,
    d5: 980,
    d6: 980,
    d9: 490,
    d10: 490,
    d11: 490,
  };
  const frequency = frequencies[terminal];
  if (
    frequency === undefined ||
    !Number.isFinite(meanVoltage) ||
    meanVoltage <= 0 ||
    meanVoltage >= 5
  )
    return meanVoltage;
  const periodMs = 1_000 / frequency;
  const phaseMs = ((simulationTimeMs % periodMs) + periodMs) % periodMs;
  return phaseMs < (meanVoltage / 5) * periodMs ? 5 : 0;
}

/** Same electrically controlled nets are used for matrix stamps and KCL. */
export function l298nControlNetIndices(
  document: Pick<ElectronicsDocument, 'components'>,
  nodeOf: ReadonlyMap<string, number>,
): ReadonlySet<number> {
  const nodes = new Set<number>();
  for (const component of document.components) {
    if (component.componentTypeId !== 'l298n-motor-driver') continue;
    for (const terminal of ['ENA', 'ENB', 'IN1', 'IN2', 'IN3', 'IN4']) {
      const node = nodeOf.get(terminalKey(component.id, terminal));
      if (node !== undefined) nodes.add(node);
    }
  }
  return nodes;
}

/** Exact PWM sampling shared with both canonical KCL verification paths. */
export function l298nQualityBranchVoltage(
  netNodes: ReadonlyMap<string, number>,
  controlNodes: ReadonlySet<number>,
  componentId: string,
  branch: Readonly<{ terminal: string; targetVoltage: number }>,
  simulationTimeMs: number,
): number {
  const node = netNodes.get(terminalKey(componentId, branch.terminal));
  return node !== undefined && controlNodes.has(node)
    ? sampleL298nArduinoPwmVoltage(branch.terminal, branch.targetVoltage, simulationTimeMs)
    : branch.targetVoltage;
}
