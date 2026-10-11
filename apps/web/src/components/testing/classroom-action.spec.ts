import { describe, expect, it, vi } from 'vitest';
import { confirmedClassroomResult, runClassroomAction } from '../classroom-action';

describe('classroom confirmed actions', () => {
  it.each(['refusal', 'throw'] as const)(
    'restores busy and permits a retry after %s',
    async (failure) => {
      let busy = false;
      let safeMode = true;
      const fail = vi.fn();
      const state = {
        start: () => {
          busy = true;
        },
        finish: () => {
          busy = false;
        },
        fail,
      };
      const work = async () => {
        expect(busy).toBe(true);
        if (failure === 'throw') throw new Error('transport unavailable');
        const data = confirmedClassroomResult(
          { ok: false, error: { message: 'Настройки не сохранены.' } },
          'Не удалось сохранить.',
        );
        safeMode = Boolean(data);
      };
      expect(await runClassroomAction(work, 'Не удалось сохранить.', state)).toContain(
        'Повторите попытку.',
      );
      expect(busy).toBe(false);
      expect(safeMode).toBe(true);
      expect(fail).toHaveBeenCalledTimes(1);
      expect(fail.mock.calls[0]![0]).not.toContain('transport');
      expect(
        await runClassroomAction(
          async () => {
            const data = confirmedClassroomResult(
              { ok: true, data: { safeMode: false } },
              'Не удалось сохранить.',
            );
            safeMode = data.safeMode;
          },
          'Не удалось сохранить.',
          state,
        ),
      ).toBeNull();
      expect(safeMode).toBe(false);
      expect(busy).toBe(false);
    },
  );
  it('uses the server-confirmed value rather than the attempted value', async () => {
    const state = { start: vi.fn(), finish: vi.fn(), fail: vi.fn() };
    let safeMode = false;
    await runClassroomAction(
      async () => {
        safeMode = confirmedClassroomResult(
          { ok: true, data: { safeMode: true } },
          'Ошибка.',
        ).safeMode;
      },
      'Ошибка.',
      state,
    );
    expect(safeMode).toBe(true);
    expect(state.finish).toHaveBeenCalledOnce();
    expect(state.fail).not.toHaveBeenCalled();
  });
});
