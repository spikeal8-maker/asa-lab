import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { CanonicalLearningProjection } from '../../apps/api/src/learning-canonical-projection.service';
import { ClassroomsController } from '../../apps/api/src/classrooms.controller';

const CLASSROOM_ID = '10000000-0000-4000-8000-000000000001';
const MODERN_ASSIGNMENT_ID = '20000000-0000-4000-8000-000000000001';
const LEGACY_ASSIGNMENT_ID = '20000000-0000-4000-8000-000000000002';
const RUN_ID = '30000000-0000-4000-8000-000000000001';

function projection(
  key: string,
  assignmentId: string,
  workflowState: 'not_applicable' | 'not_started' | 'in_progress' | 'submitted',
  activityRunId: string | null,
): CanonicalLearningProjection {
  return {
    key,
    state: { provenance: { classroomAssignmentId: assignmentId } },
    surface: { activityRunId, workflowState },
  } as unknown as CanonicalLearningProjection;
}
function assignmentRow(id: string, started: number, submitted: number) {
  return {
    id,
    assignment_id: id,
    title: id === MODERN_ASSIGNMENT_ID ? 'Modern' : 'Historical',
    brief: null,
    goal: null,
    module_key: 'electronics',
    due_at: null,
    status: 'open',
    created_at: '2026-09-30T00:00:00.000Z',
    demo_key: null,
    sample_image: null,
    seat_count: 2,
    started_count: started,
    submitted_count: submitted,
  };
}

const request = {
  cookies: { asa_session: 'session' },
} as unknown as FastifyRequest;

describe('classroom Direct assignment canonical counters', () => {
  it('does not count a Seat outside the named audience or old work as a current start', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_management_summary')) {
        return {
          rows: [
            {
              id: CLASSROOM_ID,
              title: 'Class',
              status: 'active',
              age_band: 'other',
              topic_keys: [],
              safe_mode_default: true,
              created_at: '2026-09-30T00:00:00.000Z',
              archived_at: null,
              join_code_version: null,
              join_code_status: null,
              student_count: 2,
              teacher_role: 'owner',
              workspace_kind: 'organization',
              workspace_title: 'School',
            },
          ],
        };
      }
      if (sql.includes('classroom_assignment_list')) {
        return { rows: [assignmentRow(MODERN_ASSIGNMENT_ID, 1, 1)] };
      }
      if (sql.includes('learning_direct_assignment_teacher_counts')) {
        return {
          rows: [
            {
              classroom_assignment_id: MODERN_ASSIGNMENT_ID,
              audience_type: 'named_learners',
              assigned_count: 1,
              started_count: 0,
              submitted_count: 0,
            },
          ],
        };
      }
      if (sql.includes('learning_direct_assignment_summary')) {
        return {
          rows: [
            {
              classroom_assignment_id: MODERN_ASSIGNMENT_ID,
              audience_type: 'named_learners',
              assigned_count: 1,
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const args = [
      {
        resolve: vi.fn(async () => ({
          accountId: 'account-id',
          principalId: 'principal-id',
          tenantId: 'tenant-id',
          schoolId: 'school-id',
          workspaceKind: 'organization',
          userId: 'user-id',
        })),
      },
      {
        capabilities: vi.fn(async () => [{ capability: 'educator', state: 'verified' }]),
      },
      {},
      {},
      { execute: vi.fn() },
      { query },
    ] as unknown as ConstructorParameters<typeof ClassroomsController>;
    const controller = new ClassroomsController(...args);
    const projections = new Map<string, CanonicalLearningProjection>([
      ['seat-a:modern', projection('seat-a:modern', MODERN_ASSIGNMENT_ID, 'submitted', RUN_ID)],
      [
        'seat-b:modern',
        projection('seat-b:modern', MODERN_ASSIGNMENT_ID, 'not_applicable', RUN_ID),
      ],
      ['seat-b:legacy', projection('seat-b:legacy', MODERN_ASSIGNMENT_ID, 'submitted', null)],
    ]);
    (
      controller as unknown as {
        canonical: () => {
          forTeacher: () => Promise<Map<string, CanonicalLearningProjection>>;
        };
      }
    ).canonical = () => ({
      forTeacher: vi.fn(async () => projections),
    });

    const result = await controller.listAssignments(request, CLASSROOM_ID);
    expect(result.items[0]).toMatchObject({
      assignedCount: 1,
      startedCount: 0,
      submittedCount: 0,
    });
  });

  it('uses exact-run counts and preserves historical legacy fallback', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_management_summary')) {
        return {
          rows: [
            {
              id: CLASSROOM_ID,
              title: 'Class',
              status: 'active',
              age_band: 'other',
              topic_keys: [],
              safe_mode_default: true,
              created_at: '2026-09-30T00:00:00.000Z',
              archived_at: null,
              join_code_version: null,
              join_code_status: null,
              student_count: 2,
              teacher_role: 'owner',
              workspace_kind: 'organization',
              workspace_title: 'School',
            },
          ],
        };
      }
      if (sql.includes('classroom_assignment_list')) {
        return {
          rows: [
            assignmentRow(MODERN_ASSIGNMENT_ID, 0, 0),
            assignmentRow(LEGACY_ASSIGNMENT_ID, 1, 1),
          ],
        };
      }
      if (sql.includes('learning_direct_assignment_teacher_counts')) {
        return {
          rows: [
            {
              classroom_assignment_id: MODERN_ASSIGNMENT_ID,
              audience_type: 'whole_class',
              assigned_count: 2,
              started_count: 1,
              submitted_count: 1,
            },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const args = [
      {
        resolve: vi.fn(async () => ({
          accountId: 'account-id',
          principalId: 'principal-id',
          tenantId: 'tenant-id',
          schoolId: 'school-id',
          workspaceKind: 'organization',
          userId: 'user-id',
        })),
      },
      {
        capabilities: vi.fn(async () => [{ capability: 'educator', state: 'verified' }]),
      },
      {},
      {},
      { execute: vi.fn() },
      { query },
    ] as unknown as ConstructorParameters<typeof ClassroomsController>;
    const controller = new ClassroomsController(...args);
    const projections = new Map<string, CanonicalLearningProjection>([
      ['seat-a:modern', projection('seat-a:modern', MODERN_ASSIGNMENT_ID, 'not_started', RUN_ID)],
      ['seat-b:modern', projection('seat-b:modern', MODERN_ASSIGNMENT_ID, 'submitted', RUN_ID)],
      ['seat-a:legacy', projection('seat-a:legacy', MODERN_ASSIGNMENT_ID, 'in_progress', null)],
    ]);
    (
      controller as unknown as {
        canonical: () => {
          forTeacher: () => Promise<Map<string, CanonicalLearningProjection>>;
        };
      }
    ).canonical = () => ({
      forTeacher: vi.fn(async () => projections),
    });

    const result = await controller.listAssignments(request, CLASSROOM_ID);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: MODERN_ASSIGNMENT_ID,
        assignedCount: 2,
        startedCount: 1,
        submittedCount: 1,
      }),
      expect.objectContaining({
        id: LEGACY_ASSIGNMENT_ID,
        startedCount: 1,
        submittedCount: 1,
      }),
    ]);
  });
});
