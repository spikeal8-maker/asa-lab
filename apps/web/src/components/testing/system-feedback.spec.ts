import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearSystemFeedback,
  dismissSystemFeedback,
  getSystemFeedbackSnapshot,
  subscribeSystemFeedback,
  systemFeedback,
} from '../system-feedback';

afterEach(() => {
  clearSystemFeedback();
  vi.useRealTimers();
});

describe('shared system action feedback', () => {
  it('emits one deduplicated success and announces subsequent confirmed results', () => {
    let emissions = 0;
    const unsubscribe = subscribeSystemFeedback(() => {
      emissions += 1;
    });
    const first = systemFeedback.success('Сохранено');
    expect(first).toBeGreaterThan(0);
    expect(systemFeedback.success('Сохранено')).toBe(first);
    expect(getSystemFeedbackSnapshot()).toHaveLength(1);
    expect(getSystemFeedbackSnapshot()[0]).toMatchObject({
      kind: 'success',
      message: 'Сохранено',
    });
    expect(emissions).toBe(1);
    unsubscribe();
  });

  it('keeps errors until explicitly dismissed and queues more than three messages', () => {
    const first = systemFeedback.error('Сохранение не удалось');
    const second = systemFeedback.warning('Проверьте соединение');
    systemFeedback.info('Отправлено');
    systemFeedback.success('Ещё одно действие сохранено');
    const visible = getSystemFeedbackSnapshot();
    expect(visible).toHaveLength(3);
    expect(visible[0].expiresAt).toBeNull();
    expect(visible[1].id).toBe(second);
    dismissSystemFeedback(first);
    const next = getSystemFeedbackSnapshot();
    expect(next).toHaveLength(3);
    expect(next.some((item) => item.message === 'Ещё одно действие сохранено')).toBe(true);
  });

  it('never emits blank messages', () => {
    expect(systemFeedback.info('   ')).toBe(0);
    expect(getSystemFeedbackSnapshot()).toEqual([]);
  });
});
