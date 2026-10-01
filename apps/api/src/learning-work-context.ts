import type pg from 'pg';
import type {
  CanonicalLearningProjection,
  EvidenceRow,
} from './learning-canonical-projection.service.js';
import {
  canonicalProjectionFromEvidence,
  canonicalProjectionKey,
} from './learning-canonical-projection.service.js';

export type WorkRow = {
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
  blocks: unknown[] | null;
  blocksSnapshotPresent: boolean;
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
  effectiveConditions: { values?: Record<string, unknown>; teacherUnlocked?: boolean } | null;
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
        immutable: boolean;
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
        blocks?: unknown[] | null | undefined;
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
        moveToLearningArchive: boolean;
        restoreFromLearningArchive: boolean;
        createPersonalCopy: false;
        changeGenericProjectStatus: false;
        publishOriginal: false;
      };
      presentation: {
        learnerCollectionState: 'working' | 'review' | 'completed' | 'learning_archive';
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
  if (due !== null) {
    if (!Number.isFinite(due)) return false;
    if (
      now > due &&
      values['latePolicy'] === 'block_at_due' &&
      row.effectiveConditions?.teacherUnlocked !== true
    )
      return false;
  }
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
  prefetchedOrigin?: readonly { context: WorkRow; evidence: EvidenceRow }[],
  includeSampleImage = true,
): Promise<LearningWorkContext> {
  const origin =
    prefetchedOrigin === undefined
      ? await pool.query<{ context: WorkRow; evidence: EvidenceRow }>(
          'SELECT context,evidence FROM learning_origin_work_context_for_project($1, $2)',
          [viewerPrincipalId, projectId],
        )
      : { rows: prefetchedOrigin };
  if (origin.rows.length > 1) return { state: 'unavailable', projectId };
  let row: WorkRow;
  let projection: CanonicalLearningProjection | undefined;
  let legacyReworkSupported = false;
  const immutableOrigin = origin.rows.length === 1;
  if (immutableOrigin) {
    row = origin.rows[0]!.context;
    try {
      projection = canonicalProjectionFromEvidence(origin.rows[0]!.evidence, projectId, asOf);
    } catch {
      return { state: 'unavailable', projectId };
    }
  } else {
    const canonical = await pool.query<{ linked: boolean }>(
      'SELECT learning_immutable_project_origin_exists($1, $2) AS linked',
      [viewerPrincipalId, projectId],
    );
    // An inaccessible or inconsistent immutable origin must never be treated
    // as a legacy handout work row for the same Project.
    if (canonical.rows[0]?.linked) return { state: 'denied', projectId };
    const legacy = await pool.query<{ context: WorkRow }>(
      'SELECT context FROM learning_work_context_for_project($1, $2)',
      [viewerPrincipalId, projectId],
    );
    if (legacy.rows.length > 1) return { state: 'unavailable', projectId };
    if (legacy.rows.length === 1) {
      row = legacy.rows[0]!.context;
      let readable: boolean;
      if (row.sourceKind === 'course' && row.activityRunId) {
        const proof = await pool.query<{
          proof: { modernCourseRun?: boolean; activityRunId?: string; projectReadable?: boolean };
        }>(`SELECT learning_course_modern_provenance($1,$2,$3,$4) AS proof`, [
          viewerPrincipalId,
          row.seatId,
          row.activityRunId,
          projectId,
        ]);
        readable =
          proof.rows[0]?.proof?.modernCourseRun === true &&
          proof.rows[0].proof.activityRunId === row.activityRunId &&
          proof.rows[0].proof.projectReadable === true;
      } else if (row.sourceKind === 'direct' && row.activityRunId) {
        const proof = await pool.query<{ readable: boolean }>(
          `SELECT learning_direct_modern_project_readable($1,$2,$3,$4,$5) AS readable`,
          [viewerPrincipalId, row.seatId, row.classroomAssignmentId, row.activityRunId, projectId],
        );
        readable = proof.rows[0]?.readable === true;
      } else {
        const proof = await pool.query<{
          proof: {
            legacyDirect?: boolean;
            legacyCourseLesson?: boolean;
            legacyProjectReadable?: boolean;
            submitAllowed?: boolean;
          };
        }>(`SELECT learning_legacy_direct_provenance($1,$2,$3,$4) AS proof`, [
          viewerPrincipalId,
          row.seatId,
          row.classroomAssignmentId,
          projectId,
        ]);
        readable =
          proof.rows[0]?.proof?.legacyProjectReadable === true &&
          (row.sourceKind === 'direct'
            ? proof.rows[0].proof.legacyDirect === true
            : row.sourceKind === 'course' && proof.rows[0].proof.legacyCourseLesson === true);
        legacyReworkSupported = readable && proof.rows[0]?.proof?.submitAllowed === true;
      }
      if (!readable) return { state: 'denied', projectId };
      projection = projections.get(canonicalProjectionKey(row.seatId, row.classroomAssignmentId));
    } else {
      const exists = await pool.query<{ linked: boolean }>(
        'SELECT learning_work_project_origin_exists($1, $2) AS linked',
        [viewerPrincipalId, projectId],
      );
      return { state: exists.rows[0]?.linked ? 'denied' : 'not_learning', projectId };
    }
  }
  const conflicts = projection?.state.provenance.conflicts ?? [];
  const expectedReturnedMismatch =
    !immutableOrigin &&
    projection?.surface.workflowState === 'changes_requested' &&
    projection.state.provenance.workflowAuthority === 'latest_attempt' &&
    row.attemptId !== null &&
    row.submissionId !== null &&
    row.submittedAt === null &&
    conflicts.length === 1 &&
    conflicts[0] === 'attempt_legacy_submission_mismatch';
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
    (conflicts.length > 0 && !expectedReturnedMismatch)
  )
    return { state: 'unavailable', projectId };
  if (
    projection.state.visibility.learnerCurrentAccess !== 'visible' ||
    row.seatStatus !== 'active' ||
    row.classroomStatus !== 'active'
  ) {
    return { state: 'denied', projectId };
  }

  let sampleImage = row.sampleImage;
  if (includeSampleImage && row.sourceKind === 'course' && row.courseBlockId && row.activityRunId) {
    const sample = await pool.query<{ sample_image: string | null }>(
      `SELECT learning_course_activity_sample_url_for_viewer($1, NULL, $2) AS sample_image`,
      [row.activityRunId, row.seatId],
    );
    sampleImage = sample.rows[0]?.sample_image ?? null;
  }

  const canAct = timeAllowsAction(row, asOf);
  const workflow = projection.surface.workflowState;
  let archiveBucket: 'active' | 'completed' | 'learning_archive' | null = null;
  if (immutableOrigin) {
    const archive = await pool.query<{ bucket: string | null }>(
      'SELECT learning_project_archive_bucket($1,$2) AS bucket',
      [viewerPrincipalId, projectId],
    );
    const bucket = archive.rows[0]?.bucket;
    if (bucket !== 'active' && bucket !== 'completed' && bucket !== 'learning_archive')
      return { state: 'unavailable', projectId };
    archiveBucket = bucket;
  }
  // A proven, already linked pre-origin Project needs no new Start. Its
  // compatibility Submit creates the next Attempt after changes_requested.
  const legacyRework = canAct && workflow === 'changes_requested' && legacyReworkSupported;
  return {
    state: 'ready',
    projectId,
    moduleKey: row.moduleKey,
    origin: {
      immutable: immutableOrigin,
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
      blocks: row.blocksSnapshotPresent ? row.blocks : undefined,
      sampleImage,
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
      edit: (canAct && workflow === 'in_progress') || legacyRework,
      submit: (canAct && workflow === 'in_progress') || legacyRework,
      resumeAfterChangesRequested:
        canAct && workflow === 'changes_requested' && (immutableOrigin || legacyReworkSupported),
      moveToLearningArchive: archiveBucket === 'completed',
      restoreFromLearningArchive: archiveBucket === 'learning_archive',
      createPersonalCopy: false,
      changeGenericProjectStatus: false,
      publishOriginal: false,
    },
    presentation: {
      learnerCollectionState:
        archiveBucket === 'learning_archive'
          ? 'learning_archive'
          : workflow === 'completed' || archiveBucket === 'completed'
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
