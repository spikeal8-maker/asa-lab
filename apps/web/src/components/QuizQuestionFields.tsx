import { useId } from 'react';
import type { QuizAnswer, QuizAttemptQuestion, QuizQuestionType } from '../api';

export const QUIZ_TYPES: Record<QuizQuestionType, string> = {
  single_choice: 'Один вариант',
  multiple_choice: 'Несколько вариантов',
  boolean: 'Верно / неверно',
  numeric: 'Число',
  short_text: 'Короткий ответ',
  matching: 'Соответствие',
  ordering: 'Порядок',
  long_text_manual: 'Развёрнутый ответ — проверяет преподаватель',
};

/** The same response controls render the learner draft and the frozen teacher copy. */
export function QuizQuestionFields({
  question,
  answer,
  onChange,
  disabled = false,
}: {
  readonly question: QuizAttemptQuestion;
  readonly answer?: QuizAnswer;
  readonly onChange: (answer: QuizAnswer) => void;
  readonly disabled?: boolean;
}): JSX.Element {
  const responseGroup = useId();
  const options = question.responseSchema?.options ?? question.options ?? [];
  const value = answer && 'value' in answer ? answer.value : null;
  const values = answer && 'values' in answer ? answer.values : [];
  if (
    question.type === 'single_choice' ||
    question.type === 'multiple_choice' ||
    question.type === 'boolean'
  ) {
    const choices =
      question.type === 'boolean'
        ? [
            { id: 'true', label: 'Верно' },
            { id: 'false', label: 'Неверно' },
          ]
        : options;
    return (
      <div className="quiz-options">
        {choices.map((option) => (
          <label key={option.id}>
            <input
              type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'}
              name={`quiz-${responseGroup}`}
              disabled={disabled}
              checked={
                question.type === 'multiple_choice'
                  ? values.includes(option.id)
                  : question.type === 'boolean'
                    ? value === (option.id === 'true')
                    : value === option.id
              }
              onChange={(event) =>
                onChange(
                  question.type === 'multiple_choice'
                    ? {
                        values: event.target.checked
                          ? [...values, option.id]
                          : values.filter((id) => id !== option.id),
                      }
                    : { value: question.type === 'boolean' ? option.id === 'true' : option.id },
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }
  if (question.type === 'matching')
    return (
      <div className="quiz-options">
        {(question.responseSchema?.left ?? []).map((left) => (
          <label key={left.id}>
            {left.label}
            <select
              aria-label={`Соответствие: ${left.label}`}
              disabled={disabled}
              value={values.find((pair) => pair.startsWith(`${left.id}:`))?.split(':')[1] ?? ''}
              onChange={(event) =>
                onChange({
                  values: [
                    ...values.filter((pair) => !pair.startsWith(`${left.id}:`)),
                    ...(event.target.value ? [`${left.id}:${event.target.value}`] : []),
                  ],
                })
              }
            >
              <option value="">Выберите пару</option>
              {(question.responseSchema?.right ?? []).map((right) => (
                <option key={right.id} value={right.id}>
                  {right.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  if (question.type === 'ordering') {
    if (disabled && values.length === 0) return <p>Ответ не указан</p>;
    const order = values.length === options.length ? values : options.map((option) => option.id);
    return (
      <div className="quiz-options">
        {options.map((_, index) => (
          <label key={index}>
            Место {index + 1}
            <select
              aria-label={`Место ${index + 1}`}
              value={order[index] ?? ''}
              disabled={disabled}
              onChange={(event) => {
                const next = [...order];
                const previous = next.indexOf(event.target.value);
                if (previous >= 0) next[previous] = order[index]!;
                next[index] = event.target.value;
                onChange({ values: next });
              }}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {!disabled && values.length !== options.length ? (
          <button type="button" onClick={() => onChange({ values: order })}>
            Подтвердить порядок
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <label>
      Ответ
      {question.type === 'long_text_manual' ? (
        <textarea
          aria-label="Развёрнутый ответ"
          maxLength={12000}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      ) : (
        <input
          aria-label="Ответ"
          type={question.type === 'numeric' ? 'number' : 'text'}
          step="any"
          maxLength={2000}
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              value:
                event.target.value === ''
                  ? null
                  : question.type === 'numeric'
                    ? Number(event.target.value)
                    : event.target.value,
            })
          }
        />
      )}
    </label>
  );
}
