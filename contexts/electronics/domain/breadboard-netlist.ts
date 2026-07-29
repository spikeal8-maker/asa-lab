import {
  breadboardInternalBusMap,
  type BreadboardDefinition,
} from './breadboard.js';
import type { TerminalId } from './component-model.js';
import type { TerminalRef } from './netlist.js';

export interface BreadboardInternalLink {
  readonly from: TerminalRef;
  readonly to: TerminalRef;
  readonly internalBusId: string;
}

/** Every physical hole is a stable terminal of the breadboard component. */
export function breadboardTerminalIds(
  definition: BreadboardDefinition,
): readonly TerminalId[] {
  return definition.holes.map((hole) => hole.id);
}

/**
 * Convert each internal bus into deterministic star links. This is compact,
 * preserves the exact board topology and can be supplied directly to the
 * generic netlist builder together with user-created wires.
 */
export function breadboardInternalLinks(
  definition: BreadboardDefinition,
  componentId: string,
): readonly BreadboardInternalLink[] {
  if (!componentId || componentId.length > 64) {
    throw new Error('breadboard componentId must be non-empty and at most 64 characters');
  }
  const links: BreadboardInternalLink[] = [];
  const buses = [...breadboardInternalBusMap(definition).entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [internalBusId, members] of buses) {
    const sorted = [...members].sort((left, right) => left.id.localeCompare(right.id));
    const anchor = sorted[0];
    if (!anchor) continue;
    for (const member of sorted.slice(1)) {
      links.push({
        from: { componentId, terminal: anchor.id },
        to: { componentId, terminal: member.id },
        internalBusId,
      });
    }
  }
  return links;
}
