import { useCallback, useEffect, useState } from 'react';
import { api, type LearnerQuiz } from '../api';
import { useSchoolTime } from './school-time';
import './seat-quizzes.css';

type AnswerState = Record<string, string | string[] | boolean>;

function prompt(question: LearnerQuiz['questions'][number]): string {
  return question.promptBlocks
    .map((block) => block.text ?? '')
    .join(' ')
    .trim();
}

export function SeatQuizzes(): JSX.Element | null {
  const [items, setItems] = useState<LearnerQuiz[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<AnswerState>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    Record<
      string,
      { percentage: number; outcome: 'passed' | 'failed'; correct: Record<string, boolean> }
    >
  >({});
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.seatQuizzes();
    setItems(result.ok ? result.data.items : []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit(quiz: LearnerQuiz): Promise<void> {
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
      },
    }));
    await reload();
  }

  if (items === null || items.length === 0) return null;

  return (
    <section className="seat-quizzes" aria-labelledby="seat-quizzes-title">
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
                  {result
                    ? `${result.percentage}%`
                    : quiz.latestResult?.percentage !== null && quiz.latestResult
                      ? `${quiz.latestResult.percentage}%`
                      : `${attemptsLeft} попыт.`}
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
                                    setAnswers((value) => ({
                                      ...value,
                                      [question.versionId]: option.id,
                                    }))
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
                                      setAnswers((value) => ({
                                        ...value,
                                        [question.versionId]: event.target.checked
                                          ? [...selected, option.id]
                                          : selected.filter((id) => id !== option.id),
                                      }))
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
                                    setAnswers((current) => ({
                                      ...current,
                                      [question.versionId]: value as boolean,
                                    }))
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
                              setAnswers((value) => ({
                                ...value,
                                [question.versionId]: event.target.value,
                              }))
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
