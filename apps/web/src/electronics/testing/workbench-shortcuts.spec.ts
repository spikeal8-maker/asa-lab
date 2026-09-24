import { describe, expect, it } from 'vitest';
import {
  isEditableShortcutTarget,
  resolveWorkbenchShortcut,
  targetConsumesSpace,
  type WorkbenchShortcutEvent,
} from '../workbench-shortcuts';

function key(code: string, options: Partial<WorkbenchShortcutEvent> = {}): WorkbenchShortcutEvent {
  return { code, ctrlKey: false, metaKey: false, shiftKey: false, ...options };
}

describe('workbench shortcuts', () => {
  it('dispatches command shortcuts from physical code rather than layout glyphs', () => {
    expect(resolveWorkbenchShortcut(key('KeyC', { ctrlKey: true }))).toBe('copy');
    expect(resolveWorkbenchShortcut(key('KeyV', { ctrlKey: true }))).toBe('paste');
    expect(resolveWorkbenchShortcut(key('KeyD', { metaKey: true }))).toBe('duplicate');
    expect(resolveWorkbenchShortcut(key('KeyZ', { ctrlKey: true }))).toBe('undo');
    expect(resolveWorkbenchShortcut(key('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(resolveWorkbenchShortcut(key('KeyY', { ctrlKey: true }))).toBe('redo');
    expect(resolveWorkbenchShortcut(key('KeyA', { ctrlKey: true }))).toBe('select-all');
    expect(resolveWorkbenchShortcut(key('KeyR'))).toBe('rotate');
    expect(resolveWorkbenchShortcut(key('Delete'))).toBe('delete');
    expect(resolveWorkbenchShortcut(key('Backspace'))).toBe('delete');
  });

  it('is layout independent for English and Russian KeyboardEvent.key values', () => {
    const english = { ...key('KeyC', { ctrlKey: true }), key: 'c' };
    const russian = { ...key('KeyC', { ctrlKey: true }), key: '\u0441' };
    expect(resolveWorkbenchShortcut(english)).toBe('copy');
    expect(resolveWorkbenchShortcut(russian)).toBe('copy');
  });

  it('protects editable ancestors and controls that consume Space', () => {
    const editable = {
      closest(selector: string) {
        return selector.includes('.arduino-source-editor') ? (this as unknown as Element) : null;
      },
    } as unknown as EventTarget;
    const button = {
      closest(selector: string) {
        return selector.includes('button') ? (this as unknown as Element) : null;
      },
    } as unknown as EventTarget;
    const canvas = { closest: () => null } as unknown as EventTarget;

    expect(isEditableShortcutTarget(editable)).toBe(true);
    expect(isEditableShortcutTarget(canvas)).toBe(false);
    expect(targetConsumesSpace(button)).toBe(true);
    expect(targetConsumesSpace(canvas)).toBe(false);
  });
});
