import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api, type ProjectFeedback } from '../api';
import {
  observationApi,
  type ObservationFreeProjectPreview,
  type ObservationProjectReview,
} from '../classroom-observation-api';
import {
  FreeProjectPreview,
  FrozenProjectPreview,
  type FrozenProject,
} from './ClassroomSubmittedProjectPreview';
import { ReviewDetail } from './ClassroomGradebook';
import { AssignmentView, type AssignmentViewData } from './AssignmentView';
import { useDialogFocus } from './settings-navigation';
import { useSchoolTime } from './school-time';
import './work-preview.css';

/**
 * A learner's work, looked at before it is opened.
 *
 * Marking thirty models by launching thirty editors is not marking, it is
 * waiting. Almost every decision a teacher makes about a piece of work — is it
 * finished, does it have the parts, is it worth a badge — can be made from the
 * picture the editor already saved. So the picture comes first, with the verdict
 * and the comment beside it, and the editor stays one click away for the times
 * the answer really is "let me fix this with them".
 */

type SavedWork =
  | { kind: 'none' | 'unavailable' }
  | { kind: 'free'; project: ObservationFreeProjectPreview }
  | { kind: 'ready'; target: ObservationProjectReview; submission: FrozenProject };

const BADGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'excellent', label: 'Отлично' },
  { value: 'good', label: 'Хорошо' },
  { value: 'progress', label: 'Есть прогресс' },
  { value: 'redo', label: 'Нужно доделать' },
];

export function WorkSnapshot({
  projectId,
  revision,
  refresh,
  alt,
  lazy = false,
  fallback,
  testId,
}: {
  readonly projectId: string;
  /** Undefined requests the latest protected snapshot; null means none is known to exist. */
  readonly revision?: number | null | undefined;
  /** Revalidate the current snapshot after an accepted classroom list refresh. */
  readonly refresh?: number | undefined;
  readonly alt: string;
  readonly lazy?: boolean;
  readonly fallback: ReactNode;
  readonly testId?: string;
}): JSX.Element {
  const latestQuery = refresh === undefined ? '' : `?refresh=${refresh}`;
  const source =
    revision === null
      ? null
      : `/api/projects/${encodeURIComponent(projectId)}/snapshot${revision === undefined ? latestQuery : `?rev=${revision}`}`;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!source || failedSource === source) return <>{fallback}</>;
  return (
    <img
      key={source}
      src={source}
      alt={alt}
      loading={lazy ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
      data-testid={testId}
      onError={() => setFailedSource(source)}
    />
  );
}

