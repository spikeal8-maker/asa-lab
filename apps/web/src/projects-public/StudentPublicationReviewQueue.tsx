import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectPreviewDialog } from '../modules/ProjectPlaybackStage';
import { StudentPublicationReviewArtifact } from './StudentPublicationReviewArtifact';
import {
  publicationQueuePath,
  studentPublicationReviewerApi,
  type PublicationReviewScope,
  type ReviewRequest,
} from './student-publication-review-api';
import './student-publication-review.css';

const pageSize = 50;
const maxOffset = 10000;
const moduleTitle: Partial<Record<string, string>> = {
  'three-d': '3D',
  electronics: 'Электроника',
  robotics: 'Робототехника',
  blocks: 'Scratch',
};

export function StudentPublicationReviewQueue({
  scope,
}: {
  readonly scope: PublicationReviewScope;
}): JSX.Element {
  const base = publicationQueuePath(scope);
  const stage = scope ? 'waiting_teacher' : 'waiting_platform';
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewRequest | null>(null);
  const summary = useRef<HTMLElement>(null);
  const focusAfterDecision = useRef(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void studentPublicationReviewerApi.list(base, offset, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (result.ok && Array.isArray(result.data?.items)) {
        setHasMore(result.data.items.length === pageSize && offset < maxOffset);
        setItems(result.data.items.filter((item) => item.state === stage && item.metadata?.title));
      } else {
        setItems([]);
        setHasMore(false);
        setError('Не удалось загрузить заявки. Повторите попытку.');
      }
    });
    return () => controller.abort();
  }, [base, offset, open, refresh, stage]);
  useEffect(() => {
    if (selected || !focusAfterDecision.current) return;
    focusAfterDecision.current = false;
    summary.current?.focus();
  }, [selected]);
  const close = useCallback(() => setSelected(null), []);
  return (
    <section className="student-publication-queue" aria-label="Заявки на публикацию">
      <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary ref={summary}>Заявки на публикацию</summary>
        {open ? (
          <div className="student-publication-queue-list" aria-busy={loading}>
            {loading ? <p role="status">Загружаем заявки…</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            {feedback ? <p role="status">{feedback}</p> : null}
            {!loading && !error && items.length === 0 ? <p>Заявок на проверку нет.</p> : null}
            <ul>
              {!loading &&
                items.map((item) => (
                  <li key={item.requestId}>
                    <span>
                      <strong>{item.metadata.title}</strong>
                      <small>
                        {moduleTitle[item.moduleKey] ?? 'Проект'} · Версия {item.sourceRevision}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setSelected(item)}
                    >
                      Проверить
                    </button>
                  </li>
                ))}
            </ul>
            <div className="student-publication-actions">
              {offset > 0 && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading}
                  onClick={() => setOffset((value) => value - pageSize)}
                >
                  Назад
                </button>
              )}
              {hasMore && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={loading}
                  onClick={() => setOffset((value) => value + pageSize)}
                >
                  Далее
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={loading}
                onClick={() => setRefresh((value) => value + 1)}
              >
                Обновить заявки
              </button>
            </div>
          </div>
        ) : null}
      </details>
      {selected && open ? (
        <ReviewDialog
          key={selected.requestId}
          base={base}
          scope={scope}
          request={selected}
          onClose={close}
          onDecision={(message) => {
            focusAfterDecision.current = true;
            close();
            setFeedback(message);
            setRefresh((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}

function ReviewDialog({
  base,
  scope,
  request,
  onClose,
  onDecision,
}: {
  readonly base: string;
  readonly scope: PublicationReviewScope;
  readonly request: ReviewRequest;
  readonly onClose: () => void;
  readonly onDecision: (message: string) => void;
}): JSX.Element {
  const [viewer, setViewer] = useState<'loading' | 'ready' | 'failed' | 'reload'>('loading');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = useRef<AbortController | null>(null);
  const ready = useCallback(() => setViewer('ready'), []);
  const unavailable = useCallback(() => setViewer('failed'), []);
  const reloadRequired = useCallback(() => setViewer('reload'), []);
  useEffect(() => () => action.current?.abort(), []);

  async function decide(approve: boolean) {
    if (viewer !== 'ready' || action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(true);
    setError(null);
    const result = await studentPublicationReviewerApi.decide(
      base,
      request.requestId,
      approve,
      controller.signal,
    );
    if (controller.signal.aborted) return;
    action.current = null;
    setBusy(false);
    const expected = approve
      ? request.state === 'waiting_teacher'
        ? 'waiting_platform'
        : 'approved'
      : 'rejected';
    if (
      !result.ok ||
      result.data?.requestId !== request.requestId ||
      (result.data.state !== expected && result.data.state !== 'stale')
    ) {
      setError('Не удалось сохранить решение. Проверьте, доступна ли заявка, и повторите.');
      return;
    }
    onDecision(
      result.data.state === 'stale'
        ? 'Версия изменилась. Ученик может подать новую заявку.'
        : approve
          ? 'Работа одобрена.'
          : 'Заявка отклонена.',
    );
  }

  return (
    <ProjectPreviewDialog
      title={request.metadata.title}
      label="Проверка публикации"
      byline={`Сохранённая версия ${request.sourceRevision}`}
      busy={busy}
      onClose={onClose}
    >
      <div className="student-publication-review-body">
        {request.metadata.description ? <p>{request.metadata.description}</p> : null}
        <p>{[request.metadata.license, ...request.metadata.tags].join(' · ')}</p>
        <StudentPublicationReviewArtifact
          key={retry}
          base={base}
          scope={scope}
          request={request}
          onReady={ready}
          onUnavailable={unavailable}
          onReloadRequired={reloadRequired}
        />
        {viewer === 'failed' ? (
          <div role="alert">
            Сохранённая работа недоступна. Для решения нужен просмотр работы.
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setViewer('loading');
                setRetry((value) => value + 1);
              }}
            >
              Повторить просмотр
            </button>
          </div>
        ) : null}
        {viewer === 'reload' ? (
          <div role="alert">
            Не удалось загрузить просмотрщик. Обновите страницу и снова откройте заявку.
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.location.reload()}
            >
              Обновить страницу
            </button>
          </div>
        ) : null}
        <details>
          <summary>Обложка автора</summary>
          <img
            loading="lazy"
            alt="Обложка заявки"
            src={studentPublicationReviewerApi.cover(base, request.requestId)}
          />
        </details>
        {error ? <p role="alert">{error}</p> : null}
        <div className="student-publication-actions">
          <button
            type="button"
            className="btn-primary"
            disabled={viewer !== 'ready' || busy}
            onClick={() => void decide(true)}
          >
            Одобрить
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={viewer !== 'ready' || busy}
            onClick={() => void decide(false)}
          >
            Отклонить
          </button>
        </div>
      </div>
    </ProjectPreviewDialog>
  );
}
