import { useEffect, useState } from 'react';
import { api, type Collection, type GalleryWork } from '../api';
import { useSchoolTime } from '../components/school-time';
import './gallery.css';

/**
 * One published work, opened.
 *
 * A gallery you can only look at teaches nothing. A child learns by opening
 * somebody's castle, seeing which shapes it is made of, and building their own
 * on top of it — so this page shows the picture large, what the work is built
 * from, and offers to put a copy in their own projects.
 *
 * The copy is honest about itself. It arrives carrying "копия работы Х, автор
 * Y", the mark cannot be removed, and the teacher sees it where they mark work.
 * That is what keeps "take it and learn from it" from becoming "take it and
 * hand it in".
 */

interface ShapeLine {
  readonly kind: string;
  readonly count: number;
}

/**
 * What the work is made of, in the plainest terms a document allows.
 *
 * Deliberately not a dump of JSON: a ten-year-old opening someone's model wants
 * "восемь кубов, четыре цилиндра", not a serialised tree. Anything this cannot
 * read is reported as such rather than guessed at.
 */
function describeDocument(document: unknown): ShapeLine[] {
  if (!document || typeof document !== 'object') return [];
  const counts = new Map<string, number>();
  const walk = (node: unknown, depth: number): void => {
    if (depth > 6 || !node) return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    // Each environment names its parts its own way: ASA 3D stores the figure
    // under `primitive` and puts the literal word 'primitive' in `kind`, while
    // the electronics document names components in `kind`. The specific field
    // wins, and the generic wrapper word is never a part.
    const kind =
      record['primitive'] ?? record['componentKind'] ?? record['shape'] ?? record['kind'];
    if (
      typeof kind === 'string' &&
      kind.length > 0 &&
      kind.length < 40 &&
      kind !== 'primitive' &&
      kind !== 'group'
    ) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    for (const value of Object.values(record)) walk(value, depth + 1);
  };
  walk(document, 0);
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

const LICENCE_NAMES: Readonly<Record<string, string>> = {
  reserved: 'Все права сохранены',
  'public-domain': 'Общественное достояние',
  'cc-by': 'CC BY — с указанием автора',
  'cc-by-sa': 'CC BY-SA — на тех же условиях',
  'cc-by-nc': 'CC BY-NC — без коммерческого использования',
};

const SHAPE_NAMES: Readonly<Record<string, string>> = {
  box: 'Параллелепипед',
  cube: 'Куб',
  sphere: 'Сфера',
  cylinder: 'Цилиндр',
  cone: 'Конус',
  torus: 'Тор',
  wedge: 'Клин',
  pyramid: 'Пирамида',
  roof: 'Крыша',
  text: 'Текст',
  group: 'Группа',
  hole: 'Отверстие',
  resistor: 'Резистор',
  led: 'Светодиод',
  source: 'Источник питания',
  wire: 'Провод',
  button: 'Кнопка',
};

export function GalleryWorkPage({
  projectId,
  onBack,
  onOpenProject,
}: {
  readonly projectId: string;
  readonly onBack: () => void;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [work, setWork] = useState<GalleryWork | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = useSchoolTime();

  useEffect(() => {
    let cancelled = false;
    void api.galleryWork(projectId).then((result) => {
      if (cancelled) return;
      if (result.ok) setWork(result.data.work);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function react(kind: 'like' | 'wow'): Promise<void> {
    if (!work) return;
    const on = kind === 'like' ? !work.viewerLiked : !work.viewerWowed;
    setWork({
      ...work,
      ...(kind === 'like'
        ? { viewerLiked: on, likeCount: work.likeCount + (on ? 1 : -1) }
        : { viewerWowed: on, wowCount: work.wowCount + (on ? 1 : -1) }),
    });
    const result = await api.reactToWork(projectId, kind, on);
    if (!result.ok) {
      const fresh = await api.galleryWork(projectId);
      if (fresh.ok) setWork(fresh.data.work);
    }
  }

  async function takeCopy(): Promise<void> {
    if (!work) return;
    setBusy(true);
    setError(null);
    const result = await api.copyGalleryWork(projectId);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось взять работу.');
      return;
    }
    setNotice('Копия у вас в проектах. Открыть её?');
    // Remember which project to open when they say yes.
    setCopiedProjectId(result.data.projectId);
  }

  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);
  // Подборки этого человека и то, в каких уже лежит эта работа.
  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [holding, setHolding] = useState<ReadonlySet<string>>(new Set());
  const [pickingCollection, setPickingCollection] = useState(false);
  const [newCollection, setNewCollection] = useState('');

  useEffect(() => {
    void api.listCollections().then((result) => {
      if (result.ok) setCollections(result.data.items);
    });
    void api.collectionsHolding(projectId).then((result) => {
      if (result.ok) setHolding(new Set(result.data.collectionIds));
    });
  }, [projectId]);

  async function toggleCollection(collectionId: string): Promise<void> {
    const inside = !holding.has(collectionId);
    const result = await api.setCollectionItem(collectionId, projectId, inside);
    if (!result.ok) return;
    setHolding((current) => {
      const next = new Set(current);
      if (inside) next.add(collectionId);
      else next.delete(collectionId);
      return next;
    });
    const fresh = await api.listCollections();
    if (fresh.ok) setCollections(fresh.data.items);
  }

  if (missing) {
    return (
      <main id="main-content" className="portal-content" tabIndex={-1}>
        <button type="button" className="classroom-back" onClick={onBack}>
          ← Галерея
        </button>
        <div className="classroom-roster-empty">
          <h3>Работы здесь больше нет</h3>
          <p>Автор или преподаватель убрал её из галереи.</p>
        </div>
      </main>
    );
  }

  if (!work) {
    return (
      <main id="main-content" className="portal-content" tabIndex={-1}>
        <p role="status">Загружаем работу…</p>
      </main>
    );
  }

  const parts = describeDocument(work.document);

  return (
    <main id="main-content" className="portal-content gallery-work" tabIndex={-1}>
      <button type="button" className="classroom-back" onClick={onBack}>
        ← Галерея
      </button>

      <div className="gallery-work-layout">
        <figure className="gallery-work-picture">
          <img
            src={`/api/gallery/${work.projectId}/image?rev=${work.snapshotRevision}`}
            alt={`Работа «${work.title}»`}
          />
          {work.editorsChoice ? (
            <figcaption className="gallery-choice-badge">★ Выбор редакции</figcaption>
          ) : null}
        </figure>

        <div className="gallery-work-side">
          <h1>{work.title}</h1>
          <p className="gallery-work-author">{work.authorLabel}</p>
          <p className="gallery-meta">
            Опубликовано {time.date(work.publishedAt)}
            {work.copyCount > 0 ? ` · взяли за основу: ${work.copyCount}` : ''}
            {work.visibility === 'link' ? ' · доступна по ссылке' : ''}
          </p>

          {/* Что это за работа словами автора. Без описания зритель видит
              картинку и гадает. */}
          {work.description ? <p className="gallery-work-description">{work.description}</p> : null}

          {work.tags.length > 0 ? (
            <ul className="gallery-work-tags" aria-label="Теги">
              {work.tags.map((tag) => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
          ) : null}

          {/* If the published work is itself a copy, that travels with it. */}
          {work.copiedFromTitle ? (
            <p className="gallery-copied-note">
              Это копия работы «{work.copiedFromTitle}», автор {work.copiedFromAuthor}.
            </p>
          ) : null}

          <div className="gallery-actions">
            <button
              type="button"
              className={`gallery-reaction${work.viewerLiked ? ' is-active' : ''}`}
              aria-pressed={work.viewerLiked}
              aria-label={`Нравится: ${work.likeCount}`}
              disabled={work.viewerIsAuthor}
              onClick={() => void react('like')}
            >
              <span aria-hidden="true">👍</span>
              {work.likeCount}
            </button>
            <button
              type="button"
              className={`gallery-reaction${work.viewerWowed ? ' is-active' : ''}`}
              aria-pressed={work.viewerWowed}
              aria-label={`Ого: ${work.wowCount}`}
              disabled={work.viewerIsAuthor}
              onClick={() => void react('wow')}
            >
              <span aria-hidden="true">😮</span>
              {work.wowCount}
            </button>
          </div>

          {work.viewerIsAuthor ? (
            <p className="account-hint">Это ваша работа.</p>
          ) : (
            <button
              type="button"
              className="portal-create-button gallery-take"
              disabled={busy}
              onClick={() => void takeCopy()}
            >
              {busy ? 'Копируем…' : 'Добавить к себе'}
            </button>
          )}

          {/* Отложить себе. Работа не копируется — в подборке лежит ссылка,
              и у автора ничего не забирают. */}
          <div className="gallery-collect">
            <button
              type="button"
              className="btn-secondary gallery-collect-toggle"
              aria-expanded={pickingCollection}
              onClick={() => setPickingCollection(!pickingCollection)}
            >
              {holding.size > 0 ? `В коллекциях: ${holding.size}` : 'В коллекцию'}
            </button>
            {pickingCollection ? (
              <div className="gallery-collect-panel">
                {collections.length === 0 ? (
                  <p className="account-hint">Подборок пока нет — создайте первую.</p>
                ) : (
                  <ul>
                    {collections.map((entry) => (
                      <li key={entry.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={holding.has(entry.id)}
                            onChange={() => void toggleCollection(entry.id)}
                          />
                          <span>{entry.title}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!newCollection.trim()) return;
                    const created = await api.createCollection(newCollection.trim());
                    setNewCollection('');
                    if (created.ok) {
                      await api.setCollectionItem(created.data.id, projectId, true);
                      const fresh = await api.listCollections();
                      if (fresh.ok) setCollections(fresh.data.items);
                      setHolding((current) => new Set(current).add(created.data.id));
                    }
                  }}
                >
                  <input
                    value={newCollection}
                    maxLength={120}
                    placeholder="Новая подборка"
                    onChange={(event) => setNewCollection(event.target.value)}
                  />
                  <button type="submit" className="btn-secondary">
                    Создать и добавить
                  </button>
                </form>
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          {notice && copiedProjectId ? (
            <div className="notice-success" role="status">
              <p>Копия у вас в проектах, с пометкой откуда она.</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onOpenProject(copiedProjectId, work.moduleKey)}
              >
                Открыть копию
              </button>
            </div>
          ) : null}

          {/* Под какой лицензией работу можно брать. Без этой строки «добавить
              к себе» превращается в вопрос без ответа. */}
          <p className="gallery-work-licence">
            Лицензия: {LICENCE_NAMES[work.license] ?? work.license}
          </p>

          {/* Из чего собрано. Половина смысла галереи — разобрать чужое. */}
          <section className="gallery-work-parts" aria-labelledby="gallery-parts-title">
            <h2 id="gallery-parts-title">Из чего собрано</h2>
            {parts.length === 0 ? (
              <p className="account-hint">
                Состав этой работы показать не получается — её среда хранит модель по-своему.
              </p>
            ) : (
              <ul>
                {parts.map((part) => (
                  <li key={part.kind}>
                    <span>{SHAPE_NAMES[part.kind] ?? part.kind}</span>
                    <strong>{part.count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
