import type pg from 'pg';
import type { CanonicalLearningProjection } from './learning-canonical-projection.service.js';
import { canonicalProjectionKey } from './learning-canonical-projection.service.js';

type WorkRow = {
  projectId: string;
  seatId: string;
  classroomAssignmentId: string;
  activityRunId: string | null;
  participationId: string | null;
  learningActivityVersionId: string | null;
  assignmentVersionId: string | null;
  runVersionId: string | null;
  versionNumber: number | null;
  contentDigest: string | null;
  sourceKind: 'direct' | 'course';
  courseRunId: string | null;
  courseLessonId: string | null;
  courseBlockId: string | null;
  title: string | null;
  brief: string | null;
  goal: string | null;
  moduleKey: string | null;
  sampleImage: string | null;
  dueAt: string | null;
  assignmentStatus: 'open' | 'closed';
  runStatus: string | null;
  courseStatus: string | null;
  classroomStatus: string;
  seatStatus: string;
  participationStatus: string | null;
  participationExcused: boolean | null;
  effectiveConditions: { values?: Record<string, unknown> } | null;
  submittedAt: string | null;
  snapshotRevision: number | null;
  updatedAt: string | null;
  attemptId: string | null;
  attemptNumber: number | null;
  submissionId: string | null;
  submittedProjectVersionId: string | null;
  classroomTitle: string;
  courseTitle: string | null;
  lessonTitle: string | null;
};

export type LearningWorkContext =
  | { state: 'not_learning' | 'denied' | 'unavailable'; projectId: string }
  | {
      state: 'ready';
      projectId: string;
      moduleKey: string;
      origin: {
        participationId: string | null;
        activityRunId: string | null;
        learningActivityVersionId: string;
        sourceKind: 'direct' | 'course';
        classroomAssignmentId: string;
        courseRunId: string | null;
        courseLessonId: string | null;
        courseBlockId: string | null;
      };
      task: {
        id: string;
        versionNumber: number;
        contentDigest: string;
        title: string;
        brief: string | null;
        goal: string | null;
        sampleImage: string | null;
        dueAt: string | null;
        status: 'open' | 'closed';
      };
      workflow: {
        canonicalState: CanonicalLearningProjection['surface'];
        attemptId: string | null;
        attemptNumber: number | null;
        submissionId: string | null;
        submittedProjectVersionId: string | null;
        submittedAt: string | null;
        snapshotRevision: number | null;
        updatedAt: string | null;
      };
      allowedActions: {
        edit: boolean;
        submit: boolean;
        resumeAfterChangesRequested: boolean;
        moveToLearningArchive: false;
        restoreFromLearningArchive: false;
        createPersonalCopy: false;
        changeGenericProjectStatus: false;
        publishOriginal: false;
      };
      presentation: {
        learnerCollectionState: 'working' | 'review' | 'completed';
        classroomTitle: string;
        courseTitle: string | null;
        lessonTitle: string | null;
      };
    };

function timeAllowsAction(row: WorkRow, asOf: string): boolean {
  if (row.assignmentStatus !== 'open' || row.classroomStatus !== 'active') return false;
  if (row.sourceKind === 'course' && row.courseStatus !== 'open') return false;
  if (row.activityRunId && (row.runStatus !== 'active' || row.participationStatus !== 'active'))
    return false;
  if (row.participationExcused) return false;
  const values = row.effectiveConditions?.values;
  if (!values) return !row.activityRunId;
  const now = Date.parse(asOf);
  const opens = typeof values['opensAt'] === 'string' ? Date.parse(values['opensAt']) : null;
  const due = typeof values['dueAt'] === 'string' ? Date.parse(values['dueAt']) : null;
  const closes = typeof values['closesAt'] === 'string' ? Date.parse(values['closesAt']) : null;
  if (opens !== null && (!Number.isFinite(opens) || now < opens)) return false;
  if (closes !== null && (!Number.isFinite(closes) || now > closes)) return false;
  if (
    due !== null &&
    (!Number.isFinite(due) || (now > due && values['latePolicy'] === 'block_at_due'))
  )
    return false;
  return true;
}

