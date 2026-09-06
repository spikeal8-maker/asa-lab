import { solveLinear } from './linear-system.js';

export interface CapacitorVoltageConstraint {
  readonly componentId: string;
  readonly positiveNode: number;
  readonly negativeNode: number;
  readonly capacitanceFarad: number;
  readonly voltageVolt: number;
}

interface CapacitorConstraintGroup {
  readonly nodes: readonly number[];
  readonly edges: readonly CapacitorVoltageConstraint[];
  readonly forest: readonly CapacitorVoltageConstraint[];
}

export interface CapacitorConstraintPlan {
  readonly independentIds: ReadonlySet<string>;
  readonly groups: readonly CapacitorConstraintGroup[];
}

/** Remove only redundant equations, never capacitance, charge or inconsistent voltages. */
export function planCapacitorConstraints(
  constraints: readonly CapacitorVoltageConstraint[],
): CapacitorConstraintPlan | null {
  const edges = [...constraints].sort((a, b) =>
    a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0,
  );
  if (
    new Set(edges.map((edge) => edge.componentId)).size !== edges.length ||
    edges.some(
      (edge) =>
        !Number.isSafeInteger(edge.positiveNode) ||
        !Number.isSafeInteger(edge.negativeNode) ||
        edge.positiveNode < 0 ||
        edge.negativeNode < 0 ||
        !Number.isFinite(edge.voltageVolt) ||
        !Number.isFinite(edge.capacitanceFarad) ||
        edge.capacitanceFarad <= 0,
    )
  )
    return null;

  const nodes = [...new Set(edges.flatMap((edge) => [edge.positiveNode, edge.negativeNode]))].sort(
    (a, b) => a - b,
  );
  const parents = new Map(nodes.map((node) => [node, node]));
  const root = (node: number): number => {
    let current = node;
    while (parents.get(current) !== current) current = parents.get(current)!;
    return current;
  };
  const forest: CapacitorVoltageConstraint[] = [];
  for (const edge of edges) {
    const a = root(edge.positiveNode);
    const b = root(edge.negativeNode);
    if (a === b) continue;
    parents.set(Math.max(a, b), Math.min(a, b));
    forest.push(edge);
  }
  const groups = [...new Set(nodes.map(root))].map((reference) => ({
    nodes: nodes.filter((node) => root(node) === reference),
    edges: edges.filter((edge) => root(edge.positiveNode) === reference),
    forest: forest.filter((edge) => root(edge.positiveNode) === reference),
  }));
  for (const group of groups) {
    const adjacent = new Map(
      group.nodes.map((node) => [node, [] as { to: number; drop: number }[]]),
    );
    for (const edge of group.forest) {
      adjacent.get(edge.positiveNode)!.push({ to: edge.negativeNode, drop: edge.voltageVolt });
      adjacent.get(edge.negativeNode)!.push({ to: edge.positiveNode, drop: -edge.voltageVolt });
    }
    const potentials = new Map([[group.nodes[0]!, 0]]);
    const queue = [group.nodes[0]!];
    for (let index = 0; index < queue.length; index++) {
      const node = queue[index]!;
      for (const next of adjacent.get(node)!) {
        if (potentials.has(next.to)) continue;
        potentials.set(next.to, potentials.get(node)! - next.drop);
        queue.push(next.to);
      }
    }
    // Stored voltages are rounded to 12 decimal places; do not mistake that residue for conflict.
    if (
      group.edges.some((edge) => {
        const residual =
          potentials.get(edge.positiveNode)! -
          potentials.get(edge.negativeNode)! -
          edge.voltageVolt;
        return !Number.isFinite(residual) || Math.abs(residual) > 1e-9;
      })
    )
      return null;
  }
  return { independentIds: new Set(forest.map((edge) => edge.componentId)), groups };
}

/**
 * Forest MNA currents determine total nodal flow, not the current of each physical capacitor.
 * Recover I = C dV/dt with a capacitance-weighted Laplacian and one derivative reference per group.
 * Scaling all C by max(C) keeps even tiny capacitances above the linear solver pivot floor.
 */
export function recoverCapacitorCurrents(
  plan: CapacitorConstraintPlan,
  sourceCurrents: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> | null {
  const currents = new Map<string, number>();
  for (const group of plan.groups) {
    const flows = new Map(group.nodes.map((node) => [node, 0]));
    for (const edge of group.forest) {
      const current = sourceCurrents.get(edge.componentId);
      if (current === undefined || !Number.isFinite(current)) return null;
      flows.set(edge.positiveNode, flows.get(edge.positiveNode)! + current);
      flows.set(edge.negativeNode, flows.get(edge.negativeNode)! - current);
    }
    const variables = new Map(group.nodes.slice(1).map((node, index) => [node, index]));
    const matrix = Array.from({ length: variables.size }, () =>
      Array<number>(variables.size).fill(0),
    );
    const rhs = group.nodes.slice(1).map((node) => flows.get(node)!);
    const scale = Math.max(...group.edges.map((edge) => edge.capacitanceFarad));
    for (const edge of group.edges) {
      const a = variables.get(edge.positiveNode);
      const b = variables.get(edge.negativeNode);
      const weight = edge.capacitanceFarad / scale;
      if (a !== undefined) matrix[a]![a] += weight;
      if (b !== undefined) matrix[b]![b] += weight;
      if (a !== undefined && b !== undefined) {
        matrix[a]![b] -= weight;
        matrix[b]![a] -= weight;
      }
    }
    const solution = solveLinear(matrix, rhs);
    if (!solution || solution.some((value) => !Number.isFinite(value))) return null;
    const derivative = (node: number) => {
      const index = variables.get(node);
      return index === undefined ? 0 : solution[index]!;
    };
    const recoveredFlows = new Map(group.nodes.map((node) => [node, 0]));
    for (const edge of group.edges) {
      const current =
        (edge.capacitanceFarad / scale) *
        (derivative(edge.positiveNode) - derivative(edge.negativeNode));
      if (!Number.isFinite(current)) return null;
      currents.set(edge.componentId, current);
      recoveredFlows.set(edge.positiveNode, recoveredFlows.get(edge.positiveNode)! + current);
      recoveredFlows.set(edge.negativeNode, recoveredFlows.get(edge.negativeNode)! - current);
    }
    const tolerance = Math.max(
      1e-12,
      ...[...flows.values()].map((value) => Math.abs(value) * 1e-8),
    );
    if (
      group.nodes.some((node) => Math.abs(recoveredFlows.get(node)! - flows.get(node)!) > tolerance)
    )
      return null;
  }
  return currents;
}
