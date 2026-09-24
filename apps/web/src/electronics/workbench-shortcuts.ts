export type WorkbenchShortcut =
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'rotate'
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
}

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
  const modifier = Boolean(event.ctrlKey || event.metaKey);
  if (modifier) {
    if (event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
    if (event.code === 'KeyY') return 'redo';
    if (event.code === 'KeyC') return 'copy';
    if (event.code === 'KeyV') return 'paste';
    if (event.code === 'KeyD') return 'duplicate';
    if (event.code === 'KeyA') return 'select-all';
    return null;
  }
  if (event.code === 'Delete' || event.code === 'Backspace') return 'delete';
  if (event.code === 'KeyR') return 'rotate';
  if (event.code === 'Escape') return 'escape';
  if (event.code === 'Space') return 'space';
  if (event.code === 'ArrowUp') return 'nudge-up';
  if (event.code === 'ArrowDown') return 'nudge-down';
  if (event.code === 'ArrowLeft') return 'nudge-left';
  if (event.code === 'ArrowRight') return 'nudge-right';
  return null;
}
