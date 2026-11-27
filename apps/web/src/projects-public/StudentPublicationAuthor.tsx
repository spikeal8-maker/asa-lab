import { useEffect, useRef, useState } from 'react';
import { newClientId } from '../client-id';
import type { PublicationMetadata } from './api';
import { studentPublicationAuthorApi } from './student-publication-review-api';

const statusLabel = {
  waiting_teacher: 'Ожидает одобрения преподавателя класса.',
  waiting_platform: 'Преподаватель одобрил. Ожидает одобрения администратора.',
  approved: 'Оба одобрения получены. Можно опубликовать эту версию.',
  rejected: 'Заявка отклонена.',
  stale: 'Версия изменилась. Отправьте новую заявку.',
  published: 'Одобренная версия опубликована.',
} as const;

export function StudentPublicationAuthor({
  projectId,
  sourceRevision,
  metadata,
  publicationIsPublic,
  eligible,
  disabled,
  onBusyChange,
  onPublished,
}: {
  readonly projectId: string;
  readonly sourceRevision: number | null;
  readonly metadata: PublicationMetadata;
  readonly publicationIsPublic: boolean;
  readonly eligible: boolean;
  readonly disabled: boolean;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onPublished: () => Promise<void>;
}): JSX.Element {
  type State = Extract<
    Awaited<ReturnType<typeof studentPublicationAuthorApi.submit>>,
    { ok: true }
  >['data'];
  const [current, setCurrent] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const action = useRef<AbortController | null>(null);
  const retry = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoaded(false);
    setError(null);
    void studentPublicationAuthorApi.current(projectId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (
        result.ok &&
        result.data &&
        (result.data.request === null ||
          (result.data.request && Object.hasOwn(statusLabel, result.data.request.state)))
      ) {
        setCurrent(result.data.request);
        setLoaded(true);
      } else {
        setCurrent(null);
        setError('Не удалось проверить заявку. Обновите её статус.');
      }
    });
    return () => controller.abort();
  }, [projectId, refresh]);
  useEffect(() => () => action.current?.abort(), []);

  async function submit() {
    if (action.current || disabled || !canSubmit || sourceRevision === null) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    let published: boolean;
    try {
      const payload = JSON.stringify([sourceRevision, metadata]);
      if (retry.current?.payload !== payload) retry.current = { payload, key: newClientId() };
      const result =
        current?.state === 'approved'
          ? await studentPublicationAuthorApi.publish(
              projectId,
              current.requestId,
              controller.signal,
            )
          : await studentPublicationAuthorApi.submit(
              projectId,
              sourceRevision,
              metadata,
              retry.current.key,
              controller.signal,
            );
      if (controller.signal.aborted) return;
      if (!result.ok || !result.data || !Object.hasOwn(statusLabel, result.data.state)) {
        setError(
          !result.ok && result.error.message
            ? result.error.message
            : 'Не удалось подтвердить действие. Обновите статус и повторите.',
        );
        return;
      }
      setCurrent(result.data);
      retry.current = null;
      published = result.data.state === 'published';
    } finally {
      if (!controller.signal.aborted) {
        action.current = null;
        setBusy(false);
        onBusyChange(false);
      }
    }
    if (published) await onPublished();
  }

  const waiting = current?.state === 'waiting_teacher' || current?.state === 'waiting_platform';
  const approved = current?.state === 'approved';
  const canSubmit =
    eligible &&
    loaded &&
    sourceRevision !== null &&
    sourceRevision > 0 &&
    !waiting &&
    (approved || Boolean(metadata.title.trim()));
  return (
    <>
      <p>Заявка закрыта. Сначала работу проверяет преподаватель, затем администратор.</p>
      {loading ? <p role="status">Загружаем заявку…</p> : null}
      {!loading && current ? (
        <p role="status">
          {current.state === 'published' && !publicationIsPublic
            ? 'Эта версия ранее была опубликована.'
            : statusLabel[current.state]}
        </p>
      ) : null}
      {current && 'metadata' in current ? (
        <p className="publication-status">
          Версия {current.sourceRevision} · {current.metadata.title}
        </p>
      ) : null}
      {!eligible ? (
        <p>Для этого типа проекта пока нет просмотра для проверки.</p>
      ) : sourceRevision === null || sourceRevision < 1 ? (
        <p>Откройте проект и дождитесь сохранения работы и обложки.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="publication-panel-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={disabled || busy || loading || !canSubmit}
          onClick={() => void submit()}
        >
          {approved ? 'Опубликовать одобренную версию' : 'Отправить на одобрение'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={disabled || busy || loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Обновить статус заявки
        </button>
      </div>
    </>
  );
}
