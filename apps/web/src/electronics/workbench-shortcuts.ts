export type WorkbenchShortcut =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'rotate'
  | 'mirror'
  | 'simulate'
  | 'select-all'
  | 'escape'
  | 'space'
  | 'nudge-up'
  | 'nudge-down'
  | 'nudge-left'
  | 'nudge-right'
  | null;

export interface WorkbenchShortcutEvent {
  readonly code: string;
  readonly key?: string;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly isComposing?: boolean;
}

export type WorkbenchShortcutActions = Record<
  Exclude<WorkbenchShortcut, `nudge-${string}` | 'space' | null>,
  () => unknown
> & { nudge: (dx: number, dy: number) => void };

const EDITABLE_SHORTCUT_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '.monaco-editor',
  '.monaco-editor textarea',
  '.cm-editor',
  '.cm-content',
  '.ace_text-input',
  '.arduino-source-editor',
  '[data-editor-text-entry="true"]',
].join(', ');

const SPACE_CONTROL_SELECTOR = [
  EDITABLE_SHORTCUT_SELECTOR,
  'button',
  'summary',
  'a[href]',
  '[role="button"]',
].join(', ');

function closestMatches(target: EventTarget | null, selector: string): boolean {
  const candidate = target as
    (EventTarget & { closest?: (selector: string) => Element | null }) | null;
  return typeof candidate?.closest === 'function' && candidate.closest(selector) !== null;
}

export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return closestMatches(target, EDITABLE_SHORTCUT_SELECTOR);
}

export function targetConsumesSpace(target: EventTarget | null): boolean {
  return closestMatches(target, SPACE_CONTROL_SELECTOR);
}

export function resolveWorkbenchShortcut(event: WorkbenchShortcutEvent): WorkbenchShortcut {
  if (event.isComposing) return null;
  const modifier = Boolean(event.ctrlKey || event.metaKey);
  if (modifier && event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
  const command = (modifier ? MODIFIED_KEYS : PHYSICAL_KEYS)[event.code];
  return typeof command === 'string' ? command : null;
}

const MODIFIED_KEYS: Readonly<Record<string, WorkbenchShortcut>> = {
  KeyY: 'redo',
  KeyC: 'copy',
  KeyV: 'paste',
  KeyD: 'duplicate',
  KeyA: 'select-all',
  Enter: 'simulate',
};
const PHYSICAL_KEYS: Readonly<Record<string, WorkbenchShortcut>> = {
  Delete: 'delete',
  Backspace: 'delete',
  KeyR: 'rotate',
  KeyM: 'mirror',
  Escape: 'escape',
  Space: 'space',
  ArrowUp: 'nudge-up',
  ArrowDown: 'nudge-down',
  ArrowLeft: 'nudge-left',
  ArrowRight: 'nudge-right',
};
const NUDGES: Readonly<Record<string, readonly [number, number]>> = {
  'nudge-up': [0, -1],
  'nudge-down': [0, 1],
  'nudge-left': [-1, 0],
  'nudge-right': [1, 0],
};
export const KEYBOARD_NUDGE_STEP = 5;
export const KEYBOARD_NUDGE_LARGE_STEP = 20;

/** One production listener for the toolbar's existing command callbacks. */
export function bindWorkbenchShortcuts(
  actions: { current: WorkbenchShortcutActions | null },
  space: { current: boolean },
): () => void {
  function keyDown(event: KeyboardEvent): void {
    if (event.isComposing || isEditableShortcutTarget(event.target)) return;
    if (event.code === 'Space') {
      if (targetConsumesSpace(event.target)) return;
      space.current = true;
    }
    const command = resolveWorkbenchShortcut(event);
    const current = actions.current;
    if (!command || !current) return;
    const toggle = command === 'mirror' || command === 'simulate';
    if (toggle && event.altKey) return;
    if (command !== 'escape') event.preventDefault();
    if (command === 'space' || (toggle && event.repeat)) return;
    const direction = NUDGES[command];
    if (direction) {
      const step = event.shiftKey ? KEYBOARD_NUDGE_LARGE_STEP : KEYBOARD_NUDGE_STEP;
      current.nudge(direction[0] * step, direction[1] * step);
    } else {
      current[command as Exclude<WorkbenchShortcut, `nudge-${string}` | 'space' | null>]();
    }
  }
  function keyUp(event: KeyboardEvent): void {
    if (event.code === 'Space') space.current = false;
  }
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  return () => {
    window.removeEventListener('keydown', keyDown);
    window.removeEventListener('keyup', keyUp);
  };
}