/** One authenticated project yields at most one provable Learning origin. */
export async function learningWorkContextForProject(
  pool: pg.Pool,
  viewerPrincipalId: string,
  projectId: string,
  projectModuleKey: string,
  projections: Map<string, CanonicalLearningProjection>,
  asOf = new Date().toISOString(),
): Promise<LearningWorkContext> {
  const result = await pool.query<{ context: WorkRow }>(
    'SELECT context FROM learning_work_context_for_project($1, $2)',
    [viewerPrincipalId, projectId],
  );
  if (result.rows.length === 0) {
    const exists = await pool.query<{ linked: boolean }>(
      'SELECT learning_work_project_origin_exists($1, $2) AS linked',
      [viewerPrincipalId, projectId],
    );
    return { state: exists.rows[0]?.linked ? 'denied' : 'not_learning', projectId };
  }
  if (result.rows.length !== 1) return { state: 'unavailable', projectId };
  const row = result.rows[0]!.context;
  const projection = projections.get(canonicalProjectionKey(row.seatId, row.classroomAssignmentId));
  if (
    row.projectId !== projectId ||
    !row.learningActivityVersionId ||
    !row.versionNumber ||
    !row.contentDigest ||
    !row.title ||
    !row.moduleKey ||
    row.moduleKey !== projectModuleKey ||
    (row.assignmentVersionId !== null &&
      row.assignmentVersionId !== row.learningActivityVersionId) ||
    (row.runVersionId !== null && row.runVersionId !== row.learningActivityVersionId) ||
    (row.sourceKind === 'course' && (!row.courseRunId || !row.courseLessonId)) ||
    (row.sourceKind === 'direct' && row.courseBlockId !== null) ||
    !projection ||
    projection.projectId !== projectId ||
    projection.state.provenance.activityRunId !== row.activityRunId ||
    projection.state.provenance.workflowAttemptId !== row.attemptId ||
    projection.state.provenance.conflicts.length > 0
  )
    return { state: 'unavailable', projectId };
  if (
    projection.state.visibility.learnerCurrentAccess !== 'visible' ||
    row.seatStatus !== 'active' ||
    row.classroomStatus !== 'active'
  ) {
    return { state: 'denied', projectId };
  }

  const canAct = timeAllowsAction(row, asOf);
  const workflow = projection.surface.workflowState;
  return {
    state: 'ready',
    projectId,
    moduleKey: row.moduleKey,
    origin: {
      participationId: row.participationId,
      activityRunId: row.activityRunId,
      learningActivityVersionId: row.learningActivityVersionId,
      sourceKind: row.sourceKind,
      classroomAssignmentId: row.classroomAssignmentId,
      courseRunId: row.courseRunId,
      courseLessonId: row.courseLessonId,
      courseBlockId: row.courseBlockId,
    },
    task: {
      id: row.learningActivityVersionId,
      versionNumber: row.versionNumber,
      contentDigest: row.contentDigest,
      title: row.title,
      brief: row.brief,
      goal: row.goal,
      sampleImage: row.sampleImage,
      dueAt:
        projection.surface.effectiveDueAt === undefined
          ? row.dueAt
          : projection.surface.effectiveDueAt,
      status: row.assignmentStatus,
    },
    workflow: {
      canonicalState: projection.surface,
      attemptId: row.attemptId,
      attemptNumber: row.attemptNumber,
      submissionId: row.submissionId,
      submittedProjectVersionId: row.submittedProjectVersionId,
      submittedAt: row.submittedAt,
      snapshotRevision: row.snapshotRevision,
      updatedAt: row.updatedAt,
    },
    allowedActions: {
      edit: canAct && workflow === 'in_progress',
      submit: canAct && workflow === 'in_progress',
      resumeAfterChangesRequested: canAct && workflow === 'changes_requested',
      moveToLearningArchive: false,
      restoreFromLearningArchive: false,
      createPersonalCopy: false,
      changeGenericProjectStatus: false,
      publishOriginal: false,
    },
    presentation: {
      learnerCollectionState:
        workflow === 'completed'
          ? 'completed'
          : workflow === 'submitted' || workflow === 'waiting_review'
            ? 'review'
            : 'working',
      classroomTitle: row.classroomTitle,
      courseTitle: row.courseTitle,
      lessonTitle: row.lessonTitle,
    },
  };
}
