import type { Diagnostic } from '../api';

/**
 * Presentation must never invent a physical owner for a solver diagnostic.
 * Unanchored document diagnostics stay document-level; only the solver may
 * attach a component badge by returning an explicit component id.
 */
export function diagnosticsGroupedByComponent(
  diagnostics: readonly Diagnostic[],
): ReadonlyMap<string, readonly Diagnostic[]> {
  const grouped = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    for (const componentId of diagnostic.componentIds ?? []) {
      grouped.set(componentId, [...(grouped.get(componentId) ?? []), diagnostic]);
    }
  }
  return grouped;
}
