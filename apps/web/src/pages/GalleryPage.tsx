import { useCallback, useEffect, useState } from 'react';
import { api, type GalleryItem, type ModuleSummary } from '../api';
import { useSchoolTime } from '../components/school-time';
import './gallery.css';

/**
 * The gallery: work somebody chose to show.
 *
 * This is the one place on the platform where people see each other's work, and
 * that is deliberate. Inside a class nobody sees a classmate's model — thirty
 * children on the same task, shown each other's answers, is a copying machine.
 * Here the work is finished, published on purpose, and from every school at
 * once, so looking at it is what looking at a gallery is for.
 *
 * Three things can be said about a piece of work and no more: «нравится»,
 * «ого», and «выбор редакции», which a teacher awards. There is no comment box
 * and no dislike. A wall of children's work with free text under it needs a
 * moderator, and a product without one should not offer the field.
 */

const REACTIONS = [
  { kind: 'like' as const, emoji: '👍', label: 'Нравится' },
  { kind: 'wow' as const, emoji: '😮', label: 'Ого' },
];

export function GalleryPage({
  canTeach,
  onOpenWork,
}: {
  readonly canTeach: boolean;
  readonly onOpenWork: (projectId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [sort, setSort] = useState<'recent' | 'popular'>('recent');
  const [moduleKey, setModuleKey] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.gallery({
      sort,
      ...(moduleKey ? { module: moduleKey } : {}),
    });
    setItems(result.ok ? result.data.items : []);
  }, [sort, moduleKey]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void api.listProjectModules().then((result) => {
      if (result.ok) {
        setModules(result.data.items.filter((entry) => entry.availability === 'active'));
      }
    });
  }, []);

  const moduleName = (key: string): string =>
    modules.find((entry) => entry.moduleKey === key)?.displayName ?? key;

  /**
   * A reaction answers immediately and reconciles afterwards. Pressing 👍 and
   * watching nothing happen for a round trip is the difference between a wall
   * that feels alive and one that feels broken.
   */
  async function react(item: GalleryItem, kind: 'like' | 'wow'): Promise<void> {
    const on = kind === 'like' ? !item.viewerLiked : !item.viewerWowed;
    setItems(
      (current) =>
        current?.map((entry) =>
          entry.projectId === item.projectId
            ? {
                ...entry,
                ...(kind === 'like'
                  ? { viewerLiked: on, likeCount: entry.likeCount + (on ? 1 : -1) }
                  : { viewerWowed: on, wowCount: entry.wowCount + (on ? 1 : -1) }),
              }
            : entry,
        ) ?? null,
    );
    const result = await api.reactToWork(item.projectId, kind, on);
    if (!result.ok) await reload();
  }

  return (
    <main id="main-content" className="portal-content" tabIndex={-1}>
      <header className="gallery-heading">
        <div>
          <h1>Галерея</h1>
          <p>Работы, которыми поделились. Поставьте реакцию тому, что понравилось.</p>
        </div>
      </header>

      <div className="gallery-filters">
        <div className="gallery-sort" role="group" aria-label="Порядок">
          <button
            type="button"
            className={sort === 'recent' ? 'is-active' : undefined}
            aria-pressed={sort === 'recent'}
            onClick={() => setSort('recent')}
          >
            Новые
          </button>
          <button
            type="button"
            className={sort === 'popular' ? 'is-active' : undefined}
            aria-pressed={sort === 'popular'}
            onClick={() => setSort('popular')}
          >
            Популярные
          </button>
        </div>
        <label className="gallery-module">
          <span className="sr-only">Среда</span>
          <select value={moduleKey} onChange={(event) => setModuleKey(event.target.value)}>
            <option value="">Все среды</option>
            {modules.map((module) => (
              <option key={module.moduleKey} value={module.moduleKey}>
                {module.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>

      {items === null ? (
        <p role="status">Загружаем галерею…</p>
      ) : items.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>Здесь пока пусто</h3>
          <p>
            Работы появляются, когда автор или преподаватель делится ими. Откройте свою работу и
            нажмите «Поделиться в галерее».
          </p>
        </div>
      ) : (
        <ul className="gallery-grid" data-testid="gallery">
          {items.map((item) => (
            <li key={item.projectId} className={item.editorsChoice ? 'is-choice' : undefined}>
              {/* The picture is the door. A card you cannot open is a poster. */}
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
                <span className="gallery-meta">
                  {moduleName(item.moduleKey)} · {time.date(item.publishedAt)}
                </span>
              </div>
              <div className="gallery-actions">
                {REACTIONS.map((reaction) => {
                  const active = reaction.kind === 'like' ? item.viewerLiked : item.viewerWowed;
                  const count = reaction.kind === 'like' ? item.likeCount : item.wowCount;
                  return (
                    <button
                      key={reaction.kind}
                      type="button"
                      className={`gallery-reaction${active ? ' is-active' : ''}`}
                      aria-pressed={active}
                      aria-label={`${reaction.label}: ${count}`}
                      onClick={() => void react(item, reaction.kind)}
                    >
                      <span aria-hidden="true">{reaction.emoji}</span>
                      {count}
                    </button>
                  );
                })}
              </div>
              {canTeach || item.viewerMayRemove ? (
                <div className="gallery-teacher-actions">
                  {canTeach ? (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy === item.projectId}
                      onClick={async () => {
                        setBusy(item.projectId);
                        await api.setEditorsChoice(item.projectId, !item.editorsChoice);
                        setBusy(null);
                        await reload();
                      }}
                    >
                      {item.editorsChoice ? 'Снять выбор редакции' : 'Выбор редакции'}
                    </button>
                  ) : null}
                  {item.viewerMayRemove ? (
                    <button
                      type="button"
                      className="assignment-remove"
                      disabled={busy === item.projectId}
                      onClick={async () => {
                        if (!window.confirm(`Убрать «${item.title}» из галереи?`)) return;
                        setBusy(item.projectId);
                        await api.unpublishFromGallery(item.projectId);
                        setBusy(null);
                        await reload();
                      }}
                    >
                      Убрать
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
