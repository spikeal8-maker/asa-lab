import { useEffect, useRef, useState, type JSX } from 'react';
import { api, type AuthoredActivityLearnerPreview } from '../api';
import { AssignmentView } from './AssignmentView';

/** Resolve a saved pin, including a historical version of an owned practice. */
export async function loadPinnedPractice(
  versionId: string,
): Promise<AuthoredActivityLearnerPreview> {
  const roots = await api.authoredActivities();
  if (!roots.ok) throw new Error(roots.error.message);
  let root = roots.data.items.find((item) => item.currentPublishedVersionId === versionId);
  if (!root) {
    for (const item of roots.data.items) {
      const versions = await api.authorVersions('activity', item.id);
      if (versions.ok && versions.data.items.some((version) => version.id === versionId)) {
        root = item;
        break;
      }
    }
  }
  if (!root) throw new Error('Закреплённая практика недоступна. Версия не заменена.');
  const result = await api.previewAuthoredActivityVersion(root.id, versionId);
  if (!result.ok) throw new Error(result.error.message);
  if (result.data.source.kind !== 'published' || result.data.source.id !== versionId)
    throw new Error('Сервер не подтвердил закреплённую версию практики.');
  return result.data;
}

export function PinnedPracticePreview({ versionId }: { readonly versionId: string }): JSX.Element {
  const [preview, setPreview] = useState<AuthoredActivityLearnerPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    void loadPinnedPractice(versionId).then(
      (value) => {
        if (active) setPreview(value);
      },
      (problem: unknown) => {
        if (active) setError(problem instanceof Error ? problem.message : 'Практика недоступна.');
      },
    );
    return () => {
      active = false;
    };
  }, [versionId]);
  if (error) return <p role="alert">{error}</p>;
  if (!preview) return <p role="status">Загружаем закреплённую практику…</p>;
  return (
    <div className="course-pinned-practice">
      <strong>{preview.assignment.title}</strong>
      <small>
        {preview.moduleKey === 'electronics'
          ? 'Электроника'
          : preview.moduleKey === 'three-d'
            ? '3D'
            : preview.moduleKey === 'blocks'
              ? 'Scratch'
              : 'Практика'}{' '}
        · опубликованная версия {preview.source.versionNumber}
      </small>
      <AssignmentView assignment={preview.assignment} />
    </div>
  );
}

export function CanonicalPracticePicker({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (versionId: string, title: string) => void;
}): JSX.Element {
  const latestChange = useRef(onChange);
  latestChange.current = onChange;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [selecting, setSelecting] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<
    { id: string; title: string; currentPublishedVersionId: string | null }[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void api.authoredActivities().then((result) => {
      if (!active) return;
      if (result.ok)
        setItems(
          result.data.items.filter(
            (item) => item.kind === 'project' && item.currentPublishedVersionId !== null,
          ),
        );
      else setError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [open]);
  return (
    <div className="course-practice-picker">
      {value ? (
        <PinnedPracticePreview versionId={value} />
      ) : (
        <p>Выберите свою опубликованную практику.</p>
      )}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        {value ? 'Заменить практику' : 'Выбрать практику'}
      </button>
      {open ? (
        <div className="course-practice-options" aria-label="Выбор практики">
          <label>
            Найти практику
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert">{error}</p>
          ) : items === null ? (
            <p role="status">Загружаем практики…</p>
          ) : (
            <ul>
              {items
                .filter((item) =>
                  item.title
                    .toLocaleLowerCase('ru-RU')
                    .includes(search.trim().toLocaleLowerCase('ru-RU')),
                )
                .map((item) => (
                  <li key={item.id}>
                    <strong>{item.title}</strong>
                    <span>Опубликовано</span>
                    <button
                      type="button"
                      disabled={selecting}
                      aria-label={`Добавить практику «${item.title}»`}
                      onClick={() => {
                        setSelecting(true);
                        void api
                          .previewAuthoredActivityVersion(item.id, item.currentPublishedVersionId!)
                          .then(async (result) => {
                            const modules = await api.listModules();
                            if (!mounted.current) return;
                            const supported =
                              result.ok &&
                              modules.ok &&
                              modules.data.items.some(
                                (module) =>
                                  module.moduleKey === result.data.moduleKey &&
                                  module.creatable &&
                                  module.learningCapabilities?.assignable === true,
                              );
                            if (
                              supported &&
                              result.ok &&
                              result.data.moduleKey !== null &&
                              result.data.source.kind === 'published' &&
                              result.data.source.id === item.currentPublishedVersionId
                            ) {
                              latestChange.current(
                                item.currentPublishedVersionId!,
                                result.data.assignment.title,
                              );
                              setOpen(false);
                            } else
                              setError(
                                result.ok
                                  ? 'Эта опубликованная практика сейчас недоступна для назначения.'
                                  : result.error.message,
                              );
                          })
                          .catch(() => {
                            if (mounted.current)
                              setError('Не удалось проверить практику. Повторите выбор.');
                          })
                          .finally(() => {
                            if (mounted.current) setSelecting(false);
                          });
                      }}
                    >
                      {'Добавить'}
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {items?.length === 0 ? (
            <p>Опубликуйте проектное задание, чтобы добавить его в курс.</p>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            disabled={selecting}
            onClick={() => setOpen(false)}
          >
            Закрыть выбор практики
          </button>
        </div>
      ) : null}
    </div>
  );
}
