import { useEffect, useRef, useState } from 'react';
import {
  api,
  type AuthoredQuestionPayload,
  type AuthoredQuizPayload,
  type QuizAnswer,
  type QuizQuestionType,
  type QuestionBankItem,
} from '../api';
import { QUIZ_TYPES, QuizQuestionFields } from './QuizQuestionFields';
import './quiz-learning.css';

export type SaveQuizContent = () => Promise<{ quizDraftId: string; quizDraftRevision: number }>;
type Row = {
  key: string;
  id: string | null;
  revision: number;
  head: string | null;
  payload: AuthoredQuestionPayload;
  saved: string | null;
  pinnedVersion?: string;
  changedElsewhere?: boolean;
};
function emptyQuestion(type: QuizQuestionType = 'single_choice'): AuthoredQuestionPayload {
  return {
    questionType: type,
    promptBlocks: [{ type: 'text', text: '' }],
    responseSchema:
      type === 'matching'
        ? {
            left: [
              { id: 'l1', label: '' },
              { id: 'l2', label: '' },
            ],
            right: [
              { id: 'r1', label: '' },
              { id: 'r2', label: '' },
            ],
          }
        : ['single_choice', 'multiple_choice', 'ordering'].includes(type)
          ? {
              options: [
                { id: 'o1', label: '' },
                { id: 'o2', label: '' },
              ],
            }
          : {},
    answerKey: {},
    maxPoints: null,
    subject: null,
    ageBand: null,
    tags: [],
  };
}

