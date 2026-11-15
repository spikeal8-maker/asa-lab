import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type LearnerQuiz } from '../api';
import { useSchoolTime } from './school-time';
import './seat-quizzes.css';
import { canonicalLearningLabel } from '../learning/canonical-learning-presentation';
import { useLearningDestination } from '../learning/use-learning-destination';

type AnswerState = Record<string, string | string[] | boolean>;
export type SeatQuizDrafts = Record<string, AnswerState>;
export interface SeatQuizDraftStore {
  readonly answers: SeatQuizDrafts;
  readonly update: (change: (current: SeatQuizDrafts) => SeatQuizDrafts) => void;
}

function prompt(question: LearnerQuiz['questions'][number]): string {
  return question.promptBlocks
    .map((block) => block.text ?? '')
    .join(' ')
    .trim();
}

export function SeatQuizzes({
  reloadSignal = 0,
  onLoad,
  drafts,
}: {
  readonly reloadSignal?: number;
  /** undefined: pending, null: failed, number: successfully loaded row count. */
  readonly onLoad?: (count: number | null | undefined) => void;
  /** Kept in memory by the current learner lifetime, outside section remounts. */
  readonly drafts?: SeatQuizDraftStore;
} = {}): JSX.Element | null {
  const [items, setItems] = useState<LearnerQuiz[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const destination = useLearningDestination();
  useEffect(() => {
    if (destination.assignment) setOpenId(destination.assignment);
  }, [destination.assignment]);
  const [localDrafts, setLocalDrafts] = useState<SeatQuizDrafts>({});
  const answersByQuiz = drafts?.answers ?? localDrafts;
  const updateDrafts = drafts?.update ?? setLocalDrafts;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    Record<
      string,
      {
        percentage: number;
        outcome: 'passed' | 'failed';
        correct: Record<string, boolean>;
        answers: AnswerState;
      }
    >
  >({});
  const time = useSchoolTime();
  const live = useRef(false);
  const request = useRef(0);
  const [loadError, setLoadError] = useState(false);

  const reload = useCallback(async () => {
    if (!live.current) return;
    const current = ++request.current;
    onLoad?.(undefined);
    try {
      const result = await api.seatQuizzes();
      if (!live.current || current !== request.current) return;
      setLoadError(!result.ok);
      if (result.ok) setItems(result.data.items);
      onLoad?.(result.ok ? result.data.items.length : null);
    } catch {
      if (!live.current || current !== request.current) return;
      setLoadError(true);
      onLoad?.(null);
    }
  }, [onLoad]);

  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
      request.current++;
    };
  }, [reload, reloadSignal]);

  function updateAnswer(
    assignmentId: string,
    questionVersionId: string,
    answer: AnswerState[string],
  ) {
    updateDrafts((current) => ({
      ...current,
      [assignmentId]: { ...current[assignmentId], [questionVersionId]: answer },
    }));
  }

  async function submit(quiz: LearnerQuiz): Promise<void> {
    const answers = answersByQuiz[quiz.assignmentId] ?? {};
    const unanswered = quiz.questions.some((question) => answers[question.versionId] === undefined);
    if (unanswered) {
      setError('Ответьте на все вопросы перед отправкой.');
      return;
    }
    setBusy(quiz.assignmentId);
    setError(null);
    const result = await api.submitSeatQuiz(
      quiz.assignmentId,
      quiz.questions.map((question) => ({
        questionVersionId: question.versionId,
        answer:
          question.type === 'multiple_choice'
            ? { values: answers[question.versionId] }
            : { value: answers[question.versionId] },
      })),
    );
    if (result.ok)
      updateDrafts((current) => {
        if (current[quiz.assignmentId] !== answers) return current;
        const next = { ...current };
        delete next[quiz.assignmentId];
        return next;
      });
    if (!live.current) return;
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setFeedback((current) => ({
      ...current,
      [quiz.assignmentId]: {
        percentage: result.data.percentage,
        outcome: result.data.outcome,
        correct: Object.fromEntries(
          result.data.questionResults.map((entry) => [entry.questionVersionId, entry.correct]),
        ),
        answers,
      },
    }));
    await reload();
  }

  const loadAlert = loadError && !onLoad ? <p role="alert">Не удалось загрузить тесты.</p> : null;
  if (items === null || items.length === 0) return loadAlert;

  return (
    <section className="seat-quizzes" aria-labelledby="seat-quizzes-title">
      {loadAlert}
      <div className="seat-quizzes-heading">
        <h2 id="seat-quizzes-title">Тесты</h2>
        <span>{items.length}</span>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="seat-quiz-list">
        {items.map((quiz) => {
          const result = feedback[quiz.assignmentId];
          const answers = result?.answers ?? answersByQuiz[quiz.assignmentId] ?? {};
          const attemptsLeft = Math.max(0, quiz.attemptLimit - quiz.attemptsUsed);
          return (
            <article
              key={quiz.assignmentId}
              className={openId === quiz.assignmentId ? 'is-open' : undefined}
            >
              <button
                type="button"
                className="seat-quiz-summary"
                aria-expanded={openId === quiz.assignmentId}
                onClick={() => setOpenId(openId === quiz.assignmentId ? null : quiz.assignmentId)}
              >
                <span>
                  <strong>{quiz.title}</strong>
                  <small>
                    {quiz.questions.length} вопр. · {quiz.totalPoints} б.
                    {quiz.dueAt ? ` · до ${time.date(quiz.dueAt)}` : ''}
                  </small>
                </span>
                <em>
                  {canonicalLearningLabel(quiz.canonicalState) ??
                    (result
                      ? `${result.percentage}%`
                      : quiz.latestResult?.percentage !== null && quiz.latestResult
                        ? `${quiz.latestResult.percentage}%`
                        : `${attemptsLeft} попыт.`)}
                </em>
              </button>

              {openId === quiz.assignmentId ? (
                <div className="seat-quiz-body">
                  {quiz.instructions ? <p>{quiz.instructions}</p> : null}
                  {quiz.questions.map((question, index) => {
                    const correctness = result?.correct[question.versionId];
                    return (
                      <fieldset
                        key={question.versionId}
                        className={
                          correctness === undefined ? undefined : correctness ? 'correct' : 'wrong'
                        }
                        disabled={result !== undefined || attemptsLeft === 0}
                      >
                        <legend>
                          {index + 1}. {prompt(question)} <small>{question.maxPoints} б.</small>
                        </legend>
                        {question.type === 'single_choice'
                          ? question.responseSchema.options?.map((option) => (
                              <label key={option.id}>
                                <input
                                  type="radio"
                                  name={question.versionId}
                                  checked={answers[question.versionId] === option.id}
                                  onChange={() =>
                                    updateAnswer(quiz.assignmentId, question.versionId, option.id)
                                  }
                                />
                                {option.label}
                              </label>
                            ))
                          : null}
                        {question.type === 'multiple_choice'
                          ? question.responseSchema.options?.map((option) => {
                              const selected =
                                (answers[question.versionId] as string[] | undefined) ?? [];
                              return (
                                <label key={option.id}>
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(option.id)}
                                    onChange={(event) =>
                                      updateAnswer(
                                        quiz.assignmentId,
                                        question.versionId,
                                        event.target.checked
                                          ? [...selected, option.id]
                                          : selected.filter((id) => id !== option.id),
                                      )
                                    }
                                  />
                                  {option.label}
                                </label>
                              );
                            })
                          : null}
                        {question.type === 'boolean' ? (
                          <div className="seat-quiz-inline">
                            {[
                              ['Да', true],
                              ['Нет', false],
                            ].map(([label, value]) => (
                              <label key={String(value)}>
                                <input
                                  type="radio"
                                  name={question.versionId}
                                  checked={answers[question.versionId] === value}
                                  onChange={() =>
                                    updateAnswer(
                                      quiz.assignmentId,
                                      question.versionId,
                                      value as boolean,
                                    )
                                  }
                                />
                                {label as string}
                              </label>
                            ))}
                          </div>
                        ) : null}
                        {question.type === 'numeric' || question.type === 'short_text' ? (
                          <input
                            type={question.type === 'numeric' ? 'number' : 'text'}
                            value={(answers[question.versionId] as string | undefined) ?? ''}
                            onChange={(event) =>
                              updateAnswer(
                                quiz.assignmentId,
                                question.versionId,
                                event.target.value,
                              )
                            }
                          />
                        ) : null}
                        {correctness !== undefined ? (
                          <span className="seat-quiz-check">
                            {correctness ? 'Правильно' : 'Неправильно'}
                          </span>
                        ) : null}
                      </fieldset>
                    );
                  })}
                  {result ? (
                    <p className={`seat-quiz-result ${result.outcome}`}>
                      {result.outcome === 'passed' ? 'Тест пройден' : 'Порог не набран'} ·{' '}
                      {result.percentage}%
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="portal-create-button"
                      disabled={
                        busy === quiz.assignmentId || attemptsLeft === 0 || quiz.status === 'closed'
                      }
                      onClick={() => void submit(quiz)}
                    >
                      {busy === quiz.assignmentId ? 'Проверяем…' : 'Завершить и проверить'}
                    </button>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
