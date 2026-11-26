import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import { ProjectPreviewDialog } from '../modules/ProjectPlaybackStage';
import { useSchoolTime } from './school-time';

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

type WorkPreviewProps = {
  readonly projectId: string;
  readonly moduleKey: string;
  readonly learnerName: string;
  /** Название самой работы: у ученика их несколько. */
  readonly workTitle?: string;
  readonly submittedAt: string | null;
  /** When opened from an assignment, its review must address this assignment only. */
  readonly expectedAssignmentId?: string;
  readonly allowGallerySharing?: boolean;
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
);

export function classroomWorkScope(
  moduleKey: string,
  classroomId: string,
  seatId: string,
  assigned: boolean,
  canReview: boolean,
): WorkPreviewProps['previewScope'] {
  if (assigned)
    return ['electronics', 'three-d'].includes(moduleKey)
      ? { kind: 'submission', classroomId, seatId, canReview }
      : undefined;
  return ['electronics', 'three-d', 'robotics'].includes(moduleKey)
    ? { kind: 'free', classroomId, seatId }
    : undefined;
}

export function WorkPreview(props: WorkPreviewProps): JSX.Element {
  const { projectId, moduleKey, previewScope, readOnly } = props;
  // Keep each viewer and its requests tied to the current class, pupil and work kind.
  const identity = [
    previewScope?.classroomId,
    previewScope?.seatId,
    projectId,
    moduleKey,
    previewScope?.kind,
    props.expectedAssignmentId,
    readOnly,
  ].join(':');
  return <WorkPreviewDialog key={identity} {...props} />;
}

function WorkPreviewDialog({
  projectId,
  snapshotRevision,
  snapshotRefresh,
  moduleKey,
  learnerName,
  workTitle,
  submittedAt,
  expectedAssignmentId,
  allowGallerySharing = false,
  assignment,
  previewScope,
  readOnly = false,
  onClose,
  onOpenEditor,
  onReviewed,
  onGraded,
}: WorkPreviewProps): JSX.Element {
  const [badge, setBadge] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  // Whether this work is already on the wall, so the button says the truth.
  const [shared, setShared] = useState<boolean | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [existing, setExisting] = useState<ProjectFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedWork, setSavedWork] = useState<SavedWork | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [panel, setPanel] = useState<'feedback' | 'assignment' | null>(null);
  const feedbackId = useId();
  const assignmentId = useId();
  const reviewScope = previewScope?.kind === 'submission' ? previewScope : undefined;
  const previewClassroomId = previewScope?.classroomId;
  const previewSeatId = previewScope?.seatId;
  const isFree = previewScope?.kind === 'free';
  const showSavedWork = Boolean(reviewScope && savedWork?.kind !== 'none');
  const feedbackEnabled = !readOnly && !showSavedWork;
  const galleryEnabled =
    allowGallerySharing &&
    feedbackEnabled &&
    !assignment &&
    !reviewScope &&
    snapshotRevision != null &&
    (!isFree || savedWork?.kind === 'free');
  const compactHeader = readOnly || showSavedWork || isFree;
  const time = useSchoolTime();
  const reviewAction = useRef<HTMLButtonElement>(null);

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
      if (expectedAssignmentId && lookup.data.assignmentId !== expectedAssignmentId) {
        setSavedWork({ kind: 'unavailable' });
        return;
      }
      const submission = await api.exactLearningSubmission(
        previewClassroomId,
        lookup.data.attemptId,
        request.signal,
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
  }, [expectedAssignmentId, isFree, moduleKey, previewClassroomId, previewSeatId, projectId]);

  useEffect(() => {
    if (!feedbackEnabled) return;
    void api.projectFeedback(projectId).then((result) => {
      if (!result.ok) return;
      const entry = result.data.items[0] ?? null;
      setExisting(entry);
      setBadge(entry?.badge ?? null);
      setComment(entry?.comment ?? '');
    });
  }, [projectId, feedbackEnabled]);

  useEffect(() => {
    if (!galleryEnabled) return;
    let active = true;
    void api.galleryState(projectId).then((result) => {
      if (active) setShared(result.ok ? result.data.published : null);
    });
    return () => {
      active = false;
    };
  }, [projectId, galleryEnabled]);

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

  return (
    <ProjectPreviewDialog
      title={workTitle || learnerName}
      label={compactHeader && workTitle ? `Работа: ${workTitle}` : `Работа: ${learnerName}`}
      busy={busy}
      onClose={onClose}
      byline={
        <>
          {workTitle && <span>{learnerName}</span>}
          {savedWork?.kind === 'ready' ? (
            <span>Сданная версия</span>
          ) : savedWork?.kind === 'free' ? (
            <span>Сохранённая версия</span>
          ) : submittedAt ? (
            <span>Сдано {time.dateTime(submittedAt)}</span>
          ) : !compactHeader ? (
            <span>Ещё не сдано</span>
          ) : null}
        </>
      }
    >
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
            {isFree && savedWork?.kind === 'free' ? (
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
            ) : isFree && (savedWork?.kind !== 'unavailable' || !snapshotRevision) ? (
              <p role="status">
                {savedWork?.kind === 'unavailable'
                  ? 'Предпросмотр сохранённой работы недоступен.'
                  : 'Загружаем сохранённую работу…'}
              </p>
            ) : showSavedWork ? (
              savedWork?.kind === 'ready' ? (
                <FrozenProjectPreview submission={savedWork.submission} initiallyOpen />
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
              {assignment && (
                <button
                  type="button"
                  className="btn-secondary"
                  aria-expanded={panel === 'assignment'}
                  aria-controls={assignmentId}
                  onClick={() => setPanel(panel === 'assignment' ? null : 'assignment')}
                >
                  Условие задания
                </button>
              )}
              {feedbackEnabled && (
                <button
                  type="button"
                  className="btn-secondary"
                  aria-expanded={panel === 'feedback'}
                  aria-controls={feedbackId}
                  onClick={() => setPanel(panel === 'feedback' ? null : 'feedback')}
                >
                  Отклик на проект
                </button>
              )}
              {galleryEnabled && shared !== null ? (
                <button
                  type="button"
                  className={shared ? 'assignment-remove' : 'btn-secondary'}
                  disabled={sharing}
                  onClick={async () => {
                    setSharing(true);
                    setGalleryError(null);
                    const result = shared
                      ? await api.unpublishFromGallery(projectId)
                      : await api.publishToGallery(projectId);
                    setSharing(false);
                    if (result.ok) setShared(!shared);
                    else setGalleryError(result.error.message);
                  }}
                >
                  {shared ? 'Убрать из галереи' : 'Поделиться в галерее'}
                </button>
              ) : null}
            </div>
            {galleryEnabled && galleryError && (
              <p className="form-error" role="alert">
                {galleryError}
              </p>
            )}
          </div>

          {assignment && panel === 'assignment' ? (
            <section id={assignmentId} className="work-preview-task" aria-label="Что было задано">
              <AssignmentView assignment={assignment} compact />
            </section>
          ) : null}

          {feedbackEnabled && panel === 'feedback' ? (
            <form
              id={feedbackId}
              aria-label="Отклик на проект"
              className="work-preview-form"
              onSubmit={(event) => void save(event)}
            >
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
                rows={3}
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
    </ProjectPreviewDialog>
  );
}
