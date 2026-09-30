import { api, type ApiResult, type SeatAssignment } from '../api';

/** Compatibility only for a server-proven old Direct handout. The write route
 * repeats the proof, so a stale list cannot attach a Project after a run opens. */
export async function startLegacyDirectAssignment(
  assignment: SeatAssignment,
): Promise<ApiResult<{ projectId: string }>> {
  if (assignment.activityRunId || assignment.legacyStartAllowed !== true || assignment.projectId)
    return {
      ok: false,
      status: 409,
      error: { code: 'legacy_start_unavailable', message: 'Эта практика пока недоступна.' },
    };
  const created = await api.createProject({
    scope: 'personal',
    module: assignment.moduleKey,
    title: assignment.title,
    idempotencyKey: assignment.id,
  });
  if (!created.ok) return created;
  const started = await api.startSeatAssignment(assignment.id, created.data.project.id, true);
  if (!started.ok) return started;
  return { ok: true, status: started.status, data: { projectId: started.data.projectId } };
}
