import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Collection, type CollectionItem } from '../api';
import { useSchoolTime } from '../components/school-time';
import './collections.css';
import './gallery.css';

/**
 * Коллекции — подборки работ из галереи, отложенных себе.
 *
 * Преподаватель увидел на стене хороший замок, положил в «Примеры для 6 класса»
 * и на уроке показал всё сразу. Ученик сохранил то, что его зацепило.
 *
 * В подборке лежит ссылка, а не копия: у автора ничего не забирают, и работа,
 * снятая со стены, пропадает и отсюда. Подборку видит только тот, кто её собрал.
 */
export function CollectionsPage({
  onOpenWork,
}: {
  readonly onOpenWork: (projectId: string) => void;
}): JSX.Element {
  const [collections, setCollections] = useState<readonly Collection[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<readonly CollectionItem[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const time = useSchoolTime();

  const load = useCallback(async () => {
    const result = await api.listCollections();
    setCollections(result.ok ? result.data.items : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    void api.collectionItems(openId).then((result) => {
      if (!cancelled && result.ok) setItems(result.data.items);
    });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const result = await api.createCollection(title.trim());
    setBusy(false);
    if (result.ok) {
      setTitle('');
      await load();
    }
  }

  const open = collections?.find((entry) => entry.id === openId) ?? null;

  if (open) {
    return (
      <main id="main-content" className="portal-content" tabIndex={-1}>
        <button type="button" className="classroom-student-back" onClick={() => setOpenId(null)}>
          <span aria-hidden="true">←</span> Все подборки
        </button>
        <header className="collections-heading">
          <div>
            <h1>{open.title}</h1>
            <p>
              {open.itemCount === 0
                ? 'Пока пусто. Работы добавляются из галереи.'
                : `Работ в подборке: ${open.itemCount}`}
            </p>
          </div>
        </header>

        {items.length === 0 ? (
          <div className="classroom-roster-empty">
            <h3>Здесь пока ничего нет</h3>
            <p>Откройте галерею, найдите работу и нажмите «В коллекцию».</p>
          </div>
        ) : (
          <ul className="gallery-grid" data-testid="collection-items">
            {items.map((item) => (
              <li key={item.projectId} className={item.editorsChoice ? 'is-choice' : undefined}>
                <button
                  type="button"
                  className="gallery-picture"
                  aria-label={`Открыть работу «${item.title}»`}
                  onClick={() => onOpenWork(item.projectId)}
                >
                  <img
                    src={`/api/gallery/${item.projectId}/image?rev=${item.snapshotRevision}`}
                    alt=""
                    loading="lazy"
                  />
                  {item.editorsChoice ? (
                    <span className="gallery-choice-badge">★ Выбор редакции</span>
                  ) : null}
                </button>
                <div className="gallery-card-body">
                  <button
                    type="button"
                    className="gallery-card-title"
                    onClick={() => onOpenWork(item.projectId)}
                  >
                    {item.title}
                  </button>
                  <span className="gallery-author">{item.authorLabel}</span>
                  <span className="gallery-meta">Добавлено {time.date(item.addedAt)}</span>
                </div>
                <div className="gallery-teacher-actions">
                  <button
                    type="button"
                    className="assignment-remove"
                    onClick={async () => {
                      await api.setCollectionItem(open.id, item.projectId, false);
                      const fresh = await api.collectionItems(open.id);
                      if (fresh.ok) setItems(fresh.data.items);
                      await load();
                    }}
                  >
                    Убрать из подборки
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  return (
    <main id="main-content" className="portal-content" tabIndex={-1}>
      <header className="collections-heading">
        <div>
          <h1>Коллекции</h1>
          <p>
            Подборки работ из галереи, отложенных себе. В подборке лежит ссылка — у автора ничего не
            забирают.
          </p>
        </div>
      </header>

      <form className="collections-create" onSubmit={(event) => void create(event)}>
        <label htmlFor="collection-title">Новая подборка</label>
        <div>
          <input
            id="collection-title"
            value={title}
            maxLength={120}
            disabled={busy}
            placeholder="Примеры для 6 класса"
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit" className="portal-create-button" disabled={busy || !title.trim()}>
            Создать
          </button>
        </div>
      </form>

      {collections === null ? (
        <p role="status">Загружаем подборки…</p>
      ) : collections.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>Подборок пока нет</h3>
          <p>
            Создайте первую — например, «Примеры для 6 класса» — и складывайте туда работы из
            галереи.
          </p>
        </div>
      ) : (
        <ul className="collections-list" data-testid="collections">
          {collections.map((entry) => (
            <li key={entry.id}>
              {renaming?.id === entry.id ? (
                <form
                  className="collections-rename"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    await api.renameCollection(entry.id, renaming.title.trim());
                    setRenaming(null);
                    await load();
                  }}
                >
                  <input
                    value={renaming.title}
                    maxLength={120}
                    autoFocus
                    onChange={(event) => setRenaming({ id: entry.id, title: event.target.value })}
                  />
                  <button type="submit" className="btn-secondary">
                    Сохранить
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setRenaming(null)}>
                    Отмена
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="collections-open"
                    onClick={() => setOpenId(entry.id)}
                  >
                    {entry.title}
                  </button>
                  <span className="collections-count">
                    {entry.itemCount === 0 ? 'пусто' : `работ: ${entry.itemCount}`}
                  </span>
                  <div className="collections-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setRenaming({ id: entry.id, title: entry.title })}
                    >
                      Переименовать
                    </button>
                    <button
                      type="button"
                      className="assignment-remove"
                      onClick={async () => {
                        if (!window.confirm(`Удалить подборку «${entry.title}»?`)) return;
                        await api.deleteCollection(entry.id);
                        await load();
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
