import { terminalKey, type Netlist } from './netlist.js';
import type { CompiledCircuit } from './simulation.js';
import type { ComponentResult, NodeResult, SolveResult } from './solver.js';

export const GMIN = 1e-12;

interface NodeWitness {
  readonly frame: object;
  readonly id: string;
  readonly voltage: number;
  readonly power: number;
}
const nodeWitnesses = new WeakMap<NodeResult, NodeWitness>();

/** Solver-only emission: retain the actual stamped shunt, never a public verdict. */
export function emitNumericalNodes(
  netlist: Netlist,
  voltageAt: (node: number) => number,
  referenceNodes: ReadonlySet<number>,
  round: (value: number) => number,
): NodeResult[] {
  const frame = {};
  return Array.from({ length: netlist.nodeCount }, (_, index) => {
    const voltage = voltageAt(index);
    const node = {
      id: `net-${index}`,
      voltage: round(voltage),
      terminals: netlist.terminalsByNode.get(index) ?? [],
    };
    nodeWitnesses.set(node, {
      frame,
      id: node.id,
      voltage: node.voltage,
      power: referenceNodes.has(index) ? 0 : GMIN * voltage * voltage,
    });
    return node;
  });
}

/** Trusted internal clone routes preserve evidence, but never attest changed observations. */
export function copyNumericalNode(node: NodeResult, terminals: readonly string[]): NodeResult {
  const copy = { ...node, terminals };
  const witness = nodeWitnesses.get(node);
  if (witness && node.id === witness.id && node.voltage === witness.voltage)
    nodeWitnesses.set(copy, witness);
  return copy;
}

/** Signed nodal GMIN dissipation, corroborated by physical terminal observations. */
export function numericalShuntPowerWatt(
  compiled: CompiledCircuit,
  result: SolveResult,
  components: ReadonlyMap<string, ComponentResult>,
): number | null {
  if (result.nodes.length !== compiled.nets.length) return null;
  let nodeById: Map<string, NodeResult> | undefined;
  let frame: object | undefined;
  let power = 0;
  for (let index = 0; index < compiled.nets.length; index++) {
    const id = compiled.nets[index]!.id;
    let node = result.nodes[index]!;
    // Canonical owned frames need no lookup Map; public frames may reorder nodes.
    if (!nodeById && node.id !== id) {
      nodeById = new Map(result.nodes.map((entry) => [entry.id, entry]));
      if (nodeById.size !== compiled.nets.length) return null;
    }
    node = nodeById ? nodeById.get(id)! : node;
    if (!node || !Number.isFinite(node.voltage)) return null;
    const witness = nodeWitnesses.get(node);
    if (!witness || witness.id !== id || witness.voltage !== node.voltage) return null;
    if (frame && frame !== witness.frame) return null;
    frame = witness.frame;
    power += witness.power;
  }
  if (!frame || !Number.isFinite(power)) return null;
  const covered = new Uint8Array(compiled.nets.length);
  for (const [componentId, component] of components) {
    for (const terminal in component.terminalVoltages) {
      if (!Object.hasOwn(component.terminalVoltages, terminal)) continue;
      const node = compiled.netlist.nodeOf.get(terminalKey(componentId, terminal));
      if (node === undefined || node < 0 || node >= compiled.nets.length) return null;
      const voltage = nodeById
        ? nodeById.get(compiled.nets[node]!.id)!.voltage
        : result.nodes[node]!.voltage;
      // Solver rounds both observations identically. No new tolerance is needed.
      if (component.terminalVoltages[terminal] !== voltage) return null;
      covered[node] = 1;
    }
  }
  for (let index = 0; index < covered.length; index++) {
    const voltage = nodeById
      ? nodeById.get(compiled.nets[index]!.id)!.voltage
      : result.nodes[index]!.voltage;
    // Isolated wire/reference nodes can lack component observations, but must be zero.
    if (!covered[index] && voltage !== 0) return null;
  }
  return power;
}
