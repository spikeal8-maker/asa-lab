import { api, type SeatAssignment } from '../api';

const requests = new Map<string, { revision: number; id: string }>();
export async function openAssignmentWork(
  assignment: SeatAssignment,
  onOpen: (id: string, module: string) => void,
): Promise<string | null> {
  if (!assignment.projectId) return 'Сначала начните задание.';
  // Reopening an existing draft is read-only. A changes-requested attempt is
  // resumed only by the explicit "Продолжить" action inside AssignmentBrief,
  // so the learner can first read the teacher's requested-revision state.
  onOpen(assignment.projectId, assignment.moduleKey);
  return null;
}
/** List surfaces explicitly confirm a persisted revision. Editors use their own
 * locally confirmed revision instead, and cannot silently submit another tab. */
export async function submitSavedAssignment(
  assignment: SeatAssignment,
): ReturnType<typeof api.submitSeatAssignment> {
  if (!assignment.projectId)
    return {
      ok: false,
      status: 409,
      error: { code: 'not_started', message: 'Сначала откройте задание.' },
    };
  const saved = await api.openProject(assignment.projectId);
  if (!saved.ok) return saved;
  const revision = saved.data.draft.revision;
  if (
    !window.confirm(
      'Сдать сохранённую редакцию №' +
        revision +
        ' работы «' +
        assignment.title +
        '»? Несохранённые изменения из другого окна не войдут в сдачу.',
    )
  ) {
    return {
      ok: false,
      status: 409,
      error: { code: 'submission_cancelled', message: 'Сдача отменена.' },
    };
  }
  let request = requests.get(assignment.id);
  if (request?.revision !== revision) {
    request = { revision, id: crypto.randomUUID() };
    requests.set(assignment.id, request);
  }
  const result = await api.submitSeatAssignment(assignment.id, true, revision, request.id);
  if (result.ok) requests.delete(assignment.id);
  return result;
}
