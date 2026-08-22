import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  classroomCodeHash,
  formatClassroomCode,
  isSeatAvatarKey,
  normalizeClassroomCode,
} from '@asa-lab/classroom';
import { createSessionToken, hashSessionToken } from '@asa-lab/identity';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import { clientAddress } from './client-address.js';
import { BotChallengeService } from './bot-challenge.js';
import { FixedWindowRateLimiter } from './rate-limit.js';

const STUDENT_SESSION_COOKIE = 'asa_student_session';
const STUDENT_SESSION_HOURS = 8;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 30;

interface StudentSessionRow {
  seat_id: string;
  classroom_id: string;
  classroom_title: string;
  display_label: string;
  teacher_display_name: string;
  safe_mode: boolean;
  avatar_key: string | null;
  expires_at: Date | string;
}

const SEAT_SESSION_COLUMNS = `seat_id, classroom_id, classroom_title, display_label,
              teacher_display_name, safe_mode, avatar_key, expires_at`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AssignmentForSeatRow {
  id: string;
  title: string;
  brief: string | null;
  goal: string | null;
  module_key: string;
  due_at: Date | string | null;
  status: 'open' | 'closed';
  sample_image: string | null;
  project_id: string | null;
  submitted_at: Date | string | null;
  /** Снимок работы: по нему ученик вспоминает, на чём остановился. */
  snapshot_revision: number | string | null;
  updated_at: Date | string | null;
}

interface SeatCourseRunRow {
  run_id: string;
  course_id: string;
  course_version_id: string;
  version_number: number | string;
  classroom_title: string;
  run_title: string;
  run_summary: string | null;
  due_at: Date | string | null;
  run_status: 'open' | 'closed';
  lesson_id: string;
  source_lesson_id: string;
  section_title: string;
  section_summary: string | null;
  section_position: number | string;
  lesson_title: string;
  lesson_summary: string | null;
  lesson_content: string | null;
  lesson_blocks: Array<Record<string, unknown>>;
  lesson_kind: 'material' | 'assignment';
  estimated_minutes: number | string | null;
  lesson_position: number | string;
  classroom_assignment_id: string | null;
  assignment_title: string | null;
  assignment_goal: string | null;
  assignment_brief: string | null;
  module_key: string | null;
  sample_image: string | null;
  project_id: string | null;
  submitted_at: Date | string | null;
  snapshot_revision: number | string | null;
  work_updated_at: Date | string | null;
  completed_at: Date | string | null;
}

interface QuizForSeatRow {
  classroom_assignment_id: string;
  classroom_title: string;
  quiz_version_id: string;
  quiz_title: string;
  quiz_instructions: string | null;
  due_at: Date | string | null;
  assignment_status: 'open' | 'closed';
  attempt_limit: number | string;
  attempts_used: number | string;
  time_limit_minutes: number | string | null;
  total_points: number | string;
  pass_threshold_basis_points: number | string;
  question_version_id: string;
  question_type: string;
  prompt_blocks: Array<Record<string, unknown>>;
  response_schema: Record<string, unknown>;
  question_max_points: number | string;
  question_position: number | string;
  latest_state: string | null;
  latest_points: number | string | null;
  latest_percentage_basis_points: number | string | null;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function seatCourseRuns(rows: SeatCourseRunRow[]) {
  const runs: Array<{
    id: string;
    courseId: string;
    courseVersionId: string;
    versionNumber: number;
    classroomTitle: string;
    title: string;
    summary: string | null;
    dueAt: string | null;
    status: 'open' | 'closed';
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
        blocks: Array<Record<string, unknown>>;
        kind: 'material' | 'assignment';
        estimatedMinutes: number | null;
        position: number;
        classroomAssignmentId: string | null;
        assignmentTitle: string | null;
        assignmentGoal: string | null;
        assignmentBrief: string | null;
        moduleKey: string | null;
        sampleImage: string | null;
        projectId: string | null;
        submittedAt: string | null;
        snapshotRevision: number | null;
        updatedAt: string | null;
        completedAt: string | null;
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
        classroomTitle: row.classroom_title,
        title: row.run_title,
        summary: row.run_summary,
        dueAt: row.due_at === null ? null : isoDate(row.due_at),
        status: row.run_status,
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
      projectId: row.project_id,
      submittedAt: row.submitted_at === null ? null : isoDate(row.submitted_at),
      snapshotRevision: row.snapshot_revision === null ? null : Number(row.snapshot_revision),
      updatedAt: row.work_updated_at === null ? null : isoDate(row.work_updated_at),
      completedAt: row.completed_at === null ? null : isoDate(row.completed_at),
    });
  }
  return runs;
}

