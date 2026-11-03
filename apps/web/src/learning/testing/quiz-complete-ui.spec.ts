// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type LearningQuizAttempt, type QuizAnswer } from '../../api';
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
    ok({ participationId: 'part', attempt: server, title: 'Тест', instructions: null }),
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
});

describe('Quiz compact draft author', () => {
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
