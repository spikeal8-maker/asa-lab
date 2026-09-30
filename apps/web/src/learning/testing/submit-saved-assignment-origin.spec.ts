// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type LearningWorkContext, type SeatAssignment } from '../../api';
import { submitSavedAssignment } from '../submit-saved-assignment';

const origin = {
  immutable: true,
  participationId: 'participation-one',
  activityRunId: 'run-one',
  learningActivityVersionId: 'version-one',
  sourceKind: 'course' as const,
  classroomAssignmentId: 'shared-handout',
  courseRunId: 'course-one',
  courseLessonId: 'lesson-one',
  courseBlockId: 'activity-one',
};

function assignment(projectId: string): SeatAssignment {
  return {
    id: 'shared-handout',
    title: 'Circuit',
    brief: null,
    goal: null,
    moduleKey: 'electronics',
    dueAt: null,
    status: 'open',
    sampleImage: null,
    projectId,
    submittedAt: null,
    snapshotRevision: 3,
    updatedAt: null,
    canonicalState: null,
  };
}

function ready(
  projectId: string,
  immutable: boolean,
): Extract<LearningWorkContext, { state: 'ready' }> {
  return {
    state: 'ready',
    projectId,
    moduleKey: 'electronics',
    origin: { ...origin, immutable },
    task: {
      id: 'version-one',
      versionNumber: 1,
      contentDigest: 'digest',
      title: 'Circuit',
      brief: null,
      goal: null,
      sampleImage: null,
      dueAt: null,
      status: 'open',
    },
    workflow: {
      canonicalState: {
        workflowState: 'in_progress',
        activityRunId: 'run-one',
        selectedResult: null,
        flags: [],
        learnerMessageCode: null,
      },
      attemptId: 'attempt-one',
      attemptNumber: 1,
      submissionId: null,
      submittedProjectVersionId: null,
      submittedAt: null,
      snapshotRevision: 3,
      updatedAt: null,
    },
    allowedActions: {
      edit: true,
      submit: true,
      resumeAfterChangesRequested: false,
      moveToLearningArchive: false,
      restoreFromLearningArchive: false,
      createPersonalCopy: false,
      changeGenericProjectStatus: false,
      publishOriginal: false,
    },
    presentation: {
      learnerCollectionState: 'working',
      classroomTitle: 'Class',
      courseTitle: 'Course',
      lessonTitle: 'Lesson',
    },
  };
}

function mockSavedProject(): void {
  vi.spyOn(api, 'openProject').mockResolvedValue({
    ok: true,
    status: 200,
    data: { draft: { revision: 3 } },
  } as Awaited<ReturnType<typeof api.openProject>>);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
}

afterEach(() => vi.restoreAllMocks());

describe('submit saved Learning work', () => {
  it('submits immutable project origin and keeps a retry key per Project', async () => {
    const context = vi.spyOn(api, 'learningWorkContext').mockImplementation(async (projectId) => ({
      ok: true,
      status: 200,
      data: ready(projectId, true),
    }));
    mockSavedProject();
    const exact = vi.spyOn(api, 'submitLearningProject').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'lost_response', message: 'Retry' },
    });
    const legacy = vi.spyOn(api, 'submitSeatAssignment');
    await submitSavedAssignment(assignment('project-one'));
    await submitSavedAssignment(assignment('project-one'));
    await submitSavedAssignment(assignment('project-two'));
    expect(context).toHaveBeenCalledTimes(3);
    expect(exact).toHaveBeenCalledTimes(3);
    expect(exact.mock.calls[0]?.[0]).toBe('project-one');
    expect(exact.mock.calls[0]?.[1]).toEqual({
      clientRequestId: expect.any(String),
      expectedRevision: 3,
    });
    expect(exact.mock.calls[1]?.[1].clientRequestId).toBe(exact.mock.calls[0]?.[1].clientRequestId);
    expect(exact.mock.calls[2]?.[1].clientRequestId).not.toBe(
      exact.mock.calls[0]?.[1].clientRequestId,
    );
    expect(legacy).not.toHaveBeenCalled();
  });

  it('uses old submit only when the server proves no immutable origin, even with legacy run IDs', async () => {
    vi.spyOn(api, 'learningWorkContext').mockResolvedValue({
      ok: true,
      status: 200,
      data: ready('legacy-project', false),
    });
    mockSavedProject();
    const exact = vi.spyOn(api, 'submitLearningProject');
    const legacy = vi.spyOn(api, 'submitSeatAssignment').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'lost_response', message: 'Retry' },
    });
    await submitSavedAssignment({
      ...assignment('legacy-project'),
      activityRunId: 'old-run',
      legacySubmitAllowed: true,
    });
    expect(exact).not.toHaveBeenCalled();
    expect(legacy).toHaveBeenCalledWith('shared-handout', true, 3, expect.any(String), false);
  });

  it('fails closed on denied origin and missing canonical participation', async () => {
    const read = vi.spyOn(api, 'learningWorkContext').mockResolvedValue({
      ok: true,
      status: 200,
      data: { state: 'denied', projectId: 'denied-project' },
    });
    const open = vi.spyOn(api, 'openProject');
    const exact = vi.spyOn(api, 'submitLearningProject');
    const legacy = vi.spyOn(api, 'submitSeatAssignment');
    expect(
      await submitSavedAssignment({
        ...assignment('denied-project'),
        legacySubmitAllowed: true,
      }),
    ).toMatchObject({ ok: false });
    read.mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...ready('incomplete-project', true), origin: { ...origin, participationId: null } },
    });
    expect(await submitSavedAssignment(assignment('incomplete-project'))).toMatchObject({
      ok: false,
    });
    read.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        ...ready('unproven-project', true),
        origin: { ...origin, immutable: undefined },
      } as unknown as LearningWorkContext,
    });
    expect(await submitSavedAssignment(assignment('unproven-project'))).toMatchObject({
      ok: false,
    });
    expect(open).not.toHaveBeenCalled();
    expect(exact).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('submits only server-proven historical work when no Learning Activity Version exists', async () => {
    vi.spyOn(api, 'learningWorkContext').mockImplementation(async (projectId) => ({
      ok: true,
      status: 200,
      data: { state: 'unavailable', projectId },
    }));
    mockSavedProject();
    const legacy = vi.spyOn(api, 'submitSeatAssignment').mockResolvedValue({
      ok: false,
      status: 503,
      error: { code: 'lost_response', message: 'Retry' },
    });
    const exact = vi.spyOn(api, 'submitLearningProject');
    expect(await submitSavedAssignment(assignment('unproven-old'))).toMatchObject({ ok: false });
    expect(legacy).not.toHaveBeenCalled();
    await submitSavedAssignment({
      ...assignment('proven-old'),
      activityRunId: 'old-run',
      legacySubmitAllowed: true,
    });
    expect(legacy).toHaveBeenCalledWith('shared-handout', true, 3, expect.any(String), true);
    expect(exact).not.toHaveBeenCalled();
  });
});
