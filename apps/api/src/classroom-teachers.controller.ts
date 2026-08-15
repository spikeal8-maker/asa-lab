import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITATION_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function hashInvitation(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

@Controller('api/classrooms')
export class ClassroomTeachersController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool) {
      throw new HttpException(error('database_unavailable', 'database is not configured'), 503);
    }
    return this.pool;
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'Войдите в аккаунт.'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || !['provisional', 'verified'].includes(educator.state)) {
      throw new HttpException(error('educator_required', 'Нужен аккаунт педагога.'), 403);
    }
    return context;
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  @Get(':classroomId/teachers')
  async team(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    this.requireUuid(classroomId, 'classroom');
    const context = await this.requireEducator(request);
    const [team, invitations] = await Promise.all([
      this.requirePool().query(
        `SELECT account_id, display_name, avatar_data_url, teacher_role, joined_at
           FROM classroom_teacher_team($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.requirePool().query(
        `SELECT id, status, expires_at, created_at
           FROM classroom_teacher_invitation_list($1, $2)`,
        [context.accountId, classroomId],
      ),
    ]);
    if (team.rows.length === 0) {
      throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    }
    return {
      items: team.rows.map((row) => ({
        accountId: row.account_id as string,
        displayName: row.display_name as string,
        avatarDataUrl: (row.avatar_data_url as string | null) ?? null,
        role: row.teacher_role as 'owner' | 'co_teacher',
        joinedAt: iso(row.joined_at as Date | string),
      })),
      invitations: invitations.rows.map((row) => ({
        id: row.id as string,
        status: row.status as 'pending' | 'accepted' | 'expired',
        expiresAt: iso(row.expires_at as Date | string),
        createdAt: iso(row.created_at as Date | string),
      })),
    };
  }

  @Post(':classroomId/teacher-invitations')
  async invite(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('classroomId') classroomId: string,
  ) {
    this.requireUuid(classroomId, 'classroom');
    const context = await this.requireEducator(request);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    try {
      const result = await this.requirePool().query(
        `SELECT id, expires_at, created_at
           FROM classroom_teacher_invitation_create($1, $2, $3, $4)`,
        [context.accountId, classroomId, hashInvitation(token), expiresAt],
      );
      const row = result.rows[0];
      reply.code(201);
      return {
        invitation: {
          id: row.id as string,
          status: 'pending' as const,
          expiresAt: iso(row.expires_at as Date | string),
          createdAt: iso(row.created_at as Date | string),
          invitePath: `/#/teacher-invite/${token}`,
        },
      };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('limit reached')) {
        throw new HttpException(
          error(
            'co_teacher_limit',
            'В классе может быть не более пяти активных приглашений и коллег.',
          ),
          409,
        );
      }
      if (message.includes('owner required')) {
        throw new HttpException(
          error('owner_required', 'Приглашать коллег может только основной преподаватель.'),
          403,
        );
      }
      throw failure;
    }
  }

  @Delete(':classroomId/teacher-invitations/:invitationId')
  async revokeInvitation(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('invitationId') invitationId: string,
  ) {
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(invitationId, 'invitation');
    const context = await this.requireEducator(request);
    let result: pg.QueryResult;
    try {
      result = await this.requirePool().query(
        `SELECT classroom_teacher_invitation_revoke($1, $2, $3) AS revoked`,
        [context.accountId, classroomId, invitationId],
      );
    } catch (failure) {
      if (failure instanceof Error && failure.message.includes('owner required')) {
        throw new HttpException(
          error('owner_required', 'Отзывать приглашения может только основной преподаватель.'),
          403,
        );
      }
      throw failure;
    }
    if (result.rows[0]?.revoked !== true) {
      throw new HttpException(error('invitation_not_found', 'Приглашение не найдено.'), 404);
    }
    return { revoked: true as const };
  }

  @Delete(':classroomId/teachers/:teacherAccountId')
  async removeTeacher(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('teacherAccountId') teacherAccountId: string,
  ) {
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(teacherAccountId, 'teacher');
    const context = await this.requireEducator(request);
    let result: pg.QueryResult;
    try {
      result = await this.requirePool().query(
        `SELECT classroom_teacher_remove($1, $2, $3) AS removed`,
        [context.accountId, classroomId, teacherAccountId],
      );
    } catch (failure) {
      if (failure instanceof Error && failure.message.includes('owner required')) {
        throw new HttpException(
          error('owner_required', 'Удалять коллег может только основной преподаватель.'),
          403,
        );
      }
      throw failure;
    }
    if (result.rows[0]?.removed !== true) {
      throw new HttpException(error('teacher_not_found', 'Коллега не найден.'), 404);
    }
    return { removed: true as const };
  }
}

@Controller('api/classroom-teacher-invitations')
export class ClassroomTeacherInvitationsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool)
      throw new HttpException(error('database_unavailable', 'database unavailable'), 503);
    return this.pool;
  }

  private token(value: string): string {
    if (!INVITATION_PATTERN.test(value)) {
      throw new HttpException(error('invalid_invitation', 'Ссылка приглашения повреждена.'), 400);
    }
    return value;
  }

  @Get(':token')
  async resolve(@Param('token') rawToken: string) {
    const token = this.token(rawToken);
    const result = await this.requirePool().query(
      `SELECT classroom_id, classroom_title, owner_display_name, status, expires_at
         FROM classroom_teacher_invitation_resolve($1)`,
      [hashInvitation(token)],
    );
    const row = result.rows[0];
    if (!row)
      throw new HttpException(error('invitation_not_found', 'Приглашение не найдено.'), 404);
    return {
      invitation: {
        classroomId: row.classroom_id as string,
        classroomTitle: row.classroom_title as string,
        ownerDisplayName: row.owner_display_name as string,
        status: row.status as 'pending' | 'accepted' | 'revoked' | 'expired',
        expiresAt: iso(row.expires_at as Date | string),
      },
    };
  }

  @Post(':token/accept')
  @HttpCode(200)
  async accept(@Req() request: FastifyRequest, @Param('token') rawToken: string) {
    const token = this.token(rawToken);
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'Сначала войдите в аккаунт.'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || !['provisional', 'verified'].includes(educator.state)) {
      throw new HttpException(
        error('educator_required', 'Приглашение предназначено педагогу.'),
        403,
      );
    }
    try {
      const result = await this.requirePool().query(
        `SELECT classroom_id, classroom_title, teacher_role
           FROM classroom_teacher_invitation_accept($1, $2)`,
        [context.accountId, hashInvitation(token)],
      );
      const row = result.rows[0];
      return {
        classroom: {
          id: row.classroom_id as string,
          title: row.classroom_title as string,
          role: row.teacher_role as 'co_teacher',
        },
      };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('educator required')) {
        throw new HttpException(
          error('educator_required', 'Приглашение предназначено педагогу.'),
          403,
        );
      }
      if (message.includes('owner cannot')) {
        throw new HttpException(error('owner_invitation', 'Вы уже владелец этого класса.'), 409);
      }
      if (message.includes('limit reached')) {
        throw new HttpException(error('co_teacher_limit', 'В классе уже пять коллег.'), 409);
      }
      if (message.includes('unavailable')) {
        throw new HttpException(
          error('invitation_unavailable', 'Приглашение истекло или отозвано.'),
          410,
        );
      }
      throw failure;
    }
  }
}
