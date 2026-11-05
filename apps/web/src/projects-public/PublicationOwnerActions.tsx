import { useEffect, useRef, useState } from 'react';
import { api, type Project } from '../api';
import { PortalLink } from '../components/PortalLink';
import { ProjectProperties } from '../components/ProjectProperties';
import { creatorViewToHref } from '../creator-portal/navigation';
import { publicProjectsApi } from './api';

export function PublicationOwnerActions({
  publicationId,
  onUpdated,
}: {
  readonly publicationId: string;
  readonly onUpdated: () => void;
}) {
  const [editor, setEditor] = useState<{ projectId: string; moduleKey: string } | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState(false);
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setEditor(null);
    setLookupError(false);
    void publicProjectsApi
      .editor(publicationId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) setEditor(result.data.editor);
        else if (result.status >= 500) setLookupError(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLookupError(true);
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [publicationId, retry]);
  if (!editor)
    return lookupError ? (
      <button type="button" className="btn-secondary" onClick={() => setRetry((n) => n + 1)}>
        Повторить проверку доступа
      </button>
    ) : null;
  const close = () => {
    setProject(null);
    onUpdated();
  };
  return (
    <div className="publication-owner-actions">
      <PortalLink
        className="btn-secondary"
        href={creatorViewToHref({
          kind: 'editor',
          projectId: editor.projectId,
          moduleKey: editor.moduleKey,
          returnTo: { kind: 'my-projects' },
        })}
      >
        Редактировать
      </PortalLink>
      <button
        className="btn-secondary"
        type="button"
        disabled={busy}
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setError(null);
          try {
            const result = await api.openProject(editor.projectId);
            if (!alive.current) return;
            if (result.ok) setProject(result.data.project);
            else setError('Не удалось открыть настройки публикации. Повторите.');
          } catch {
            if (alive.current) setError('Не удалось открыть настройки публикации. Повторите.');
          } finally {
            if (alive.current) setBusy(false);
          }
        }}
      >
        Публикация
      </button>
      {error ? <span role="alert">{error}</span> : null}
      {project ? (
        <ProjectProperties
          project={project}
          initialSection="publication"
          onClose={close}
          onSaved={close}
        />
      ) : null}
    </div>
  );
}
