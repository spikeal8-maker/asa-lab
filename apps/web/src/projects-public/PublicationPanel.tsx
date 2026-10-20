import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalLink } from '../components/PortalLink';
import { useSchoolTime } from '../components/school-time';
import {
  publicationError,
  publicProjectsApi,
  type ProjectPublicationStatus,
  type PublicationMetadata,
} from './api';
import { publicationHref } from './presentation';
import { SharePublicationLink } from './SharePublicationLink';
import './public-projects.css';

export function PublicationPanel({
  projectId,
  metadata,
  disabled,
  onBusyChange,
}: {
  readonly projectId: string;
  readonly metadata: PublicationMetadata;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const [status, setStatus] = useState<ProjectPublicationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'publish' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const time = useSchoolTime();
  const reload = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    setNotice(null);
    setConfirmRevoke(false);
    const result = await publicProjectsApi.status(projectId);
    if (current !== request.current) return;
    setLoading(false);
    if (!result.ok) {
      setStatus(null);
      setError(publicationError(result, 'Не удалось проверить публикацию.'));
      return;
    }
    if (!result.data || typeof result.data.canPublish !== 'boolean') {
      setStatus(null);
      setError('Не удалось прочитать состояние публикации.');
      return;
    }
    setStatus(result.data);
  }, [projectId]);
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [reload]);

  async function change(operation: 'publish' | 'revoke'): Promise<void> {
    if (inFlight.current || disabled || loading) return;
    if (operation === 'publish' && !metadata.title.trim()) {
      setError('Введите название проекта перед публикацией.');
      return;
    }
    const current = ++request.current;
    inFlight.current = true;
    setBusy(operation);
    onBusyChange(true);
    setError(null);
    setNotice(null);
    const result =
      operation === 'publish'
        ? await publicProjectsApi.publish(projectId, metadata)
        : await publicProjectsApi.revoke(projectId);
    if (current !== request.current) return;
    inFlight.current = false;
    setBusy(null);
    onBusyChange(false);
    if (!result.ok) {
      setError(
        publicationError(
          result,
          operation === 'publish'
            ? 'Не удалось подтвердить публикацию. Проверьте состояние и повторите.'
            : 'Не удалось подтвердить снятие с публикации. Проверьте состояние и повторите.',
        ),
      );
      return;
    }
    if (!result.data || typeof result.data.canPublish !== 'boolean') {
      setError('Ответ сервера не удалось прочитать. Проверьте состояние публикации.');
      return;
    }
    setStatus(result.data);
    setConfirmRevoke(false);
    setNotice(
      operation === 'publish'
        ? 'Публикация сохранена. Её можно открыть в каталоге.'
        : 'Публикация снята. Личный проект сохранён.',
    );
  }

  const publication = status?.publication;
  const live = publication?.state === 'public';
  const publicAccess = live && Boolean(publication.publicPath);
  const blocked = disabled || busy !== null || loading;
  const reason =
    status?.reasonCode === 'preview_required'
      ? 'Для публикации нужно актуальное изображение. Откройте проект в редакторе, дождитесь сохранения и проверьте состояние снова.'
      : status?.reasonCode === 'learning_work_protected'
        ? 'Оригинальную учебную работу нельзя публиковать.'
        : status && !status.canPublish
          ? 'Публикация этой работы ограничена настройками доступа.'
          : null;

  return (
    <section
      className="publication-panel"
      aria-labelledby="publication-panel-title"
      data-testid="publication-panel"
    >
      <h3 id="publication-panel-title">Публикация</h3>
      {loading ? <p role="status">Проверяем состояние публикации…</p> : null}
      {status && !loading ? (
        <>
          <p
            className={`publication-status${publicAccess ? ' is-public' : ''}`}
            data-testid="publication-status"
          >
            {publicAccess
              ? 'Опубликовано'
              : live
                ? 'Публичный доступ ограничен'
                : publication?.state === 'revoked'
                  ? 'Снято с публикации'
                  : 'Не опубликовано'}
            {publication ? (
              <span>
                Версия проекта {publication.versionNo} · Публикация {publication.revisionNo}
              </span>
            ) : null}
          </p>
          {publicAccess && publication ? (
            <p className="publication-published-at">{time.dateTime(publication.publishedAt)}</p>
          ) : null}
          <p className="publication-help">
            Название, описание, теги и лицензия из этой формы попадут в публикацию вместе с
            сохранённой версией проекта. Изменения в редакторе станут публичными только после
            обновления публикации.
          </p>
          {reason ? (
            <p className="publication-permission" data-testid="publication-permission">
              {reason}
            </p>
          ) : null}
          <div className="publication-panel-actions">
            <button
              type="button"
              className="btn-primary"
              data-testid="publication-publish"
              disabled={blocked || !status.canPublish || !metadata.title.trim()}
              onClick={() => void change('publish')}
            >
              {busy === 'publish' ? 'Публикуем…' : live ? 'Обновить публикацию' : 'Опубликовать'}
            </button>
            {publicAccess && publication ? (
              <PortalLink
                className="btn-secondary"
                data-testid="publication-open"
                href={publicationHref(publication.publicationId)}
              >
                Открыть публикацию
              </PortalLink>
            ) : null}
            {live ? (
              <button
                type="button"
                className="btn-secondary publication-revoke"
                data-testid="publication-revoke"
                disabled={blocked}
                onClick={() => setConfirmRevoke(true)}
              >
                Снять с публикации
              </button>
            ) : null}
          </div>
          {publicAccess && publication ? (
            <SharePublicationLink
              key={publication.publicationId}
              publicationId={publication.publicationId}
            />
          ) : null}
        </>
      ) : null}
      {confirmRevoke ? (
        <div
          className="publication-revoke-prompt"
          role="group"
          aria-label="Подтверждение снятия с публикации"
        >
          <p>Публикация исчезнет из каталога, а публичная ссылка перестанет открываться.</p>
          <div className="publication-panel-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={blocked}
              onClick={() => setConfirmRevoke(false)}
            >
              Оставить публикацию
            </button>
            <button
              type="button"
              className="btn-primary"
              data-testid="publication-revoke-confirm"
              disabled={blocked}
              onClick={() => void change('revoke')}
            >
              {busy === 'revoke' ? 'Снимаем…' : 'Подтвердить снятие'}
            </button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="notice-error" data-testid="publication-error" role="alert">
          {error}
        </p>
      ) : null}
      {error || reason ? (
        <button
          type="button"
          className="btn-secondary publication-retry"
          disabled={blocked}
          onClick={() => void reload()}
        >
          Проверить состояние
        </button>
      ) : null}
    </section>
  );
}
