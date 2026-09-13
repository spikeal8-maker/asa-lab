import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type SeatAssignment } from '../api';
import { AssignmentView } from './AssignmentView';
import './assignment-brief.css';
import { useConfirmedProjectRevision } from '../modules/project-save-evidence';
import { courseAssignmentShape } from './SeatCourses';
import {
  canonicalLearningLabel,
  canonicalSubmissionLocked,
} from '../learning/canonical-learning-presentation';

/**
 * What to make, while you are making it.
 *
 * A learner opened their assignment, landed in the editor, and the task was
 * gone — the picture and the list of required parts were on a page they had
 * just left. Going back to read "four windows, all the same size" and returning
 * to build it is not something a ten-year-old does twice; they build what they
 * remember, which is usually a house with three windows.
 *
 * So the brief travels with the work. It sits over the editor as a strip that
 * opens to the full task and the reference picture, and closes back to a line,
 * because the model needs the screen too. Which state it was left in is
 * remembered: a learner who folded it away is not asked again every time.
 */

const OPEN_KEY = 'asa-assignment-brief-open';

export function AssignmentBrief({
  projectId,
  seatLearner,
}: {
  readonly projectId: string;
  readonly seatLearner: boolean;
}): JSX.Element | null {
  const [assignment, setAssignment] = useState<SeatAssignment | null>(null);
  const [open, setOpen] = useState(() => window.localStorage.getItem(OPEN_KEY) !== 'closed');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useConfirmedProjectRevision();
  const submissionRequest = useRef<{ revision: number; id: string } | null>(null);
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
      window.localStorage.setItem(OPEN_KEY, current ? 'closed' : 'open');
      return !current;
    });
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

  return (
    <aside className={`assignment-brief${open ? ' is-open' : ''}`} data-testid="assignment-brief">
      <div className="assignment-brief-bar">
        <button
          type="button"
          className="assignment-brief-toggle"
          aria-expanded={open}
          onClick={toggle}
        >
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          Задание: {assignment.title}
        </button>
        <span className="assignment-brief-state">
          {canonicalLearningLabel(assignment.canonicalState) ??
            (assignment.submittedAt ? 'Сдано' : 'В работе')}
        </span>
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
      </div>
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

      {open ? (
        <div className="assignment-brief-body">
          <p>
            {assignment.dueAt
              ? `Срок: ${new Date(assignment.dueAt).toLocaleString()}`
              : 'Без срока'}
          </p>
          <AssignmentView assignment={assignment} />
        </div>
      ) : null}
    </aside>
  );
}