export function WorkPreview({
  projectId,
  snapshotRevision,
  snapshotRefresh,
  moduleKey,
  learnerName,
  workTitle,
  submittedAt,
  assignment,
  previewScope,
  readOnly = false,
  manageFocus = false,
  onClose,
  onOpenEditor,
  onReviewed,
  onGraded,
}: {
  readonly projectId: string;
  readonly moduleKey: string;
  readonly learnerName: string;
  /** Название самой работы: у ученика их несколько. */
  readonly workTitle?: string;
  readonly submittedAt: string | null;
  /**
   * Что было задано.
   *
   * Оценивать модель, не видя условия, преподаватель может только по памяти — а
   * через неделю после урока её уже нет. Поэтому задание открывается вместе с
   * работой, тем же видом, который читал ученик.
   */
  readonly assignment?: AssignmentViewData | null;
  readonly previewScope?:
    | ({ readonly classroomId: string; readonly seatId: string } & (
        { readonly kind: 'submission'; readonly canReview: boolean } | { readonly kind: 'free' }
      ))
    | undefined;
  readonly manageFocus?: boolean;
  readonly onClose: () => void;
  readonly onOpenEditor: () => void;
  readonly onReviewed?: () => Promise<void>;
} & (
  | {
      readonly readOnly: true;
      readonly snapshotRevision?: never;
      readonly snapshotRefresh: number;
      readonly onGraded?: never;
    }
  | {
      readonly readOnly: true;
      readonly snapshotRevision: number | null;
      readonly snapshotRefresh?: never;
      readonly onGraded?: never;
    }
  | {
      readonly readOnly?: false;
      readonly snapshotRevision: number | null;
      readonly snapshotRefresh?: never;
      readonly onGraded: () => void;
    }
)): JSX.Element {
  const [badge, setBadge] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  // Whether this work is already on the wall, so the button says the truth.
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [existing, setExisting] = useState<ProjectFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedWork, setSavedWork] = useState<SavedWork | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const reviewScope = previewScope?.kind === 'submission' ? previewScope : undefined;
  const previewClassroomId = previewScope?.classroomId;
  const previewSeatId = previewScope?.seatId;
  const isFree = previewScope?.kind === 'free';
  const showSavedWork = Boolean(reviewScope && savedWork?.kind !== 'none');
  const feedbackEnabled = !readOnly && !showSavedWork;
  const compactHeader = readOnly || showSavedWork || isFree;
  const time = useSchoolTime();
  const dialog = useRef<HTMLDivElement>(null);
  const reviewAction = useRef<HTMLButtonElement>(null);
  useDialogFocus(readOnly || manageFocus, dialog);

  useEffect(() => {
    if (!previewClassroomId || !previewSeatId) return;
    const request = new AbortController();
    void (async () => {
      if (isFree) {
        const result = await observationApi.freeProjectPreview(
          previewClassroomId,
          previewSeatId,
          projectId,
          request.signal,
        );
        if (request.signal.aborted) return;
        if (
          result.ok &&
          result.data?.projectId === projectId &&
          result.data.moduleKey === moduleKey &&
          Number.isSafeInteger(result.data.revision) &&
          result.data.revision > 0
        )
          setSavedWork({ kind: 'free', project: result.data });
        else setSavedWork({ kind: 'unavailable' });
        return;
      }
      const lookup = await observationApi.projectReview(
        previewClassroomId,
        previewSeatId,
        projectId,
        request.signal,
      );
      if (request.signal.aborted) return;
      if (!lookup.ok) {
        setSavedWork({ kind: lookup.status === 404 ? 'none' : 'unavailable' });
        return;
      }
      const submission = await api.exactLearningSubmission(
        previewClassroomId,
        lookup.data.attemptId,
      );
      if (request.signal.aborted) return;
      if (
        !submission.ok ||
        !submission.data ||
        !('projectVersionId' in submission.data) ||
        submission.data.submissionId !== lookup.data.submissionId ||
        submission.data.projectVersionId !== lookup.data.projectVersionId ||
        submission.data.moduleKey !== moduleKey
      ) {
        setSavedWork({ kind: 'unavailable' });
        return;
      }
      setSavedWork({ kind: 'ready', target: lookup.data, submission: submission.data });
    })();
    return () => request.abort();
  }, [isFree, moduleKey, previewClassroomId, previewSeatId, projectId]);

  useEffect(() => {
    if (!feedbackEnabled) return;
    void api.projectFeedback(projectId).then((result) => {
      if (!result.ok) return;
      const entry = result.data.items[0] ?? null;
      setExisting(entry);
      setBadge(entry?.badge ?? null);
      setComment(entry?.comment ?? '');
    });
    void api.galleryState(projectId).then((result) => {
      if (result.ok) setShared(result.data.published);
    });
  }, [projectId, feedbackEnabled]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !busy && !event.defaultPrevented && !document.fullscreenElement)
        onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!feedbackEnabled) return;
    if (badge === null && !comment.trim()) {
      setError('Поставьте значок или напишите комментарий.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.saveProjectFeedback(projectId, { badge, comment });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось сохранить отклик.');
      return;
    }
    setExisting(result.data.feedback);
    setSaved(true);
    onGraded?.();
  }

  const content = (
    <div className="modal-backdrop" role="presentation">
      <div
        ref={dialog}
        className={[
          'modal work-preview',
          readOnly ? 'work-preview-readonly' : '',
          showSavedWork || isFree ? 'work-preview-saved' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={compactHeader && workTitle ? `Работа: ${workTitle}` : `Работа: ${learnerName}`}
      >
        <header className="work-preview-head">
          <div>
            <h2>{compactHeader && workTitle ? workTitle : learnerName}</h2>
            {compactHeader ? (
              <p>{learnerName}</p>
            ) : (
              <p>
                {workTitle ? `${workTitle} · ` : ''}
                {submittedAt ? `Сдано ${time.dateTime(submittedAt)}` : 'Ещё не сдано'}
              </p>
            )}
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Закрыть
          </button>
        </header>

        {reviewing && reviewScope && savedWork?.kind === 'ready' ? (
          <ReviewDetail
            classroomId={reviewScope.classroomId}
            item={{
              assignmentId: savedWork.target.assignmentId,
              seatId: reviewScope.seatId,
              displayLabel: learnerName,
              assignmentTitle: workTitle ?? 'Задание',
            }}
            readOnly={!reviewScope.canReview || !savedWork.target.canReview}
            pinned={savedWork.target}
            onChanged={onReviewed}
            onClose={() => {
              setReviewing(false);
              requestAnimationFrame(() => reviewAction.current?.focus());
            }}
          />
        ) : (
          <div className="work-preview-body">
            <div className="work-preview-picture">
              {savedWork?.kind === 'free' ? (
                <div className="work-preview-exact">
                  <p>
                    <strong>Сохранённая версия</strong>
                  </p>
                  <FreeProjectPreview
                    project={savedWork.project}
                    snapshot={
                      <WorkSnapshot
                        projectId={projectId}
                        revision={savedWork.project.revision}
                        alt={`Снимок работы ученика ${learnerName}`}
                        testId="work-preview-image"
                        fallback={<p className="work-preview-empty">Снимок недоступен</p>}
                      />
                    }
                  />
                </div>
              ) : isFree && (savedWork?.kind !== 'unavailable' || !snapshotRevision) ? (
                <p role="status">
                  {savedWork?.kind === 'unavailable'
                    ? 'Предпросмотр сохранённой работы недоступен.'
                    : 'Загружаем сохранённую работу…'}
                </p>
              ) : showSavedWork ? (
                savedWork?.kind === 'ready' ? (
                  <div className="work-preview-exact">
                    <p>
                      <strong>Сданная версия</strong>
                    </p>
                    <FrozenProjectPreview submission={savedWork.submission} initiallyOpen />
                  </div>
                ) : (
                  <p role="status">
                    {savedWork?.kind === 'unavailable'
                      ? 'Не удалось открыть сохранённую сдачу.'
                      : 'Загружаем сохранённую сдачу…'}
                  </p>
                )
              ) : (
                <WorkSnapshot
                  projectId={projectId}
                  revision={snapshotRevision}
                  refresh={snapshotRefresh}
                  alt={`Работа ученика ${learnerName}`}
                  testId="work-preview-image"
                  fallback={
                    <p className="work-preview-empty" data-testid="work-preview-image">
                      {readOnly || snapshotRevision !== null
                        ? 'Снимок недоступен'
                        : 'Ученик открыл задание, но пока ничего не собрал.'}
                    </p>
                  }
                />
              )}
              <div className="work-preview-actions">
                <button type="button" className="btn-secondary" onClick={onOpenEditor}>
                  Открыть в редакторе
                </button>
                {savedWork?.kind === 'ready' &&
                reviewScope?.canReview &&
                savedWork.target.canReview ? (
                  <button
                    ref={reviewAction}
                    type="button"
                    className="btn-primary"
                    onClick={() => setReviewing(true)}
                  >
                    Оценить сдачу
                  </button>
                ) : null}
                {/* Sharing a child's work is a teacher's decision, never the
                child's: a ten-year-old should not be publishing their homework
                mid-lesson, and somebody should look at the picture before the
                rest of the platform does. */}
                {feedbackEnabled && snapshotRevision !== null ? (
                  <button
                    type="button"
                    className={shared ? 'assignment-remove' : 'btn-secondary'}
                    disabled={sharing}
                    onClick={async () => {
                      setSharing(true);
                      const result = shared
                        ? await api.unpublishFromGallery(projectId)
                        : await api.publishToGallery(projectId);
                      setSharing(false);
                      if (result.ok) setShared(!shared);
                    }}
                  >
                    {shared ? 'Убрать из галереи' : 'Поделиться в галерее'}
                  </button>
                ) : null}
              </div>
            </div>

            {assignment ? (
              <section className="work-preview-task" aria-label="Что было задано">
                <span className="work-preview-label">Задание: {assignment.title}</span>
                <AssignmentView assignment={assignment} compact />
              </section>
            ) : null}

            {feedbackEnabled ? (
              <form className="work-preview-form" onSubmit={(event) => void save(event)}>
                <span className="work-preview-label">Отклик на проект</span>
                <p>
                  Значок и комментарий не являются официальной оценкой. Учебная сдача проверяется в
                  журнале класса.
                </p>
                <div className="feedback-badges" role="group" aria-label="Значок">
                  {BADGES.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={badge === option.value ? 'active' : undefined}
                      aria-pressed={badge === option.value}
                      disabled={busy}
                      onClick={() => {
                        setBadge(badge === option.value ? null : option.value);
                        setSaved(false);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label htmlFor="work-preview-comment">Комментарий</label>
                <textarea
                  id="work-preview-comment"
                  rows={5}
                  maxLength={1000}
                  value={comment}
                  disabled={busy}
                  placeholder="Что получилось и что стоит поправить"
                  onChange={(event) => {
                    setComment(event.target.value);
                    setSaved(false);
                  }}
                />
                {error ? (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {saved ? (
                  <p className="notice-success" role="status">
                    Отклик сохранён — ученик увидит его у себя.
                  </p>
                ) : null}
                {existing && !saved ? (
                  <p className="work-preview-existing">
                    Отклик от {existing.author} · {time.date(existing.updatedAt)}
                  </p>
                ) : null}
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Сохраняем…' : existing ? 'Обновить отклик' : 'Сохранить отклик'}
                </button>
              </form>
            ) : null}
          </div>
        )}
        <span className="sr-only">{moduleKey}</span>
      </div>
    </div>
  );
  return readOnly ? createPortal(content, document.body) : content;
}
