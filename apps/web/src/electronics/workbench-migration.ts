import type { ComponentKind, SchematicComponent, SchematicDocument } from '../api';
import { catalogEntry, componentOriginForCenter } from './component-catalog';

const PHYSICAL_PROFILE = 'breadboard-2.54mm-v1' as const;

/** Render widths used by the first Electronics foundation before physical scale. */
const LEGACY_RENDER_WIDTH: Partial<Record<Exclude<ComponentKind, 'wire'>, number>> = {
  source: 118,
  resistor: 164,
  led: 92,
};

export interface GeometryMigrationResult {
  readonly document: SchematicDocument;
  readonly migrated: boolean;
  readonly migratedComponents: number;
  readonly maximumCentreShift: number;
  readonly fromProfile: 'legacy-pixel-v1' | 'breadboard-2.54mm-v1';
  readonly toProfile: 'breadboard-2.54mm-v1';
}

function legacyRenderedSize(
  component: SchematicComponent,
): { width: number; height: number } | null {
  if (component.kind === 'wire') return null;
  const entry = catalogEntry(component.kind);
  const width = LEGACY_RENDER_WIDTH[component.kind];
  if (!entry || width === undefined) return null;
  const height = (entry.viewBox.height * width) / entry.viewBox.width;
  return Math.abs((component.rotation ?? 0) % 180) === 90
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Upgrade only mutable draft geometry. Component IDs, values, rotation,
 * terminal references, wire IDs/colours/vertices, hidden attachments and
 * electrical topology remain unchanged. Immutable ProjectVersions are
 * rendered/migrated on read later and are never rewritten by this helper.
 *
 * A legacy breadboard has no accepted visual geometry in this foundation, so
 * it is preserved in place rather than guessed or scaled as an arbitrary box.
 */
export function migrateElectronicsGeometry(
  document: SchematicDocument,
): GeometryMigrationResult {
  const fromProfile = document.geometryProfile ?? 'legacy-pixel-v1';
  if (fromProfile === PHYSICAL_PROFILE) {
    return {
      document,
      migrated: false,
      migratedComponents: 0,
      maximumCentreShift: 0,
      fromProfile,
      toProfile: PHYSICAL_PROFILE,
    };
  }

  let migratedComponents = 0;
  let maximumCentreShift = 0;
  const components = document.components.map((component) => {
    const legacySize = legacyRenderedSize(component);
    if (!legacySize || component.kind === 'wire') return component;
    const rotation = component.rotation ?? 0;
    const previousCenter = {
      x: component.position.x + legacySize.width / 2,
      y: component.position.y + legacySize.height / 2,
    };
    const position = componentOriginForCenter(component.kind, previousCenter, rotation);
    const entry = catalogEntry(component.kind);
    if (!entry) return component;
    const physicalBaseWidth = entry.renderWidth;
    const physicalBaseHeight = (entry.viewBox.height * physicalBaseWidth) / entry.viewBox.width;
    const physicalSize =
      Math.abs(rotation % 180) === 90
        ? { width: physicalBaseHeight, height: physicalBaseWidth }
        : { width: physicalBaseWidth, height: physicalBaseHeight };
    const nextCenter = {
      x: position.x + physicalSize.width / 2,
      y: position.y + physicalSize.height / 2,
    };
    maximumCentreShift = Math.max(
      maximumCentreShift,
      Math.hypot(nextCenter.x - previousCenter.x, nextCenter.y - previousCenter.y),
    );
    migratedComponents += 1;
    return { ...component, position };
  });

  return {
    document: {
      ...document,
      geometryProfile: PHYSICAL_PROFILE,
      components,
    },
    migrated: true,
    migratedComponents,
    maximumCentreShift,
    fromProfile,
    toProfile: PHYSICAL_PROFILE,
  };
}