/** Build a learner-safe DTO. Answer keys are not selected by either SQL function. */
function seatQuizzes(rows: QuizForSeatRow[]) {
  const quizzes: Array<{
    assignmentId: string;
    classroomTitle: string;
    quizVersionId: string;
    title: string;
    instructions: string | null;
    dueAt: string | null;
    status: 'open' | 'closed';
    attemptLimit: number;
    attemptsUsed: number;
    timeLimitMinutes: number | null;
    totalPoints: number;
    passThreshold: number;
    latestResult: { state: string; points: number | null; percentage: number | null } | null;
    questions: Array<{
      versionId: string;
      type: string;
      promptBlocks: Array<Record<string, unknown>>;
      responseSchema: Record<string, unknown>;
      maxPoints: number;
      position: number;
    }>;
  }> = [];
  for (const row of rows) {
    let quiz = quizzes.find((entry) => entry.assignmentId === row.classroom_assignment_id);
    if (!quiz) {
      quiz = {
        assignmentId: row.classroom_assignment_id,
        classroomTitle: row.classroom_title,
        quizVersionId: row.quiz_version_id,
        title: row.quiz_title,
        instructions: row.quiz_instructions,
        dueAt: row.due_at === null ? null : isoDate(row.due_at),
        status: row.assignment_status,
        attemptLimit: Number(row.attempt_limit),
        attemptsUsed: Number(row.attempts_used),
        timeLimitMinutes: row.time_limit_minutes === null ? null : Number(row.time_limit_minutes),
        totalPoints: Number(row.total_points),
        passThreshold: Number(row.pass_threshold_basis_points) / 100,
        latestResult: row.latest_state
          ? {
              state: row.latest_state,
              points: row.latest_points === null ? null : Number(row.latest_points),
              percentage:
                row.latest_percentage_basis_points === null
                  ? null
                  : Number(row.latest_percentage_basis_points) / 100,
            }
          : null,
        questions: [],
      };
      quizzes.push(quiz);
    }
    quiz.questions.push({
      versionId: row.question_version_id,
      type: row.question_type,
      promptBlocks: row.prompt_blocks,
      responseSchema: row.response_schema,
      maxPoints: Number(row.question_max_points),
      position: Number(row.question_position),
    });
  }
  return quizzes;
}

function studentPayload(row: StudentSessionRow) {
  return {
    authenticated: true as const,
    student: {
      seatId: row.seat_id,
      displayName: row.display_label,
      safeMode: row.safe_mode,
      // Null means nobody has chosen; the client draws one keyed by the seat.
      avatarKey: row.avatar_key,
    },
    classroom: {
      id: row.classroom_id,
      title: row.classroom_title,
      teacherDisplayName: row.teacher_display_name,
    },
    expiresAt:
      row.expires_at instanceof Date ? row.expires_at.toISOString() : String(row.expires_at),
  };
}

