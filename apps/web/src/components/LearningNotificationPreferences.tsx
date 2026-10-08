import { useCallback, useEffect, useId, useRef, useState, type MutableRefObject } from 'react';
import type { SettingsDraft } from './settings-navigation';
import { InfoHint } from './InfoHint';
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

const categoryHints: Record<NotificationCategory, string> = {
  NC01: 'Новые назначения и изменения условий задания. Само задание останется в обучении, даже если оповещение выключено.',
  NC02: 'Работы, которые поступили вам на проверку. Настройка не меняет очередь работ и доступ преподавателя.',
  NC03: 'Проверка работы и её результаты. Оценки и комментарии остаются в журнале.',
  NC04: 'Напоминания о приближении срока. Выключение не переносит срок задания.',
  NC05: 'Напоминания о пропущенном сроке. Статус задания не меняется.',
  NC06: 'События выполнения работ и курсов. Прогресс обучения сохраняется независимо от оповещений.',
  NC08: 'Заявки и приглашения на обучение. Ответить на приглашение или заявку можно в соответствующем разделе.',
};

export function LearningNotificationPreferences({
  classroomId,
  seat = false,
  teaching = true,
  controlRef,
  onDirtyChange,
}: {
  classroomId?: string;
  seat?: boolean;
  teaching?: boolean;
  controlRef?: MutableRefObject<SettingsDraft | null>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const formId = useId();
  const [saved, setSaved] = useState<Preferences | null>(null),
    [draft, setDraft] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const latestLoad = useRef(0),
    editRevision = useRef(0);
  const load = useCallback(async () => {
    const loadId = ++latestLoad.current;
    const revisionAtStart = editRevision.current;
    const result = await api.learningNotificationPreferences();
    if (loadId !== latestLoad.current || revisionAtStart !== editRevision.current) return;
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
    (key) => (!seat || key !== 'NC08') && ((!seat && teaching) || key !== 'NC02'),
  );
  const dirty = saved !== null && draft !== null && JSON.stringify(saved) !== JSON.stringify(draft);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  function discard() {
    editRevision.current += 1;
    setDraft(saved);
    setError(null);
    setNotice('');
  }
  if (controlRef) controlRef.current = { dirty, save, discard };
  function editDraft(next: Preferences) {
    editRevision.current += 1;
    setDraft(next);
    setNotice('');
  }
  async function save() {
    if (!draft || busy) return false;
    latestLoad.current += 1;
    const input = {
      revision: draft.revision,
      masterEnabled: draft.masterEnabled,
      categories: draft.categories,
      classOverrides: draft.classOverrides,
    };
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
    return result.ok;
  }
  function classRule(id: string, mode: string) {
    if (!draft) return;
    const rules = { ...draft.classOverrides };
    if (mode === 'inherit') delete rules[id];
    else rules[id] = { ...rules[id], mode: mode as 'off' | 'custom' };
    editDraft({ ...draft, classOverrides: rules });
  }
  const visibleClasses = draft?.classes.filter(
    (c) =>
      (!classroomId || c.id === classroomId) &&
      c.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section
      className="learning-notification-settings"
      aria-label="Учебные оповещения — только для меня"
    >
      <div className="notification-setting-heading">
        <h3>Доставка</h3>
        <InfoHint label="О доставке оповещений">
          Эти настройки меняют только ваши учебные оповещения. Уведомления других участников, работы
          и журнал не изменятся. Обязательные сообщения безопасности здесь не отключаются. Изменения
          применяются после сохранения.
        </InfoHint>
      </div>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => void load()}>
            Обновить форму
          </button>
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!draft && !error ? (
        <p>Загружаем настройки…</p>
      ) : draft ? (
        <>
          <div className="notification-setting-row">
            <label>
              <input
                type="checkbox"
                checked={draft.masterEnabled}
                disabled={busy}
                onChange={(e) => {
                  editDraft({ ...draft, masterEnabled: e.target.checked });
                }}
              />
              Получать учебные оповещения
            </label>
            <InfoHint label="О получении учебных оповещений">
              Общий выключатель останавливает доставку всех выбранных учебных категорий. Выбор
              категорий и правила классов сохраняются; при включении доставка возобновится по ним.
            </InfoHint>
          </div>
          {!draft.masterEnabled ? (
            <p>Доставка остановлена общим выключателем. Выбранные категории сохранены.</p>
          ) : null}
          {!classroomId ? (
            <div className="learning-category-grid">
              {keys.map((key) => (
                <div className="notification-setting-row" key={key}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={draft.categories[key]}
                      onChange={(e) => {
                        editDraft({
                          ...draft,
                          categories: { ...draft.categories, [key]: e.target.checked },
                        });
                      }}
                    />
                    {notificationCategories[key]}
                  </label>
                  <InfoHint label={`О категории «${notificationCategories[key]}»`}>
                    {categoryHints[key]}
                  </InfoHint>
                </div>
              ))}
            </div>
          ) : null}
          {draft.classes.length > 0 ? (
            <section className="notification-class-settings" aria-label="По классам">
              <div className="notification-setting-heading">
                <h4>По классам</h4>
                <InfoHint label="О настройках по классам">
                  Для каждого класса можно наследовать общие категории, выключить доставку или
                  выбрать отдельные категории. Общий выключатель имеет приоритет. Сброс для класса
                  возвращает наследование, не меняя настройки других классов.
                </InfoHint>
              </div>
              {!classroomId ? (
                <label>
                  Найти класс{' '}
                  <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
                </label>
              ) : null}
              {visibleClasses?.length === 0 ? <p>Классы не найдены.</p> : null}
              {visibleClasses?.map((c) => {
                const rule = draft.classOverrides[c.id];
                return (
                  <fieldset key={c.id} disabled={busy}>
                    <legend>{c.title}</legend>
                    <div className="notification-setting-field">
                      <div className="notification-setting-heading">
                        <label htmlFor={`${formId}-${c.id}-mode`}>
                          Мои оповещения об этом классе
                        </label>
                        <InfoHint label={`О доставке в классе «${c.title}»`}>
                          «Как в общих настройках» наследует ваши категории. «Выключить для меня»
                          останавливает доставку этого класса. «Настроить категории» позволяет
                          выбрать исключения; общий выключатель продолжает действовать.
                        </InfoHint>
                      </div>
                      <select
                        id={`${formId}-${c.id}-mode`}
                        value={rule?.mode ?? 'inherit'}
                        onChange={(e) => classRule(c.id, e.target.value)}
                      >
                        <option value="inherit">Как в общих настройках</option>
                        <option value="off">Выключить для меня</option>
                        <option value="custom">Настроить категории</option>
                      </select>
                    </div>
                    {rule?.mode === 'custom' ? (
                      <div className="learning-category-grid">
                        {keys.map((key) => (
                          <div className="notification-setting-field" key={key}>
                            <div className="notification-setting-heading">
                              <label htmlFor={`${formId}-${c.id}-${key}`}>
                                {notificationCategories[key]}
                              </label>
                              <InfoHint
                                label={`О категории «${notificationCategories[key]}» в классе «${c.title}»`}
                              >
                                {categoryHints[key]} Наследование использует общий выбор этой
                                категории; включение или выключение создаёт исключение для класса.
                              </InfoHint>
                            </div>
                            <select
                              id={`${formId}-${c.id}-${key}`}
                              value={rule.categories?.[key] ?? 'inherit'}
                              onChange={(e) =>
                                editDraft({
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
                          </div>
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
            </section>
          ) : (
            <p>Нет доступных классов для отдельных настроек.</p>
          )}
          {busy ? <p role="status">Сохраняем оповещения…</p> : null}
          <div className="learning-notification-actions">
            <button className="btn-primary" disabled={busy} onClick={() => void save()}>
              Сохранить оповещения
            </button>
            <button className="btn-secondary" disabled={busy} onClick={discard}>
              Отменить
            </button>
          </div>
        </>
      ) : null}
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
