import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { api, type SeatAssignment } from '../api';
import { AssignmentView } from './AssignmentView';
import './assignment-brief.css';
import { useConfirmedProjectRevision } from '../modules/project-save-evidence';
import { courseAssignmentShape } from './SeatCourses';
import {
  canonicalLearningLabel,
  canonicalSubmissionLocked,
} from '../learning/canonical-learning-presentation';
import {
  clampAssignmentBriefRect,
  defaultAssignmentBriefRect,
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

const OPEN_KEY = 'asa-assignment-brief-open-v2';
const RECT_KEY = 'asa-assignment-brief-rect-v2';
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
  return window.localStorage.getItem(openStorageKey(projectId)) !== 'closed';
}

function readRect(): AssignmentBriefRect {
  return parseAssignmentBriefRect(
    window.localStorage.getItem(RECT_KEY),
    window.innerWidth,
    window.innerHeight,
  );
}

export function AssignmentBrief({
  projectId,
  seatLearner,
}: {
  readonly projectId: string;
  readonly seatLearner: boolean;
}): JSX.Element | null {
  const [assignment, setAssignment] = useState<SeatAssignment | null>(null);
  const [open, setOpen] = useState(() => readOpen(projectId));
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [rect, setRect] = useState<AssignmentBriefRect>(readRect);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useConfirmedProjectRevision();
  const submissionRequest = useRef<{ revision: number; id: string } | null>(null);
  const operation = useRef<PointerOperation | null>(null);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  const load = useCallback(async () => {
    const [direct, courses] = await Promise.all([
      seatLearner ? api.seatAssignments() : api.attendedAssignments(),
      seatLearner ? api.seatCourseRuns() : api.accountCourseRuns(),
    ]);
    const items: SeatAssignment[] = direct.ok ? direct.data.items : [];
    if (courses.ok)
      for (const run of courses.data.items)
        for (const section of run.sections) {
          items.push(
            ...section.lessons
              .filter((lesson) => lesson.kind === 'assignment')
              .map((lesson) => courseAssignmentShape(run, lesson)),
          );
        }
    return items.find((item) => item.projectId === projectId) ?? null;
  }, [projectId, seatLearner]);

  useEffect(() => {
    setOpen(readOpen(projectId));
  }, [projectId]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = (): void => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const onResize = (): void => {
      if (window.matchMedia(MOBILE_QUERY).matches) return;
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
      window.localStorage.setItem(RECT_KEY, JSON.stringify(rectRef.current));
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
    // Resolve the same delivery through the authenticated Account or Seat reader.
    void load().then((result) => {
      if (cancelled) return;
      setAssignment(result);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (!assignment) return null;

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

  function resetPosition(): void {
    const next = defaultAssignmentBriefRect(window.innerWidth, window.innerHeight);
    rectRef.current = next;
    setRect(next);
    window.localStorage.setItem(RECT_KEY, JSON.stringify(next));
  }

  async function submit(): Promise<void> {
    if (!assignment || revision === null) return;
    setBusy(true);
    setError(null);
    if (assignment.canonicalState?.workflowState === 'changes_requested') {
      const started = await api.startSeatAssignment(assignment.id, projectId);
      setBusy(false);
      if (started.ok) setAssignment(await load());
      else setError(started.error.message);
      return;
    }
    if (submissionRequest.current?.revision !== revision)
      submissionRequest.current = { revision, id: crypto.randomUUID() };
    const result = await api.submitSeatAssignment(
      assignment.id,
      true,
      revision,
      submissionRequest.current.id,
    );
    setBusy(false);
    if (result.ok) {
      setAssignment((await load()) ?? { ...assignment, submittedAt: result.data.submittedAt });
      submissionRequest.current = null;
    } else setError(result.error.message);
  }

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
    <aside
      className={`assignment-brief${open ? ' is-open' : ''}${mobile ? ' is-mobile' : ''}`}
      data-testid="assignment-brief"
      style={floatingStyle}
    >
      <div className="assignment-brief-bar">
        {open && !mobile ? (
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
        <button
          type="button"
          className="assignment-brief-toggle"
          aria-expanded={open}
          onClick={toggle}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          Задание: {assignment.title}
        </button>
        {open ? (
          <span className="assignment-brief-state">
            {canonicalLearningLabel(assignment.canonicalState) ??
              (assignment.submittedAt ? 'Сдано' : 'В работе')}
          </span>
        ) : null}
        {open && !mobile ? (
          <button
            type="button"
            className="assignment-brief-reset"
            onClick={resetPosition}
            title="Вернуть карточку в исходное положение"
          >
            Сбросить
          </button>
        ) : null}
        {open ? (
          <button
            type="button"
            className="assignment-brief-submit"
            disabled={
              busy ||
              revision === null ||
              (assignment.canonicalState
                ? canonicalSubmissionLocked(assignment.canonicalState)
                : assignment.submittedAt !== null)
            }
            onClick={() => void submit()}
          >
            {assignment.canonicalState
              ? assignment.canonicalState.workflowState === 'changes_requested'
                ? 'Начать доработку'
                : canonicalSubmissionLocked(assignment.canonicalState)
                  ? 'Работа сдана'
                  : 'Сдать работу'
              : assignment.submittedAt
                ? 'Работа сдана'
                : 'Сдать работу'}
          </button>
        ) : null}
      </div>

      {open ? (
        <>
          <div className="assignment-brief-meta">
            {assignment.canonicalState && canonicalSubmissionLocked(assignment.canonicalState) ? (
              <small>
                Работа сдана. Изменения черновика не меняют закреплённую сдачу.
                {revision !== null
                  ? ` Черновик сохранён: редакция №${revision}.`
                  : ' Дождитесь сохранения изменений черновика.'}
              </small>
            ) : revision === null ? (
              <p role="status">Перед сдачей дождитесь сохранения проекта.</p>
            ) : (
              <small>К проверке будет закреплена сохранённая редакция №{revision}.</small>
            )}
            {error ? <p role="alert">{error}</p> : null}
          </div>

          <div className="assignment-brief-body">
            <p>
              {assignment.dueAt
                ? `Срок: ${new Date(assignment.dueAt).toLocaleString()}`
                : 'Без срока'}
            </p>
            <AssignmentView assignment={assignment} />
          </div>

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
        </>
      ) : null}
    </aside>
  );
}
