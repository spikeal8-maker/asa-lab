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
): Promise<
  | Awaited<ReturnType<typeof api.submitSeatAssignment>>
  | Awaited<ReturnType<typeof api.submitLearningProject>>
> {
  if (!assignment.projectId)
    return {
      ok: false,
      status: 409,
      error: { code: 'not_started', message: 'Сначала откройте задание.' },
    };
  const contextResult = await api.learningWorkContext(assignment.projectId);
  const ready =
    contextResult.ok && contextResult.data.state === 'ready' ? contextResult.data : null;
  const oldWithoutVersion =
    contextResult.ok &&
    (contextResult.data.state === 'unavailable' || contextResult.data.state === 'not_learning') &&
    contextResult.data.projectId === assignment.projectId;
  const exactAllowed =
    ready?.projectId === assignment.projectId &&
    ready.origin.classroomAssignmentId === assignment.id &&
    ready.origin.immutable === true &&
    ready.allowedActions.submit &&
    !!ready.origin.participationId &&
    !!ready.origin.activityRunId;
  const legacyAllowed =
    (assignment.legacySubmitAllowed === true && oldWithoutVersion) ||
    (ready?.projectId === assignment.projectId &&
      ready.origin.classroomAssignmentId === assignment.id &&
      ready.origin.immutable === false &&
      ready.allowedActions.submit);
  if (!exactAllowed && !legacyAllowed)
    return {
      ok: false,
      status: 409,
      error: { code: 'learning_work_unavailable', message: 'Нельзя подтвердить учебную работу.' },
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
  let request = requests.get(assignment.projectId);
  if (request?.revision !== revision) {
    request = { revision, id: crypto.randomUUID() };
    requests.set(assignment.projectId, request);
  }
  const result = exactAllowed
    ? await api.submitLearningProject(assignment.projectId, {
        clientRequestId: request.id,
        expectedRevision: revision,
      })
    : await api.submitSeatAssignment(assignment.id, true, revision, request.id, oldWithoutVersion);
  if (result.ok) requests.delete(assignment.projectId);
  return result;
}
