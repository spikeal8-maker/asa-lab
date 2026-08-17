import type { Classroom } from '../api';

/**
 * What a class is: a name, an age, some subjects, and whether safe mode is on.
 *
 * The same four answers are given when a class is made and when a teacher
 * corrects it afterwards, so they are one component. Two copies would drift —
 * a subject added to the creation form and missing from the properties dialog
 * is a class that cannot be fixed without deleting it.
 */

export const CLASSROOM_AGE_OPTIONS: ReadonlyArray<{ value: Classroom['ageBand']; label: string }> =
  [
    { value: 'mixed', label: 'Разный возраст' },
    { value: '6-8', label: '6–8 лет' },
    { value: '9-10', label: '9–10 лет' },
    { value: '11-12', label: '11–12 лет' },
    { value: '13-15', label: '13–15 лет' },
    { value: '16-18', label: '16–18 лет' },
  ];

export const CLASSROOM_TOPIC_OPTIONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'electronics', label: 'Электроника' },
  { key: '3d', label: '3D-моделирование' },
  { key: 'chess', label: 'Шахматы' },
  { key: 'checkers', label: 'Шашки' },
  { key: 'robotics', label: 'Робототехника' },
];

export function ageBandLabel(value: Classroom['ageBand']): string {
  return CLASSROOM_AGE_OPTIONS.find((entry) => entry.value === value)?.label ?? 'Разный возраст';
}

export function topicLabel(key: string): string {
  return CLASSROOM_TOPIC_OPTIONS.find((entry) => entry.key === key)?.label ?? key;
}

export interface ClassroomDraft {
  readonly title: string;
  readonly ageBand: Classroom['ageBand'];
  readonly topicKeys: readonly string[];
  readonly safeModeDefault: boolean;
}

export function ClassroomFields({
  idPrefix,
  draft,
  busy,
  autoFocus = false,
  titleRef,
  invalid,
  describedBy,
  onChange,
}: {
  readonly idPrefix: string;
  readonly draft: ClassroomDraft;
  readonly busy: boolean;
  readonly autoFocus?: boolean;
  readonly titleRef?: React.RefObject<HTMLInputElement>;
  readonly invalid?: boolean;
  readonly describedBy?: string | undefined;
  readonly onChange: (next: ClassroomDraft) => void;
}): JSX.Element {
  return (
    <>
      <label htmlFor={`${idPrefix}-title`}>Название класса</label>
      <input
        {...(titleRef ? { ref: titleRef } : {})}
        autoFocus={autoFocus}
        id={`${idPrefix}-title`}
        name="title"
        placeholder="8А Робототехника"
        maxLength={255}
        value={draft.title}
        disabled={busy}
        aria-invalid={invalid ? 'true' : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <label htmlFor={`${idPrefix}-age-band`}>Возраст учеников</label>
      <select
        id={`${idPrefix}-age-band`}
        value={draft.ageBand}
        disabled={busy}
        onChange={(event) =>
          onChange({ ...draft, ageBand: event.target.value as Classroom['ageBand'] })
        }
      >
        {CLASSROOM_AGE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <fieldset className="classroom-topic-fieldset">
        <legend>Направления</legend>
        {CLASSROOM_TOPIC_OPTIONS.map((topic) => (
          <label key={topic.key}>
            <input
              type="checkbox"
              checked={draft.topicKeys.includes(topic.key)}
              disabled={busy}
              onChange={(event) =>
                onChange({
                  ...draft,
                  topicKeys: event.target.checked
                    ? [...draft.topicKeys, topic.key]
                    : draft.topicKeys.filter((entry) => entry !== topic.key),
                })
              }
            />
            {topic.label}
          </label>
        ))}
      </fieldset>
      <label className="classroom-safe-mode-field">
        <input
          type="checkbox"
          checked={draft.safeModeDefault}
          disabled={busy}
          onChange={(event) => onChange({ ...draft, safeModeDefault: event.target.checked })}
        />
        <span>
          <strong>Безопасный режим</strong>
          <small>Проекты учеников закрыты от публичной публикации. Рекомендуется.</small>
        </span>
      </label>
    </>
  );
}
