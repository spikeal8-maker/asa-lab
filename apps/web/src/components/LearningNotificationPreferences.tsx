import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type LearningNotificationPreferences as Preferences,
  type NotificationCategory,
} from '../api';
import './learning-notifications.css';

export const notificationCategories: Record<NotificationCategory, string> = {
  NC01: 'Назначения и условия',
  NC02: 'Работы на проверку',
  NC03: 'Проверка и результаты',
  NC04: 'Скоро срок',
  NC05: 'Просроченные задания',
  NC06: 'Выполнение работ и курсов',
  NC08: 'Заявки и приглашения',
};

export function LearningNotificationPreferences({
  classroomId,
  seat = false,
}: {
  classroomId?: string;
  seat?: boolean;
}) {
  const [saved, setSaved] = useState<Preferences | null>(null),
    [draft, setDraft] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const result = await api.learningNotificationPreferences();
    if (result.ok) {
      setSaved(result.data);
      setDraft(result.data);
      setError(null);
    } else setError(result.error.message);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const keys = (Object.keys(notificationCategories) as NotificationCategory[]).filter(
    (key) => !seat || (key !== 'NC02' && key !== 'NC08'),
  );
  async function save() {
    if (!draft || busy) return;
    const input = {revision:draft.revision,masterEnabled:draft.masterEnabled,
      categories:draft.categories,classOverrides:draft.classOverrides};
    const payload = JSON.stringify(input);
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    setNotice('');
    const result = await api.saveLearningNotificationPreferences({
      ...input,
      requestId: request.current.id,
    });
    setBusy(false);
    if (result.ok) {
      setDraft(result.data);
      setSaved(result.data);
      setNotice('Настройки сохранены.');
    } else setError(result.error.message);
  }
  function classRule(id: string, mode: string) {
    if (!draft) return;
    const rules = { ...draft.classOverrides };
    if (mode === 'inherit') delete rules[id];
    else rules[id] = { ...rules[id], mode: mode as 'off' | 'custom' };
    setDraft({ ...draft, classOverrides: rules });
    setNotice('');
  }
  return (
    <section
      className="learning-notification-settings"
      aria-label="Учебные оповещения — только для меня"
    >
      <h3>Учебные оповещения — только для меня</h3>
      <p>
        Уведомления других участников не изменятся. Работы, сроки и результаты останутся в обучении
        и журнале.
      </p>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Обновить форму
          </button>
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!draft ? (
        <p>Загружаем настройки…</p>
      ) : (
        <>
          <label>
            <input
              type="checkbox"
              checked={draft.masterEnabled}
              disabled={busy}
              onChange={(e) => {
                setDraft({ ...draft, masterEnabled: e.target.checked });
                setNotice('');
              }}
            />
            Получать учебные оповещения
          </label>
          {!draft.masterEnabled ? (
            <p>Доставка остановлена общим выключателем. Выбранные категории сохранены.</p>
          ) : null}
          {!classroomId ? (
            <div className="learning-category-grid">
              {keys.map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={draft.categories[key]}
                    onChange={(e) => {
                      setDraft({
                        ...draft,
                        categories: { ...draft.categories, [key]: e.target.checked },
                      });
                      setNotice('');
                    }}
                  />
                  {notificationCategories[key]}
                </label>
              ))}
            </div>
          ) : null}
          <details open={classroomId ? true : undefined}>
            <summary>По классам</summary>
            {!classroomId ? (
              <label>
                Найти класс{' '}
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
            ) : null}
            {draft.classes
              .filter(
                (c) =>
                  (!classroomId || c.id === classroomId) &&
                  c.title.toLowerCase().includes(search.toLowerCase()),
              )
              .map((c) => {
                const rule = draft.classOverrides[c.id];
                return (
                  <fieldset key={c.id} disabled={busy}>
                    <legend>{c.title}</legend>
                    <label>
                      Мои оповещения об этом классе{' '}
                      <select
                        value={rule?.mode ?? 'inherit'}
                        onChange={(e) => classRule(c.id, e.target.value)}
                      >
                        <option value="inherit">Как в общих настройках</option>
                        <option value="off">Выключить для меня</option>
                        <option value="custom">Настроить категории</option>
                      </select>
                    </label>
                    {rule?.mode === 'custom' ? (
                      <div className="learning-category-grid">
                        {keys.map((key) => (
                          <label key={key}>
                            {notificationCategories[key]}
                            <select
                              value={rule.categories?.[key] ?? 'inherit'}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  classOverrides: {
                                    ...draft.classOverrides,
                                    [c.id]: {
                                      ...rule,
                                      categories: {
                                        ...rule.categories,
                                        [key]: e.target.value as 'inherit' | 'on' | 'off',
                                      },
                                    },
                                  },
                                })
                              }
                            >
                              <option value="inherit">
                                Наследовать — {draft.categories[key] ? 'включено' : 'выключено'}
                              </option>
                              <option value="on">Включено</option>
                              <option value="off">Выключено</option>
                            </select>
                          </label>
                        ))}
                      </div>
                    ) : null}
                    {rule ? (
                      <button type="button" onClick={() => classRule(c.id, 'inherit')}>
                        Сбросить для класса
                      </button>
                    ) : null}
                  </fieldset>
                );
              })}
          </details>
          <p>
            Обязательные сообщения безопасности не отключаются здесь. MAX используется для входа, а
            не для рассылки.
          </p>
          <div className="learning-notification-actions">
            <button className="btn-primary" disabled={busy} onClick={() => void save()}>
              Сохранить оповещения
            </button>
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => {
                setDraft(saved);
                setError(null);
                setNotice('');
              }}
            >
              Отменить
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function ClassroomLearningReminders({ classroomId }: { classroomId: string }) {
  const [value, setValue] = useState<{ revision: number; due: boolean; overdue: boolean } | null>(
      null,
    ),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api.classLearningReminders(classroomId);
    if (r.ok) setValue(r.data);
    else setError(r.error.message);
  }, [classroomId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <details>
      <summary>Напоминания ученикам</summary>
      <p>
        Для учащихся этого класса. Личные выключатели учеников сохраняют приоритет. Сроки и оценки
        не меняются.
      </p>
      {error ? (
        <p role="alert">
          {error}
          <button onClick={() => void load()}>Обновить</button>
        </p>
      ) : null}
      {value ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={value.due}
              onChange={(e) => setValue({ ...value, due: e.target.checked })}
            />
            Напоминать о приближении срока
          </label>
          <label>
            <input
              type="checkbox"
              checked={value.overdue}
              onChange={(e) => setValue({ ...value, overdue: e.target.checked })}
            />
            Напоминать о просроченных действиях
          </label>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const r = await api.saveClassLearningReminders(classroomId, value);
              setBusy(false);
              if (r.ok) setValue(r.data);
              else setError(r.error.message);
            }}
          >
            Применить для учащихся класса
          </button>
        </>
      ) : null}
    </details>
  );
}
