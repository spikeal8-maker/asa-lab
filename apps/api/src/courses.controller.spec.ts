import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { CoursesController } from './courses.controller.js';

const COURSE_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECTION_ID = '123e4567-e89b-42d3-a456-426614174001';
const SECOND_SECTION_ID = '123e4567-e89b-42d3-a456-426614174002';
const LESSON_ID = '123e4567-e89b-42d3-a456-426614174003';
const ASSIGNMENT_ID = '123e4567-e89b-42d3-a456-426614174004';
const VERSION_ID = '123e4567-e89b-42d3-a456-426614174005';
const CLASSROOM_ID = '123e4567-e89b-42d3-a456-426614174006';
const RUN_ID = '123e4567-e89b-42d3-a456-426614174007';

function request(): FastifyRequest {
  return { cookies: { asa_session: 'session' } } as unknown as FastifyRequest;
}

function controller(rows: unknown[] = []) {
  const query = vi.fn(async () => ({ rows }));
  const activeContext = {
    resolve: vi.fn(async () => ({
      principalId: 'principal-id',
      accountId: 'account-id',
      tenantId: 'tenant-id',
    })),
  } as unknown as ActiveContextUseCase;
  const accounts = {
    capabilities: vi.fn(async () => [{ capability: 'educator', state: 'verified' }]),
  } as unknown as AccountDirectoryPort;
  const pool = { query } as unknown as pg.Pool;
  return { value: new CoursesController(activeContext, accounts, pool), query };
}

