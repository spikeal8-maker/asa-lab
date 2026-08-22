import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { api, type CatalogueCoursePreview, type CatalogueEntry, type ModuleSummary } from '../api';
import { CLASSROOM_AGE_OPTIONS } from './ClassroomFields';
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
  const [ageFilter, setAgeFilter] = useState('');
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
        if (ageFilter && entry.ageBand !== ageFilter) return false;
        if (needle.length === 0) return true;
        return (
          entry.title.toLocaleLowerCase('ru-RU').includes(needle) ||
          (entry.summary ?? '').toLocaleLowerCase('ru-RU').includes(needle) ||
          entry.authorName.toLocaleLowerCase('ru-RU').includes(needle)
        );
      }),
    [items, kindFilter, ageFilter, needle],
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
      <p className="catalogue-intro">
        Чужие курсы и задания, открытые вам: вашей школой, лично вам или всей платформе. Забранное
        становится вашей копией — автор правит своё, вы своё.
      </p>

      <div className="library-filters">
        <label className="library-search">
          <span className="sr-only">Поиск в каталоге</span>
          <input
            type="search"
            placeholder="Поиск по названию, описанию или автору"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Что показывать</span>
          <select
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value as '' | 'course' | 'assignment')}
          >
            <option value="">Курсы и задания</option>
            <option value="course">Только курсы</option>
            <option value="assignment">Только задания</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Возраст</span>
          <select value={ageFilter} onChange={(event) => setAgeFilter(event.target.value)}>
            <option value="">Любой возраст</option>
            {CLASSROOM_AGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <p role="status">Загружаем каталог…</p>
      ) : visible.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>{needle ? 'Ничего не найдено' : 'Каталог пока пуст'}</h3>
          <p>
            Здесь появится то, чем поделятся коллеги. Вы тоже можете открыть свой курс школе или
            всей платформе — в карточке курса есть «Кому видно».
          </p>
        </div>
      ) : (
        <ul className="catalogue-list" data-testid="catalogue-list">
          {visible.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`}>
              {entry.sampleImage ? (
                <img src={entry.sampleImage} alt="" width={72} height={72} />
              ) : (
                <span className="library-no-sample" aria-hidden="true" />
              )}
              <div className="catalogue-copy">
                <strong>
                  {entry.title}
                  <em className={entry.kind === 'course' ? 'is-course' : undefined}>
                    {entry.kind === 'course' ? `курс · ${entry.itemCount}` : 'задание'}
                  </em>
                </strong>
                {entry.summary ? <span>{entry.summary}</span> : null}
                {/* Кто автор — не украшение: преподаватель решает, брать ли
                    работу незнакомого человека. */}
                {/* Школу называем, только если она не совпадает с именем: у
                    личной полки название и есть имя человека, и «Иванов ·
                    Иванов» ничего не сообщает. */}
                <span className="catalogue-author">
                  {entry.authorName}
                  {entry.authorSchool && entry.authorSchool !== entry.authorName
                    ? ` · ${entry.authorSchool}`
                    : ''}
                  {entry.kind === 'assignment' ? ` · ${moduleName(entry.moduleKey)}` : ''}
                </span>
              </div>
              <div className="catalogue-actions">
                {entry.kind === 'course' ? (
                  <button type="button" className="btn-secondary" onClick={() => setPreview(entry)}>
                    Посмотреть
                  </button>
                ) : null}
                <button
                  type="button"
                  className="portal-create-button"
                  disabled={busy}
                  onClick={() => void take(entry)}
                >
                  Забрать себе
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

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
