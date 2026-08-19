import { useEffect, useState } from 'react';
import { api, type SeatAssignment } from '../api';
import { AssignmentView } from './AssignmentView';
import './assignment-brief.css';

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

export function AssignmentBrief({ projectId }: { readonly projectId: string }): JSX.Element | null {
  const [assignment, setAssignment] = useState<SeatAssignment | null>(null);
  const [open, setOpen] = useState(() => window.localStorage.getItem(OPEN_KEY) !== 'closed');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Only a class seat can have work set for them, and the seat endpoint is the
    // one that knows which project belongs to which task. For anybody else this
    // answers 401 and the strip never appears.
    void api.seatAssignments().then((result) => {
      if (cancelled || !result.ok) return;
      setAssignment(result.data.items.find((entry) => entry.projectId === projectId) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!assignment) return null;

  function toggle(): void {
    setOpen((current) => {
      window.localStorage.setItem(OPEN_KEY, current ? 'closed' : 'open');
      return !current;
    });
  }

  async function submit(): Promise<void> {
    if (!assignment) return;
    setBusy(true);
    const result = await api.submitSeatAssignment(assignment.id, assignment.submittedAt === null);
    setBusy(false);
    if (result.ok) {
      setAssignment({ ...assignment, submittedAt: result.data.submittedAt });
    }
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
          {assignment.submittedAt ? 'Сдано' : 'В работе'}
        </span>
        <button
          type="button"
          className="assignment-brief-submit"
          disabled={busy}
          onClick={() => void submit()}
        >
          {assignment.submittedAt ? 'Вернуть в работу' : 'Сдать работу'}
        </button>
      </div>

      {open ? (
        <div className="assignment-brief-body">
          <AssignmentView assignment={assignment} />
        </div>
      ) : null}
    </aside>
  );
}