/** Content saves participate in the existing assignment Save/Publish operation. */
export function QuizActivityEditor({
  quizId,
  title,
  instructions,
  disabled,
  registerSave,
  onDirty,
}: {
  readonly quizId: string | null;
  readonly title: string;
  readonly instructions: string | null;
  readonly disabled: boolean;
  readonly registerSave: (save: SaveQuizContent | null) => void;
  readonly onDirty: (dirty: boolean) => void;
}): JSX.Element {
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [bank, setBank] = useState<QuestionBankItem[] | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [bankError, setBankError] = useState<string | null>(null);
  const [shuffle, setShuffle] = useState({ questions: false, options: false });
  const [loading, setLoading] = useState(quizId !== null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<{ id: string; revision: number; head: string | null; saved: string } | null>(
    null,
  );
  const state = useRef({ rows, title, instructions, shuffle });
  state.current = { rows, title, instructions, shuffle };
  const operation = useRef(false);
  const request = useRef(new Map<string, string>());
  const callbacks = useRef({ registerSave, onDirty });
  callbacks.current = { registerSave, onDirty };
  useEffect(() => {
    let live = true;
    if (!quizId) {
      root.current = null;
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      const quiz = await api.quizDraft(quizId);
      if (!quiz.ok) throw new Error(quiz.error.message);
      const loaded = await Promise.all(
        quiz.data.draft.questions.map(async (reference) => {
          if (!reference.questionId && reference.questionVersionId) {
            const version = await api.authoredQuestionVersion(reference.questionVersionId);
            if (version.ok)
              return {
                key: version.data.id,
                id: version.data.questionId,
                revision: 0,
                head: version.data.id,
                pinnedVersion: version.data.id,
                payload: {
                  questionType: version.data.type,
                  promptBlocks: version.data.promptBlocks,
                  responseSchema: version.data.responseSchema,
                  answerKey: version.data.answerKey,
                  maxPoints: reference.maxPoints,
                  subject: null,
                  ageBand: null,
                  tags: [],
                } as AuthoredQuestionPayload,
                saved: null,
              };
            if (quiz.data.latestVersionId) {
              const published = await api.authoredQuizVersion(
                quiz.data.id,
                quiz.data.latestVersionId,
              );
              const safe = published.ok
                ? published.data.questions.find(
                    (item) =>
                      item.id === reference.questionVersionId ||
                      item.questionVersionId === reference.questionVersionId,
                  )
                : null;
              if (safe)
                return {
                  key: reference.questionVersionId,
                  id: null,
                  revision: 0,
                  head: null,
                  pinnedVersion: reference.questionVersionId,
                  payload: {
                    questionType: safe.type,
                    promptBlocks: safe.promptBlocks.map((block) => ({
                      type: 'text' as const,
                      text: block.text ?? '',
                    })),
                    responseSchema: safe.responseSchema ?? { options: safe.options },
                    answerKey: {},
                    maxPoints: reference.maxPoints,
                    subject: null,
                    ageBand: null,
                    tags: [],
                  } as AuthoredQuestionPayload,
                  saved: null,
                };
            }
            const bank = await api.listQuestionBank();
            const safeBankQuestion = bank.ok
              ? bank.data.items.find((item) => item.versionId === reference.questionVersionId)
              : null;
            if (safeBankQuestion) return bankRow(safeBankQuestion, reference.maxPoints);
            throw new Error(
              'Закреплённый вопрос недоступен. Состав теста сохранён; повторите загрузку.',
            );
          }
          if (!reference.questionId) throw new Error('Вопрос недоступен.');
          const question = await api.questionDraft(reference.questionId);
          if (!question.ok) throw new Error(question.error.message);
          return {
            key: question.data.id,
            id: question.data.id,
            revision: question.data.draftRevision,
            head: question.data.latestVersionId,
            payload: question.data.draft,
            saved: JSON.stringify(question.data.draft),
            changedElsewhere:
              reference.questionDraftRevision !== undefined &&
              reference.questionDraftRevision !== question.data.draftRevision,
          };
        }),
      );
      if (!live) return;
      root.current = {
        id: quiz.data.id,
        revision: quiz.data.draftRevision,
        head: quiz.data.latestVersionId,
        saved: JSON.stringify(quiz.data.draft),
      };
      setRows(loaded);
      setShuffle({
        questions: quiz.data.draft.shuffleQuestions,
        options: quiz.data.draft.shuffleOptions,
      });
      setLoading(false);
      callbacks.current.onDirty(false);
    })().catch((problem) => {
      if (live) {
        setError(problem instanceof Error ? problem.message : 'Не удалось открыть тест.');
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [quizId]);

  const ready = useRef(false);
  ready.current = !loading && !error;
  useEffect(() => {
    const commandId = (scope: string, payload: unknown) => {
      const key = `${scope}:${JSON.stringify(payload)}`;
      let id = request.current.get(key);
      if (!id) {
        id = crypto.randomUUID();
        request.current.set(key, id);
      }
      return id;
    };
    callbacks.current.registerSave(async () => {
      if (operation.current || !ready.current) throw new Error('Дождитесь загрузки теста.');
      operation.current = true;
      try {
        const savedRows: Row[] = [];
        for (const row of state.current.rows) {
          if (row.changedElsewhere)
            throw new Error(
              'Вопрос изменён в другом окне. Подтвердите использование его текущей ревизии.',
            );
          if (row.pinnedVersion) {
            savedRows.push(row);
            continue;
          }
          if (row.id && row.saved === JSON.stringify(row.payload)) {
            savedRows.push(row);
            continue;
          }
          const result = row.id
            ? await api.saveQuestionDraft(
                row.id,
                row.revision,
                row.head,
                row.payload,
                commandId(`${row.id}:${row.revision}`, row.payload),
              )
            : await api.createQuestionDraft(row.payload, commandId(row.key, row.payload));
          if (!result.ok) throw new Error(result.error.message);
          const saved = {
            ...row,
            id: result.data.id,
            revision: result.data.draftRevision,
            head: result.data.latestVersionId ?? row.head,
            saved: JSON.stringify(row.payload),
          };
          savedRows.push(saved);
          // Keep receipts after a later question/quiz save fails; retry never creates duplicates.
          setRows((current) => current.map((item) => (item.key === row.key ? saved : item)));
        }
        const payload: AuthoredQuizPayload = {
          title: state.current.title,
          instructions: state.current.instructions,
          questions: savedRows.map((row) => ({
            ...(row.pinnedVersion
              ? { questionVersionId: row.pinnedVersion }
              : { questionId: row.id!, questionDraftRevision: row.revision }),
            maxPoints: row.payload.maxPoints,
            required: true,
          })),
          shuffleQuestions: state.current.shuffle.questions,
          shuffleOptions: state.current.shuffle.options,
        };
        const previous = root.current;
        if (previous && previous.saved === JSON.stringify(payload))
          return { quizDraftId: previous.id, quizDraftRevision: previous.revision };
        const result = previous
          ? await api.saveQuizDraft(
              previous.id,
              previous.revision,
              previous.head,
              payload,
              commandId(`${previous.id}:${previous.revision}`, payload),
            )
          : await api.createQuizDraft(payload, commandId('quiz', payload));
        if (!result.ok) throw new Error(result.error.message);
        root.current = {
          id: result.data.id,
          revision: result.data.draftRevision,
          head: result.data.latestVersionId ?? null,
          saved: JSON.stringify(payload),
        };
        callbacks.current.onDirty(false);
        return { quizDraftId: result.data.id, quizDraftRevision: result.data.draftRevision };
      } finally {
        operation.current = false;
      }
    });
    return () => callbacks.current.registerSave(null);
  }, []);

  function change(key: string, payload: AuthoredQuestionPayload) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, payload } : row)));
    onDirty(true);
  }
  function bankRow(item: QuestionBankItem, maxPoints: number | null = item.maxPoints): Row {
    return {
      key: crypto.randomUUID(),
      id: null,
      revision: 0,
      head: null,
      pinnedVersion: item.versionId,
      saved: null,
      payload: {
        questionType: item.type,
        promptBlocks: item.promptBlocks.map((block) => ({ type: 'text', text: block.text ?? '' })),
        responseSchema: item.responseSchema,
        answerKey: {},
        maxPoints,
        subject: null,
        ageBand: null,
        tags: [],
      },
    };
  }
  return (
    <section className="quiz-editor" aria-label="Вопросы теста">
      <h3>Вопросы теста</h3>
      <details>
        <summary>Порядок вопросов и вариантов</summary>
        <label>
          <input
            type="checkbox"
            checked={shuffle.questions}
            disabled={disabled || loading}
            onChange={(event) => {
              setShuffle((current) => ({ ...current, questions: event.target.checked }));
              onDirty(true);
            }}
          />
          Перемешивать вопросы
        </label>
        <label>
          <input
            type="checkbox"
            checked={shuffle.options}
            disabled={disabled || loading}
            onChange={(event) => {
              setShuffle((current) => ({ ...current, options: event.target.checked }));
              onDirty(true);
            }}
          />
          Перемешивать варианты ответа
        </label>
      </details>
      {loading ? <p role="status">Открываем вопросы…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {rows.map((row, index) => (
        <details key={row.key} open={expanded === row.key}>
          <summary
            onClick={(event) => {
              event.preventDefault();
              setExpanded(expanded === row.key ? null : row.key);
            }}
          >
            Вопрос {index + 1} · {QUIZ_TYPES[row.payload.questionType]} ·{' '}
            {row.payload.promptBlocks[0]?.text || 'Без текста'} · {row.payload.maxPoints ?? '—'}{' '}
            балл(а)
          </summary>
          {row.changedElsewhere ? (
            <div role="alert">
              <p>
                Вопрос изменён в другом окне. Показана текущая редакция; состав сохранённого теста
                ещё не изменён.
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setRows((current) =>
                    current.map((item) =>
                      item.key === row.key ? { ...item, changedElsewhere: false } : item,
                    ),
                  );
                  onDirty(true);
                }}
              >
                Использовать текущую ревизию вопроса
              </button>
            </div>
          ) : null}
          {row.pinnedVersion ? (
            <div className="quiz-actions">
              {row.id ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    void api.questionDraft(row.id!).then((result) => {
                      if (!result.ok) {
                        setError(result.error.message);
                        return;
                      }
                      setError(null);
                      setRows((current) =>
                        current.map((item) =>
                          item.key === row.key
                            ? {
                                key: row.key,
                                id: result.data.id,
                                revision: result.data.draftRevision,
                                head: result.data.latestVersionId,
                                payload: result.data.draft,
                                saved: JSON.stringify(result.data.draft),
                              }
                            : item,
                        ),
                      );
                      onDirty(true);
                    });
                  }}
                >
                  Редактировать исходный черновик
                </button>
              ) : (
                <p>Закреплённый вопрос другого автора — только чтение.</p>
              )}
            </div>
          ) : null}
          <fieldset disabled={disabled || loading || !!row.pinnedVersion || row.changedElsewhere}>
            <legend>Вопрос {index + 1}</legend>
            <label>
              Тип вопроса
              <select
                aria-label={`Тип вопроса ${index + 1}`}
                value={row.payload.questionType}
                onChange={(event) =>
                  change(row.key, {
                    ...emptyQuestion(event.target.value as QuizQuestionType),
                    promptBlocks: row.payload.promptBlocks,
                    maxPoints: row.payload.maxPoints,
                  })
                }
              >
                {Object.entries(QUIZ_TYPES).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Вопрос
              <textarea
                aria-label={`Текст вопроса ${index + 1}`}
                maxLength={12000}
                value={row.payload.promptBlocks.map((block) => block.text).join('\n')}
                onChange={(event) =>
                  change(row.key, {
                    ...row.payload,
                    promptBlocks: [{ type: 'text', text: event.target.value }],
                  })
                }
              />
            </label>
            <label>
              Баллы
              <input
                aria-label={`Баллы за вопрос ${index + 1}`}
                type="number"
                min={1}
                max={10000}
                value={row.payload.maxPoints ?? ''}
                onChange={(event) =>
                  change(row.key, {
                    ...row.payload,
                    maxPoints: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            </label>
            {(['options', 'left', 'right'] as const).map((group) =>
              row.payload.responseSchema[group] ? (
                <div key={group}>
                  <strong>
                    {group === 'options'
                      ? 'Варианты'
                      : group === 'left'
                        ? 'Левая часть'
                        : 'Правая часть'}
                  </strong>
                  {row.payload.responseSchema[group]!.map((option, position) => (
                    <label key={option.id}>
                      Элемент {position + 1}
                      <input
                        aria-label={`${group} ${index + 1}.${position + 1}`}
                        value={option.label}
                        maxLength={2000}
                        onChange={(event) =>
                          change(row.key, {
                            ...row.payload,
                            responseSchema: {
                              ...row.payload.responseSchema,
                              [group]: row.payload.responseSchema[group]!.map((item) =>
                                item.id === option.id
                                  ? { ...item, label: event.target.value }
                                  : item,
                              ),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      change(row.key, {
                        ...row.payload,
                        responseSchema: {
                          ...row.payload.responseSchema,
                          [group]: [
                            ...row.payload.responseSchema[group]!,
                            { id: `v${crypto.randomUUID().replaceAll('-', '')}`, label: '' },
                          ],
                        },
                      })
                    }
                  >
                    Добавить элемент
                  </button>
                </div>
              ) : null,
            )}
            {row.pinnedVersion && !row.id ? (
              <p>
                Правильные ответы этого вопроса закрыты. Проверка использует закреплённую версию.
              </p>
            ) : row.payload.questionType === 'long_text_manual' ? (
              <p>Ответ проверяет преподаватель. Автоматический итог до проверки не выставляется.</p>
            ) : (
              <div>
                <strong>Правильный ответ</strong>
                {row.payload.questionType === 'short_text' ? (
                  <label>
                    Допустимые ответы, каждый с новой строки
                    <textarea
                      aria-label={`Допустимые ответы ${index + 1}`}
                      value={
                        (row.payload.answerKey.accepted as string[] | undefined)?.join('\n') ?? ''
                      }
                      onChange={(event) =>
                        change(row.key, {
                          ...row.payload,
                          answerKey: { accepted: event.target.value.split('\n') },
                        })
                      }
                    />
                  </label>
                ) : (
                  <QuizQuestionFields
                    question={{
                      id: `key-${row.key}`,
                      type: row.payload.questionType,
                      promptBlocks: [],
                      responseSchema: row.payload.responseSchema,
                      maxPoints: row.payload.maxPoints ?? 0,
                    }}
                    answer={row.payload.answerKey as QuizAnswer}
                    onChange={(answer) =>
                      change(row.key, {
                        ...row.payload,
                        answerKey:
                          row.payload.questionType === 'numeric'
                            ? { ...row.payload.answerKey, ...answer }
                            : answer,
                      })
                    }
                  />
                )}
                {row.payload.questionType === 'numeric' ? (
                  <label>
                    Допуск
                    <input
                      aria-label={`Допуск ${index + 1}`}
                      type="number"
                      min={0}
                      step="any"
                      value={String(row.payload.answerKey.tolerance ?? 0)}
                      onChange={(event) =>
                        change(row.key, {
                          ...row.payload,
                          answerKey: {
                            ...row.payload.answerKey,
                            tolerance: Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ) : null}
              </div>
            )}
          </fieldset>
          <div className="quiz-actions">
            <button
              type="button"
              disabled={disabled || loading || index === 0}
              onClick={() => {
                setRows((current) => {
                  const next = [...current];
                  [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                  return next;
                });
                onDirty(true);
              }}
            >
              Выше
            </button>
            <button
              type="button"
              disabled={disabled || loading}
              onClick={() => {
                setRows((current) => current.filter((item) => item.key !== row.key));
                onDirty(true);
              }}
            >
              Удалить вопрос
            </button>
          </div>
        </details>
      ))}
      <button
        type="button"
        disabled={disabled || loading || error !== null}
        onClick={() => {
          const key = crypto.randomUUID();
          setExpanded(key);
          setRows((current) => [
            ...current,
            {
              key,
              id: null,
              revision: 0,
              head: null,
              payload: emptyQuestion(),
              saved: null,
            },
          ]);
          onDirty(true);
        }}
      >
        Добавить вопрос
      </button>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => {
          setBankOpen(!bankOpen);
          if (bankOpen || bank) return;
          setBankError(null);
          void api
            .listQuestionBank()
            .then((result) => {
              if (result.ok) setBank(result.data.items);
              else setBankError(result.error.message);
            })
            .catch(() => setBankError('Не удалось открыть банк вопросов.'));
        }}
      >
        Из банка
      </button>
      {bankOpen ? (
        <div aria-label="Банк вопросов">
          <label>
            Найти вопрос
            <input
              aria-label="Найти вопрос в банке"
              value={bankSearch}
              onChange={(event) => setBankSearch(event.target.value)}
            />
          </label>
          {bankError ? (
            <p role="alert">{bankError}</p>
          ) : !bank ? (
            <p role="status">Загружаем банк вопросов…</p>
          ) : (
            <ul>
              {bank
                .filter((item) =>
                  item.promptBlocks.some((block) =>
                    (block.text ?? '')
                      .toLocaleLowerCase('ru-RU')
                      .includes(bankSearch.trim().toLocaleLowerCase('ru-RU')),
                  ),
                )
                .map((item) => (
                  <li key={item.versionId}>
                    <span>
                      {QUIZ_TYPES[item.type]} ·{' '}
                      {item.promptBlocks.map((block) => block.text ?? '').join(' ')} ·{' '}
                      {item.maxPoints} балл(а)
                    </span>
                    <button
                      type="button"
                      disabled={
                        disabled || rows.some((row) => row.pinnedVersion === item.versionId)
                      }
                      onClick={() => {
                        const row = bankRow(item);
                        setRows((current) => [...current, row]);
                        setExpanded(row.key);
                        onDirty(true);
                        setBankOpen(false);
                      }}
                    >
                      Добавить закреплённый вопрос
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <small>
            В тест добавляется опубликованная версия. Изменения исходного вопроса её не заменяют.
          </small>
        </div>
      ) : null}
      <small>
        Незаконченные вопросы сохраняются в черновике. Публикация проверяет вопросы и правильные
        ответы.
      </small>
    </section>
  );
}