describe('course outline API', () => {
  it('returns compact course counters from the outline library query', async () => {
    const target = controller([
      {
        id: COURSE_ID,
        title: 'Основы электроники',
        summary: 'От схемы к устройству',
        visibility: 'private',
        age_band: '11-12',
        section_count: '3',
        lesson_count: '8',
        assignment_count: '4',
        shared_with: '0',
        copied_from_course_id: null,
        publication_state: 'published',
        published_version: '2',
        published_at: '2026-08-21T10:30:00.000Z',
        created_at: '2026-08-21T10:00:00.000Z',
        updated_at: '2026-08-21T11:00:00.000Z',
      },
    ]);

    await expect(target.value.list(request())).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: COURSE_ID,
          sectionCount: 3,
          lessonCount: 8,
          assignmentCount: 4,
          itemCount: 8,
          publicationState: 'published',
          publishedVersion: 2,
          publishedAt: '2026-08-21T10:30:00.000Z',
        }),
      ],
    });
    expect(target.query).toHaveBeenCalledWith(expect.stringContaining('course_library_list'), [
      'principal-id',
    ]);
  });

  it('publishes an immutable course version', async () => {
    const target = controller([
      {
        result_code: 'ok',
        version_id: VERSION_ID,
        version_number: '1',
        published_at: '2026-08-21T12:00:00.000Z',
        reused: false,
      },
    ]);

    await expect(target.value.publish(request(), COURSE_ID)).resolves.toEqual({
      versionId: VERSION_ID,
      versionNumber: 1,
      publishedAt: '2026-08-21T12:00:00.000Z',
      reused: false,
    });
    expect(target.query).toHaveBeenCalledWith(expect.stringContaining('course_publish'), [
      'principal-id',
      COURSE_ID,
    ]);
  });

  it('does not publish a course without lessons', async () => {
    const target = controller([
      {
        result_code: 'course_empty',
        version_id: null,
        version_number: null,
        published_at: null,
        reused: false,
      },
    ]);

    await expect(target.value.publish(request(), COURSE_ID)).rejects.toMatchObject({ status: 409 });
  });

  it('groups the frozen classroom course into sections and lessons', async () => {
    const target = controller([
      {
        run_id: RUN_ID,
        course_id: COURSE_ID,
        course_version_id: VERSION_ID,
        version_number: '2',
        run_title: 'Основы электроники',
        run_summary: 'Маршрут класса',
        due_at: '2026-09-01T12:00:00.000Z',
        run_status: 'open',
        published_at: '2026-08-21T12:00:00.000Z',
        started_count: '1',
        submitted_count: '0',
        lesson_id: LESSON_ID,
        source_lesson_id: LESSON_ID,
        section_title: 'Старт',
        section_summary: null,
        section_position: '1',
        lesson_title: 'Светодиод и резистор',
        lesson_summary: 'Первая схема',
        lesson_content: null,
        lesson_kind: 'assignment',
        estimated_minutes: '25',
        lesson_position: '1',
        classroom_assignment_id: ASSIGNMENT_ID,
        assignment_title: 'Светодиод и резистор',
        assignment_goal: 'Понять сопротивление',
        assignment_brief: 'Соберите безопасную цепь.',
        module_key: 'electronics',
        sample_image: null,
        seat_count: '3',
        lesson_started_count: '1',
        lesson_submitted_count: '0',
        lesson_completed_count: '0',
      },
    ]);

    await expect(target.value.classroomRuns(request(), CLASSROOM_ID)).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: RUN_ID,
          courseVersionId: VERSION_ID,
          versionNumber: 2,
          dueAt: '2026-09-01T12:00:00.000Z',
          sections: [
            expect.objectContaining({
              title: 'Старт',
              lessons: [
                expect.objectContaining({
                  id: LESSON_ID,
                  classroomAssignmentId: ASSIGNMENT_ID,
                  seatCount: 3,
                  startedCount: 1,
                  completedCount: 0,
                }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(target.query).toHaveBeenCalledWith(
      expect.stringContaining('classroom_course_runs_for_teacher'),
      ['account-id', CLASSROOM_ID],
    );
  });

  it('assigns the latest published version to a class', async () => {
    const target = controller([
      {
        result_code: 'ok',
        run_id: RUN_ID,
        version_number: '3',
        reused: false,
      },
    ]);

    await expect(
      target.value.assignCourseToClassroom(request(), CLASSROOM_ID, {
        courseId: COURSE_ID,
        dueAt: '2026-09-01T12:00:00.000Z',
      }),
    ).resolves.toEqual({ runId: RUN_ID, versionNumber: 3, reused: false });
    expect(target.query).toHaveBeenCalledWith(
      expect.stringContaining('classroom_course_run_assign'),
      ['principal-id', CLASSROOM_ID, COURSE_ID, '2026-09-01T12:00:00.000Z'],
    );
  });

  it('groups lessons by section and keeps an empty section visible', async () => {
    const target = controller([
      {
        section_id: SECTION_ID,
        section_title: 'Старт',
        section_summary: null,
        section_position: '1',
        lesson_id: LESSON_ID,
        lesson_title: 'Зачем нужен резистор',
        lesson_summary: 'Разбираем роль сопротивления',
        lesson_content: 'Короткое объяснение.',
        lesson_kind: 'assignment',
        lesson_assignment_id: ASSIGNMENT_ID,
        assignment_title: 'Светодиод и резистор',
        module_key: 'electronics',
        estimated_minutes: '20',
        lesson_position: '1',
      },
      {
        section_id: SECOND_SECTION_ID,
        section_title: 'Следующий шаг',
        section_summary: 'Пока без уроков',
        section_position: '2',
        lesson_id: null,
        lesson_title: null,
        lesson_summary: null,
        lesson_content: null,
        lesson_kind: null,
        lesson_assignment_id: null,
        assignment_title: null,
        module_key: null,
        estimated_minutes: null,
        lesson_position: null,
      },
    ]);

    const result = await target.value.outline(request(), COURSE_ID);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({
      id: SECTION_ID,
      position: 1,
      lessons: [
        expect.objectContaining({
          id: LESSON_ID,
          kind: 'assignment',
          assignmentId: ASSIGNMENT_ID,
          estimatedMinutes: 20,
        }),
      ],
    });
    expect(result.sections[1]).toMatchObject({ id: SECOND_SECTION_ID, lessons: [] });
    expect(target.query).toHaveBeenCalledWith(expect.stringContaining('course_outline'), [
      COURSE_ID,
      'principal-id',
      'account-id',
      'tenant-id',
    ]);
  });

  it('rejects an assignment link on a material lesson before querying the database', async () => {
    const target = controller();

    await expect(
      target.value.createLesson(request(), COURSE_ID, {
        sectionId: SECTION_ID,
        title: 'Введение',
        summary: null,
        content: 'Материал',
        kind: 'material',
        assignmentId: ASSIGNMENT_ID,
        estimatedMinutes: 10,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(target.query).not.toHaveBeenCalled();
  });

  it('saves an assignment lesson with its section and duration', async () => {
    const target = controller([{ id: LESSON_ID }]);

    await expect(
      target.value.createLesson(request(), COURSE_ID, {
        sectionId: SECTION_ID,
        title: 'Практика',
        summary: 'Соберите схему',
        content: null,
        kind: 'assignment',
        assignmentId: ASSIGNMENT_ID,
        estimatedMinutes: 25,
      }),
    ).resolves.toEqual({ id: LESSON_ID });
    expect(target.query).toHaveBeenCalledWith(expect.stringContaining('course_lesson_save'), [
      'principal-id',
      COURSE_ID,
      SECTION_ID,
      null,
      'Практика',
      'Соберите схему',
      null,
      'assignment',
      ASSIGNMENT_ID,
      25,
    ]);
  });
});
