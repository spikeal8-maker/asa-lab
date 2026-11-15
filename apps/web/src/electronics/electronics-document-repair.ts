import { parseElectronicsDocument } from '@asa-lab/electronics';
import type { SchematicDocument } from '../api';
import { localProjectDraftFingerprint } from '../modules/project-local-draft';

const COPY_SUFFIX = ' — копия';

type IdentifierRepair =
  | { readonly status: 'unchanged' | 'blocked'; readonly document: null }
  | { readonly status: 'repaired'; readonly document: SchematicDocument };

/** Return only a complete, valid repair. Never mutate or partially salvage a circuit.
 * Stable IDs let save acknowledgements recognize the original recovery branch. */
export function repairElectronicsDocumentIdentifiers(
  document: SchematicDocument,
): IdentifierRepair {
  try {
    const remap = (ids: readonly string[], kind: string): Map<string, string> | null => {
      if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) return null;
      const used = new Set(ids.filter((id) => id.length > 0 && id.length <= 64));
      const replacements = new Map<string, string>();
      for (const id of ids) {
        if (used.has(id)) continue;
        let attempt = 0;
        let replacement: string;
        do {
          replacement = `recovered-${kind}-${localProjectDraftFingerprint(JSON.stringify([id, attempt++])).slice(0, 48)}`;
        } while (used.has(replacement));
        used.add(replacement);
        replacements.set(id, replacement);
      }
      return replacements;
    };
    const components = remap(
      document.components.map((item) => item.id),
      'c',
    );
    const wires = remap(
      document.connections.map((item) => item.id),
      'w',
    );
    if (!components || !wires) return { status: 'blocked', document: null };
    let changed = components.size > 0 || wires.size > 0;
    const candidate: SchematicDocument = {
      ...document,
      components: document.components.map((component) => {
        let name = component.name;
        if (name && name.length > 120 && name.endsWith(COPY_SUFFIX)) {
          name = name.slice(0, 120 - COPY_SUFFIX.length) + COPY_SUFFIX;
          changed = true;
        }
        return {
          ...component,
          id: components.get(component.id) ?? component.id,
          ...(name === component.name ? {} : { name }),
          ...(component.holeBindings
            ? {
                holeBindings: Object.fromEntries(
                  Object.entries(component.holeBindings).map(([pin, binding]) => [
                    pin,
                    {
                      ...binding,
                      breadboardComponentId:
                        components.get(binding.breadboardComponentId) ??
                        binding.breadboardComponentId,
                    },
                  ]),
                ),
              }
            : {}),
        };
      }),
      connections: document.connections.map((wire) => ({
        ...wire,
        id: wires.get(wire.id) ?? wire.id,
        from: {
          ...wire.from,
          componentId: components.get(wire.from.componentId) ?? wire.from.componentId,
        },
        to: { ...wire.to, componentId: components.get(wire.to.componentId) ?? wire.to.componentId },
      })),
    };
    // Use the parser as a gate, not as a serializer: retain every original property.
    if (!changed) return { status: 'unchanged', document: null };
    return parseElectronicsDocument(candidate).ok
      ? { status: 'repaired', document: candidate }
      : { status: 'blocked', document: null };
  } catch {
    return { status: 'blocked', document: null };
  }
}
