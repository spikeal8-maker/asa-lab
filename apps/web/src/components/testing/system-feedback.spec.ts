import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateSystemFeedbackScope,
  clearSystemFeedback,
  dismissSystemFeedback,
  getSystemFeedbackSnapshot,
  subscribeSystemFeedback,
  SYSTEM_FEEDBACK_MAX_LENGTH,
} from '../system-feedback';

describe('system feedback store', () => {
  beforeEach(() => clearSystemFeedback());

  it('keeps an immutable stable snapshot between changes', () => {
    expect(getSystemFeedbackSnapshot()).toBeNull();
    const handle = activateSystemFeedbackScope('page');
    handle.notify('Готово', 'success');
    const snapshot = getSystemFeedbackSnapshot();
    expect(getSystemFeedbackSnapshot()).toBe(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('refreshes duplicates and publishes once per change to subscribers', () => {
    const handle = activateSystemFeedbackScope('page');
    const listener = vi.fn();
    const unsubscribe = subscribeSystemFeedback(listener);
    try {
      const first = handle.notify('Готово', 'success');
      const firstSnapshot = getSystemFeedbackSnapshot();
      const second = handle.notify('Готово', 'success');
      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second!).toBeGreaterThan(first!);
      expect(getSystemFeedbackSnapshot()).not.toBe(firstSnapshot);
      expect(getSystemFeedbackSnapshot()).toEqual({
        id: second,
        message: 'Готово',
        tone: 'success',
        scope: 'page',
      });
      expect(listener).toHaveBeenCalledTimes(2);
      dismissSystemFeedback(first!);
      expect(getSystemFeedbackSnapshot()?.id).toBe(second);
      expect(listener).toHaveBeenCalledTimes(2);
      dismissSystemFeedback(second!);
      expect(getSystemFeedbackSnapshot()).toBeNull();
      expect(listener).toHaveBeenCalledTimes(3);
      unsubscribe();
      handle.notify('Снова', 'info');
      expect(listener).toHaveBeenCalledTimes(3);
    } finally {
      unsubscribe();
    }
  });

  it('atomically invalidates old owners before notifying scope-switch subscribers', () => {
    const old = activateSystemFeedbackScope('a');
    old.notify('Старое', 'info');
    const listener = vi.fn(() => {
      old.notify('Позднее', 'error');
      old.clear();
    });
    const unsubscribe = subscribeSystemFeedback(listener);
    try {
      const next = activateSystemFeedbackScope('b');
      expect(getSystemFeedbackSnapshot()).toBeNull();
      next.notify('Новое', 'success');
      expect(getSystemFeedbackSnapshot()?.message).toBe('Новое');
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it('rejects obsolete publish, whitespace, clear and dispose without erasing the new owner', () => {
    const old = activateSystemFeedbackScope('a');
    const next = activateSystemFeedbackScope('b');
    next.notify('Новое', 'info');
    const snapshot = getSystemFeedbackSnapshot();
    expect(old.notify('Позднее', 'error')).toBeNull();
    expect(old.notify(' ', 'error')).toBeNull();
    old.clear();
    old.dispose();
    expect(getSystemFeedbackSnapshot()).toBe(snapshot);
    next.clear();
    expect(getSystemFeedbackSnapshot()).toBeNull();
  });

  it('separates generations for A to B to A and repeated identical scope keys', () => {
    const first = activateSystemFeedbackScope('a');
    const middle = activateSystemFeedbackScope('b');
    const last = activateSystemFeedbackScope('a');
    last.notify('Последнее', 'success');
    first.clear();
    first.dispose();
    middle.dispose();
    expect(first.notify('Старое', 'error')).toBeNull();
    expect(getSystemFeedbackSnapshot()?.message).toBe('Последнее');
    const replacement = activateSystemFeedbackScope('a');
    replacement.notify('Новый экземпляр', 'info');
    last.clear();
    last.dispose();
    expect(last.notify('Позднее', 'error')).toBeNull();
    expect(getSystemFeedbackSnapshot()?.message).toBe('Новый экземпляр');
  });

  it('trims text and treats active whitespace as clear', () => {
    const handle = activateSystemFeedbackScope('page');
    handle.notify('  Текст  ', 'info');
    expect(getSystemFeedbackSnapshot()?.message).toBe('Текст');
    handle.notify(' \n\t ', 'warning');
    expect(getSystemFeedbackSnapshot()).toBeNull();
  });

  it('bounds Unicode text with an ellipsis and preserves literal text', () => {
    const handle = activateSystemFeedbackScope('page');
    handle.notify('я'.repeat(3000), 'warning');
    expect(getSystemFeedbackSnapshot()?.message.length).toBe(SYSTEM_FEEDBACK_MAX_LENGTH);
    expect(getSystemFeedbackSnapshot()?.message.endsWith('…')).toBe(true);
    handle.notify('😀'.repeat(1500), 'info');
    const text = getSystemFeedbackSnapshot()?.message ?? '';
    expect(text.length).toBeLessThanOrEqual(SYSTEM_FEEDBACK_MAX_LENGTH);
    expect(text).toBe(`${'😀'.repeat(999)}…`);
    handle.notify('я'.repeat(2000), 'info');
    expect(getSystemFeedbackSnapshot()?.message).toBe('я'.repeat(2000));
    handle.notify('<b>Текст</b>', 'info');
    expect(getSystemFeedbackSnapshot()?.message).toBe('<b>Текст</b>');
  });

  it('invalidates disposed handles and explicit teardown publishers', () => {
    const handle = activateSystemFeedbackScope('page');
    handle.notify('Готово', 'success');
    handle.dispose();
    expect(getSystemFeedbackSnapshot()).toBeNull();
    expect(handle.notify('Позднее', 'error')).toBeNull();
    const next = activateSystemFeedbackScope('next');
    clearSystemFeedback();
    expect(next.notify('После teardown', 'info')).toBeNull();
  });
});
