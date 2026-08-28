import type { ProductionStateValue, SchematicDocument } from '../api';

export interface RuntimeComponentOverride {
  readonly state?: boolean;
  readonly wiperPosition?: number;
  readonly stateProperties?: Readonly<Record<string, ProductionStateValue>>;
}

export type RuntimeComponentOverrides = Readonly<Record<string, RuntimeComponentOverride>>;

/**
 * Simulation controls are deliberately overlaid on the project document.
 * Turning a knob, holding a button or changing an environmental input must
 * influence the solver immediately without creating an autosave, undo entry or
 * a new shared project revision.
 */
export function applyRuntimeComponentOverrides(
  document: SchematicDocument | null,
  running: boolean,
  overrides: RuntimeComponentOverrides,
): SchematicDocument | null {
  if (!document || !running) return document;
  return {
    ...document,
    simulation: { ...document.simulation, running: true },
    components: document.components.map((component) => {
      const override = overrides[component.id];
      if (!override) return component;
      return {
        ...component,
        ...('state' in override ? { state: override.state } : {}),
        ...('wiperPosition' in override ? { wiperPosition: override.wiperPosition } : {}),
        ...(override.stateProperties
          ? {
              stateProperties: {
                ...component.stateProperties,
                ...override.stateProperties,
              },
            }
          : {}),
      };
    }),
  };
}
