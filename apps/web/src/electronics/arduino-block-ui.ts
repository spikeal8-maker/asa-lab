import * as ScratchBlocks from 'scratch-blocks';

export const ARDUINO_WORKSPACE_PLUGINS = { connectionChecker: 'asa-arduino-values' };
let checkerRegistered = false;
const configuredPalettes = new WeakSet<object>();
const configuredCheckers = new WeakSet<object>();

function numericBooleanPair(a: ScratchBlocks.Connection, b: ScratchBlocks.Connection): boolean {
  const left = a.getCheck() ?? [];
  const right = b.getCheck() ?? [];
  return (
    (left.includes('Number') && right.includes('Boolean')) ||
    (left.includes('Boolean') && right.includes('Number'))
  );
}

/** Scratch's continuous flyout measures content height without the leading
 * category spacer. Include its actual bottom and reserve the zoom controls so
 * the final item can scroll fully into view in every category and scale. */
export function configureArduinoPaletteScroll(workspace: ScratchBlocks.WorkspaceSvg): void {
  const palette = workspace.getFlyout()?.getWorkspace();
  if (!palette) return;
  const manager = palette.getMetricsManager();
  if (configuredPalettes.has(manager)) return;
  const original = manager.getScrollMetrics.bind(manager);
  manager.getScrollMetrics = (workspaceCoordinates, view, content) => {
    const metrics = original(workspaceCoordinates, view, content);
    const bounds = content ?? manager.getContentMetrics(workspaceCoordinates);
    const footer = 68 / (workspaceCoordinates ? palette.scale : 1);
    return {
      ...metrics,
      height: Math.max(metrics.height, bounds.top + bounds.height + footer - metrics.top),
    };
  };
  configuredPalettes.add(manager);
  palette.scrollbar?.resize();
}

/** Arduino accepts Boolean values as 0/1 and numeric conditions as false/true.
 * Keep Number checks for round slots and Boolean checks for hexagonal slots;
 * only the type compatibility changes, never the renderer or string safety. */
export function registerArduinoConnectionChecker(): void {
  if (checkerRegistered) return;
  const Base = ScratchBlocks.registry.getClass(
    ScratchBlocks.registry.Type.CONNECTION_CHECKER,
    ScratchBlocks.registry.DEFAULT,
  ) as typeof ScratchBlocks.ConnectionChecker;
  class ArduinoConnectionChecker extends Base {
    override doTypeChecks(a: ScratchBlocks.Connection, b: ScratchBlocks.Connection): boolean {
      if (super.doTypeChecks(a, b)) return true;
      return numericBooleanPair(a, b);
    }
  }
  ScratchBlocks.registry.register(
    ScratchBlocks.registry.Type.CONNECTION_CHECKER,
    ARDUINO_WORKSPACE_PLUGINS.connectionChecker,
    ArduinoConnectionChecker,
  );
  checkerRegistered = true;
}

export function configureArduinoConnections(workspace: ScratchBlocks.WorkspaceSvg): void {
  registerArduinoConnectionChecker();
  // Pinned scratch-blocks.inject replaces the plugins option. Apply the local
  // checker through the public workspace property after injection, including
  // the flyout from which native drags originate. Never replace its global default.
  // Native connection databases/previewers may retain this exact instance.
  // Decorate its public type check rather than swapping out the instance.
  for (const target of [workspace, workspace.getFlyout()?.getWorkspace()]) {
    const checker = target?.connectionChecker;
    if (!checker || configuredCheckers.has(checker)) continue;
    const original = checker.doTypeChecks.bind(checker);
    checker.doTypeChecks = (a, b) => original(a, b) || numericBooleanPair(a, b);
    configuredCheckers.add(checker);
  }
}

export { arduinoBlockTooltip, ARDUINO_SCRATCH_THEME } from './arduino-block-appearance';
