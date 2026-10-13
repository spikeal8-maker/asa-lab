import { useEffect, useRef, useState, type JSX } from 'react';
import { api, type AuthoredActivityLearnerPreview } from '../api';
import { TaskBlocks } from './TaskBlocks';

async function loadManual(versionId: string): Promise<AuthoredActivityLearnerPreview> {
  const roots = await api.authoredActivities();
  if (!roots.ok) throw new Error(roots.error.message);
  for (const root of roots.data.items.filter((item) => item.kind === 'manual')) {
    const versions = await api.authorVersions('activity', root.id);
    if (!versions.ok || !versions.data.items.some((version) => version.id === versionId)) continue;
    const preview = await api.previewAuthoredActivityVersion(root.id, versionId);
    if (!preview.ok) throw new Error(preview.error.message);
    if (
      preview.data.source.kind !== 'published' ||
      preview.data.source.id !== versionId ||
      preview.data.moduleKey !== null
    )
      throw new Error('Сервер не подтвердил опубликованную версию материала.');
    return preview.data;
  }
  throw new Error('Закреплённый материал недоступен. Версия не заменена.');
}

export function PinnedManualMaterialPreview({
  versionId,
}: {
  readonly versionId: string;
}): JSX.Element {
  const [preview, setPreview] = useState<AuthoredActivityLearnerPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setPreview(null);
    setError(null);
    void loadManual(versionId).then(
      (value) => {
        if (active) setPreview(value);
      },
      (problem: unknown) => {
        if (active) setError(problem instanceof Error ? problem.message : 'Материал недоступен.');
      },
    );
    return () => {
      active = false;
    };
  }, [versionId]);
  if (error) return <p role="alert">{error}</p>;
  if (!preview) return <p role="status">Загружаем закреплённый материал…</p>;
  return (
    <section className="course-pinned-material" data-testid="course-pinned-material">
      <strong>{preview.assignment.title}</strong>
      <small>Опубликованная версия {preview.source.versionNumber}</small>
      <TaskBlocks blocks={preview.assignment.blocks} />
    </section>
  );
}

export function CanonicalManualMaterialPicker({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (versionId: string) => void;
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Array<{
    id: string;
    title: string;
    versionId: string;
  }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void api.authoredActivities().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setItems(
        result.data.items
          .filter((item) => item.kind === 'manual' && item.currentPublishedVersionId !== null)
          .map((item) => ({
            id: item.id,
            title: item.title,
            versionId: item.currentPublishedVersionId!,
          })),
      );
    });
    return () => {
      active = false;
    };
  }, [open]);
  return (
    <div className="course-manual-material-picker">
      {value ? (
        <PinnedManualMaterialPreview versionId={value} />
      ) : (
        <p>Выберите свой опубликованный материал.</p>
      )}
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        {value ? 'Заменить материал' : 'Выбрать материал'}
      </button>
      {open ? (
        <div className="course-practice-options" aria-label="Выбор материала">
          <label>
            Найти материал
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert">{error}</p>
          ) : items === null ? (
            <p role="status">Загружаем материалы…</p>
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
                      disabled={busy}
                      aria-label={`Добавить материал «${item.title}»`}
                      onClick={() => {
                        setBusy(true);
                        void api
                          .previewAuthoredActivityVersion(item.id, item.versionId)
                          .then((result) => {
                            if (!mounted.current) return;
                            if (
                              result.ok &&
                              result.data.source.kind === 'published' &&
                              result.data.source.id === item.versionId &&
                              result.data.moduleKey === null
                            ) {
                              latestChange.current(item.versionId);
                              setOpen(false);
                            } else
                              setError(
                                result.ok
                                  ? 'Материал недоступен для закрепления.'
                                  : result.error.message,
                              );
                          })
                          .catch(() => {
                            if (mounted.current) setError('Не удалось проверить материал.');
                          })
                          .finally(() => {
                            if (mounted.current) setBusy(false);
                          });
                      }}
                    >
                      Добавить
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {items?.length === 0 ? <p>Опубликуйте материал, чтобы добавить его в курс.</p> : null}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Закрыть выбор материала
          </button>
        </div>
      ) : null}
    </div>
  );
}
