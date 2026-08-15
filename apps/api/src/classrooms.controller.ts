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
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import type { GetTeachingContextUseCase } from '@asa-lab/organization';
import {
  classroomCodeFor,
  classroomCodeHash,
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
}

interface StudentSeatRow {
  id: string;
  display_label: string;
  login_handle: string;
  safe_mode: boolean;
  status: 'issued' | 'active' | 'suspended';
  last_active_at: Date | string | null;
  created_at: Date | string;
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
    createdAt: iso(row.created_at),
  });
}

function seatView(row: StudentSeatRow) {
  return {
    id: row.id,
    displayLabel: row.display_label,
    loginHandle: row.login_handle,
    safeMode: row.safe_mode,
    status: row.status,
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

  private async requireEducator(
    request: FastifyRequest,
  ): Promise<ActiveContext & { userId: string }> {
    const context = await this.requireContext(request);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Классы доступны педагогам.'), 403);
    }
    if (context.userId === null || context.workspaceKind !== 'organization') {
      throw new HttpException(error('school_required', 'Откройте пространство своей школы.'), 403);
    }
    return { ...context, userId: context.userId };
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  private async summary(context: ActiveContext & { userId: string }, classroomId: string) {
    this.requireUuid(classroomId, 'classroom');
    const result = await this.requirePool().query(
      `SELECT id, title, status, age_band, topic_keys, safe_mode_default,
              created_at, join_code_version, join_code_status, student_count
         FROM classroom_teacher_summary($1, $2, $3)`,
      [context.tenantId, context.userId, classroomId],
    );
    const row = result.rows[0] as ClassroomSummaryRow | undefined;
    if (!row) throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    return summaryView(row);
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const items = await this.listUseCase.execute(context.tenantId, context.userId);
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
    const teaching = await this.teachingContext.execute(context.tenantId, context.schoolId);
    if (!teaching.ok) {
      throw new HttpException(error(teaching.code, 'Сначала создайте школу и откройте её.'), 409);
    }
    const classroomId = randomUUID();
    const ageBand = shape.body['ageBand'] ?? 'mixed';
    const topicKeys = shape.body['topicKeys'] ?? [];
    const safeModeDefault = shape.body['safeModeDefault'] ?? true;
    const joinCode = classroomCodeFor(classroomId, 1, classroomCodeSecret());
    const result = await this.createUseCase.execute({
      tenantId: context.tenantId,
      classroomId,
      schoolId: teaching.context.schoolId,
      academicPeriodId: teaching.context.academicPeriodId,
      teacherId: context.userId,
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
    return { classroom: classroomView(result.classroom), created: result.created };
  }

  @Get(':classroomId/roster')
  async roster(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const result = await this.requirePool().query(
      `SELECT id, display_label, login_handle, safe_mode, status, last_active_at, created_at
         FROM classroom_teacher_roster($1, $2, $3)`,
      [context.tenantId, context.userId, classroomId],
    );
    return { items: (result.rows as StudentSeatRow[]).map(seatView) };
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
        `SELECT id, display_label, login_handle, safe_mode, status, last_active_at, created_at
           FROM classroom_teacher_add_seat($1, $2, $3, $4, $5, $6)`,
        [context.tenantId, context.userId, classroomId, displayLabel.trim(), loginHandle, safeMode],
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
          `SELECT id, display_label, login_handle, safe_mode, status, last_active_at, created_at
             FROM classroom_teacher_add_seat($1, $2, $3, $4, $5, $6)`,
          [
            context.tenantId,
            context.userId,
            classroomId,
            displayLabel.trim(),
            loginHandle,
            safeMode,
          ],
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
    const shape = checkBodyShape(rawBody, ['displayLabel', 'loginHandle', 'safeMode', 'status']);
    const displayLabel = shape.ok ? shape.body['displayLabel'] : null;
    const loginHandle = shape.ok ? shape.body['loginHandle'] : null;
    const safeMode = shape.ok ? shape.body['safeMode'] : null;
    const status = shape.ok ? shape.body['status'] : null;
    if (
      !shape.ok ||
      typeof displayLabel !== 'string' ||
      displayLabel.trim().length < 1 ||
      displayLabel.trim().length > 120 ||
      typeof loginHandle !== 'string' ||
      !HANDLE_PATTERN.test(loginHandle.trim().toLowerCase()) ||
      typeof safeMode !== 'boolean' ||
      typeof status !== 'string' ||
      !SEAT_STATUSES.includes(status as (typeof SEAT_STATUSES)[number])
    ) {
      throw new HttpException(error('validation_error', 'Проверьте настройки ученика.'), 400);
    }
    try {
      const result = await this.requirePool().query(
        `SELECT id, display_label, login_handle, safe_mode, status, last_active_at, created_at
           FROM classroom_teacher_update_seat($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          context.tenantId,
          context.userId,
          classroomId,
          seatId,
          displayLabel.trim(),
          loginHandle.trim().toLowerCase(),
          safeMode,
          status,
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
      `SELECT classroom_teacher_remove_seat($1, $2, $3, $4) AS removed`,
      [context.tenantId, context.userId, classroomId, seatId],
    );
    if (result.rows[0]?.removed !== true) {
      throw new HttpException(error('student_not_found', 'Ученик не найден.'), 404);
    }
    return { removed: true as const };
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
    await this.requirePool().query(`SELECT classroom_teacher_update_policy($1, $2, $3, $4)`, [
      context.tenantId,
      context.userId,
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
    await this.requirePool().query(
      `SELECT classroom_teacher_rotate_join_code($1, $2, $3, $4, $5)`,
      [context.tenantId, context.userId, classroomId, classroomCodeHash(joinCode), version],
    );
    return { classroom: await this.summary(context, classroomId) };
  }

  @Delete(':classroomId/join-code')
  async revokeJoinCode(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    await this.requirePool().query(`SELECT classroom_teacher_revoke_join_code($1, $2, $3)`, [
      context.tenantId,
      context.userId,
      classroomId,
    ]);
    return { classroom: await this.summary(context, classroomId) };
  }
}
