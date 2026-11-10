// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  type AuthoredQuestionPayload,
  type AuthoredQuizPayload,
  type LearningQuizAttempt,
} from '../../api';
import { QuizResponsePlayer } from '../../components/QuizResponsePlayer';
import { QuizQuestionFields, QUIZ_TYPES } from '../../components/QuizQuestionFields';
import { QuizActivityEditor, type SaveQuizContent } from '../../components/QuizActivityEditor';
import { setTelemetryContext } from '../../telemetry-context';

const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
let root: Root | null;
let container: HTMLDivElement;
let learner = 0;
const ok = <T>(data: T) => ({ ok: true as const, status: 200, data: structuredClone(data) });
const changed = vi.fn(async () => undefined);
let server: LearningQuizAttempt;
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
async function mount(element: React.ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
    await flush();
  });
}
async function unmount() {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === label,
  );
  if (!found) throw new Error(label);
  return found;
}
async function click(label: string) {
  await act(async () => {
    button(label).click();
    await flush();
  });
}
async function input(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const proto =
      field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
    await flush();
  });
}
beforeEach(() => {
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  changed.mockClear();
  setTelemetryContext(
    {
      kind: 'student',
      seatId: `50000000-0000-4000-8000-${String(++learner).padStart(12, '0')}`,
      classId: '60000000-0000-4000-8000-000000000001',
    },
    true,
    'learning',
  );
  server = {
    attemptId: 'attempt',
    version: 1,
    answers: { q: { value: 'official' } },
    questions: [
      {
        id: 'q',
        type: 'long_text_manual',
        promptBlocks: [{ type: 'text', text: 'Объясните ответ' }],
        maxPoints: 4,
      },
    ],
    questionOrder: ['q'],
    state: 'in_progress',
    expiresAt: null,
    serverNow: new Date().toISOString(),
    lastSavedAt: null,
  };
  vi.spyOn(api, 'readQuizLearning').mockImplementation(async () =>
    ok({
      participationId: 'part',
      attempt: server,
      title: 'Тест',
      instructions: null,
      canStart: true,
    }),
  );
  vi.spyOn(api, 'saveQuizAnswers').mockImplementation(async (_id, version, answers) => {
    expect(version).toBe(server.version);
    server = { ...server, version: version + 1, answers: structuredClone(answers) };
    return ok({ version: server.version, savedAt: new Date().toISOString(), expiresAt: null });
  });
  vi.spyOn(api, 'submitQuizAttempt').mockImplementation(async (_id, version) => {
    expect(version).toBe(server.version);
    server = { ...server, state: 'submitted' };
    return ok({ attempt: server });
  });
});
afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
  globals.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('Quiz mounted learner controls', () => {
  it('respects denied Start without hiding a previously saved attempt', async () => {
    const start = vi.spyOn(api, 'startQuizLearning');
    vi.mocked(api.readQuizLearning).mockResolvedValueOnce(
      ok({
        participationId: 'part',
        attempt: null,
        title: null,
        instructions: null,
        canStart: false,
      }),
    );
    await mount(
      createElement(QuizResponsePlayer, { activityRunId: 'unavailable', onChanged: changed }),
    );
    expect(container.textContent).toContain('Тест сейчас недоступен.');
    expect(container.textContent).not.toContain('Начать тест');
    expect(start).not.toHaveBeenCalled();

    await unmount();
    vi.mocked(api.readQuizLearning).mockResolvedValueOnce(
      ok({
        participationId: 'part',
        attempt: { ...server, state: 'closed' },
        title: 'Тест',
        instructions: null,
        canStart: false,
      }),
    );
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'closed', onChanged: changed }));
    expect(container.querySelector('textarea')?.value).toBe('official');
    expect(container.textContent).not.toContain('Новая попытка');
  });

  it.each(['in_progress', 'score_only', 'after_close_not_released'])(
    'does not fabricate per-question feedback when the server omits it: %s',
    async (mode) => {
      server = { ...server, state: mode === 'in_progress' ? 'in_progress' : 'evaluated' };
      if (mode === 'score_only')
        server.result = { points: 7, maxPoints: 9, outcome: 'passed', provisional: false };
      await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
      expect(container.querySelector('[data-testid="quiz-question-feedback"]')).toBeNull();
      expect(container.textContent).not.toContain('Ожидает проверки');
      if (mode === 'score_only') expect(container.textContent).toContain('7 из 9');
    },
  );
  it.each(['immediate', 'after_close_released'])(
    'renders only released feedback matched by immutable question version: %s',
    async () => {
      server = {
        ...server,
        state: 'evaluated',
        questions: [{ ...server.questions[0]!, type: 'short_text' }],
        feedback: [
          {
            questionVersionId: 'unrelated-version',
            points: 999,
            correct: true,
            maxPoints: 999,
            manualPending: false,
          },
          { questionVersionId: 'q', points: 0, correct: false, maxPoints: 4, manualPending: false },
        ],
        result: { points: 2, maxPoints: 10, outcome: 'failed', provisional: false },
      };
      await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
      const feedback = container.querySelectorAll('[data-testid="quiz-question-feedback"]');
      expect(feedback).toHaveLength(1);
      expect(feedback[0]!.textContent).toBe('Неверно · 0 из 4 балл(а)');
      expect(container.textContent).toContain('2 из 10');
      expect(container.textContent).not.toContain('999');
    },
  );
  it('shows released correct and pending manual feedback without inventing a final total', async () => {
    server = {
      ...server,
      state: 'submitted',
      questions: [
        { ...server.questions[0]!, id: 'auto', type: 'short_text' },
        server.questions[0]!,
      ],
      questionOrder: ['auto', 'q'],
      feedback: [
        { questionVersionId: 'auto', points: 4, correct: true, maxPoints: 4, manualPending: false },
        { questionVersionId: 'q', points: null, correct: null, maxPoints: 4, manualPending: true },
      ],
    };
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    expect(
      [...container.querySelectorAll('[data-testid="quiz-question-feedback"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['Верно · 4 из 4 балл(а)', 'Ожидает проверки']);
    expect(container.textContent).not.toContain('Результат');
    expect(container.textContent).not.toContain('4 из 8');
  });
  it('shows teacher completion for final aggregate review without inventing a per-question manual score', async () => {
    server = {
      ...server,
      state: 'evaluated',
      feedback: [
        { questionVersionId: 'q', points: null, correct: null, maxPoints: 4, manualPending: false },
      ],
      result: { points: 8, maxPoints: 10, outcome: 'passed', provisional: false },
    };
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    expect(container.querySelector('[data-testid="quiz-question-feedback"]')!.textContent).toBe(
      'Проверено преподавателем',
    );
    expect(container.textContent).toContain('8 из 10');
    expect(container.textContent).not.toContain('Ожидает проверки');
    expect(container.textContent).not.toContain('0 из 4');
    expect(container.textContent).not.toContain('Неверно');
  });
  it('renders all eight response types without author keys', async () => {
    await mount(
      createElement(
        'div',
        null,
        ...Object.keys(QUIZ_TYPES).map((type, index) =>
          createElement(QuizQuestionFields, {
            key: type,
            question: {
              id: String(index),
              type: type as keyof typeof QUIZ_TYPES,
              promptBlocks: [],
              maxPoints: 1,
              responseSchema: {
                options: [
                  { id: 'a', label: 'А' },
                  { id: 'b', label: 'Б' },
                ],
                left: [{ id: 'l', label: 'Слева' }],
                right: [{ id: 'r', label: 'Справа' }],
              },
            },
            onChange: () => undefined,
          }),
        ),
      ),
    );
    expect(container.querySelectorAll('input[type=radio]')).toHaveLength(4);
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelectorAll('select')).toHaveLength(3);
    expect(container.textContent).not.toContain('answerKey');
  });
  it('saves first and submits only the server-confirmed revision', async () => {
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await input(container.querySelector('textarea')!, 'Обоснование');
    await click('Сдать тест');
    expect(api.saveQuizAnswers).toHaveBeenCalledWith('attempt', 1, { q: { value: 'Обоснование' } });
    expect(api.submitQuizAttempt).toHaveBeenCalledWith('attempt', 2, expect.any(String));
    expect(container.querySelector('textarea')!.disabled).toBe(true);
  });
  it('autosaves and reopens the saved answer', async () => {
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await input(container.querySelector('textarea')!, 'Сохранено');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(701);
    });
    expect(server.answers).toEqual({ q: { value: 'Сохранено' } });
    await unmount();
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    expect(container.querySelector('textarea')!.value).toBe('Сохранено');
  });
  it('keeps a conflict draft and never submits it', async () => {
    vi.mocked(api.saveQuizAnswers).mockResolvedValue({
      ok: false,
      status: 409,
      error: { code: 'quiz_version_conflict', message: 'conflict' },
    });
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await input(container.querySelector('textarea')!, 'Не терять');
    await click('Сдать тест');
    expect(container.querySelector('textarea')!.value).toBe('Не терять');
    expect(container.textContent).toContain('Ваши ответы до конфликта');
    expect(api.submitQuizAttempt).not.toHaveBeenCalled();
  });
  it('uses frozen official answers after a cross-device submission at the same version', async () => {
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await input(container.querySelector('textarea')!, 'LOCAL UNSENT');
    await unmount();
    server = { ...server, state: 'submitted' };
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    expect(container.querySelector('textarea')!.value).toBe('official');
    expect(container.querySelector('textarea')!.disabled).toBe(true);
    expect(container.textContent).toContain('LOCAL UNSENT');
    expect(api.saveQuizAnswers).not.toHaveBeenCalled();
  });
  it('disables answers at the server deadline without claiming a client grade', async () => {
    server = { ...server, expiresAt: new Date(Date.now() - 1000).toISOString() };
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    expect(container.querySelector('textarea')!.disabled).toBe(true);
    expect(container.textContent).toContain('Время истекло');
    expect(api.submitQuizAttempt).not.toHaveBeenCalled();
  });
  it('adopts the server expiry submission and keeps a failed-save draft separately', async () => {
    server = { ...server, expiresAt: new Date(Date.now() + 1000).toISOString() };
    vi.mocked(api.saveQuizAnswers).mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'save failed' },
    });
    vi.spyOn(api, 'readQuizAttempt').mockImplementation(async () =>
      ok({ attempt: { ...server, state: 'submitted' } }),
    );
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await input(container.querySelector('textarea')!, 'FAILED LOCAL B');
    await click('Сохранить ответы');
    expect(container.querySelector('textarea')!.value).toBe('FAILED LOCAL B');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1501);
    });
    expect(api.readQuizAttempt).toHaveBeenCalledWith('attempt');
    expect(container.querySelector('textarea')!.value).toBe('official');
    expect(container.querySelector('textarea')!.disabled).toBe(true);
    expect(container.querySelector('pre')!.textContent).toContain('FAILED LOCAL B');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(api.submitQuizAttempt).not.toHaveBeenCalled();
  });
  it.each(['http_error', 'network_rejection'])(
    'retries a failed expiry read serially and adopts official answers with a separate unsent draft: %s',
    async (failure) => {
      server = { ...server, expiresAt: new Date(Date.now() + 1000).toISOString() };
      vi.mocked(api.saveQuizAnswers).mockResolvedValue({
        ok: false,
        status: 503,
        error: { code: 'unavailable', message: 'save failed' },
      });
      const read = vi.spyOn(api, 'readQuizAttempt');
      if (failure === 'network_rejection') read.mockRejectedValueOnce(new Error('network'));
      else
        read.mockResolvedValueOnce({
          ok: false,
          status: 503,
          error: { code: 'unavailable', message: 'read failed' },
        });
      read.mockImplementation(async () => ok({ attempt: { ...server, state: 'submitted' } }));
      await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
      await input(container.querySelector('textarea')!, 'RETRY LOCAL B');
      await click('Сохранить ответы');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(container.querySelector('textarea')!.value).toBe('RETRY LOCAL B');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2999);
      });
      expect(read).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(container.querySelector('textarea')!.value).toBe('official');
      expect(container.querySelector('pre')!.textContent).toContain('RETRY LOCAL B');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(api.submitQuizAttempt).not.toHaveBeenCalled();
    },
  );
  it('bounds automatic expiry reads and permits an explicit retry after exhaustion', async () => {
    server = { ...server, expiresAt: new Date(Date.now() - 1000).toISOString() };
    const read = vi.spyOn(api, 'readQuizAttempt').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'unavailable', message: 'read failed' },
    });
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(read).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(read).toHaveBeenCalledTimes(4);
    read.mockResolvedValue(ok({ attempt: { ...server, state: 'submitted' } }));
    await click('Повторить получение итога');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(read).toHaveBeenCalledTimes(5);
    expect(container.textContent).toContain('Тест сдан');
  });
  it('never overlaps expiry reads or applies an old session result after switching runs', async () => {
    server = { ...server, expiresAt: new Date(Date.now() - 1000).toISOString() };
    let finish: ((result: Awaited<ReturnType<typeof api.readQuizAttempt>>) => void) | undefined;
    const read = vi.spyOn(api, 'readQuizAttempt').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(api.readQuizLearning).mockImplementation(async (id) =>
      ok({
        participationId: id,
        canStart: true,
        title: id,
        instructions: id,
        attempt:
          id === 'first'
            ? server
            : {
                ...server,
                attemptId: 'second-attempt',
                expiresAt: null,
                questions: [
                  {
                    ...server.questions[0]!,
                    promptBlocks: [{ type: 'text', text: 'SECOND SESSION' }],
                  },
                ],
              },
      }),
    );
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'first', onChanged: changed }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      root!.render(
        createElement(QuizResponsePlayer, { activityRunId: 'second', onChanged: changed }),
      );
      await flush();
    });
    await act(async () => {
      finish!(
        ok({
          attempt: {
            ...server,
            state: 'submitted',
            questions: [
              { ...server.questions[0]!, promptBlocks: [{ type: 'text', text: 'STALE EXPIRY' }] },
            ],
          },
        }),
      );
      await flush();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('SECOND SESSION');
    expect(container.textContent).not.toContain('STALE EXPIRY');
    await unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('does not schedule another expiry read when an in-flight request rejects after unmount', async () => {
    server = { ...server, expiresAt: new Date(Date.now() - 1000).toISOString() };
    let rejectRead: ((error: Error) => void) | undefined;
    const read = vi.spyOn(api, 'readQuizAttempt').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(read).toHaveBeenCalledTimes(1);
    await unmount();
    await act(async () => {
      rejectRead!(new Error('late network failure'));
      await flush();
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(changed).not.toHaveBeenCalled();
  });
  it('keeps native radio groups independent for two mounted players with the same question version', async () => {
    server = {
      ...server,
      answers: {},
      questions: [
        {
          id: 'shared-version',
          type: 'single_choice',
          promptBlocks: [{ type: 'text', text: 'Общий вопрос' }],
          maxPoints: 1,
          options: [
            { id: 'a', label: 'А' },
            { id: 'b', label: 'Б' },
          ],
        },
      ],
      questionOrder: ['shared-version'],
    };
    await mount(
      createElement(
        'div',
        null,
        createElement(QuizResponsePlayer, { activityRunId: 'run-one', onChanged: changed }),
        createElement(QuizResponsePlayer, { activityRunId: 'run-two', onChanged: changed }),
      ),
    );
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type=radio]')];
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(2);
    await act(async () => {
      radios[0]!.click();
    });
    await act(async () => {
      radios[3]!.click();
    });
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false, true]);
  });
  it('keeps unsent answers separate from a new attempt and requires an explicit choice', async () => {
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await input(container.querySelector('textarea')!, 'OLD UNSENT');
    await unmount();
    server = { ...server, state: 'evaluated' };
    vi.spyOn(api, 'startQuizLearning').mockImplementation(async () =>
      ok({
        attempt: { ...server, attemptId: 'next-attempt', state: 'in_progress', answers: {} },
        reused: false,
      }),
    );
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'run', onChanged: changed }));
    await click('Новая попытка');
    expect(api.startQuizLearning).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click('Новая попытка');
    expect(container.querySelector('textarea')!.value).toBe('');
    expect(container.textContent).toContain('OLD UNSENT');
    expect(api.saveQuizAnswers).not.toHaveBeenCalled();
  });
  it('ignores a late Start response after switching the run in the same mounted player', async () => {
    let finish: ((result: Awaited<ReturnType<typeof api.startQuizLearning>>) => void) | undefined;
    vi.spyOn(api, 'startQuizLearning').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(api.readQuizLearning).mockImplementation(async (id) =>
      ok({
        participationId: id,
        canStart: true,
        attempt: id === 'first' ? null : server,
        title: id,
        instructions: id,
      }),
    );
    await mount(createElement(QuizResponsePlayer, { activityRunId: 'first', onChanged: changed }));
    await click('Начать тест');
    await act(async () => {
      root!.render(
        createElement(QuizResponsePlayer, { activityRunId: 'second', onChanged: changed }),
      );
      await flush();
    });
    await act(async () => {
      finish!(
        ok({
          attempt: {
            ...server,
            questions: [
              {
                ...server.questions[0]!,
                promptBlocks: [{ type: 'text', text: 'STALE FIRST QUESTION' }],
              },
            ],
          },
          reused: false,
        }),
      );
      await flush();
    });
    expect(container.textContent).toContain('second');
    expect(container.textContent).not.toContain('STALE FIRST QUESTION');
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('Quiz compact draft author', () => {
  const questionPayload: AuthoredQuestionPayload = {
    questionType: 'short_text',
    promptBlocks: [{ type: 'text', text: 'Исходный вопрос' }],
    responseSchema: {},
    answerKey: { accepted: ['ответ'] },
    maxPoints: 1,
    subject: null,
    ageBand: null,
    tags: [],
  };
  it('keeps numeric tolerance when editing and saving the expected value', async () => {
    let save: SaveQuizContent | null = null;
    const write = vi
      .spyOn(api, 'createQuestionDraft')
      .mockResolvedValue(ok({ code: 'ok', id: 'numeric', draftRevision: 1 }));
    vi.spyOn(api, 'createQuizDraft').mockResolvedValue(
      ok({ code: 'ok', id: 'quiz', draftRevision: 1 }),
    );
    await mount(
      createElement(QuizActivityEditor, {
        quizId: null,
        title: 'Тест',
        instructions: null,
        disabled: false,
        registerSave: (value) => {
          save = value;
        },
        onDirty: vi.fn(),
      }),
    );
    await click('Добавить вопрос');
    await input(
      container.querySelector<HTMLSelectElement>('[aria-label="Тип вопроса 1"]')!,
      'numeric',
    );
    const tolerance = container.querySelector<HTMLInputElement>('[aria-label="Допуск 1"]')!;
    await input(tolerance, '0.25');
    await input(container.querySelector<HTMLInputElement>('[aria-label="Ответ"]')!, '42');
    expect(tolerance.value).toBe('0.25');
    await act(async () => {
      await save!();
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ answerKey: { value: 42, tolerance: 0.25 } }),
      expect.any(String),
    );
  });
  it('recovers a failed source-draft read without losing another edited question or blocking Save', async () => {
    let save: SaveQuizContent | null = null;
    let sourceReads = 0;
    vi.spyOn(api, 'quizDraft').mockResolvedValue(
      ok({
        id: 'quiz',
        draftRevision: 1,
        latestVersionId: null,
        draft: {
          title: 'Тест',
          instructions: null,
          questions: [
            { questionVersionId: 'pin', maxPoints: 1, required: true },
            { questionId: 'other', questionDraftRevision: 1, maxPoints: 1, required: true },
          ],
          shuffleQuestions: false,
          shuffleOptions: false,
        },
        versions: [],
      }),
    );
    vi.spyOn(api, 'authoredQuestionVersion').mockResolvedValue(
      ok({
        id: 'pin',
        questionId: 'source',
        type: 'short_text',
        promptBlocks: questionPayload.promptBlocks,
        responseSchema: {},
        maxPoints: 1,
        answerKey: { accepted: ['ответ'] },
      }),
    );
    vi.spyOn(api, 'questionDraft').mockImplementation(async (id) => {
      if (id === 'source' && ++sourceReads === 1)
        return { ok: false, status: 503, error: { code: 'unavailable', message: 'read failed' } };
      return ok({
        id,
        draftRevision: 1,
        latestVersionId: id === 'source' ? 'pin' : null,
        draft: {
          ...questionPayload,
          promptBlocks: [
            { type: 'text', text: id === 'other' ? 'Другой вопрос' : 'Исходный вопрос' },
          ],
        },
        versions: [],
      });
    });
    const write = vi
      .spyOn(api, 'saveQuestionDraft')
      .mockImplementation(async (id) => ok({ code: 'ok', id, draftRevision: 2 }));
    const saveQuiz = vi
      .spyOn(api, 'saveQuizDraft')
      .mockResolvedValue(ok({ code: 'ok', id: 'quiz', draftRevision: 2 }));
    await mount(
      createElement(QuizActivityEditor, {
        quizId: 'quiz',
        title: 'Тест',
        instructions: null,
        disabled: false,
        registerSave: (value) => {
          save = value;
        },
        onDirty: vi.fn(),
      }),
    );
    await input(
      container.querySelector<HTMLTextAreaElement>('[aria-label="Текст вопроса 2"]')!,
      'Сохранить другую правку',
    );
    await click('Редактировать исходный черновик');
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('read failed');
    await click('Редактировать исходный черновик');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => {
      await save!();
    });
    expect(write).toHaveBeenCalledWith(
      'other',
      1,
      null,
      expect.objectContaining({
        promptBlocks: [{ type: 'text', text: 'Сохранить другую правку' }],
      }),
      expect.any(String),
    );
    expect(saveQuiz).toHaveBeenCalled();
  });
  it('reorders two immutable bank pins and preserves exact identities and order after reopen', async () => {
    let save: SaveQuizContent | null = null;
    let payload: AuthoredQuizPayload = {
      title: 'Порядок',
      instructions: null,
      questions: [
        { questionVersionId: 'pin-a', maxPoints: 1, required: true },
        { questionVersionId: 'pin-b', maxPoints: 1, required: true },
      ],
      shuffleQuestions: false,
      shuffleOptions: false,
    };
    vi.spyOn(api, 'quizDraft').mockImplementation(async () =>
      ok({ id: 'quiz', draftRevision: 1, latestVersionId: null, draft: payload, versions: [] }),
    );
    vi.spyOn(api, 'authoredQuestionVersion').mockImplementation(async (id) =>
      ok({
        id,
        questionId: `source-${id}`,
        type: 'short_text',
        promptBlocks: [{ type: 'text', text: id }],
        responseSchema: {},
        maxPoints: 1,
        answerKey: { accepted: ['ответ'] },
      }),
    );
    vi.spyOn(api, 'saveQuizDraft').mockImplementation(async (_id, _revision, _head, next) => {
      payload = next;
      return ok({ code: 'ok', id: 'quiz', draftRevision: 2 });
    });
    const writeQuestion = vi.spyOn(api, 'saveQuestionDraft');
    const props = {
      quizId: 'quiz',
      title: 'Порядок',
      instructions: null,
      disabled: false,
      registerSave: (value: SaveQuizContent | null) => {
        save = value;
      },
      onDirty: vi.fn(),
    };
    await mount(createElement(QuizActivityEditor, props));
    const moves = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (item) => item.textContent === 'Выше',
    );
    expect(moves[1]!.disabled).toBe(false);
    expect(moves[1]!.closest('fieldset')).toBeNull();
    await act(async () => {
      moves[1]!.click();
    });
    await act(async () => {
      await save!();
    });
    expect(payload.questions.map((item) => item.questionVersionId)).toEqual(['pin-b', 'pin-a']);
    expect(writeQuestion).not.toHaveBeenCalled();
    await unmount();
    await mount(createElement(QuizActivityEditor, props));
    const summaries = [...container.querySelectorAll('summary')].filter((item) =>
      item.textContent?.startsWith('Вопрос '),
    );
    expect(summaries[0]!.textContent).toContain('pin-b');
    expect(summaries[1]!.textContent).toContain('pin-a');
    expect([...container.querySelectorAll('fieldset')].every((item) => item.disabled)).toBe(true);
  });
  it('reuses an exact bank version without creating or editing a question', async () => {
    let save: SaveQuizContent | null = null;
    const items = Object.keys(QUIZ_TYPES).map((type, index) => ({
      id: `root-${index}`,
      versionId: `version-${index}`,
      type: type as keyof typeof QUIZ_TYPES,
      promptBlocks: [{ type: 'text', text: `Банк ${index}` }],
      responseSchema: {
        left: [{ id: 'l', label: 'Левая часть' }],
        right: [{ id: 'r', label: 'Правая часть' }],
      },
      maxPoints: 2,
      scope: 'school' as const,
      subject: null,
      ageBand: null,
      tags: [],
      publishedAt: '2026-11-03T00:00:00Z',
    }));
    vi.spyOn(api, 'listQuestionBank').mockResolvedValue(ok({ items }));
    const createQuestion = vi.spyOn(api, 'createQuestionDraft');
    let savedPayload: unknown;
    vi.spyOn(api, 'createQuizDraft').mockImplementation(async (payload) => {
      savedPayload = payload;
      return ok({ code: 'ok', id: 'quiz-bank', draftRevision: 1 });
    });
    const props = {
      title: 'Из банка',
      instructions: null,
      disabled: false,
      registerSave: (value: SaveQuizContent | null) => {
        save = value;
      },
      onDirty: vi.fn(),
    };
    await mount(createElement(QuizActivityEditor, { ...props, quizId: null }));
    await click('Из банка');
    expect(container.querySelectorAll('li')).toHaveLength(8);
    await input(
      container.querySelector<HTMLInputElement>('[aria-label="Найти вопрос в банке"]')!,
      'Банк 5',
    );
    await click('Добавить закреплённый вопрос');
    await act(async () => {
      await save!();
    });
    expect(savedPayload).toMatchObject({
      questions: [{ questionVersionId: 'version-5', maxPoints: 2, required: true }],
    });
    expect(createQuestion).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Правильные ответы этого вопроса закрыты');
    await unmount();
    vi.spyOn(api, 'quizDraft').mockResolvedValue(
      ok({
        id: 'quiz-bank',
        draftRevision: 1,
        latestVersionId: null,
        draft: savedPayload as never,
        versions: [],
      }),
    );
    vi.spyOn(api, 'authoredQuestionVersion').mockResolvedValue({
      ok: false,
      status: 403,
      error: { code: 'forbidden', message: 'Ключ закрыт' },
    });
    await mount(createElement(QuizActivityEditor, { ...props, quizId: 'quiz-bank' }));
    expect(container.textContent).toContain('Банк 5');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(createQuestion).not.toHaveBeenCalled();
  });
  it('saves an incomplete question and reopens it through the existing Save hook', async () => {
    let save: SaveQuizContent | null = null;
    let questionPayload: unknown;
    let quizPayload: unknown;
    vi.spyOn(api, 'createQuestionDraft').mockImplementation(async (payload) => {
      questionPayload = payload;
      return ok({ code: 'ok', id: 'question', draftRevision: 1 });
    });
    vi.spyOn(api, 'createQuizDraft').mockImplementation(async (payload) => {
      quizPayload = payload;
      return ok({ code: 'ok', id: 'quiz', draftRevision: 1 });
    });
    vi.spyOn(api, 'quizDraft').mockImplementation(async () =>
      ok({
        id: 'quiz',
        draftRevision: 1,
        latestVersionId: null,
        draft: quizPayload as never,
        versions: [],
      }),
    );
    vi.spyOn(api, 'questionDraft').mockImplementation(async () =>
      ok({
        id: 'question',
        draftRevision: 1,
        latestVersionId: null,
        draft: questionPayload as never,
        versions: [],
      }),
    );
    const props = {
      title: 'Черновик теста',
      instructions: null,
      disabled: false,
      registerSave: (value: SaveQuizContent | null) => {
        save = value;
      },
      onDirty: vi.fn(),
    };
    await mount(createElement(QuizActivityEditor, { ...props, quizId: null }));
    await click('Добавить вопрос');
    await input(container.querySelector<HTMLSelectElement>('select')!, 'matching');
    await act(async () => {
      expect(await save!()).toEqual({ quizDraftId: 'quiz', quizDraftRevision: 1 });
    });
    expect(questionPayload).toMatchObject({ questionType: 'matching', maxPoints: null });
    expect(quizPayload).toMatchObject({
      questions: [{ questionId: 'question', questionDraftRevision: 1, maxPoints: null }],
    });
    await unmount();
    await mount(createElement(QuizActivityEditor, { ...props, quizId: 'quiz' }));
    expect(container.textContent).toContain('Соответствие');
    expect(container.querySelector('details')!.open).toBe(false);
    expect(container.querySelector('select')!.querySelectorAll('option')).toHaveLength(8);
  });
});
