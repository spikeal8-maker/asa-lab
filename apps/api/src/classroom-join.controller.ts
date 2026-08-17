import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { classroomCodeHash, formatClassroomCode, normalizeClassroomCode } from '@asa-lab/classroom';
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
  expires_at: Date | string;
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
      `SELECT seat_id, classroom_id, classroom_title, display_label,
              teacher_display_name, safe_mode, expires_at
         FROM classroom_student_seat_sign_in($1, $2, $3, $4)`,
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
      `SELECT seat_id, classroom_id, classroom_title, display_label,
              teacher_display_name, safe_mode, expires_at
         FROM classroom_student_session_context($1)`,
      [hashSessionToken(token)],
    );
    const row = result.rows[0] as StudentSessionRow | undefined;
    return row ? studentPayload(row) : { authenticated: false as const };
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
