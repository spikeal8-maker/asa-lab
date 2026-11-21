// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type EssayLearningResponse } from '../../api';
import { EssayResponseEditor } from '../../components/EssayResponseEditor';
import { TaskBlocks } from '../../components/TaskBlocks';
import { setTelemetryContext } from '../../telemetry-context';

const RUN = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const ATTEMPT = '33333333-3333-4333-8333-333333333333';
const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root | null;
let container: HTMLDivElement;
let server: EssayLearningResponse;
let learner = 0;
const changed = vi.fn(async () => undefined);
let guard: (() => boolean) | null;
const ok = (data: EssayLearningResponse) => ({
  ok: true as const,
  status: 200,
  data: structuredClone(data),
});
const failure = (code: string) => ({
  ok: false as const,
  status: 409,
  error: { code, message: code },
});
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
async function mount() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(EssayResponseEditor, {
        activityRunId: RUN,
        activityVersionId: VERSION,
        onChanged: changed,
        onRegisterLeaveGuard: (_id: string, value: (() => boolean) | null) => {
          guard = value;
        },
      }),
    );
    await flush();
  });
}
function field() {
  return container.querySelector<HTMLTextAreaElement>('textarea')!;
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (!found) throw new Error('Missing button: ' + label);
  return found;
}
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      field(),
      text,
    );
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await flush();
  });
}
beforeAll(() => {
  globals.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globals.IS_REACT_ACT_ENVIRONMENT = false;
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  setTelemetryContext(
    {
      kind: 'student',
      seatId: `50000000-0000-4000-8000-${String(++learner).padStart(12, '0')}`,
      classId: '60000000-0000-4000-8000-000000000001',
    },
    true,
    'learning',
  );
  guard = null;
  changed.mockClear();
  server = {
    activityRunId: RUN,
    activityVersionId: VERSION,
    participationId: '44444444-4444-4444-8444-444444444444',
    title: 'Письменное задание',
    instructions: 'Объясните ответ',
    goal: null,
    blocks: [],
    resultMode: 'graded',
    maxPoints: 10,
    canEdit: true,
    canStart: false,
    attempt: {
      id: ATTEMPT,
      number: 1,
      state: 'in_progress',
      revision: 0,
      text: '',
      revisionOfAttemptId: null,
      savedAt: '2026-11-02T12:00:00.000Z',
      submittedAt: null,
      submissionId: null,
      digest: null,
      reviewDecision: null,
      feedback: null,
    },
  };
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  vi.spyOn(api, 'readEssayLearning').mockImplementation(async () => ok(server));
  vi.spyOn(api, 'saveEssayLearning').mockImplementation(async (_run, input) => {
    server = {
      ...server,
      attempt: { ...server.attempt!, text: input.text, revision: input.expectedRevision + 1 },
    };
    return ok(server);
  });
  vi.spyOn(api, 'submitEssayLearning').mockImplementation(async () => {
    server = {
      ...server,
      canEdit: false,
      attempt: {
        ...server.attempt!,
        state: 'submitted',
        submissionId: '55555555-5555-4555-8555-555555555555',
        digest: 'a'.repeat(64),
        submittedAt: '2026-11-02T12:10:00.000Z',
      },
    };
    return ok(server);
  });
  vi.spyOn(api, 'startEssayLearning').mockImplementation(async () => ok(server));
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('compact written-response editor', () => {
  it('saves before Submit and freezes only the acknowledged revision under one synchronous lock', async () => {
    await mount();
    await type('  Мой ответ\nс объяснением  ');
    expect(button('Сдать ответ').disabled).toBe(false);
    await click('Сдать ответ');
    expect(api.saveEssayLearning).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({
        attemptId: ATTEMPT,
        expectedRevision: 0,
        text: '  Мой ответ\nс объяснением  ',
      }),
    );
    expect(api.submitEssayLearning).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({ attemptId: ATTEMPT, expectedRevision: 1 }),
    );
    expect(field().value).toBe('  Мой ответ\nс объяснением  ');
    expect(field().disabled).toBe(true);
    expect(container.textContent).toContain('Ответ сдан');
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('keeps local text on optimistic conflict and requires an explicit choice before overwriting confirmed text', async () => {
    await mount();
    await type('Мой несохранённый ответ');
    server.attempt = { ...server.attempt!, text: 'Ответ из другого окна', revision: 3 };
    vi.mocked(api.saveEssayLearning).mockResolvedValueOnce(failure('draft_revision_conflict'));
    await click('Сохранить ответ');
    expect(field().value).toBe('Мой несохранённый ответ');
    expect(field().disabled).toBe(true);
    await click('Оставить мой текст');
    expect(field().value).toBe('Мой несохранённый ответ');
    expect(api.saveEssayLearning).toHaveBeenCalledTimes(1);
    await click('Сохранить ответ');
    expect(api.saveEssayLearning).toHaveBeenLastCalledWith(
      RUN,
      expect.objectContaining({ expectedRevision: 3, text: 'Мой несохранённый ответ' }),
    );
  });

  it('does not discard the local conflict answer when loading confirmed text is cancelled', async () => {
    await mount();
    await type('Мой текст');
    server.attempt = { ...server.attempt!, text: 'Подтверждённый текст', revision: 2 };
    vi.mocked(api.saveEssayLearning).mockResolvedValueOnce(failure('draft_revision_conflict'));
    await click('Сохранить ответ');
    await click('Загрузить сохранённый ответ');
    expect(field().value).toBe('Мой текст');
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await click('Загрузить сохранённый ответ');
    expect(field().value).toBe('Подтверждённый текст');
  });

  it('retains the same retry ID after an uncertain submission without creating another save or duplicate request', async () => {
    await mount();
    await type('Ответ');
    vi.mocked(api.submitEssayLearning).mockRejectedValueOnce(new Error('lost acknowledgement'));
    await click('Сдать ответ');
    expect(field().value).toBe('Ответ');
    expect(container.textContent).toContain('Ваш текст оставлен');
    const first = vi.mocked(api.submitEssayLearning).mock.calls[0]![1];
    await click('Сдать ответ');
    expect(api.saveEssayLearning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.submitEssayLearning).mock.calls[1]![1]).toEqual(first);
  });

  it('blocks duplicate submit and navigation while acknowledgement is pending', async () => {
    await mount();
    await type('Ответ');
    let finish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(api.saveEssayLearning).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await act(async () => {
      button('Сдать ответ').click();
      button('Сдать ответ').click();
      await flush();
    });
    expect(api.saveEssayLearning).toHaveBeenCalledTimes(1);
    expect(guard?.()).toBe(false);
    expect(field().disabled).toBe(true);
    await act(async () => {
      finish(ok({ ...server, attempt: { ...server.attempt!, text: 'Ответ', revision: 1 } }));
      await flush();
    });
    expect(api.submitEssayLearning).toHaveBeenCalledTimes(1);
  });

  it('recovers unsent text after a section remount only after exact authorized read, and clears it for another learner', async () => {
    await mount();
    await type('Личный черновик');
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await act(async () => root!.unmount());
    root = null;
    container.remove();
    await mount();
    expect(field().value).toBe('Личный черновик');
    await act(async () => {
      setTelemetryContext(
        {
          kind: 'student',
          seatId: '70000000-0000-4000-8000-000000000001',
          classId: '60000000-0000-4000-8000-000000000001',
        },
        true,
        'learning',
      );
      await flush();
    });
    expect(field().value).toBe('');
  });

  it('never restores a cached answer for a different attempt or an inaccessible activity', async () => {
    await mount();
    await type('Личный старый черновик');
    await act(async () => root!.unmount());
    root = null;
    container.remove();
    server.attempt = {
      ...server.attempt!,
      id: '88888888-8888-4888-8888-888888888888',
      number: 2,
      text: 'Новая попытка',
      revision: 0,
    };
    await mount();
    expect(field().value).toBe('Новая попытка');
    await act(async () => root!.unmount());
    root = null;
    container.remove();
    vi.mocked(api.readEssayLearning).mockResolvedValueOnce(failure('learning_work_unavailable'));
    await mount();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toContain('Личный старый черновик');
  });

  it('never applies an acknowledgement after the learner changes', async () => {
    await mount();
    await type('Старый ученик');
    let finish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(api.saveEssayLearning).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await click('Сохранить ответ');
    await act(async () => {
      server.attempt = { ...server.attempt!, text: 'Новый ученик', revision: 4 };
      setTelemetryContext(
        {
          kind: 'student',
          seatId: '90000000-0000-4000-8000-000000000001',
          classId: '60000000-0000-4000-8000-000000000001',
        },
        true,
        'learning',
      );
      await flush();
    });
    await act(async () => {
      finish(
        ok({
          ...server,
          attempt: { ...server.attempt!, text: 'Старое подтверждение', revision: 1 },
        }),
      );
      await flush();
    });
    expect(field().value).toBe('Новый ученик');
  });

  it('recognizes a saved but lost acknowledgement after remount without inventing a text conflict', async () => {
    await mount();
    await type('Уже подтверждённый сервером ответ');
    vi.mocked(api.saveEssayLearning).mockImplementationOnce(async (_run, input) => {
      server.attempt = { ...server.attempt!, text: input.text, revision: 1 };
      throw new Error('lost acknowledgement');
    });
    await click('Сохранить ответ');
    await act(async () => root!.unmount());
    root = null;
    container.remove();
    await mount();
    expect(field().value).toBe('Уже подтверждённый сервером ответ');
    expect(container.textContent).toContain('Ответ сохранён');
    expect(container.textContent).not.toContain('Загрузить сохранённый ответ');
    expect(button('Сдать ответ').disabled).toBe(false);
  });

  it('does not let an old learner acknowledgement unlock the new learner pending operation', async () => {
    await mount();
    await type('Старый ответ');
    let oldFinish!: (value: ReturnType<typeof ok>) => void;
    let newFinish!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(api.saveEssayLearning).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldFinish = resolve;
        }),
    );
    await click('Сохранить ответ');
    await act(async () => {
      server.attempt = { ...server.attempt!, text: 'Новый ответ', revision: 4 };
      setTelemetryContext(
        {
          kind: 'student',
          seatId: 'a0000000-0000-4000-8000-000000000001',
          classId: '60000000-0000-4000-8000-000000000001',
        },
        true,
        'learning',
      );
      await flush();
    });
    await type('Текст нового ученика');
    vi.mocked(api.saveEssayLearning).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          newFinish = resolve;
        }),
    );
    await click('Сохранить ответ');
    await act(async () => {
      oldFinish(
        ok({
          ...server,
          attempt: { ...server.attempt!, text: 'Старое подтверждение', revision: 1 },
        }),
      );
      await flush();
    });
    expect(field().disabled).toBe(true);
    expect(guard?.()).toBe(false);
    expect(api.saveEssayLearning).toHaveBeenCalledTimes(2);
    await act(async () => {
      newFinish(
        ok({
          ...server,
          attempt: { ...server.attempt!, text: 'Текст нового ученика', revision: 5 },
        }),
      );
      await flush();
    });
    expect(field().value).toBe('Текст нового ученика');
    expect(field().disabled).toBe(false);
  });

  it('uses only the exact essay role and digest media URLs without broadening task resource origins', async () => {
    await mount();
    const hash = 'a'.repeat(64);
    const image = `/api/learning/essay/runs/${RUN}/media/image/${hash}`;
    const file = `/api/learning/essay/runs/${RUN}/media/file/${hash}`;
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    await act(async () =>
      root!.render(
        createElement(TaskBlocks, {
          blocks: [
            { type: 'image', alt: 'Условия', contentHash: hash, src: image },
            { type: 'file', name: 'Условия.pdf', contentHash: hash, src: file },
          ],
        }),
      ),
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(image);
    await click('Скачать PDF');
    expect(fetch).toHaveBeenCalledWith(file, { credentials: 'same-origin', cache: 'no-store' });
    await act(async () =>
      root!.render(
        createElement(TaskBlocks, {
          blocks: [
            {
              type: 'image',
              alt: 'Условия',
              contentHash: hash,
              src: 'https://outside.test' + image,
            },
            { type: 'file', name: 'Условия.pdf', contentHash: hash, src: image },
          ],
        }),
      ),
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      `/api/assignments/task-images/${hash}`,
    );
    await click('Скачать PDF');
    expect(fetch).toHaveBeenLastCalledWith(`/api/assignments/task-files/${hash}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it.each(['submitted', 'evaluating', 'closed'] as const)(
    'shows frozen server text after another device moves the same revision to %s, preserving unsent text separately',
    async (state) => {
      server.attempt = { ...server.attempt!, revision: 1, text: 'Официально сохранённый ответ А' };
      await mount();
      await type('Несохранённый локальный ответ Б');
      await act(async () => root!.unmount());
      root = null;
      container.remove();
      server = {
        ...server,
        canEdit: false,
        attempt: {
          ...server.attempt!,
          state,
          submissionId: '55555555-5555-4555-8555-555555555555',
          submittedAt: '2026-11-02T12:10:00.000Z',
          digest: 'a'.repeat(64),
          reviewDecision: state === 'closed' ? 'accepted' : null,
        },
      };
      await mount();
      expect(field().value).toBe('Официально сохранённый ответ А');
      expect(field().disabled).toBe(true);
      expect(
        container.querySelector<HTMLTextAreaElement>('[aria-label="Локальный несохранённый текст"]')
          ?.value,
      ).toBe('Несохранённый локальный ответ Б');
      expect(container.querySelector<HTMLDetailsElement>('.essay-response-recovery')?.open).toBe(
        false,
      );
      expect(container.textContent).toContain('Этот текст не был сдан');
      await act(async () => {
        setTelemetryContext(
          {
            kind: 'student',
            seatId: 'b0000000-0000-4000-8000-000000000001',
            classId: '60000000-0000-4000-8000-000000000001',
          },
          true,
          'learning',
        );
        await flush();
      });
      expect(container.querySelector('[aria-label="Локальный несохранённый текст"]')).toBeNull();
    },
  );

  it.each([false, true])(
    'requires a recovery choice after starting rework and before leaving (discard=%s)',
    async (discard) => {
      server.attempt = { ...server.attempt!, revision: 1, text: 'Сданный ответ А' };
      await mount();
      await type('Несохранённый ответ Б');
      await act(async () => root!.unmount());
      root = null;
      container.remove();
      server = {
        ...server,
        canEdit: false,
        canStart: true,
        attempt: {
          ...server.attempt!,
          state: 'closed',
          reviewDecision: 'changes_requested',
          submissionId: '55555555-5555-4555-8555-555555555555',
        },
      };
      await mount();
      vi.mocked(api.startEssayLearning).mockImplementationOnce(async () => {
        server = {
          ...server,
          canEdit: true,
          canStart: false,
          attempt: {
            ...server.attempt!,
            id: '88888888-8888-4888-8888-888888888888',
            revision: 0,
            number: 2,
            state: 'in_progress',
            revisionOfAttemptId: ATTEMPT,
            submissionId: null,
            reviewDecision: null,
          },
        };
        return ok(server);
      });
      await click('Начать доработку');
      expect(field().value).toBe('Сданный ответ А');
      expect(guard!()).toBe(false);
      expect(window.confirm).toHaveBeenLastCalledWith(
        'Несохранённый текст предыдущего редактирования будет потерян. Выйти и удалить этот текст?',
      );
      expect(
        container.querySelector<HTMLTextAreaElement>(
          '[aria-label="Локальный несохранённый текст"]',
        )!.value,
      ).toBe('Несохранённый ответ Б');
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
      if (discard) {
        vi.mocked(window.confirm).mockReturnValueOnce(true);
        await act(async () => expect(guard!()).toBe(true));
        await act(async () => root!.unmount());
        root = null;
        container.remove();
        await mount();
        expect(field().value).toBe('Сданный ответ А');
        expect(container.querySelector('[aria-label="Локальный несохранённый текст"]')).toBeNull();
        return;
      }
      const details = container.querySelector<HTMLDetailsElement>('.essay-response-recovery')!;
      details.open = true;
      await click('Использовать в новой попытке');
      expect(field().value).toBe('Несохранённый ответ Б');
      expect(api.saveEssayLearning).not.toHaveBeenCalled();
      await click('Сохранить ответ');
      expect(api.saveEssayLearning).toHaveBeenCalledWith(
        RUN,
        expect.objectContaining({
          attemptId: '88888888-8888-4888-8888-888888888888',
          expectedRevision: 0,
          text: 'Несохранённый ответ Б',
        }),
      );
    },
  );
});
