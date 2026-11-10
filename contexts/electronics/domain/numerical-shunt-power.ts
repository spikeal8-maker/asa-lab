import { terminalKey } from './netlist.js';
import type { CompiledCircuit } from './simulation.js';
import { GMIN, type ComponentResult, type SolveResult } from './solver.js';

/** Signed nodal GMIN dissipation, corroborated by physical terminal observations. */
export function numericalShuntPowerWatt(
  compiled: CompiledCircuit,
  result: SolveResult,
  components: ReadonlyMap<string, ComponentResult>,
): number | null {
  if (result.nodes.length !== compiled.nets.length) return null;
  let voltageById: Map<string, number> | undefined;
  let power = 0;
  for (let index = 0; index < compiled.nets.length; index++) {
    const id = compiled.nets[index]!.id;
    const node = result.nodes[index]!;
    // Canonical owned frames need no lookup Map; public frames may reorder nodes.
    if (!voltageById && node.id !== id) {
      voltageById = new Map(result.nodes.map((entry) => [entry.id, entry.voltage]));
      if (voltageById.size !== compiled.nets.length) return null;
    }
    const voltage = voltageById ? voltageById.get(id) : node.voltage;
    if (voltage === undefined || !Number.isFinite(voltage)) return null;
    power += GMIN * voltage * voltage;
  }
  if (!Number.isFinite(power)) return null;
  const covered = new Uint8Array(compiled.nets.length);
  for (const [componentId, component] of components) {
    for (const terminal in component.terminalVoltages) {
      if (!Object.hasOwn(component.terminalVoltages, terminal)) continue;
      const node = compiled.netlist.nodeOf.get(terminalKey(componentId, terminal));
      if (node === undefined || node < 0 || node >= compiled.nets.length) return null;
      const voltage = voltageById
        ? voltageById.get(compiled.nets[node]!.id)
        : result.nodes[node]!.voltage;
      // Solver rounds both observations identically. No new tolerance is needed.
      if (component.terminalVoltages[terminal] !== voltage) return null;
      covered[node] = 1;
    }
  }
  for (let index = 0; index < covered.length; index++) {
    const voltage = voltageById
      ? voltageById.get(compiled.nets[index]!.id)
      : result.nodes[index]!.voltage;
    // Isolated wire/reference nodes can lack component observations, but must be zero.
    if (!covered[index] && voltage !== 0) return null;
  }
  return power;
}
