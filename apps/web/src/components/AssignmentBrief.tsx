import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { api, type LearningWorkContext, type SeatAssignment } from '../api';
import { AssignmentView } from './AssignmentView';
import { TaskImageReferenceWindow } from './TaskImageReferenceWindow';
import './assignment-brief.css';
import { useConfirmedProjectRevision } from '../modules/project-save-evidence';
import { AtomicLearningStarter } from '../learning/atomic-learning-start';
import {
  assignmentBriefResultText,
  assignmentBriefSubmitLabel,
  assignmentBriefWorkflowLabel,
} from './assignment-brief-presentation';
import {
  clampAssignmentBriefRect,
  defaultAssignmentBriefRect,
  expandedAssignmentBriefRect,
  moveAssignmentBriefRect,
  parseAssignmentBriefRect,
  resizeAssignmentBriefRect,
  type AssignmentBriefRect,
  type AssignmentBriefResizeEdge,
} from './assignment-brief-layout';

/**
 * What to make, while you are making it.
 *
 * This component belongs to Learning, not to any subject editor. ModuleEditorHost
 * mounts it above Electronics, 3D, Blocks, Chess, Checkers and future editors.
 * Subject editors keep owning the project surface; the assignment stays movable,
 * collapsible and independently responsive above them.
 */

const OPEN_KEY = 'asa-assignment-brief-open-v3';
const RECT_KEY = 'asa-assignment-brief-rect-v3';
const MOBILE_QUERY = '(max-width: 720px)';

