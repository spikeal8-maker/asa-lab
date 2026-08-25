import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import {
  LearningCanonicalProjectionService,
  type CanonicalLearningProjection,
} from './learning-canonical-projection.service.js';

/**
 * Курсы и общий каталог.
 *
 * Задание — единица работы, курс — единица преподавания: «Электроника, первый
 * год» это не двадцать разрозненных заданий, а порядок, в котором их проходят.
 * Поэтому курс не папка: папка отвечает «куда я это положил», курс — «что за
 * чем идёт и что отдаётся целиком».
 *
 * Круг доступа один и тот же для задания и для курса: только мне → названным
 * преподавателям → моей школе → всем. Вопрос один, и два разных ответа в двух
 * местах преподаватель не удержит в голове.
 *
 * Чужое забирается копией, а не ссылкой: автор правит своё, взявший — своё.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISIBILITY = new Set(['private', 'teachers', 'school', 'public']);
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
const BLOCK_TYPES = new Set(['paragraph', 'heading', 'callout', 'image', 'video', 'audio', 'file']);
const ASSET_URL_PATTERN = /^\/assets\/[A-Za-z0-9][A-Za-z0-9/_.%-]*$/;

type LessonBlock = Record<string, unknown> & { id: string; type: string };

function safeLessonUrl(value: string, type: string): boolean {
  const localAsset = ASSET_URL_PATTERN.test(value) && !value.includes('..');
  return type === 'file' ? value.startsWith('https://') || localAsset : localAsset;
}

function lessonBlocks(raw: unknown, legacyContent: string | null): LessonBlock[] | null {
  const value =
    raw === undefined
      ? legacyContent
        ? [{ id: 'legacy', type: 'paragraph', text: legacyContent }]
        : []
      : raw;
  if (!Array.isArray(value) || value.length > 40) return null;
  if (JSON.stringify(value).length > 60_000) return null;
  const ids = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const block = candidate as Record<string, unknown>;
    if (
      typeof block['id'] !== 'string' ||
      !BLOCK_ID_PATTERN.test(block['id']) ||
      ids.has(block['id']) ||
      typeof block['type'] !== 'string' ||
      !BLOCK_TYPES.has(block['type'])
    )
      return null;
    ids.add(block['id']);
    const text = block['text'];
    const url = block['url'];
    if (block['type'] === 'paragraph' && (typeof text !== 'string' || text.length > 12_000)) {
      return null;
    }
    if (
      block['type'] === 'heading' &&
      (typeof text !== 'string' ||
        text.trim().length === 0 ||
        text.length > 300 ||
        (block['level'] !== 2 && block['level'] !== 3))
    )
      return null;
    if (
      block['type'] === 'callout' &&
      (typeof text !== 'string' ||
        text.trim().length === 0 ||
        text.length > 3_000 ||
        !['note', 'tip', 'warning'].includes(String(block['tone'])))
    )
      return null;
    if (['image', 'video', 'audio', 'file'].includes(String(block['type']))) {
      if (
        typeof url !== 'string' ||
        url.length > 2_000 ||
        !safeLessonUrl(url, String(block['type']))
      )
        return null;
    }
    if (
      block['type'] === 'image' &&
      ((block['alt'] !== undefined && typeof block['alt'] !== 'string') ||
        String(block['alt'] ?? '').length > 300 ||
        (block['caption'] !== undefined && typeof block['caption'] !== 'string') ||
        String(block['caption'] ?? '').length > 600)
    )
      return null;
    if (
      ['video', 'audio'].includes(String(block['type'])) &&
      ((block['title'] !== undefined && typeof block['title'] !== 'string') ||
        String(block['title'] ?? '').length > 300)
    )
      return null;
    if (
      block['type'] === 'file' &&
      (typeof block['label'] !== 'string' ||
        block['label'].trim().length === 0 ||
        block['label'].length > 300)
    )
      return null;
  }
  return value as LessonBlock[];
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface CourseRow {
  id: string;
  title: string;
  summary: string | null;
  visibility: string;
  age_band: string | null;
  section_count: number | string;
  lesson_count: number | string;
  assignment_count: number | string;
  shared_with: number | string;
  copied_from_course_id: string | null;
  publication_state: 'draft' | 'published' | 'changed';
  published_version: number | string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CoursePublishRow {
  result_code: 'ok' | 'course_not_found' | 'course_empty';
  version_id: string | null;
  version_number: number | string | null;
  published_at: Date | string | null;
  reused: boolean;
}

interface ClassroomCourseRunRow {
  run_id: string;
  course_id: string;
  course_version_id: string;
  version_number: number | string;
  run_title: string;
  run_summary: string | null;
  due_at: Date | string | null;
  run_status: 'open' | 'closed';
  published_at: Date | string;
  started_count: number | string;
  submitted_count: number | string;
  lesson_id: string;
  source_lesson_id: string;
  section_title: string;
  section_summary: string | null;
  section_position: number | string;
  lesson_title: string;
  lesson_summary: string | null;
  lesson_content: string | null;
  lesson_blocks: LessonBlock[];
  lesson_kind: 'material' | 'assignment';
  estimated_minutes: number | string | null;
  lesson_position: number | string;
  classroom_assignment_id: string | null;
  assignment_title: string | null;
  assignment_goal: string | null;
  assignment_brief: string | null;
  module_key: string | null;
  sample_image: string | null;
  seat_count: number | string;
  lesson_started_count: number | string;
  lesson_submitted_count: number | string;
  lesson_completed_count: number | string;
}

function classroomCourseRuns(
  rows: ClassroomCourseRunRow[],
  projections: Map<string, CanonicalLearningProjection> = new Map(),
) {
  const runs: Array<{
    id: string;
    courseId: string;
    courseVersionId: string;
    versionNumber: number;
    title: string;
    summary: string | null;
    dueAt: string | null;
    status: 'open' | 'closed';
    publishedAt: string;
    startedCount: number;
    submittedCount: number;
    sections: Array<{
      id: string;
      title: string;
      summary: string | null;
      position: number;
      lessons: Array<{
        id: string;
        sourceLessonId: string;
        title: string;
        summary: string | null;
        content: string | null;
        blocks: LessonBlock[];
        kind: 'material' | 'assignment';
        estimatedMinutes: number | null;
        position: number;
        classroomAssignmentId: string | null;
        assignmentTitle: string | null;
        assignmentGoal: string | null;
        assignmentBrief: string | null;
        moduleKey: string | null;
        sampleImage: string | null;
        seatCount: number;
        startedCount: number;
        submittedCount: number;
        completedCount: number;
        canonicalCounts: null | {
          notStarted: number;
          inProgress: number;
          submitted: number;
          waitingReview: number;
          changesRequested: number;
          completed: number;
        };
      }>;
    }>;
  }> = [];
  for (const row of rows) {
    let run = runs.find((entry) => entry.id === row.run_id);
    if (!run) {
      run = {
        id: row.run_id,
        courseId: row.course_id,
        courseVersionId: row.course_version_id,
        versionNumber: Number(row.version_number),
        title: row.run_title,
        summary: row.run_summary,
        dueAt: row.due_at === null ? null : iso(row.due_at),
        status: row.run_status,
        publishedAt: iso(row.published_at),
        startedCount: Number(row.started_count),
        submittedCount: Number(row.submitted_count),
        sections: [],
      };
      runs.push(run);
    }
    const sectionPosition = Number(row.section_position);
    let section = run.sections.find((entry) => entry.position === sectionPosition);
    if (!section) {
      section = {
        id: `${row.run_id}:section:${sectionPosition}`,
        title: row.section_title,
        summary: row.section_summary,
        position: sectionPosition,
        lessons: [],
      };
      run.sections.push(section);
    }
    const lessonStates = row.classroom_assignment_id
      ? [...projections.values()].filter(
          (projection) =>
            projection.state.provenance.classroomAssignmentId === row.classroom_assignment_id,
        )
      : [];
    const canonicalCounts = lessonStates.length
      ? {
          notStarted: lessonStates.filter((item) => item.surface.workflowState === 'not_started')
            .length,
          inProgress: lessonStates.filter((item) => item.surface.workflowState === 'in_progress')
            .length,
          submitted: lessonStates.filter((item) => item.surface.workflowState === 'submitted')
            .length,
          waitingReview: lessonStates.filter(
            (item) => item.surface.workflowState === 'waiting_review',
          ).length,
          changesRequested: lessonStates.filter(
            (item) => item.surface.workflowState === 'changes_requested',
          ).length,
          completed: lessonStates.filter((item) => item.surface.workflowState === 'completed')
            .length,
        }
      : null;
    section.lessons.push({
      id: row.lesson_id,
      sourceLessonId: row.source_lesson_id,
      title: row.lesson_title,
      summary: row.lesson_summary,
      content: row.lesson_content,
      blocks: row.lesson_blocks,
      kind: row.lesson_kind,
      estimatedMinutes: row.estimated_minutes === null ? null : Number(row.estimated_minutes),
      position: Number(row.lesson_position),
      classroomAssignmentId: row.classroom_assignment_id,
      assignmentTitle: row.assignment_title,
      assignmentGoal: row.assignment_goal,
      assignmentBrief: row.assignment_brief,
      moduleKey: row.module_key,
      sampleImage: row.sample_image,
      seatCount: Number(row.seat_count),
      startedCount: canonicalCounts
        ? lessonStates.filter((item) => item.surface.workflowState !== 'not_started').length
        : Number(row.lesson_started_count),
      submittedCount: canonicalCounts
        ? canonicalCounts.submitted +
          canonicalCounts.waitingReview +
          canonicalCounts.changesRequested +
          canonicalCounts.completed
        : Number(row.lesson_submitted_count),
      completedCount: Number(row.lesson_completed_count),
      canonicalCounts,
    });
  }
  return runs;
}

interface CourseOutlineRow {
  section_id: string;
  section_title: string;
  section_summary: string | null;
  section_position: number | string;
  lesson_id: string | null;
  lesson_title: string | null;
  lesson_summary: string | null;
  lesson_content: string | null;
  lesson_blocks: LessonBlock[] | null;
  lesson_kind: 'material' | 'assignment' | null;
  lesson_assignment_id: string | null;
  assignment_title: string | null;
  module_key: string | null;
  estimated_minutes: number | string | null;
  lesson_position: number | string | null;
}

interface CatalogueRow {
  kind: string;
  id: string;
  title: string;
  summary: string | null;
  module_key: string | null;
  age_band: string | null;
  visibility: string;
  sample_image: string | null;
  item_count: number | string;
  author_name: string | null;
  author_school: string | null;
  created_at: Date | string;
}

interface CataloguePreviewRow {
  version_number: number | string;
  title: string;
  summary: string | null;
  outline: Record<string, unknown>;
  published_at: Date | string;
}

function cataloguePreview(row: CataloguePreviewRow) {
  const sections = Array.isArray(row.outline['sections']) ? row.outline['sections'] : [];
  return {
    versionNumber: Number(row.version_number),
    title: row.title,
    summary: row.summary,
    publishedAt: iso(row.published_at),
    sections: sections.flatMap((candidate, sectionIndex) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const section = candidate as Record<string, unknown>;
      const lessons = Array.isArray(section['lessons']) ? section['lessons'] : [];
      return [
        {
          id: String(section['sourceSectionId'] ?? `section-${sectionIndex}`),
          title: String(section['title'] ?? 'Раздел'),
          summary: typeof section['summary'] === 'string' ? section['summary'] : null,
          position: Number(section['position'] ?? sectionIndex + 1),
          lessons: lessons.flatMap((lessonCandidate, lessonIndex) => {
            if (
              !lessonCandidate ||
              typeof lessonCandidate !== 'object' ||
              Array.isArray(lessonCandidate)
            ) {
              return [];
            }
            const lesson = lessonCandidate as Record<string, unknown>;
            return [
              {
                id: String(lesson['sourceLessonId'] ?? `lesson-${sectionIndex}-${lessonIndex}`),
                title: String(lesson['title'] ?? 'Урок'),
                summary: typeof lesson['summary'] === 'string' ? lesson['summary'] : null,
                content: typeof lesson['content'] === 'string' ? lesson['content'] : null,
                blocks: Array.isArray(lesson['blocks']) ? (lesson['blocks'] as LessonBlock[]) : [],
                kind:
                  lesson['kind'] === 'assignment' ? ('assignment' as const) : ('material' as const),
                estimatedMinutes:
                  typeof lesson['estimatedMinutes'] === 'number'
                    ? lesson['estimatedMinutes']
                    : null,
                position: Number(lesson['position'] ?? lessonIndex + 1),
              },
            ];
          }),
        },
      ];
    }),
  };
}

@Controller('api')
export class CoursesController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool)
      throw new HttpException(error('unavailable', 'database is not configured'), 503);
    return this.pool;
  }

  private canonical(): LearningCanonicalProjectionService {
    return new LearningCanonicalProjectionService(this.requirePool());
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Курсы доступны педагогам.'), 403);
    }
    return context;
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  // Свои курсы.

  @Get('courses')
  async list(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT id, title, summary, visibility, age_band, section_count, lesson_count,
              assignment_count, shared_with, copied_from_course_id,
              publication_state, published_version, published_at, created_at, updated_at
         FROM course_library_list($1)`,
      [context.principalId],
    );
    return {
      items: (result.rows as CourseRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        visibility: row.visibility,
        ageBand: row.age_band,
        itemCount: Number(row.lesson_count),
        sectionCount: Number(row.section_count),
        lessonCount: Number(row.lesson_count),
        assignmentCount: Number(row.assignment_count),
        sharedWith: Number(row.shared_with),
        copiedFromCourseId: row.copied_from_course_id,
        publicationState: row.publication_state,
        publishedVersion: row.published_version === null ? null : Number(row.published_version),
        publishedAt: row.published_at === null ? null : iso(row.published_at),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
    };
  }

  @Post('courses')
  async create(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    return { id: await this.save(request, null, rawBody) };
  }

  /**
   * Put one complete, published reference course into the educator's library.
   *
   * The operation is idempotent per educator. It never assigns the course to a
   * class: the teacher still previews it and explicitly chooses the audience.
   */
  @Post('courses/demo')
  async ensureDemo(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT course_id, created, published_version
         FROM course_demo_ensure($1)`,
      [context.principalId],
    );
    const row = result.rows[0] as
      { course_id: string; created: boolean; published_version: number | string } | undefined;
    if (!row?.course_id || Number(row.published_version) < 1) {
      throw new HttpException(error('demo_course_failed', 'Не получилось создать демо-курс.'), 500);
    }
    return {
      id: row.course_id,
      created: row.created,
      publishedVersion: Number(row.published_version),
    };
  }

  @Patch('courses/:courseId')
  async update(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Body() rawBody: unknown,
  ) {
    this.requireUuid(courseId, 'course');
    return { id: await this.save(request, courseId, rawBody) };
  }

  private async save(
    request: FastifyRequest,
    courseId: string | null,
    rawBody: unknown,
  ): Promise<string> {
    const context = await this.requireEducator(request);
    const shape = checkBodyShape(rawBody, ['title', 'summary', 'ageBand', 'visibility']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = String(shape.body['title'] ?? '').trim();
    const summary = shape.body['summary'] ?? null;
    const ageBand = shape.body['ageBand'] ?? null;
    const visibility = shape.body['visibility'] ?? null;
    if (title.length === 0 || title.length > 160) {
      throw new HttpException(error('validation_error', 'Введите название курса.'), 400);
    }
    if (summary !== null && (typeof summary !== 'string' || summary.length > 600)) {
      throw new HttpException(error('validation_error', 'Описание слишком длинное.'), 400);
    }
    if (visibility !== null && !VISIBILITY.has(String(visibility))) {
      throw new HttpException(error('validation_error', 'Неизвестный уровень доступа.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT course_save($1, $2, $3, $4, $5, $6) AS id`,
      [context.principalId, courseId, title, summary, ageBand, visibility],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
    return id;
  }

  /**
   * Freeze the current draft into an immutable version.
   *
   * Future classroom runs refer to this version, so an edit in the authoring
   * surface can never rewrite material that learners have already received.
   */
  @Post('courses/:courseId/publish')
  async publish(@Req() request: FastifyRequest, @Param('courseId') courseId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const result = await this.requirePool().query(
      `SELECT result_code, version_id, version_number, published_at, reused
         FROM course_publish($1, $2)`,
      [context.principalId, courseId],
    );
    const row = result.rows[0] as CoursePublishRow | undefined;
    if (!row || row.result_code === 'course_not_found') {
      throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
    }
    if (row.result_code === 'course_empty') {
      throw new HttpException(
        error('course_empty', 'Добавьте хотя бы один урок перед публикацией.'),
        409,
      );
    }
    if (!row.version_id || row.version_number === null || row.published_at === null) {
      throw new HttpException(error('publish_failed', 'Не получилось опубликовать курс.'), 500);
    }
    return {
      versionId: row.version_id,
      versionNumber: Number(row.version_number),
      publishedAt: iso(row.published_at),
      reused: row.reused,
    };
  }

  // Проведение курса в классе. Здесь используется опубликованная версия, а не
  // редактируемый черновик из методической мастерской.

  @Get('classrooms/:classroomId/course-runs')
  async classroomRuns(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const [result, projections] = await Promise.all([
      this.requirePool().query(
        `SELECT run_id, course_id, course_version_id, version_number, run_title, run_summary,
              due_at, run_status, published_at, started_count, submitted_count,
              lesson_id, source_lesson_id, section_title, section_summary, section_position,
              lesson_title, lesson_summary, lesson_content, lesson_blocks, lesson_kind, estimated_minutes,
              lesson_position, classroom_assignment_id, assignment_title, assignment_goal,
              assignment_brief, module_key, sample_image, seat_count,
              lesson_started_count, lesson_submitted_count, lesson_completed_count
         FROM classroom_course_runs_for_teacher_v2($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.canonical().forTeacher(context.accountId, classroomId),
    ]);
    return { items: classroomCourseRuns(result.rows as ClassroomCourseRunRow[], projections) };
  }

  @Post('classrooms/:classroomId/course-runs')
  async assignCourseToClassroom(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['courseId', 'dueAt']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const courseId = shape.body['courseId'];
    const dueAt = shape.body['dueAt'] ?? null;
    if (typeof courseId !== 'string') {
      throw new HttpException(error('validation_error', 'Выберите курс.'), 400);
    }
    this.requireUuid(courseId, 'course');
    if (dueAt !== null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt)))) {
      throw new HttpException(error('validation_error', 'Неверный срок курса.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, run_id, version_number, reused
         FROM classroom_course_run_assign_v2($1, $2, $3, $4)`,
      [context.principalId, classroomId, courseId, dueAt],
    );
    const row = result.rows[0] as
      | {
          result_code: 'ok' | 'classroom_not_found' | 'course_not_published';
          run_id: string | null;
          version_number: number | string | null;
          reused: boolean;
        }
      | undefined;
    if (!row || row.result_code === 'classroom_not_found') {
      throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    }
    if (row.result_code === 'course_not_published') {
      throw new HttpException(error('course_not_published', 'Сначала опубликуйте курс.'), 409);
    }
    return {
      runId: row.run_id as string,
      versionNumber: Number(row.version_number),
      reused: row.reused,
    };
  }

  @Post('classrooms/:classroomId/course-runs/:runId/status')
  async setClassroomRunStatus(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('runId') runId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(runId, 'course run');
    const shape = checkBodyShape(rawBody, ['status']);
    const status = shape.ok ? shape.body['status'] : null;
    if (status !== 'open' && status !== 'closed') {
      throw new HttpException(error('validation_error', 'Неизвестное состояние курса.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT classroom_course_run_set_status($1, $2, $3, $4) AS ok`,
      [context.principalId, classroomId, runId, status],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('course_run_not_found', 'Курс класса не найден.'), 404);
    }
    return { ok: true as const };
  }

  /** Удаляется курс, а не задания: они остаются в банке. */
  @Delete('courses/:courseId')
  async remove(@Req() request: FastifyRequest, @Param('courseId') courseId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const result = await this.requirePool().query(`SELECT course_delete($1, $2) AS ok`, [
      context.principalId,
      courseId,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
    }
    return { removed: true as const };
  }

  /** Состав курса — то, что видно и чужому, если курс ему открыт. */
  @Get('courses/:courseId/items')
  async items(@Req() request: FastifyRequest, @Param('courseId') courseId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const result = await this.requirePool().query(
      `SELECT id, title, goal, module_key, sample_image, step_number
         FROM course_contents($1, $2, $3, $4)`,
      [courseId, context.principalId, context.accountId, context.tenantId],
    );
    return {
      items: (
        result.rows as Array<{
          id: string;
          title: string;
          goal: string | null;
          module_key: string;
          sample_image: string | null;
          step_number: number | string;
        }>
      ).map((row) => ({
        id: row.id,
        title: row.title,
        goal: row.goal,
        moduleKey: row.module_key,
        sampleImage: row.sample_image,
        position: Number(row.step_number),
      })),
    };
  }

  @Put('courses/:courseId/items/:assignmentId')
  async setItem(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['included']);
    const included = shape.ok ? shape.body['included'] !== false : true;
    const result = await this.requirePool().query(`SELECT course_item_set($1, $2, $3, $4) AS ok`, [
      context.principalId,
      courseId,
      assignmentId,
      included,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('course_not_found', 'Курс или задание не найдены.'), 404);
    }
    return { ok: true as const };
  }

  /** Порядок внутри курса: шаг вверх или вниз. */
  @Post('courses/:courseId/items/:assignmentId/move')
  async moveItem(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['delta']);
    const delta = shape.ok && Number(shape.body['delta']) < 0 ? -1 : 1;
    const result = await this.requirePool().query(`SELECT course_item_move($1, $2, $3, $4) AS ok`, [
      context.principalId,
      courseId,
      assignmentId,
      delta,
    ]);
    return { ok: (result.rows[0] as { ok: boolean } | undefined)?.ok === true };
  }

  // Настоящее содержание курса: разделы и уроки.

  @Get('courses/:courseId/outline')
  async outline(@Req() request: FastifyRequest, @Param('courseId') courseId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const result = await this.requirePool().query(
      'SELECT section_id, section_title, section_summary, section_position, ' +
        'lesson_id, lesson_title, lesson_summary, lesson_content, lesson_blocks, lesson_kind, ' +
        'lesson_assignment_id, assignment_title, module_key, estimated_minutes, ' +
        'lesson_position FROM course_outline_v2($1, $2, $3, $4)',
      [courseId, context.principalId, context.accountId, context.tenantId],
    );
    const rows = result.rows as CourseOutlineRow[];
    if (rows.length === 0) {
      throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
    }

    const sections: Array<{
      id: string;
      title: string;
      summary: string | null;
      position: number;
      lessons: Array<{
        id: string;
        title: string;
        summary: string | null;
        content: string | null;
        blocks: LessonBlock[];
        kind: 'material' | 'assignment';
        assignmentId: string | null;
        assignmentTitle: string | null;
        moduleKey: string | null;
        estimatedMinutes: number | null;
        position: number;
      }>;
    }> = [];
    for (const row of rows) {
      let section = sections.find((entry) => entry.id === row.section_id);
      if (!section) {
        section = {
          id: row.section_id,
          title: row.section_title,
          summary: row.section_summary,
          position: Number(row.section_position),
          lessons: [],
        };
        sections.push(section);
      }
      if (row.lesson_id && row.lesson_title && row.lesson_kind) {
        section.lessons.push({
          id: row.lesson_id,
          title: row.lesson_title,
          summary: row.lesson_summary,
          content: row.lesson_content,
          blocks: row.lesson_blocks ?? [],
          kind: row.lesson_kind,
          assignmentId: row.lesson_assignment_id,
          assignmentTitle: row.assignment_title,
          moduleKey: row.module_key,
          estimatedMinutes: row.estimated_minutes === null ? null : Number(row.estimated_minutes),
          position: Number(row.lesson_position),
        });
      }
    }
    return { sections };
  }

  @Post('courses/:courseId/sections')
  async createSection(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Body() rawBody: unknown,
  ) {
    return { id: await this.saveSection(request, courseId, null, rawBody) };
  }

  @Patch('courses/:courseId/sections/:sectionId')
  async updateSection(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('sectionId') sectionId: string,
    @Body() rawBody: unknown,
  ) {
    this.requireUuid(sectionId, 'section');
    return { id: await this.saveSection(request, courseId, sectionId, rawBody) };
  }

  private async saveSection(
    request: FastifyRequest,
    courseId: string,
    sectionId: string | null,
    rawBody: unknown,
  ): Promise<string> {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const shape = checkBodyShape(rawBody, ['title', 'summary']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = String(shape.body['title'] ?? '').trim();
    const summary = shape.body['summary'] ?? null;
    if (title.length === 0 || title.length > 160) {
      throw new HttpException(error('validation_error', 'Введите название раздела.'), 400);
    }
    if (summary !== null && (typeof summary !== 'string' || summary.length > 600)) {
      throw new HttpException(error('validation_error', 'Описание раздела слишком длинное.'), 400);
    }
    const result = await this.requirePool().query(
      'SELECT course_section_save($1, $2, $3, $4, $5) AS id',
      [context.principalId, courseId, sectionId, title, summary],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
    return id;
  }

  @Post('courses/:courseId/sections/:sectionId/move')
  async moveSection(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('sectionId') sectionId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(sectionId, 'section');
    const shape = checkBodyShape(rawBody, ['delta']);
    const delta = shape.ok && Number(shape.body['delta']) < 0 ? -1 : 1;
    const result = await this.requirePool().query(
      'SELECT course_section_move($1, $2, $3, $4) AS ok',
      [context.principalId, courseId, sectionId, delta],
    );
    return { ok: (result.rows[0] as { ok: boolean } | undefined)?.ok === true };
  }

  @Delete('courses/:courseId/sections/:sectionId')
  async deleteSection(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('sectionId') sectionId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(sectionId, 'section');
    const result = await this.requirePool().query(
      'SELECT course_section_delete($1, $2, $3) AS ok',
      [context.principalId, courseId, sectionId],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(
        error('section_not_empty', 'Сначала удалите уроки. Последний раздел удалить нельзя.'),
        409,
      );
    }
    return { removed: true as const };
  }

  @Post('courses/:courseId/lessons')
  async createLesson(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Body() rawBody: unknown,
  ) {
    return { id: await this.saveLesson(request, courseId, null, rawBody) };
  }

  @Patch('courses/:courseId/lessons/:lessonId')
  async updateLesson(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body() rawBody: unknown,
  ) {
    this.requireUuid(lessonId, 'lesson');
    return { id: await this.saveLesson(request, courseId, lessonId, rawBody) };
  }

  private async saveLesson(
    request: FastifyRequest,
    courseId: string,
    lessonId: string | null,
    rawBody: unknown,
  ): Promise<string> {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const shape = checkBodyShape(rawBody, [
      'sectionId',
      'title',
      'summary',
      'content',
      'blocks',
      'kind',
      'assignmentId',
      'estimatedMinutes',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const sectionId = String(shape.body['sectionId'] ?? '');
    const title = String(shape.body['title'] ?? '').trim();
    const summary = shape.body['summary'] ?? null;
    const content = shape.body['content'] ?? null;
    const blocks = lessonBlocks(shape.body['blocks'], typeof content === 'string' ? content : null);
    const kind = String(shape.body['kind'] ?? 'material');
    const assignmentId = shape.body['assignmentId'] ?? null;
    const rawMinutes = shape.body['estimatedMinutes'] ?? null;
    const estimatedMinutes = rawMinutes === null ? null : Number(rawMinutes);
    this.requireUuid(sectionId, 'section');
    if (title.length === 0 || title.length > 160) {
      throw new HttpException(error('validation_error', 'Введите название урока.'), 400);
    }
    if (summary !== null && (typeof summary !== 'string' || summary.length > 600)) {
      throw new HttpException(error('validation_error', 'Описание урока слишком длинное.'), 400);
    }
    if (content !== null && (typeof content !== 'string' || content.length > 12_000)) {
      throw new HttpException(error('validation_error', 'Материал урока слишком длинный.'), 400);
    }
    if (blocks === null) {
      throw new HttpException(
        error('validation_error', 'Проверьте блоки урока и ссылки на материалы.'),
        400,
      );
    }
    if (kind !== 'material' && kind !== 'assignment') {
      throw new HttpException(error('validation_error', 'Неизвестный тип урока.'), 400);
    }
    if (kind === 'assignment') {
      if (typeof assignmentId !== 'string') {
        throw new HttpException(error('validation_error', 'Выберите задание.'), 400);
      }
      this.requireUuid(assignmentId, 'assignment');
    } else if (assignmentId !== null) {
      throw new HttpException(
        error('validation_error', 'Материал не должен ссылаться на задание.'),
        400,
      );
    }
    if (
      estimatedMinutes !== null &&
      (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 600)
    ) {
      throw new HttpException(error('validation_error', 'Укажите время от 1 до 600 минут.'), 400);
    }

    const result = await this.requirePool().query(
      'SELECT course_lesson_save_v2($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS id',
      [
        context.principalId,
        courseId,
        sectionId,
        lessonId,
        title,
        summary,
        JSON.stringify(blocks),
        kind,
        kind === 'assignment' ? assignmentId : null,
        estimatedMinutes,
      ],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) {
      throw new HttpException(error('lesson_not_saved', 'Урок или раздел не найдены.'), 404);
    }
    return id;
  }

  @Post('courses/:courseId/lessons/:lessonId/move')
  async moveLesson(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(lessonId, 'lesson');
    const shape = checkBodyShape(rawBody, ['delta']);
    const delta = shape.ok && Number(shape.body['delta']) < 0 ? -1 : 1;
    const result = await this.requirePool().query(
      'SELECT course_lesson_move($1, $2, $3, $4) AS ok',
      [context.principalId, courseId, lessonId, delta],
    );
    return { ok: (result.rows[0] as { ok: boolean } | undefined)?.ok === true };
  }

  @Delete('courses/:courseId/lessons/:lessonId')
  async deleteLesson(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('lessonId') lessonId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(lessonId, 'lesson');
    const result = await this.requirePool().query('SELECT course_lesson_delete($1, $2, $3) AS ok', [
      context.principalId,
      courseId,
      lessonId,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('lesson_not_found', 'Урок не найден.'), 404);
    }
    return { removed: true as const };
  }

  // Кому открыто.

  @Put('sharing/:kind/:subjectId/visibility')
  async setVisibility(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const shape = checkBodyShape(rawBody, ['visibility']);
    const visibility = String(shape.ok ? (shape.body['visibility'] ?? '') : '');
    if (!VISIBILITY.has(visibility)) {
      throw new HttpException(error('validation_error', 'Неизвестный уровень доступа.'), 400);
    }
    const pool = this.requirePool();
    if (kind === 'assignment') {
      const result = await pool.query(
        `SELECT teacher_assignment_visibility_set($1, $2, $3) AS ok`,
        [context.principalId, subjectId, visibility],
      );
      if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
        throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
      }
      return { ok: true as const };
    }
    if (kind === 'course') {
      const result = await pool.query(`SELECT course_visibility_set($1, $2, $3) AS ok`, [
        context.principalId,
        subjectId,
        visibility,
      ]);
      if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
        throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
      }
      return { ok: true as const };
    }
    throw new HttpException(error('validation_error', 'Неизвестный вид содержимого.'), 400);
  }

  @Get('sharing/:kind/:subjectId')
  async shares(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const result = await this.requirePool().query(
      `SELECT account_id, email, display_name, created_at FROM content_share_list($1, $2, $3)`,
      [context.principalId, kind, subjectId],
    );
    return {
      items: (
        result.rows as Array<{
          account_id: string;
          email: string;
          display_name: string;
          created_at: Date | string;
        }>
      ).map((row) => ({
        accountId: row.account_id,
        email: row.email,
        displayName: row.display_name,
        createdAt: iso(row.created_at),
      })),
    };
  }

  /**
   * Открыть доступ коллеге по почте.
   *
   * Почта, а не выбор из списка всех преподавателей платформы: список чужих
   * имён — это справочник людей, и показывать его ради «поделиться заданием»
   * незачем.
   */
  @Post('sharing/:kind/:subjectId')
  async addShare(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const shape = checkBodyShape(rawBody, ['email']);
    const email = String(shape.ok ? (shape.body['email'] ?? '') : '').trim();
    if (email.length === 0 || email.length > 254) {
      throw new HttpException(error('validation_error', 'Введите почту преподавателя.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT content_share_add($1, $2, $3, $4) AS ok`,
      [context.principalId, kind, subjectId, email],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(
        error('share_rejected', 'Преподаватель с такой почтой не найден.'),
        404,
      );
    }
    return { ok: true as const };
  }

  @Delete('sharing/:kind/:subjectId/:accountId')
  async removeShare(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
    @Param('accountId') accountId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    this.requireUuid(accountId, 'account');
    const result = await this.requirePool().query(
      `SELECT content_share_remove($1, $2, $3, $4) AS ok`,
      [context.principalId, kind, subjectId, accountId],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('share_not_found', 'Доступ не найден.'), 404);
    }
    return { removed: true as const };
  }

  // Общий каталог.

  /** Курсы и задания, открытые тому, кто смотрит. Своё сюда не попадает. */
  @Get('catalogue')
  async catalogue(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT kind, id, title, summary, module_key, age_band, visibility, sample_image,
              item_count, author_name, author_school, created_at
         FROM shared_catalogue($1, $2, $3)`,
      [context.principalId, context.accountId, context.tenantId],
    );
    return {
      items: (result.rows as CatalogueRow[]).map((row) => ({
        kind: row.kind as 'course' | 'assignment',
        id: row.id,
        title: row.title,
        summary: row.summary,
        moduleKey: row.module_key,
        ageBand: row.age_band,
        visibility: row.visibility,
        sampleImage: row.sample_image,
        itemCount: Number(row.item_count),
        authorName: row.author_name ?? 'Преподаватель',
        authorSchool: row.author_school,
        createdAt: iso(row.created_at),
      })),
    };
  }

  /** Full immutable published outline shown before a colleague takes a course. */
  @Get('catalogue/courses/:courseId')
  async catalogueCourse(@Req() request: FastifyRequest, @Param('courseId') courseId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const result = await this.requirePool().query(
      `SELECT version_number, title, summary, outline, published_at
         FROM course_catalogue_preview($1, $2, $3, $4)`,
      [courseId, context.principalId, context.accountId, context.tenantId],
    );
    const row = result.rows[0] as CataloguePreviewRow | undefined;
    if (!row) {
      throw new HttpException(error('not_available', 'Опубликованный курс недоступен.'), 404);
    }
    return cataloguePreview(row);
  }

  /**
   * Забрать чужое себе.
   *
   * Копией, а не ссылкой: автор правит своё, взявший — своё. Иначе исправленная
   * у автора опечатка меняет урок в чужой школе посреди четверти.
   */
  @Post('catalogue/:kind/:subjectId/take')
  async take(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const pool = this.requirePool();
    const sql =
      kind === 'course'
        ? `SELECT course_take_with_outline($1, $2, $3, $4) AS id`
        : `SELECT assignment_take($1, $2, $3, $4) AS id`;
    if (kind !== 'course' && kind !== 'assignment') {
      throw new HttpException(error('validation_error', 'Неизвестный вид содержимого.'), 400);
    }
    const result = await pool.query(sql, [
      context.principalId,
      subjectId,
      context.accountId,
      context.tenantId,
    ]);
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('not_available', 'Это вам не доступно.'), 404);
    return { id };
  }
}
