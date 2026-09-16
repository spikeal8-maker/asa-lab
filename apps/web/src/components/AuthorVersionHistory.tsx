import { useEffect, useRef, useState } from 'react';
import { api, type PublishedAuthorVersion } from '../api';
import { LessonBlocks } from './LessonBlocks';
import { courseVersionStructuralDiff } from './course-version-diff';

/** Author-only history; the server owns source selection and conflict checks. */
export function AuthorVersionHistory({
  kind,
  rootId,
  revision,
  dirty = false,
  onOpenDraft,
  onBusyChange,
}: {
  kind: 'course' | 'activity';
  rootId: string;
  revision: number;
  dirty?: boolean;
  onOpenDraft: (sourceVersionNumber?: number) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<PublishedAuthorVersion[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [compareId, setCompareId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    let live = true;
    setItems([]);
    setSelected('');
    setCompareId('');
    setMessage(null);
    setConflict(false);
    void api.authorVersions(kind, rootId).then((result) => {
      if (!live) return;
      if (result.ok) setItems(result.data.items);
      else setMessage(result.error.message);
    });
    return () => {
      live = false;
      generation.current += 1;
    };
  }, [kind, rootId, revision]);
  const version = items.find((entry) => entry.id === selected);
  const comparison = items.find((entry) => entry.id === compareId);
  const structuralDiff =
    kind === 'course' && version && comparison
      ? courseVersionStructuralDiff(comparison, version)
      : [];
  async function create() {
    if (!version || busy || dirty) return;
    setBusy(true);
    onBusyChange(true);
    const current = generation.current;
    setMessage(null);
    const result = await api.draftFromPublishedVersion(kind, rootId, version.id, revision);
    if (current !== generation.current) {
      setBusy(false);
      onBusyChange(false);
      return;
    }
    if (result.ok) {
      await onOpenDraft(result.data.sourceVersionNumber);
      setSelected('');
    } else {
      setConflict(result.error.code === 'draft_exists');
      setMessage(result.error.message);
    }
    setBusy(false);
    onBusyChange(false);
  }
  return (
    <section aria-label="Опубликованные версии" data-testid="author-version-history">
      <label>
        Опубликованная версия
        <select
          aria-label="Опубликованная версия"
          value={selected}
          disabled={busy}
          onChange={(event) => {
            const nextId = event.target.value;
            setSelected(nextId);
            if (kind === 'course') {
              const nextVersion = items.find((entry) => entry.id === nextId);
              const previous = nextVersion
                ? items
                    .filter((entry) => entry.versionNumber < nextVersion.versionNumber)
                    .sort((a, b) => b.versionNumber - a.versionNumber)[0]
                : undefined;
              setCompareId(previous?.id ?? '');
            }
            setMessage(null);
            setConflict(false);
          }}
        >
          <option value="">Выберите версию</option>
          {items.map((entry) => (
            <option key={entry.id} value={entry.id}>
              Версия {entry.versionNumber}
            </option>
          ))}
        </select>
      </label>
      {version ? (
        <article aria-label={'Опубликованная версия ' + version.versionNumber}>
          <h3>{version.outline?.course.title ?? version.title}</h3>
          <p>{version.outline?.course.summary ?? version.instructions}</p>
          {kind === 'course' && items.length > 1 ? (
            <div className="author-version-diff" data-testid="author-version-diff">
              <label>
                Сравнить с
                <select
                  aria-label="Сравнить с версией"
                  value={compareId}
                  onChange={(event) => setCompareId(event.target.value)}
                >
                  <option value="">Выберите версию</option>
                  {items
                    .filter((entry) => entry.id !== version.id)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        Версия {entry.versionNumber}
                      </option>
                    ))}
                </select>
              </label>
              {comparison ? (
                <p data-testid="version-structural-diff">
                  {structuralDiff.length > 0
                    ? 'Изменено: ' + structuralDiff.join(', ')
                    : 'Структурных изменений нет.'}
                </p>
              ) : null}
            </div>
          ) : null}
          {version.outline?.sections.map((section) => (
            <section key={section.sourceSectionId}>
              <h4>{section.title}</h4>
              <p>{section.summary}</p>
              {section.lessons.map((lesson) => (
                <div key={lesson.sourceLessonId}>
                  <h5>{lesson.title}</h5>
                  <LessonBlocks blocks={lesson.blocks ?? []} legacyContent={lesson.content} />
                </div>
              ))}
            </section>
          ))}
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || dirty}
            onClick={() => void create()}
          >
            Создать черновик из этой версии
          </button>
          {dirty ? <p>Сначала сохраните изменения в редакторе.</p> : null}
        </article>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
      {conflict ? (
        <button
          type="button"
          disabled={busy || dirty}
          onClick={async () => {
            setBusy(true);
            onBusyChange(true);
            await onOpenDraft();
            setMessage(null);
            setConflict(false);
            setSelected('');
            setBusy(false);
            onBusyChange(false);
          }}
        >
          Открыть существующий черновик
        </button>
      ) : null}
    </section>
  );
}
