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
import {
  classroomCodeHash,
  formatClassroomCode,
  isSeatAvatarKey,
  normalizeClassroomCode,
} from '@asa-lab/classroom';
import { createSessionToken, hashSessionToken } from '@asa-lab/identity';
import { TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

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
  module_key: string;
  due_at: Date | string | null;
  status: 'open' | 'closed';
  project_id: string | null;
  submitted_at: Date | string | null;
}

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
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
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(@Inject(TOKENS.pool) private readonly pool: pg.Pool | null) {}

  private requirePool(): pg.Pool {
    if (!this.pool) {
      throw new HttpException(error('database_unavailable', 'database is not configured'), 503);
    }
    return this.pool;
  }

  private checkRateLimit(request: FastifyRequest): void {
    const key = request.ip || 'unknown';
    const now = Date.now();
    const current = this.attempts.get(key);
    if (!current || current.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
      return;
    }
    current.count += 1;
    if (current.count > MAX_ATTEMPTS) {
      throw new HttpException(
        error('too_many_attempts', 'Слишком много попыток. Подождите несколько минут.'),
        429,
      );
    }
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
    const shape = checkBodyShape(rawBody, ['code', 'loginHandle']);
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
  @Get('me/assignments')
  async assignments(@Req() request: FastifyRequest) {
    const seat = await this.currentSeat(request);
    const result = await this.requirePool().query(
      `SELECT id, title, brief, module_key, due_at, status, project_id, submitted_at
         FROM classroom_assignments_for_seat($1)`,
      [seat.seat_id],
    );
    return {
      items: (result.rows as AssignmentForSeatRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        brief: row.brief,
        moduleKey: row.module_key,
        dueAt: row.due_at ? isoDate(row.due_at) : null,
        status: row.status,
        projectId: row.project_id,
        submittedAt: row.submitted_at ? isoDate(row.submitted_at) : null,
      })),
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
    const seat = await this.currentSeat(request);
    const shape = checkBodyShape(rawBody, ['projectId']);
    const projectId = shape.ok ? shape.body['projectId'] : null;
    if (typeof projectId !== 'string' || !UUID_PATTERN.test(projectId)) {
      throw new HttpException(error('validation_error', 'project is invalid'), 400);
    }
    if (!UUID_PATTERN.test(assignmentId)) {
      throw new HttpException(error('validation_error', 'assignment is invalid'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT project_id, submitted_at FROM classroom_assignment_work_start($1, $2, $3)`,
      [seat.seat_id, assignmentId, projectId],
    );
    const row = result.rows[0] as { project_id: string; submitted_at: Date | null } | undefined;
    if (!row) throw new HttpException(error('assignment_unavailable', 'Задание недоступно.'), 404);
    return {
      projectId: row.project_id,
      submittedAt: row.submitted_at ? isoDate(row.submitted_at) : null,
    };
  }

  /** Handing it in, or taking it back to keep working. */
  @Post('me/assignments/:assignmentId/submit')
  @HttpCode(200)
  async submitAssignment(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const seat = await this.currentSeat(request);
    const shape = checkBodyShape(rawBody, ['submitted']);
    const submitted = shape.ok ? shape.body['submitted'] : null;
    if (typeof submitted !== 'boolean' || !UUID_PATTERN.test(assignmentId)) {
      throw new HttpException(error('validation_error', 'submitted must be boolean'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT project_id, submitted_at FROM classroom_assignment_work_submit($1, $2, $3)`,
      [seat.seat_id, assignmentId, submitted],
    );
    const row = result.rows[0] as { project_id: string; submitted_at: Date | null } | undefined;
    if (!row) throw new HttpException(error('assignment_unavailable', 'Задание недоступно.'), 404);
    return {
      projectId: row.project_id,
      submittedAt: row.submitted_at ? isoDate(row.submitted_at) : null,
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
