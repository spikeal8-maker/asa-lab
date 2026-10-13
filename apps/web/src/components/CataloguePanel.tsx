import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { api, type CatalogueCoursePreview, type CatalogueEntry, type ModuleSummary } from '../api';
import { LessonBlocks } from './LessonBlocks';
import './courses-panel.css';

/**
 * Общий каталог.
 *
 * Витрина чужого: курсы и задания, которые коллеги открыли школе, назвали вас
 * поимённо или выложили всем. Своё сюда не попадает — оно и так в банке, а в
 * витрине только мешало бы.
 *
 * Забирается копией, а не ссылкой: автор правит своё, взявший — своё. Иначе
 * исправленная у автора опечатка меняет урок в чужой школе посреди четверти.
 * Кто автор и из какой школы — написано: у преподавателя должен быть выбор,
 * брать ли работу незнакомого человека.
 */
export function CataloguePanel({
  modules,
  onTaken,
}: {
  readonly modules: readonly ModuleSummary[];
  readonly onTaken: () => void;
}): JSX.Element {
  const [items, setItems] = useState<CatalogueEntry[] | null>(null);
  const [preview, setPreview] = useState<CatalogueEntry | null>(null);
  const [contents, setContents] = useState<CatalogueCoursePreview | null | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | 'course' | 'assignment'>('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await api.catalogue();
    setItems(result.ok ? result.data.items : []);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!preview || preview.kind !== 'course') {
      setContents(undefined);
      return;
    }
    setContents(undefined);
    void api.catalogueCourse(preview.id).then((result) => {
      setContents(result.ok ? result.data : null);
    });
  }, [preview]);

  const moduleName = (key: string | null): string =>
    key ? (modules.find((entry) => entry.moduleKey === key)?.displayName ?? key) : 'Курс';

  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const visible = useMemo(
    () =>
      (items ?? []).filter((entry) => {
        if (kindFilter && entry.kind !== kindFilter) return false;
        if (moduleFilter && entry.moduleKey !== moduleFilter) return false;
        if (needle.length === 0) return true;
        return (
          entry.title.toLocaleLowerCase('ru-RU').includes(needle) ||
          (entry.summary ?? '').toLocaleLowerCase('ru-RU').includes(needle) ||
          entry.authorName.toLocaleLowerCase('ru-RU').includes(needle)
        );
      }),
    [items, kindFilter, moduleFilter, needle],
  );

  async function take(entry: CatalogueEntry): Promise<void> {
    setBusy(true);
    const result = await api.takeFromCatalogue(entry.kind, entry.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось забрать.');
      return;
    }
    setError(null);
    setNotice(
      entry.kind === 'course'
        ? `Курс «${entry.title}» у вас. Задания легли в свою папку — правьте как свои.`
        : `Задание «${entry.title}» у вас. Правки автора ваш урок больше не тронут.`,
    );
    setPreview(null);
    onTaken();
  }

  return (
    <section className="catalogue-panel">
      <div className="catalogue-workspace">
        <div className="catalogue-toolbar">
          <label className="catalogue-search">
            <span className="sr-only">Поиск в библиотеке</span>
            <input
              type="search"
              placeholder="Найти ресурс"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="catalogue-filter">
            <span className="sr-only">Тип ресурса</span>
            <select
              aria-label="Тип ресурса"
              value={kindFilter}
              onChange={(event) =>
                setKindFilter(event.target.value as '' | 'course' | 'assignment')
              }
            >
              <option value="">Все типы</option>
              <option value="assignment">Задания</option>
              <option value="course">Курсы</option>
            </select>
          </label>
          <label className="catalogue-filter">
            <span className="sr-only">Среда</span>
            <select
              aria-label="Среда"
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value)}
            >
              <option value="">Все среды</option>
              {modules.map((module) => (
                <option key={module.moduleKey} value={module.moduleKey}>
                  {module.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>

        {notice ? (
          <div className="catalogue-state is-success" role="status">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="catalogue-state is-error" role="alert">
            {error}
          </div>
        ) : null}

        {items === null ? (
          <div className="catalogue-state" role="status">
            Загружаем библиотеку…
          </div>
        ) : visible.length === 0 ? (
          <div className="catalogue-state">
            <strong>{needle ? 'Ничего не найдено.' : 'Библиотека пока пуста.'}</strong>
            <span>
              {needle ? 'Измените запрос или фильтры.' : 'Здесь появятся материалы коллег.'}
            </span>
          </div>
        ) : (
          <ul className="catalogue-list catalogue-resource-list" data-testid="catalogue-list">
            {visible.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`}>
                {entry.sampleImage ? (
                  <img className="catalogue-resource-thumb" src={entry.sampleImage} alt="" />
                ) : (
                  <span className="catalogue-resource-mark" aria-hidden="true">
                    {entry.kind === 'course' ? 'К' : 'З'}
                  </span>
                )}
                <div className="catalogue-copy">
                  <strong>{entry.title}</strong>
                  <span className="catalogue-resource-meta">
                    {entry.kind === 'course' ? 'Курс' : 'Задание'}
                    {entry.kind === 'assignment' && entry.moduleKey
                      ? ` · ${moduleName(entry.moduleKey)}`
                      : ''}
                    {entry.kind === 'course' && entry.itemCount
                      ? ` · ${entry.itemCount} материалов`
                      : ''}
                  </span>
                  {entry.summary ? (
                    <span className="catalogue-resource-summary">{entry.summary}</span>
                  ) : null}
                  <span className="catalogue-author">
                    {entry.authorName}
                    {entry.authorSchool && entry.authorSchool !== entry.authorName
                      ? ` · ${entry.authorSchool}`
                      : ''}
                  </span>
                </div>
                <div className="catalogue-actions">
                  {entry.kind === 'course' ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setPreview(entry)}
                    >
                      Открыть
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void take(entry)}
                  >
                    Добавить
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {preview ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal course-preview"
            role="dialog"
            aria-modal="true"
            aria-label={preview.title}
          >
            <h2>{preview.title}</h2>
            <p>
              {preview.authorName}
              {preview.authorSchool && preview.authorSchool !== preview.authorName
                ? ` · ${preview.authorSchool}`
                : ''}
            </p>
            {preview.summary ? <p>{preview.summary}</p> : null}
            {contents === undefined ? (
              <p role="status">Загружаем состав…</p>
            ) : contents === null ? (
              <p className="form-error" role="alert">
                Не удалось открыть опубликованную версию курса.
              </p>
            ) : (
              <div className="catalogue-course-outline" data-testid="catalogue-course-outline">
                <p className="catalogue-version">Опубликованная версия {contents.versionNumber}</p>
                {contents.sections.map((section) => (
                  <section key={section.id}>
                    <h3>{section.title}</h3>
                    {section.summary ? <p>{section.summary}</p> : null}
                    <ol>
                      {section.lessons.map((lesson) => (
                        <li key={lesson.id} data-testid="catalogue-course-lesson">
                          <details>
                            <summary>
                              <span>{lesson.kind === 'assignment' ? 'Практика' : 'Материал'}</span>
                              <strong>{lesson.title}</strong>
                              {lesson.estimatedMinutes ? (
                                <small>{lesson.estimatedMinutes} мин</small>
                              ) : null}
                            </summary>
                            {lesson.summary ? <p>{lesson.summary}</p> : null}
                            <LessonBlocks
                              blocks={lesson.blocks}
                              legacyContent={lesson.content}
                              compact
                            />
                          </details>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setPreview(null)}>
                Закрыть
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => void take(preview)}
              >
                Забрать себе
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
