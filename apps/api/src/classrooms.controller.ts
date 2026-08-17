import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import type { GetTeachingContextUseCase } from '@asa-lab/organization';
import {
  areValidTopicKeys,
  classroomCodeFor,
  classroomCodeHash,
  isClassroomAgeBand,
  isClassroomStatus,
  isSeatAvatarKey,
  isValidClassroomTitle,
  type Classroom,
  type CreateClassroomUseCase,
  type ListClassroomsUseCase,
} from '@asa-lab/classroom';
import { classroomCodeSecret } from './classroom-code-secret.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape, checkIdempotencyKey, isPlainObject } from './validation.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDLE_PATTERN = /^[a-z0-9._-]{3,32}$/;
const SEAT_STATUSES = ['issued', 'active', 'suspended'] as const;

interface ClassroomSummaryRow {
  id: string;
  title: string;
  status: string;
  age_band: Classroom['ageBand'];
  topic_keys: string[];
  safe_mode_default: boolean;
  created_at: Date | string;
  join_code_version: number | string | null;
  join_code_status: 'active' | 'revoked' | null;
  student_count: number | string;
  teacher_role: 'owner' | 'co_teacher';
  workspace_kind: 'personal' | 'organization';
  workspace_title: string;
  archived_at: Date | string | null;
}

interface ClassroomCreationContext {
  tenantId: string;
  schoolId: string;
  academicPeriodId: string;
  userId: string;
}

interface StudentSeatRow {
  id: string;
  display_label: string;
  login_handle: string;
  safe_mode: boolean;
  status: 'issued' | 'active' | 'suspended';
  avatar_key: string | null;
  last_active_at: Date | string | null;
  created_at: Date | string;
}

interface ClassroomActivityRow {
  id: string;
  action: string;
  seat_id: string | null;
  seat_label: string | null;
  actor_is_teacher: boolean;
  project_id: string | null;
  project_title: string | null;
  occurrence_count: number | string;
  first_occurred_at: Date | string;
  occurred_at: Date | string;
}

