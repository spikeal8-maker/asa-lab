import type { ThreeDDocument, ThreeDNode } from '@asa-lab/three-d';

/** Physical shortcuts also work with a Russian keyboard layout. */
export function editorShortcutKey(event: Pick<KeyboardEvent, 'code' | 'key'>): string {
  return /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : event.key.toLowerCase();
}

export function isEditorTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      Boolean(target.closest('input, textarea, select, [role="textbox"]')))
  );
}

export function keyboardNudge(
  key: string,
  step: number,
  accelerated: boolean,
): { x: number; z: number } | null {
  const distance = (Number.isFinite(step) && step > 0 ? step : 1) * (accelerated ? 10 : 1);
  switch (key) {
    case 'ArrowLeft':
      return { x: -distance, z: 0 };
    case 'ArrowRight':
      return { x: distance, z: 0 };
    case 'ArrowUp':
      return { x: 0, z: -distance };
    case 'ArrowDown':
      return { x: 0, z: distance };
    default:
      return null;
  }
}

export function nudgedSelection(
  document: ThreeDDocument,
  selectedIds: readonly string[],
  delta: { x: number; z: number },
): readonly ThreeDNode[] {
  if (!Number.isFinite(delta.x) || !Number.isFinite(delta.z)) return [];
  const selected = new Set(selectedIds);
  const blockedGroups = new Set(
    document.nodes
      .filter((node) => node.locked)
      .map((node) => node.groupId)
      .filter(Boolean),
  );
  const blockedBundles = new Set(
    document.nodes
      .filter((node) => node.locked)
      .map((node) => node.bundleId)
      .filter(Boolean),
  );
  return document.nodes
    .filter(
      (node) =>
        selected.has(node.id) &&
        node.visible &&
        !node.locked &&
        !blockedGroups.has(node.groupId) &&
        !blockedBundles.has(node.bundleId),
    )
    .map((node) => ({
      ...node,
      transform: {
        ...node.transform,
        position: {
          ...node.transform.position,
          x: Math.round((node.transform.position.x + delta.x) * 1000) / 1000,
          z: Math.round((node.transform.position.z + delta.z) * 1000) / 1000,
        },
      },
    }));
}
