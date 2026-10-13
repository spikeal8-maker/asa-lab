import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  api,
  type CatalogueCoursePreview,
  type CatalogueCopyRequest,
  type CatalogueCopyReceipt,
  type CatalogueEntry,
  type ModuleSummary,
} from '../api';
import { CLASSROOM_AGE_OPTIONS } from './ClassroomFields';
import { LessonBlocks } from './LessonBlocks';
import { AssignmentView } from './AssignmentView';
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
  onRegisterLeaveGuard,
}: {
  readonly modules: readonly ModuleSummary[];
  readonly onTaken: (kind: 'course' | 'assignment', receipt: CatalogueCopyReceipt) => void;
  readonly onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void;
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
  const attempt = useRef<{
    entry: CatalogueEntry;
    preview: CatalogueCoursePreview;
    payload: CatalogueCopyRequest;
  } | null>(null);
  const busyRef = useRef(false);
  const canLeave = useCallback(() => {
    if (busyRef.current || attempt.current) {
      setError(
        'Сначала подтвердите результат копирования: откройте тот же курс и повторите действие.',
      );
      return false;
    }
    return true;
  }, []);
  useEffect(() => {
    onRegisterLeaveGuard?.(canLeave);
    const warn = (event: BeforeUnloadEvent) => {
      if (busyRef.current || attempt.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      onRegisterLeaveGuard?.(null);
      window.removeEventListener('beforeunload', warn);
    };
  }, [canLeave, onRegisterLeaveGuard]);
  function openPreview(entry: CatalogueEntry): void {
    if (attempt.current) {
      if (entry.id !== attempt.current.entry.id) {
        canLeave();
        return;
      }
      setContents(attempt.current.preview);
    } else setContents(undefined);
    setPreview(entry);
  }

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
    if (attempt.current?.entry.id === preview.id) {
      setContents(attempt.current.preview);
      return;
    }
    let active = true;
    setContents(undefined);
    void api.catalogueCourse(preview.id).then((result) => {
      if (active) setContents(result.ok ? result.data : null);
    });
    return () => {
      active = false;
    };
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
    if (busyRef.current) return;
    if (attempt.current && (entry.kind !== 'course' || attempt.current.entry.id !== entry.id)) {
      canLeave();
      return;
    }
    if (entry.kind === 'course') {
      if (attempt.current && attempt.current.entry.id !== entry.id) {
        canLeave();
        return;
      }
      if (!attempt.current) {
        if (
          !contents?.versionId ||
          !contents.contentHash ||
          !contents.destinationTenantId ||
          preview?.id !== entry.id
        )
          return;
        attempt.current = {
          entry,
          preview: contents,
          payload: {
            versionId: contents.versionId,
            contentHash: contents.contentHash,
            destinationTenantId: contents.destinationTenantId,
            requestId: crypto.randomUUID(),
          },
        };
      }
    }
    busyRef.current = true;
    setBusy(true);
    const result = await api.takeFromCatalogue(entry.kind, entry.id, attempt.current?.payload);
    busyRef.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось забрать.');
      if (['copy_unavailable', 'not_available'].includes(result.error.code)) attempt.current = null;
      return;
    }
    if (
      entry.kind === 'course' &&
      (result.data?.sourceVersionId !== attempt.current?.payload.versionId ||
        result.data.sourceContentHash !== attempt.current?.payload.contentHash ||
        !result.data.id)
    ) {
      setError('Сервер не подтвердил точную копию. Повторите то же действие.');
      return;
    }
    setError(null);
    setNotice(
      entry.kind === 'course'
        ? `Курс «${entry.title}» у вас. Скопирована опубликованная версия ${result.data.sourceVersionNumber}.`
        : `Задание «${entry.title}» у вас. Правки автора ваш урок больше не тронут.`,
    );
    setPreview(null);
    attempt.current = null;
    onTaken(entry.kind, result.data);
  }

  function pinned(versionId: string): JSX.Element {
    const item = contents?.pinnedItems?.[versionId];
    if (!item) return <p role="alert">Закреплённый материал недоступен.</p>;
    return (
      <section className="course-pinned-practice">
        <strong>{item.title}</strong>
        <small>
          {item.moduleKey ? moduleName(item.moduleKey) : 'Материал'} · опубликованная версия{' '}
          {item.versionNumber}
        </small>
        <AssignmentView assignment={item} />
      </section>
    );
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
      {attempt.current && !preview ? (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => openPreview(attempt.current!.entry)}
        >
          Подтвердить копирование
        </button>
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
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => openPreview(entry)}
                  >
                    Посмотреть
                  </button>
                ) : null}
                <button
                  type="button"
                  className="portal-create-button"
                  disabled={busy}
                  onClick={() => (entry.kind === 'course' ? openPreview(entry) : void take(entry))}
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
            <h2>{contents?.title ?? preview.title}</h2>
            <p>
              {preview.authorName}
              {preview.authorSchool && preview.authorSchool !== preview.authorName
                ? ` · ${preview.authorSchool}`
                : ''}
            </p>
            {contents?.summary ? <p>{contents.summary}</p> : null}
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
                              renderActivity={(block) => pinned(block.learningActivityVersionId)}
                              renderMaterial={(block) => pinned(block.learningActivityVersionId)}
                            />
                            {lesson.learningActivityVersionId
                              ? pinned(lesson.learningActivityVersionId)
                              : null}
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
                disabled={busy || !contents?.versionId || !contents.contentHash}
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