@Controller('api/class-join')
export class ClassroomJoinController {
  private readonly attemptsByAddress = new FixedWindowRateLimiter({
    limit: MAX_ATTEMPTS,
    windowMs: ATTEMPT_WINDOW_MS,
    maxKeys: 5_000,
  });
  private readonly attemptsByCredential = new FixedWindowRateLimiter({
    limit: 10,
    windowMs: ATTEMPT_WINDOW_MS,
    maxKeys: 10_000,
  });

  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    // Взрослый входит в класс своим аккаунтом, а не выданным логином, поэтому
    // здесь нужна и обычная сессия тоже.
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.botChallengeService) private readonly botChallenges: BotChallengeService,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool) {
      throw new HttpException(error('database_unavailable', 'database is not configured'), 503);
    }
    return this.pool;
  }

  private enforceRateLimit(limiter: FixedWindowRateLimiter, key: string): void {
    const decision = limiter.consume(key);
    if (!decision.allowed) {
      throw new HttpException(
        {
          error: {
            code: 'too_many_attempts',
            message: 'Слишком много попыток. Подождите несколько минут.',
            retryAfterSeconds: decision.retryAfterSeconds,
          },
        },
        429,
      );
    }
  }

  private checkRateLimit(request: FastifyRequest): void {
    this.enforceRateLimit(this.attemptsByAddress, clientAddress(request));
  }

  private codeFromBody(rawBody: unknown): string {
    const shape = checkBodyShape(rawBody, ['code']);
    const code = shape.ok ? shape.body['code'] : null;
    if (!shape.ok || typeof code !== 'string' || normalizeClassroomCode(code).length !== 9) {
      throw new HttpException(error('validation_error', 'Введите код класса из 9 символов.'), 400);
    }
    return formatClassroomCode(code);
  }

  @Post('resolve')
  @HttpCode(200)
  async resolve(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    this.checkRateLimit(request);
    const code = this.codeFromBody(rawBody);
    const result = await this.requirePool().query(
      `SELECT tenant_id, classroom_id, classroom_title, teacher_display_name, safe_mode_default
         FROM classroom_public_resolve_join_code($1)`,
      [classroomCodeHash(code)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new HttpException(
        error('class_not_found', 'Не удалось найти класс. Проверьте код у педагога.'),
        404,
      );
    }
    return {
      classroom: {
        id: row.classroom_id as string,
        title: row.classroom_title as string,
        teacherDisplayName: row.teacher_display_name as string,
        safeMode: row.safe_mode_default === true,
      },
    };
  }

  @Post('studentseat')
  @HttpCode(200)
  async signIn(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() rawBody: unknown,
  ) {
    this.checkRateLimit(request);
    const shape = checkBodyShape(rawBody, ['code', 'loginHandle', 'botProof']);
    const code = shape.ok ? shape.body['code'] : null;
    const loginHandle = shape.ok ? shape.body['loginHandle'] : null;
    if (
      !shape.ok ||
      typeof code !== 'string' ||
      normalizeClassroomCode(code).length !== 9 ||
      typeof loginHandle !== 'string' ||
      !/^[a-zA-Z0-9._-]{3,32}$/.test(loginHandle.trim())
    ) {
      throw new HttpException(
        error('validation_error', 'Введите код класса и выданное педагогом имя.'),
        400,
      );
    }
    this.enforceRateLimit(
      this.attemptsByCredential,
      `${classroomCodeHash(code)}:${loginHandle.trim().toLowerCase()}`,
    );
    if (
      !this.botChallenges.verify(
        'class_join',
        shape.body['botProof'],
        request.headers['user-agent'],
      )
    ) {
      throw new HttpException(error('bot_check_required', 'Подтвердите, что вы не робот.'), 403);
    }
    const token = createSessionToken();
    const result = await this.requirePool().query(
      `SELECT ${SEAT_SESSION_COLUMNS} FROM classroom_student_seat_sign_in($1, $2, $3, $4)`,
      [
        classroomCodeHash(code),
        loginHandle.trim().toLowerCase(),
        hashSessionToken(token),
        STUDENT_SESSION_HOURS,
      ],
    );
    const row = result.rows[0] as StudentSessionRow | undefined;
    if (!row) {
      throw new HttpException(
        error(
          'invalid_class_credentials',
          'Код или имя для входа не подошли. Попросите педагога проверить данные.',
        ),
        401,
      );
    }
    reply.setCookie(STUDENT_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env['NODE_ENV'] === 'production',
      maxAge: STUDENT_SESSION_HOURS * 60 * 60,
    });
    await this.recordSeatActivity(row.seat_id, 'seat.signed_in');
    return studentPayload(row);
  }

  /**
   * Notes a learner's arrival or departure in their class record. It is written
   * after the session itself so a failure here can never cost a learner their
   * sign-in: the record exists to tell a teacher how someone is getting on, and
   * that is never worth a locked door.
   */
  private async recordSeatActivity(seatId: string, action: string): Promise<void> {
    try {
      const principal = await this.requirePool().query(
        `SELECT principal_id, tenant_id, classroom_id FROM student_seat_principal($1)`,
        [seatId],
      );
      const seat = principal.rows[0] as
        { principal_id: string; tenant_id: string; classroom_id: string } | undefined;
      if (!seat) return;
      await this.requirePool().query(`SELECT classroom_activity_record($1,$2,$3,$4,$5,NULL,NULL)`, [
        seat.tenant_id,
        seat.classroom_id,
        seatId,
        seat.principal_id,
        action,
      ]);
    } catch {
      // Deliberately silent: see above.
    }
  }

  @Get('me')
  async me(@Req() request: FastifyRequest) {
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    if (!token) return { authenticated: false as const };
    const result = await this.requirePool().query(
      `SELECT ${SEAT_SESSION_COLUMNS} FROM classroom_student_session_context($1)`,
      [hashSessionToken(token)],
    );
    const row = result.rows[0] as StudentSessionRow | undefined;
    return row ? studentPayload(row) : { authenticated: false as const };
  }

  /** The seat behind the current session, or 401. */
  private async currentSeat(request: FastifyRequest): Promise<StudentSessionRow> {
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    if (!token) throw new HttpException(error('unauthorized', 'no active seat session'), 401);
    const result = await this.requirePool().query(
      `SELECT ${SEAT_SESSION_COLUMNS} FROM classroom_student_session_context($1)`,
      [hashSessionToken(token)],
    );
    const row = result.rows[0] as StudentSessionRow | undefined;
    if (!row) throw new HttpException(error('unauthorized', 'no active seat session'), 401);
    return row;
  }

  /**
   * A learner choosing their own picture.
   *
   * Their teacher can change it too, from the register; both write the same
   * field. What a seat cannot do is upload an image — the choice is from the
   * set the product ships with, which is why this takes a name and not a file.
   */
  @Put('me/avatar')
  async setAvatar(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const row = await this.currentSeat(request);
    const shape = checkBodyShape(rawBody, ['avatarKey']);
    const avatarKey = shape.ok ? (shape.body['avatarKey'] ?? null) : null;
    if (!shape.ok || !isSeatAvatarKey(avatarKey)) {
      throw new HttpException(error('validation_error', 'Неизвестный аватар.'), 400);
    }
    await this.requirePool().query(`SELECT classroom_seat_avatar_set($1, $2)`, [
      row.seat_id,
      avatarKey,
    ]);
    return studentPayload({ ...row, avatar_key: avatarKey });
  }

  /**
   * What has been set for this learner, and where they are with it.
   *
   * Answered from the seat session alone: a learner never names their own seat
   * to the server, so there is nothing to tamper with.
   */
  /**
   * How much work is still owed. One small number, asked on every page load, so
   * the class in a learner's navigation can carry a dot with a count — the way
   * anything with unread items does.
   */
  @Get('me/assignment-counts')
  async assignmentCounts(@Req() request: FastifyRequest) {
    const seat = await this.currentSeat(request);
    const result = await this.requirePool().query(
      `SELECT open_count, unfinished_count FROM classroom_seat_assignment_counts($1)`,
      [seat.seat_id],
    );
    const row = result.rows[0] as { open_count: number; unfinished_count: number } | undefined;
    return { open: Number(row?.open_count ?? 0), unfinished: Number(row?.unfinished_count ?? 0) };
  }

  /**
   * Занять место в классе, будучи собой.
   *
   * Взрослый, студент или коллега-преподаватель уже вошёл в продукт под своим
   * аккаунтом — второй вход по выданному логину ему не нужен, как не нужна и
   * вторая полка работ. Он вводит тот же код класса, что и дети, и получает то
   * же место: задания, сдача, значки и отклики работают дальше без изменений.
   */
  @Post('account')
  @HttpCode(200)
  async joinAsAccount(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    this.checkRateLimit(request);
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'Сначала войдите в аккаунт.'), 401);
    const code = this.codeFromBody(rawBody);
    const result = await this.requirePool().query(
      `SELECT seat_id, classroom_id, classroom_title, already_member
         FROM classroom_join_with_account($1, $2)`,
      [context.accountId, classroomCodeHash(code)],
    );
    const row = result.rows[0] as
      | {
          seat_id: string;
          classroom_id: string;
          classroom_title: string;
          already_member: boolean;
        }
      | undefined;
    if (!row) {
      throw new HttpException(
        error(
          'class_not_found',
          'Не удалось войти в класс. Проверьте код — и учтите, что преподаватель класса не может быть в нём учеником.',
        ),
        404,
      );
    }
    return {
      classroom: { id: row.classroom_id, title: row.classroom_title },
      seatId: row.seat_id,
      alreadyMember: row.already_member === true,
    };
  }

  /** Классы, в которых этот аккаунт учится. */
  @Get('account/classes')
  async accountClasses(@Req() request: FastifyRequest) {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const result = await this.requirePool().query(
      `SELECT seat_id, classroom_id, classroom_title, teacher_display_name,
              open_count, unfinished_count
         FROM classroom_account_seats($1)`,
      [context.accountId],
    );
    return {
      items: (
        result.rows as Array<{
          seat_id: string;
          classroom_id: string;
          classroom_title: string;
          teacher_display_name: string;
          open_count: number | string;
          unfinished_count: number | string;
        }>
      ).map((row) => ({
        seatId: row.seat_id,
        classroomId: row.classroom_id,
        classroomTitle: row.classroom_title,
        teacherDisplayName: row.teacher_display_name,
        openCount: Number(row.open_count ?? 0),
        unfinishedCount: Number(row.unfinished_count ?? 0),
      })),
    };
  }

  /** Задания по всем классам, где этот аккаунт учится. */
  @Get('account/assignments')
  async accountAssignments(@Req() request: FastifyRequest) {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const result = await this.requirePool().query(
      `SELECT id, seat_id, classroom_title, title, brief, goal, module_key,
              due_at, status, sample_image, project_id, submitted_at,
              snapshot_revision, updated_at
         FROM classroom_assignments_for_account($1)`,
      [context.accountId],
    );
    return {
      items: (result.rows as Array<AssignmentForSeatRow & { classroom_title: string }>).map(
        (row) => ({
          id: row.id,
          title: row.title,
          brief: row.brief,
          goal: row.goal,
          moduleKey: row.module_key,
          dueAt: row.due_at ? isoDate(row.due_at) : null,
          status: row.status,
          sampleImage: row.sample_image,
          projectId: row.project_id,
          submittedAt: row.submitted_at ? isoDate(row.submitted_at) : null,
          snapshotRevision: row.snapshot_revision === null ? null : Number(row.snapshot_revision),
          updatedAt: row.updated_at ? isoDate(row.updated_at) : null,
          classroomTitle: row.classroom_title,
        }),
      ),
    };
  }

  /** Tests across every class attended by the signed-in account. */
  @Get('account/quizzes')
  async accountQuizzes(@Req() request: FastifyRequest) {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const result = await this.requirePool().query(
      `SELECT * FROM quiz_assignments_for_account($1)`,
      [context.accountId],
    );
    return { items: seatQuizzes(result.rows as QuizForSeatRow[]) };
  }

  /** Published course runs across every class this signed-in account attends. */
  @Get('account/course-runs')
  async accountCourseRuns(@Req() request: FastifyRequest) {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const result = await this.requirePool().query(
      `SELECT run_id, course_id, course_version_id, version_number, classroom_title,
              run_title, run_summary, due_at, run_status, lesson_id, source_lesson_id,
              section_title, section_summary, section_position, lesson_title, lesson_summary,
              lesson_content, lesson_blocks, lesson_kind, estimated_minutes, lesson_position,
              classroom_assignment_id, assignment_title, assignment_goal, assignment_brief,
              module_key, sample_image, project_id, submitted_at, snapshot_revision,
              work_updated_at, completed_at
         FROM classroom_course_runs_for_account_v2($1)`,
      [context.accountId],
    );
    return { items: seatCourseRuns(result.rows as SeatCourseRunRow[]) };
  }

  @Post('account/course-runs/:runId/lessons/:lessonId/progress')
  @HttpCode(200)
  async setAccountCourseLessonProgress(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Param('lessonId') lessonId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['completed']);
    const completed = shape.ok ? shape.body['completed'] : null;
    if (
      !UUID_PATTERN.test(runId) ||
      !UUID_PATTERN.test(lessonId) ||
      typeof completed !== 'boolean'
    ) {
      throw new HttpException(error('validation_error', 'completed must be boolean'), 400);
    }
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const result = await this.requirePool().query(
      `SELECT result_code, completed_at
         FROM classroom_course_material_progress_set_for_account($1, $2, $3, $4)`,
      [context.accountId, runId, lessonId, completed],
    );
    const row = result.rows[0] as
      | { result_code: 'ok' | 'lesson_not_found' | 'course_closed'; completed_at: Date | null }
      | undefined;
    if (!row || row.result_code === 'lesson_not_found') {
      throw new HttpException(error('course_lesson_not_found', 'Урок недоступен.'), 404);
    }
    if (row.result_code === 'course_closed') {
      throw new HttpException(error('course_closed', 'Курс уже закрыт.'), 409);
    }
    return { completedAt: row.completed_at ? isoDate(row.completed_at) : null };
  }

  @Get('me/assignments')
  async assignments(@Req() request: FastifyRequest) {
    const seat = await this.currentSeat(request);
    const result = await this.requirePool().query(
      `SELECT id, title, brief, goal, module_key, due_at, status, sample_image, project_id,
              submitted_at, snapshot_revision, updated_at
         FROM classroom_assignments_for_seat($1)`,
      [seat.seat_id],
    );
    return {
      items: (result.rows as AssignmentForSeatRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        brief: row.brief,
        goal: row.goal,
        moduleKey: row.module_key,
        dueAt: row.due_at ? isoDate(row.due_at) : null,
        status: row.status,
        sampleImage: row.sample_image,
        projectId: row.project_id,
        submittedAt: row.submitted_at ? isoDate(row.submitted_at) : null,
        snapshotRevision: row.snapshot_revision === null ? null : Number(row.snapshot_revision),
        updatedAt: row.updated_at ? isoDate(row.updated_at) : null,
      })),
    };
  }

  /** Published tests for the current learner seat; no answer key crosses this boundary. */
  @Get('me/quizzes')
  async quizzes(@Req() request: FastifyRequest) {
    const seat = await this.currentSeat(request);
    const result = await this.requirePool().query(`SELECT * FROM quiz_assignments_for_seat($1)`, [
      seat.seat_id,
    ]);
    return { items: seatQuizzes(result.rows as QuizForSeatRow[]) };
  }

  /** Published courses assigned to the learner's current class. */
  @Get('me/course-runs')
  async courseRuns(@Req() request: FastifyRequest) {
    const seat = await this.currentSeat(request);
    const result = await this.requirePool().query(
      `SELECT run_id, course_id, course_version_id, version_number, classroom_title,
              run_title, run_summary, due_at, run_status, lesson_id, source_lesson_id,
              section_title, section_summary, section_position, lesson_title, lesson_summary,
              lesson_content, lesson_blocks, lesson_kind, estimated_minutes, lesson_position,
              classroom_assignment_id, assignment_title, assignment_goal, assignment_brief,
              module_key, sample_image, project_id, submitted_at, snapshot_revision,
              work_updated_at, completed_at
         FROM classroom_course_runs_for_seat_v2($1)`,
      [seat.seat_id],
    );
    return { items: seatCourseRuns(result.rows as SeatCourseRunRow[]) };
  }

  /** Material completion is explicit; assignment completion comes from submission. */
  @Post('me/course-runs/:runId/lessons/:lessonId/progress')
  @HttpCode(200)
  async setCourseLessonProgress(
    @Req() request: FastifyRequest,
    @Param('runId') runId: string,
    @Param('lessonId') lessonId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['completed']);
    const completed = shape.ok ? shape.body['completed'] : null;
    if (
      !UUID_PATTERN.test(runId) ||
      !UUID_PATTERN.test(lessonId) ||
      typeof completed !== 'boolean'
    ) {
      throw new HttpException(error('validation_error', 'completed must be boolean'), 400);
    }
    const seat = await this.currentSeat(request);
    const result = await this.requirePool().query(
      `SELECT result_code, completed_at
         FROM classroom_course_material_progress_set($1, $2, $3, $4)`,
      [seat.seat_id, runId, lessonId, completed],
    );
    const row = result.rows[0] as
      | { result_code: 'ok' | 'lesson_not_found' | 'course_closed'; completed_at: Date | null }
      | undefined;
    if (!row || row.result_code === 'lesson_not_found') {
      throw new HttpException(error('course_lesson_not_found', 'Урок недоступен.'), 404);
    }
    if (row.result_code === 'course_closed') {
      throw new HttpException(error('course_closed', 'Курс уже закрыт.'), 409);
    }
    return { completedAt: row.completed_at ? isoDate(row.completed_at) : null };
  }

  /** Versioned uploaded sample, available to a learner or a teacher of the class. */
  @Get('course-runs/:runId/lessons/:lessonId/sample')
  async courseRunSample(
    @Req() request: FastifyRequest,
    @Res({ passthrough: false }) reply: FastifyReply,
    @Param('runId') runId: string,
    @Param('lessonId') lessonId: string,
  ): Promise<void> {
    if (!UUID_PATTERN.test(runId) || !UUID_PATTERN.test(lessonId)) {
      throw new HttpException(error('validation_error', 'course media is invalid'), 400);
    }
    let seatId: string | null = null;
    let accountId: string | null = null;
    if (request.cookies[STUDENT_SESSION_COOKIE]) {
      seatId = (await this.currentSeat(request)).seat_id;
    } else {
      const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
      if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
      accountId = context.accountId;
    }
    const result = await this.requirePool().query(
      `SELECT sample_bytes, content_type
         FROM classroom_course_run_media($1, $2, $3, $4)`,
      [runId, lessonId, seatId, accountId],
    );
    const row = result.rows[0] as { sample_bytes: Buffer; content_type: string } | undefined;
    if (!row) throw new HttpException(error('media_not_found', 'Образец не найден.'), 404);
    reply.header('Cache-Control', 'private, max-age=3600, immutable');
    reply.type(row.content_type).send(row.sample_bytes);
  }

  /**
   * Место, с которого человек работает над этим заданием.
   *
   * Ребёнок сидит на месте по сессии места; взрослый вошёл своим аккаунтом, и
   * его место находится по классу, которому задание принадлежит. Дальше всё
   * одинаково: сдача, значки и отклики висят на месте, а не на способе входа.
   */
  private async seatForAssignment(request: FastifyRequest, assignmentId: string): Promise<string> {
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    if (token) return (await this.currentSeat(request)).seat_id;

    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const result = await this.requirePool().query(
      `SELECT classroom_seat_for_account_assignment($1, $2) AS id`,
      [context.accountId, assignmentId],
    );
    const seatId = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!seatId) {
      throw new HttpException(error('assignment_unavailable', 'Задание недоступно.'), 404);
    }
    return seatId;
  }

  /** Submit one immutable quiz attempt and return only the released feedback. */
  @Post('me/quizzes/:assignmentId/submit')
  @HttpCode(200)
  async submitQuiz(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['answers', 'clientRequestId']);
    const answers = shape.ok ? shape.body['answers'] : null;
    const clientRequestId = shape.ok ? shape.body['clientRequestId'] : null;
    if (
      !UUID_PATTERN.test(assignmentId) ||
      !Array.isArray(answers) ||
      answers.length > 100 ||
      answers.some(
        (answer) =>
          !answer ||
          typeof answer !== 'object' ||
          typeof (answer as Record<string, unknown>)['questionVersionId'] !== 'string' ||
          !UUID_PATTERN.test(String((answer as Record<string, unknown>)['questionVersionId'])) ||
          !Object.hasOwn(answer as object, 'answer'),
      ) ||
      typeof clientRequestId !== 'string' ||
      !/^[A-Za-z0-9._:-]{8,128}$/.test(clientRequestId)
    ) {
      throw new HttpException(error('validation_error', 'Проверьте ответы теста.'), 400);
    }
    const seatId = await this.seatForAssignment(request, assignmentId);
    const result = await this.requirePool().query(
      `SELECT result_code, attempt_id, submission_id, attempt_number,
              raw_points, max_points, percentage_basis_points, outcome,
              late_state, question_results, reused
         FROM quiz_submission_create($1, $2, $3::jsonb, $4)`,
      [seatId, assignmentId, JSON.stringify(answers), clientRequestId],
    );
    const row = result.rows[0] as
      | {
          result_code: string;
          attempt_id: string | null;
          submission_id: string | null;
          attempt_number: number | string | null;
          raw_points: number | string | null;
          max_points: number | string | null;
          percentage_basis_points: number | string | null;
          outcome: string | null;
          late_state: string | null;
          question_results: unknown;
          reused: boolean;
        }
      | undefined;
    if (!row || row.result_code === 'assignment_unavailable') {
      throw new HttpException(error('assignment_unavailable', 'Тест недоступен.'), 404);
    }
    if (row.result_code === 'attempt_limit_reached') {
      throw new HttpException(error('attempt_limit_reached', 'Попытки закончились.'), 409);
    }
    if (row.result_code !== 'ok' || !row.attempt_id || !row.submission_id) {
      throw new HttpException(error('quiz_submission_failed', 'Не удалось проверить тест.'), 409);
    }
    return {
      attemptId: row.attempt_id,
      submissionId: row.submission_id,
      attemptNumber: Number(row.attempt_number),
      points: Number(row.raw_points),
      maxPoints: Number(row.max_points),
      percentage: Number(row.percentage_basis_points) / 100,
      outcome: row.outcome,
      lateState: row.late_state,
      questionResults: row.question_results,
      reused: row.reused,
    };
  }

  /**
   * Records the project a learner just made as their copy of an assignment.
   *
   * The project is created through the ordinary route first, so nothing about
   * making a project is reimplemented here — this only ties the two together,
   * and the database refuses any project that is not the learner's own.
   */
  @Post('me/assignments/:assignmentId/work')
  @HttpCode(200)
  async startAssignment(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['projectId']);
    const projectId = shape.ok ? shape.body['projectId'] : null;
    if (typeof projectId !== 'string' || !UUID_PATTERN.test(projectId)) {
      throw new HttpException(error('validation_error', 'project is invalid'), 400);
    }
    if (!UUID_PATTERN.test(assignmentId)) {
      throw new HttpException(error('validation_error', 'assignment is invalid'), 400);
    }
    const seatId = await this.seatForAssignment(request, assignmentId);
    const result = await this.requirePool().query(
      `SELECT project_id, submitted_at FROM classroom_assignment_work_start($1, $2, $3)`,
      [seatId, assignmentId, projectId],
    );
    const row = result.rows[0] as { project_id: string; submitted_at: Date | null } | undefined;
    if (!row) throw new HttpException(error('assignment_unavailable', 'Задание недоступно.'), 404);
    return {
      projectId: row.project_id,
      submittedAt: row.submitted_at ? isoDate(row.submitted_at) : null,
    };
  }

  /**
   * The badges this learner has been given.
   *
   * A badge nobody sees is a row in a table. The learner reads their own — with
   * the reason their teacher wrote, which is the half that is remembered.
   */
  @Get('me/awards')
  async myAwards(@Req() request: FastifyRequest) {
    const seat = await this.currentSeat(request);
    const result = await this.requirePool().query(
      `SELECT award_key, note, created_at, awarded_by_display_name
         FROM classroom_seat_awards_list($1)`,
      [seat.seat_id],
    );
    return {
      items: (
        result.rows as Array<{
          award_key: string;
          note: string | null;
          created_at: Date | string;
          awarded_by_display_name: string;
        }>
      ).map((row) => ({
        awardKey: row.award_key,
        note: row.note,
        createdAt: isoDate(row.created_at),
        awardedBy: row.awarded_by_display_name,
      })),
    };
  }

  /**
   * Freeze one attempt for review.
   *
   * A submitted snapshot is immutable. A teacher can request changes, which
   * opens a new numbered attempt; the old submission remains evidence.
   */
  @Post('me/assignments/:assignmentId/submit')
  @HttpCode(200)
  async submitAssignment(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const shape = checkBodyShape(rawBody, ['submitted', 'clientRequestId']);
    const submitted = shape.ok ? shape.body['submitted'] : null;
    const clientRequestId = shape.ok ? shape.body['clientRequestId'] : null;
    if (typeof submitted !== 'boolean' || !UUID_PATTERN.test(assignmentId)) {
      throw new HttpException(error('validation_error', 'submitted must be boolean'), 400);
    }
    if (!submitted) {
      throw new HttpException(
        error(
          'submission_immutable',
          'Сданную попытку нельзя отозвать. Педагог может вернуть её на доработку.',
        ),
        409,
      );
    }
    if (
      clientRequestId !== null &&
      (typeof clientRequestId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(clientRequestId))
    ) {
      throw new HttpException(error('validation_error', 'clientRequestId is invalid'), 400);
    }
    const seatId = await this.seatForAssignment(request, assignmentId);
    const result = await this.requirePool().query(
      `SELECT result_code, attempt_id, submission_id, attempt_number, attempt_state,
              project_id, project_version_id, submitted_at, late_state, reused
         FROM learning_project_submission_create($1, $2, $3)`,
      [seatId, assignmentId, clientRequestId ?? randomUUID()],
    );
    const row = result.rows[0] as
      | {
          result_code: string;
          attempt_id: string | null;
          submission_id: string | null;
          attempt_number: number | string | null;
          attempt_state: string | null;
          project_id: string | null;
          project_version_id: string | null;
          submitted_at: Date | string | null;
          late_state: string | null;
          reused: boolean;
        }
      | undefined;
    if (!row || row.result_code === 'assignment_unavailable') {
      throw new HttpException(error('assignment_unavailable', 'Задание недоступно.'), 404);
    }
    if (row.result_code === 'attempt_already_submitted') {
      throw new HttpException(
        error('attempt_already_submitted', 'Эта попытка уже отправлена на проверку.'),
        409,
      );
    }
    if (row.result_code !== 'ok' || !row.project_id || !row.submitted_at) {
      throw new HttpException(error('submission_failed', 'Не удалось зафиксировать сдачу.'), 409);
    }
    return {
      projectId: row.project_id,
      projectVersionId: row.project_version_id,
      attemptId: row.attempt_id,
      submissionId: row.submission_id,
      attemptNumber: Number(row.attempt_number),
      state: row.attempt_state,
      submittedAt: isoDate(row.submitted_at),
      lateState: row.late_state,
      reused: row.reused,
    };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ ok: true }> {
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    if (token) {
      const active = await this.requirePool().query(
        `SELECT seat_id FROM classroom_student_session_context($1)`,
        [hashSessionToken(token)],
      );
      const seatId = (active.rows[0] as { seat_id: string } | undefined)?.seat_id;
      await this.requirePool().query(`SELECT classroom_student_session_revoke($1)`, [
        hashSessionToken(token),
      ]);
      if (seatId) await this.recordSeatActivity(seatId, 'seat.signed_out');
    }
    reply.clearCookie(STUDENT_SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }
}