const RESIZE_EDGES: readonly AssignmentBriefResizeEdge[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

type PointerOperation =
  | {
      readonly kind: 'move';
      readonly startX: number;
      readonly startY: number;
      readonly startRect: AssignmentBriefRect;
      readonly pointerId: number;
      readonly target: HTMLElement;
    }
  | {
      readonly kind: 'resize';
      readonly edge: AssignmentBriefResizeEdge;
      readonly startX: number;
      readonly startY: number;
      readonly startRect: AssignmentBriefRect;
      readonly pointerId: number;
      readonly target: HTMLElement;
    };

function openStorageKey(projectId: string): string {
  return `${OPEN_KEY}:${projectId}`;
}

function readOpen(projectId: string): boolean {
  return window.localStorage.getItem(openStorageKey(projectId)) === 'open';
}

function readRect(): AssignmentBriefRect {
  return parseAssignmentBriefRect(
    window.localStorage.getItem(RECT_KEY),
    window.innerWidth,
    window.innerHeight,
  );
}

function assignmentFromContext(
  context: Extract<LearningWorkContext, { state: 'ready' }>,
): SeatAssignment {
  return {
    id: context.origin.classroomAssignmentId,
    title: context.task.title,
    brief: context.task.brief,
    goal: context.task.goal,
    blocks: context.task.blocks,
    moduleKey: context.moduleKey,
    dueAt: context.task.dueAt,
    status: context.task.status,
    sampleImage: context.task.sampleImage,
    projectId: context.projectId,
    submittedAt: context.workflow.submittedAt,
    snapshotRevision: context.workflow.snapshotRevision,
    updatedAt: context.workflow.updatedAt,
    canonicalState: context.workflow.canonicalState,
  };
}

export function AssignmentBrief({ projectId }: { readonly projectId: string }): JSX.Element | null {
  const [context, setContext] = useState<LearningWorkContext | { state: 'resolving' }>({
    state: 'resolving',
  });
  const assignment = context.state === 'ready' ? assignmentFromContext(context) : null;
  const [referenceOwner, setReferenceOwner] = useState<{
    readonly projectId: string;
    readonly assignmentId: string;
  } | null>(null);
  const [open, setOpen] = useState(() => readOpen(projectId));
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [rect, setRect] = useState<AssignmentBriefRect>(readRect);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legacyResumed, setLegacyResumed] = useState(false);
  const revision = useConfirmedProjectRevision();
  const submissionRequest = useRef<{ revision: number; id: string } | null>(null);
  const starter = useRef(new AtomicLearningStarter());
  const operation = useRef<PointerOperation | null>(null);
  const rectRef = useRef(rect);
  const compactRectRef = useRef(rect);
  const expandedRef = useRef(expanded);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  rectRef.current = rect;
  expandedRef.current = expanded;

  const load = useCallback(async () => {
    const result = await api.learningWorkContext(projectId);
    if (result.ok) return result.data;
    return {
      state: result.status === 403 || result.status === 404 ? 'denied' : 'unavailable',
      projectId,
    } as LearningWorkContext;
  }, [projectId]);

  useEffect(() => {
    setOpen(readOpen(projectId));
    setReferenceOwner(null);
    setLegacyResumed(false);
    submissionRequest.current = null;
    const next = readRect();
    compactRectRef.current = next;
    rectRef.current = next;
    setRect(next);
    setExpanded(false);
  }, [projectId]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = (): void => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (mobile) setReferenceOwner(null);
  }, [mobile]);

  useEffect(() => {
    setReferenceOwner(null);
  }, [assignment?.id, projectId]);

  useEffect(() => {
    const onResize = (): void => {
      if (window.matchMedia(MOBILE_QUERY).matches) return;
      compactRectRef.current = clampAssignmentBriefRect(
        compactRectRef.current,
        window.innerWidth,
        window.innerHeight,
      );
      setRect((current) =>
        clampAssignmentBriefRect(current, window.innerWidth, window.innerHeight),
      );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      const current = operation.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const deltaX = event.clientX - current.startX;
      const deltaY = event.clientY - current.startY;
      const next =
        current.kind === 'move'
          ? moveAssignmentBriefRect(
              current.startRect,
              deltaX,
              deltaY,
              window.innerWidth,
              window.innerHeight,
            )
          : resizeAssignmentBriefRect(
              current.startRect,
              current.edge,
              deltaX,
              deltaY,
              window.innerWidth,
              window.innerHeight,
            );
      rectRef.current = next;
      setRect(next);
    };
    const finish = (event: PointerEvent): void => {
      const current = operation.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (current.target.hasPointerCapture(current.pointerId)) {
        current.target.releasePointerCapture(current.pointerId);
      }
      operation.current = null;
      if (!expandedRef.current) {
        compactRectRef.current = rectRef.current;
        window.localStorage.setItem(RECT_KEY, JSON.stringify(rectRef.current));
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setContext({ state: 'resolving' });
    void load().then((result) => {
      if (cancelled) return;
      setContext(result);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (context.state === 'not_learning') return null;
  if (context.state !== 'ready' || !assignment) {
    const message =
      context.state === 'resolving'
        ? 'Ищем учебное задание…'
        : context.state === 'denied'
          ? 'Эта учебная работа недоступна.'
          : 'Не удалось загрузить учебное задание.';
    return (
      <div
        className="assignment-brief-state-card"
        data-testid="learning-work-context-state"
        role="status"
      >
        <span>{message}</span>
        {context.state === 'unavailable' ? (
          <button
            type="button"
            onClick={() => {
              setContext({ state: 'resolving' });
              void load().then(setContext);
            }}
          >
            Повторить
          </button>
        ) : null}
      </div>
    );
  }

  function toggle(): void {
    setOpen((current) => {
      window.localStorage.setItem(openStorageKey(projectId), current ? 'closed' : 'open');
      return !current;
    });
  }

  function beginMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (mobile || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    operation.current = {
      kind: 'move',
      startX: event.clientX,
      startY: event.clientY,
      startRect: rectRef.current,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
  }

  function beginResize(
    edge: AssignmentBriefResizeEdge,
    event: ReactPointerEvent<HTMLSpanElement>,
  ): void {
    if (mobile || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    operation.current = {
      kind: 'resize',
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startRect: rectRef.current,
      pointerId: event.pointerId,
      target: event.currentTarget,
    };
  }

  function resetPanel(): void {
    const next = defaultAssignmentBriefRect(window.innerWidth, window.innerHeight);
    compactRectRef.current = next;
    rectRef.current = next;
    setRect(next);
    setExpanded(false);
    window.localStorage.setItem(RECT_KEY, JSON.stringify(next));
    if (menuRef.current) menuRef.current.open = false;
  }

  function toggleExpanded(): void {
    if (mobile) return;
    if (!expandedRef.current) {
      compactRectRef.current = rectRef.current;
      const next = expandedAssignmentBriefRect(
        rectRef.current,
        window.innerWidth,
        window.innerHeight,
      );
      rectRef.current = next;
      expandedRef.current = true;
      setRect(next);
      setExpanded(true);
      return;
    }

    const next = clampAssignmentBriefRect(
      compactRectRef.current,
      window.innerWidth,
      window.innerHeight,
    );
    rectRef.current = next;
    expandedRef.current = false;
    setRect(next);
    setExpanded(false);
    window.localStorage.setItem(RECT_KEY, JSON.stringify(next));
  }

  async function submit(): Promise<void> {
    if (!assignment || context.state !== 'ready' || revision === null) return;
    setBusy(true);
    setError(null);
    if (typeof context.origin.immutable !== 'boolean') {
      setBusy(false);
      setError('Нельзя подтвердить учебную работу.');
      return;
    }
    if (
      context.workflow.canonicalState.workflowState === 'changes_requested' &&
      (context.origin.immutable || !legacyResumed)
    ) {
      if (!context.allowedActions.resumeAfterChangesRequested) {
        setBusy(false);
        return;
      }
      const started = context.origin.immutable
        ? await starter.current.start(context.origin.activityRunId)
        : await api.startSeatAssignment(assignment.id, projectId);
      if (started === null) {
        setBusy(false);
        return;
      }
      setBusy(false);
      if (started.ok) {
        if (started.data.projectId !== projectId) {
          setError('Нельзя подтвердить учебную работу.');
          return;
        }
        const refreshed = await load();
        setContext(refreshed);
        if (!context.origin.immutable && refreshed.state === 'ready') setLegacyResumed(true);
      } else setError(started.error.message);
      return;
    }
    if (!context.allowedActions.submit) {
      setBusy(false);
      return;
    }
    if (submissionRequest.current?.revision !== revision)
      submissionRequest.current = { revision, id: crypto.randomUUID() };
    if (
      context.origin.immutable &&
      (!context.origin.participationId || !context.origin.activityRunId)
    ) {
      setBusy(false);
      setError('Нельзя подтвердить учебную работу.');
      return;
    }
    const result = context.origin.immutable
      ? await api.submitLearningProject(projectId, {
          clientRequestId: submissionRequest.current.id,
          expectedRevision: revision,
        })
      : await api.submitSeatAssignment(assignment.id, true, revision, submissionRequest.current.id);
    setBusy(false);
    if (result.ok) {
      setContext(await load());
      setLegacyResumed(false);
      submissionRequest.current = null;
    } else setError(result.error.message);
  }

  const workflowState =
    assignment.canonicalState?.workflowState ??
    (assignment.submittedAt ? 'submitted' : 'in_progress');
  const changesRequested = workflowState === 'changes_requested';
  const waitingReview = workflowState === 'submitted' || workflowState === 'waiting_review';
  const completed = workflowState === 'completed';
  const invalidated = workflowState === 'invalidated';
  const workflowLabel = assignmentBriefWorkflowLabel(
    assignment.canonicalState,
    assignment.submittedAt,
  );
  const anchorResult = assignmentBriefResultText(assignment.canonicalState, 'anchor');
  const panelResult = assignmentBriefResultText(assignment.canonicalState, 'panel');
  const floatingStyle: CSSProperties | undefined =
    open && !mobile
      ? {
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
        }
      : undefined;

  return (
    <>
      {open ? (
        <aside
          id="assignment-brief-panel"
          className={`assignment-brief-panel${mobile ? ' is-mobile' : ''}${expanded ? ' is-expanded' : ''}`}
          data-testid="assignment-brief"
          style={floatingStyle}
        >
          <header className="assignment-brief-header">
            {!mobile ? (
              <button
                type="button"
                className="assignment-brief-drag"
                aria-label="Переместить карточку задания"
                title="Переместить карточку задания"
                onPointerDown={beginMove}
              >
                ⠿
              </button>
            ) : null}
            <div className="assignment-brief-heading">
              <div className="assignment-brief-title">{assignment.title}</div>
              <span className="assignment-brief-state">{workflowLabel}</span>
            </div>
            {!mobile ? (
              <button
                type="button"
                className="assignment-brief-expand"
                aria-label={expanded ? 'Вернуть компактный размер' : 'Расширить задание'}
                aria-pressed={expanded}
                title={expanded ? 'Вернуть компактный размер' : 'Расширить задание'}
                onClick={toggleExpanded}
              >
                {expanded ? '↙' : '↗'}
              </button>
            ) : null}
            <details ref={menuRef} className="assignment-brief-menu">
              <summary aria-label="Другие действия" title="Другие действия">
                ⋯
              </summary>
              <div className="assignment-brief-menu-popover">
                <button type="button" onClick={resetPanel}>
                  Сбросить положение и размер
                </button>
              </div>
            </details>
          </header>

          <div className="assignment-brief-body">
            {assignment.dueAt ? (
              <p className="assignment-brief-due">
                Срок: {new Date(assignment.dueAt).toLocaleString()}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="assignment-brief-error">
                {error}
              </p>
            ) : null}
            <AssignmentView
              assignment={assignment}
              compact
              sampleAction={
                !mobile && assignment.sampleImage ? (
                  <button
                    type="button"
                    className="assignment-brief-reference-open"
                    onClick={() => setReferenceOwner({ projectId, assignmentId: assignment.id })}
                  >
                    Открыть отдельно
                  </button>
                ) : undefined
              }
            />
          </div>

          <footer className="assignment-brief-footer">
            {completed ? (
              <>
                <span className="assignment-brief-footer-state">Выполнено</span>
                {panelResult ? (
                  <strong className="assignment-brief-result">{panelResult}</strong>
                ) : null}
              </>
            ) : waitingReview ? (
              <span className="assignment-brief-footer-state">На проверке</span>
            ) : invalidated ? (
              <span className="assignment-brief-footer-state">Попытка отменена</span>
            ) : changesRequested ? (
              <>
                <span className="assignment-brief-footer-state">Нужна доработка</span>
                <button
                  type="button"
                  className="assignment-brief-submit"
                  disabled={
                    busy ||
                    revision === null ||
                    !(legacyResumed && !context.origin.immutable
                      ? context.allowedActions.submit
                      : context.allowedActions.resumeAfterChangesRequested)
                  }
                  onClick={() => void submit()}
                >
                  {busy
                    ? legacyResumed && !context.origin.immutable
                      ? 'Отправляем…'
                      : 'Открываем…'
                    : legacyResumed && !context.origin.immutable
                      ? 'Сдать доработку'
                      : 'Продолжить'}
                </button>
              </>
            ) : (
              <>
                <span className="assignment-brief-save-state">
                  {revision === null ? 'Сохраняем…' : 'Сохранено'}
                </span>
                <button
                  type="button"
                  className="assignment-brief-submit"
                  disabled={busy || revision === null || !context.allowedActions.submit}
                  onClick={() => void submit()}
                >
                  {busy ? 'Отправляем…' : assignmentBriefSubmitLabel(assignment.canonicalState)}
                </button>
              </>
            )}
          </footer>

          {!mobile
            ? RESIZE_EDGES.map((edge) => (
                <span
                  key={edge}
                  className={`assignment-brief-resize assignment-brief-resize-${edge}`}
                  aria-hidden="true"
                  onPointerDown={(event) => beginResize(edge, event)}
                />
              ))
            : null}
        </aside>
      ) : null}

      {!mobile &&
      assignment.sampleImage &&
      referenceOwner?.projectId === projectId &&
      referenceOwner.assignmentId === assignment.id ? (
        <TaskImageReferenceWindow
          src={assignment.sampleImage}
          assignmentTitle={assignment.title}
          onClose={() => setReferenceOwner(null)}
        />
      ) : null}

      <button
        type="button"
        className="assignment-brief-anchor"
        data-testid="assignment-brief-anchor"
        aria-controls="assignment-brief-panel"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="assignment-brief-anchor-icon" aria-hidden="true">
          ▣
        </span>
        <span className="assignment-brief-anchor-label">Задание</span>
        {anchorResult ? (
          <span className="assignment-brief-anchor-result">· {anchorResult}</span>
        ) : null}
        <span className="assignment-brief-anchor-chevron" aria-hidden="true">
          {open ? '⌄' : '⌃'}
        </span>
      </button>
    </>
  );
}