interface SeatProjectRow {
  id: string;
  module_key: string;
  title: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  snapshot_revision: number | string | null;
  preview_json: unknown;
  preview_digest: string | null;
  last_editor_was_teacher: boolean;
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function classroomView(classroom: Classroom) {
  return {
    ...classroom,
    joinCode:
      classroom.joinCodeVersion && classroom.joinCodeStatus === 'active'
        ? classroomCodeFor(classroom.id, classroom.joinCodeVersion, classroomCodeSecret())
        : null,
  };
}

function summaryView(row: ClassroomSummaryRow) {
  const joinCodeVersion = row.join_code_version === null ? null : Number(row.join_code_version);
  return classroomView({
    id: row.id,
    title: row.title,
    status: row.status,
    ageBand: row.age_band,
    topicKeys: row.topic_keys ?? [],
    safeModeDefault: row.safe_mode_default,
    studentCount: Number(row.student_count),
    joinCodeVersion,
    joinCodeStatus: row.join_code_status,
    teacherRole: row.teacher_role,
    workspaceKind: row.workspace_kind,
    workspaceTitle: row.workspace_title,
    createdAt: iso(row.created_at),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
  });
}

function seatView(row: StudentSeatRow) {
  return {
    id: row.id,
    displayLabel: row.display_label,
    loginHandle: row.login_handle,
    safeMode: row.safe_mode,
    status: row.status,
    // Null means "nobody has chosen"; the client draws one from the built-in
    // set keyed by the seat, so a class looks like a class from the first
    // minute without a picture having to be picked thirty times.
    avatarKey: row.avatar_key,
    lastActiveAt: row.last_active_at ? iso(row.last_active_at) : null,
    createdAt: iso(row.created_at),
  };
}

function fallbackHandle(): string {
  return `student-${randomBytes(3).toString('hex')}`;
}

@Controller('api/classrooms')
export class ClassroomsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.teachingContextUseCase)
    private readonly teachingContext: GetTeachingContextUseCase,
    @Inject(TOKENS.createClassroomUseCase) private readonly createUseCase: CreateClassroomUseCase,
    @Inject(TOKENS.listClassroomsUseCase) private readonly listUseCase: ListClassroomsUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool) {
      throw new HttpException(error('database_unavailable', 'database is not configured'), 503);
    }
    return this.pool;
  }

  private async requireContext(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    return context;
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.requireContext(request);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Классы доступны педагогам.'), 403);
    }
    return context;
  }

  private async creationContext(context: ActiveContext): Promise<ClassroomCreationContext> {
    if (context.workspaceKind === 'organization') {
      const teaching = await this.teachingContext.execute(context.tenantId, context.schoolId);
      if (!teaching.ok) {
        throw new HttpException(
          error(
            teaching.code,
            teaching.code === 'no_active_period'
              ? 'В школе нет активного учебного периода.'
              : 'В этом пространстве не выбрана школа.',
          ),
          409,
        );
      }
      if (!context.userId) {
        throw new HttpException(
          error('no_school_assigned', 'В этом пространстве не выбрана школа.'),
          409,
        );
      }
      return {
        tenantId: context.tenantId,
        schoolId: teaching.context.schoolId,
        academicPeriodId: teaching.context.academicPeriodId,
        userId: context.userId,
      };
    }
    const result = await this.requirePool().query(
      `SELECT tenant_id, school_id, academic_period_id, user_id
         FROM classroom_ensure_personal_teacher($1)`,
      [context.accountId],
    );
    const row = result.rows[0] as
      | { tenant_id: string; school_id: string; academic_period_id: string; user_id: string }
      | undefined;
    if (!row) {
      throw new HttpException(
        error('teaching_context_unavailable', 'Не удалось подготовить личные классы.'),
        409,
      );
    }
    return {
      tenantId: row.tenant_id,
      schoolId: row.school_id,
      academicPeriodId: row.academic_period_id,
      userId: row.user_id,
    };
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  private async summary(context: ActiveContext, classroomId: string) {
    this.requireUuid(classroomId, 'classroom');
    const result = await this.requirePool().query(
      `SELECT id, title, status, age_band, topic_keys, safe_mode_default,
              created_at, archived_at, join_code_version, join_code_status, student_count,
              teacher_role, workspace_kind, workspace_title
         FROM classroom_management_summary($1, $2)`,
      [context.accountId, classroomId],
    );
    const row = result.rows[0] as ClassroomSummaryRow | undefined;
    if (!row) throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    return summaryView(row);
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const items = await this.listUseCase.execute(context.accountId);
    return { items: items.map(classroomView), meta: { total: items.length } };
  }

  @Get(':classroomId')
  async get(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    return { classroom: await this.summary(await this.requireEducator(request), classroomId) };
  }

  @Post()
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
  ) {
    const context = await this.requireEducator(request);
    if (isPlainObject(rawBody) && ('tenant_id' in rawBody || 'tenantId' in rawBody)) {
      throw new HttpException(error('validation_error', 'tenant is derived from the session'), 400);
    }
    const shape = checkBodyShape(rawBody, ['title', 'ageBand', 'topicKeys', 'safeModeDefault']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const keyCheck = checkIdempotencyKey(idempotencyHeader);
    if (!keyCheck.ok) {
      throw new HttpException(error('invalid_idempotency_key', keyCheck.message), 400);
    }
    const teaching = await this.creationContext(context);
    const classroomId = randomUUID();
    const ageBand = shape.body['ageBand'] ?? 'mixed';
    const topicKeys = shape.body['topicKeys'] ?? [];
    const safeModeDefault = shape.body['safeModeDefault'] ?? true;
    const joinCode = classroomCodeFor(classroomId, 1, classroomCodeSecret());
    const result = await this.createUseCase.execute({
      accountId: context.accountId,
      tenantId: teaching.tenantId,
      classroomId,
      schoolId: teaching.schoolId,
      academicPeriodId: teaching.academicPeriodId,
      teacherId: teaching.userId,
      title: shape.body['title'],
      ageBand,
      topicKeys,
      safeModeDefault,
      joinCodeHash: classroomCodeHash(joinCode),
      idempotencyKey: keyCheck.key,
    });
    if (!result.ok) {
      throw new HttpException(
        error(result.code, result.message),
        result.code === 'idempotency_conflict' ? 409 : 400,
      );
    }
    reply.code(result.created ? 201 : 200);
    return { classroom: await this.summary(context, result.classroom.id), created: result.created };
  }

  @Get(':classroomId/roster')
  async roster(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const result = await this.requirePool().query(
      `SELECT id, display_label, login_handle, safe_mode, status, avatar_key, last_active_at, created_at
         FROM classroom_management_roster($1, $2)`,
      [context.accountId, classroomId],
    );
    return { items: (result.rows as StudentSeatRow[]).map(seatView) };
  }

  /**
   * What happened in this class. The database applies the teacher check and the
   * seat filter, so a caller cannot ask about a learner in someone else's
   * class by editing the request.
   */
  @Get(':classroomId/activity')
  async activity(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Query('seatId') seatId: string | undefined,
    @Query('kind') kind: string | undefined,
  ) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT id, action, seat_id, seat_label, actor_is_teacher, project_id,
              project_title, occurrence_count, first_occurred_at, occurred_at
         FROM classroom_activity_feed($1, $2, $3, 200)`,
      [context.principalId, classroomId, seatId ?? null],
    );
    const rows = result.rows as ClassroomActivityRow[];
    const projectsOnly = kind === 'projects';
    return {
      items: rows
        .filter((row) => (projectsOnly ? row.project_id !== null : true))
        .map((row) => ({
          id: row.id,
          action: row.action,
          seatId: row.seat_id,
          seatLabel: row.seat_label,
          byTeacher: row.actor_is_teacher === true,
          projectId: row.project_id,
          projectTitle: row.project_title,
          count: Number(row.occurrence_count),
          firstAt: String(row.first_occurred_at),
          at: String(row.occurred_at),
        })),
    };
  }

  /** One learner: who they are, what they made, and what they have been doing. */
  @Get(':classroomId/students/:seatId')
  async student(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
  ) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const [roster, projects, activity] = await Promise.all([
      this.requirePool().query(
        `SELECT id, display_label, login_handle, safe_mode, status, avatar_key, last_active_at, created_at
           FROM classroom_management_roster($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.requirePool().query(
        `SELECT id, module_key, title, status, created_at, updated_at,
                snapshot_revision, preview_json, preview_digest, last_editor_was_teacher
           FROM classroom_seat_projects($1, $2)`,
        [context.principalId, seatId],
      ),
      this.requirePool().query(
        `SELECT id, action, seat_id, seat_label, actor_is_teacher, project_id,
                project_title, occurrence_count, first_occurred_at, occurred_at
           FROM classroom_activity_feed($1, $2, $3, 100)`,
        [context.principalId, classroomId, seatId],
      ),
    ]);
    const seat = (roster.rows as StudentSeatRow[]).find((row) => row.id === seatId);
    if (!seat) {
      throw new HttpException(error('not_found', 'Ученик не найден в этом классе.'), 404);
    }
    return {
      student: seatView(seat),
      projects: (projects.rows as SeatProjectRow[]).map((row) => ({
        id: row.id,
        moduleKey: row.module_key,
        title: row.title,
        status: row.status,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        snapshotRevision: row.snapshot_revision === null ? null : Number(row.snapshot_revision),
        preview:
          row.preview_json && row.preview_digest
            ? { digest: row.preview_digest, descriptor: row.preview_json }
            : null,
        lastEditedByTeacher: row.last_editor_was_teacher === true,
      })),
      activity: (activity.rows as ClassroomActivityRow[]).map((row) => ({
        id: row.id,
        action: row.action,
        seatId: row.seat_id,
        seatLabel: row.seat_label,
        byTeacher: row.actor_is_teacher === true,
        projectId: row.project_id,
        projectTitle: row.project_title,
        count: Number(row.occurrence_count),
        firstAt: String(row.first_occurred_at),
        at: String(row.occurred_at),
      })),
    };
  }

  @Post(':classroomId/seats')
  async addSeat(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['displayLabel', 'loginHandle', 'safeMode']);
    const displayLabel = shape.ok ? shape.body['displayLabel'] : null;
    const requestedHandle = shape.ok ? shape.body['loginHandle'] : undefined;
    const safeMode = shape.ok ? (shape.body['safeMode'] ?? true) : null;
    const loginHandle =
      typeof requestedHandle === 'string' && requestedHandle.trim()
        ? requestedHandle.trim().toLowerCase()
        : fallbackHandle();
    if (
      !shape.ok ||
      typeof displayLabel !== 'string' ||
      displayLabel.trim().length < 1 ||
      displayLabel.trim().length > 120 ||
      !HANDLE_PATTERN.test(loginHandle) ||
      typeof safeMode !== 'boolean'
    ) {
      throw new HttpException(
        error('validation_error', 'Проверьте имя ученика и имя для входа.'),
        400,
      );
    }
    try {
      const result = await this.requirePool().query(
        `SELECT id, display_label, login_handle, safe_mode, status, avatar_key, last_active_at, created_at
           FROM classroom_management_add_seat($1, $2, $3, $4, $5)`,
        [context.accountId, classroomId, displayLabel.trim(), loginHandle, safeMode],
      );
      reply.code(201);
      return { student: seatView(result.rows[0] as StudentSeatRow) };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new HttpException(
          error('handle_taken', 'Это имя для входа уже занято в классе.'),
          409,
        );
      }
      if (message.includes('unavailable')) {
        throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
      }
      throw failure;
    }
  }

  @Post(':classroomId/seats/batch')
  async addSeatsBatch(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['students']);
    const students = shape.ok ? shape.body['students'] : null;
    if (!Array.isArray(students) || students.length < 1 || students.length > 100) {
      throw new HttpException(error('validation_error', 'Добавьте от 1 до 100 учеников.'), 400);
    }
    const results: Array<{
      index: number;
      ok: boolean;
      student?: ReturnType<typeof seatView>;
      message?: string;
    }> = [];
    for (const [index, item] of students.entries()) {
      if (!isPlainObject(item)) {
        results.push({ index, ok: false, message: 'Строка не распознана.' });
        continue;
      }
      const displayLabel = item['displayLabel'];
      const requested = item['loginHandle'];
      const safeMode = item['safeMode'] ?? true;
      const loginHandle =
        typeof requested === 'string' && requested.trim()
          ? requested.trim().toLowerCase()
          : fallbackHandle();
      if (
        typeof displayLabel !== 'string' ||
        displayLabel.trim().length < 1 ||
        displayLabel.trim().length > 120 ||
        !HANDLE_PATTERN.test(loginHandle) ||
        typeof safeMode !== 'boolean'
      ) {
        results.push({ index, ok: false, message: 'Проверьте имя и логин.' });
        continue;
      }
      try {
        const inserted = await this.requirePool().query(
          `SELECT id, display_label, login_handle, safe_mode, status, avatar_key, last_active_at, created_at
             FROM classroom_management_add_seat($1, $2, $3, $4, $5)`,
          [context.accountId, classroomId, displayLabel.trim(), loginHandle, safeMode],
        );
        results.push({ index, ok: true, student: seatView(inserted.rows[0] as StudentSeatRow) });
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : '';
        results.push({
          index,
          ok: false,
          message: message.includes('unique')
            ? 'Имя для входа уже занято.'
            : 'Не удалось добавить.',
        });
      }
    }
    return { results, created: results.filter((item) => item.ok).length };
  }

  @Patch(':classroomId/seats/:seatId')
  async updateSeat(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(seatId, 'student seat');
    const shape = checkBodyShape(rawBody, [
      'displayLabel',
      'loginHandle',
      'safeMode',
      'status',
      'avatarKey',
    ]);
    const displayLabel = shape.ok ? shape.body['displayLabel'] : null;
    const loginHandle = shape.ok ? shape.body['loginHandle'] : null;
    const safeMode = shape.ok ? shape.body['safeMode'] : null;
    const status = shape.ok ? shape.body['status'] : null;
    const avatarKey = shape.ok ? (shape.body['avatarKey'] ?? null) : null;
    if (
      !shape.ok ||
      typeof displayLabel !== 'string' ||
      displayLabel.trim().length < 1 ||
      displayLabel.trim().length > 120 ||
      typeof loginHandle !== 'string' ||
      !HANDLE_PATTERN.test(loginHandle.trim().toLowerCase()) ||
      typeof safeMode !== 'boolean' ||
      typeof status !== 'string' ||
      !SEAT_STATUSES.includes(status as (typeof SEAT_STATUSES)[number]) ||
      !isSeatAvatarKey(avatarKey)
    ) {
      throw new HttpException(error('validation_error', 'Проверьте настройки ученика.'), 400);
    }
    try {
      const result = await this.requirePool().query(
        `SELECT id, display_label, login_handle, safe_mode, status, avatar_key, last_active_at, created_at
           FROM classroom_management_update_seat($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          context.accountId,
          classroomId,
          seatId,
          displayLabel.trim(),
          loginHandle.trim().toLowerCase(),
          safeMode,
          status,
          avatarKey,
        ],
      );
      return { student: seatView(result.rows[0] as StudentSeatRow) };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new HttpException(error('handle_taken', 'Это имя для входа уже занято.'), 409);
      }
      throw failure;
    }
  }

  @Delete(':classroomId/seats/:seatId')
  async removeSeat(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(seatId, 'student seat');
    const result = await this.requirePool().query(
      `SELECT classroom_management_remove_seat($1, $2, $3) AS removed`,
      [context.accountId, classroomId, seatId],
    );
    if (result.rows[0]?.removed !== true) {
      throw new HttpException(error('student_not_found', 'Ученик не найден.'), 404);
    }
    return { removed: true as const };
  }

  /**
   * Everything about a class that a teacher can correct without entering it:
   * the name they typed in a hurry, the age band they picked by accident, the
   * subjects, and whether safe mode is on. One request, because to the teacher
   * it is one act — fixing the class.
   */
  @Patch(':classroomId')
  async updateDetails(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    const current = await this.summary(context, classroomId);
    const shape = checkBodyShape(rawBody, ['title', 'ageBand', 'topicKeys', 'safeModeDefault']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'] ?? current.title;
    const ageBand = shape.body['ageBand'] ?? current.ageBand;
    const topicKeys = shape.body['topicKeys'] ?? current.topicKeys;
    const safeModeDefault = shape.body['safeModeDefault'] ?? current.safeModeDefault;
    if (!isValidClassroomTitle(title)) {
      throw new HttpException(error('validation_error', 'Название класса обязательно.'), 400);
    }
    if (!isClassroomAgeBand(ageBand)) {
      throw new HttpException(error('validation_error', 'Неизвестный возраст учеников.'), 400);
    }
    if (!areValidTopicKeys(topicKeys)) {
      throw new HttpException(error('validation_error', 'Неизвестные направления.'), 400);
    }
    if (typeof safeModeDefault !== 'boolean') {
      throw new HttpException(error('validation_error', 'Safe Mode must be boolean.'), 400);
    }
    await this.requirePool().query(
      `SELECT classroom_management_update_details($1, $2, $3, $4, $5, $6)`,
      [
        context.accountId,
        classroomId,
        title.trim(),
        ageBand,
        [...topicKeys].sort(),
        safeModeDefault,
      ],
    );
    return { classroom: await this.summary(context, classroomId) };
  }

  /**
   * Put a class away, bring it back, or remove it.
   *
   * Removal keeps the rows: a class holds children's work and a record of who
   * did what. What the teacher asked for — it is gone from my lists, nobody can
   * get in — is exactly what the state delivers, and a mistake stays undoable
   * by someone who can read the audit trail.
   */
  @Post(':classroomId/status')
  async setStatus(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['status']);
    const status = shape.ok ? shape.body['status'] : null;
    if (!isClassroomStatus(status)) {
      throw new HttpException(error('validation_error', 'Неизвестное состояние класса.'), 400);
    }
    try {
      await this.requirePool().query(`SELECT classroom_management_set_status($1, $2, $3)`, [
        context.accountId,
        classroomId,
        status,
      ]);
    } catch (cause) {
      // The database is the authority on who may do this; it answers with one
      // of two refusals and neither should read as a server fault.
      const message = cause instanceof Error ? cause.message : '';
      if (message.includes('owner required')) {
        throw new HttpException(
          error('owner_required', 'Удалить класс может только основной преподаватель.'),
          403,
        );
      }
      if (message.includes('classroom unavailable')) {
        throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
      }
      throw cause;
    }
    if (status === 'deleted') return { removed: true as const };
    return { classroom: await this.summary(context, classroomId) };
  }

  @Patch(':classroomId/policies')
  async updatePolicy(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['safeModeDefault']);
    const safeModeDefault = shape.ok ? shape.body['safeModeDefault'] : null;
    if (!shape.ok || typeof safeModeDefault !== 'boolean') {
      throw new HttpException(error('validation_error', 'Safe Mode must be boolean.'), 400);
    }
    await this.requirePool().query(`SELECT classroom_management_update_policy($1, $2, $3)`, [
      context.accountId,
      classroomId,
      safeModeDefault,
    ]);
    return { classroom: await this.summary(context, classroomId) };
  }

  @Post(':classroomId/join-code/rotate')
  async rotateJoinCode(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    const current = await this.summary(context, classroomId);
    const version = (current.joinCodeVersion ?? 0) + 1;
    const joinCode = classroomCodeFor(classroomId, version, classroomCodeSecret());
    await this.requirePool().query(`SELECT classroom_management_rotate_join_code($1, $2, $3, $4)`, [
      context.accountId,
      classroomId,
      classroomCodeHash(joinCode),
      version,
    ]);
    return { classroom: await this.summary(context, classroomId) };
  }

  @Delete(':classroomId/join-code')
  async revokeJoinCode(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    await this.requirePool().query(`SELECT classroom_management_revoke_join_code($1, $2)`, [
      context.accountId,
      classroomId,
    ]);
    return { classroom: await this.summary(context, classroomId) };
  }
}
