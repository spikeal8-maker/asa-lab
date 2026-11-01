import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type pg from 'pg';
import {
  hashSessionToken,
  isValidAvatarDataUrl,
  type ActiveContextUseCase,
} from '@asa-lab/identity';
import { TOKENS, SESSION_COOKIE } from './tokens.js';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { noteAuthoritativeMutationSession } from './mutation-session-proof.js';
import { checkBodyShape } from './validation.js';
import { publicationError, throwPublicationError } from './public-projects.errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
function expected(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) < 2147483647;
}
function invalid(): never {
  throw publicationError('validation_error', 'Проверьте данные комментария.', 400);
}

@Controller('api')
export class PublicationCommentsController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly account: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
  ) {}
  private async actor(request: FastifyRequest, required: boolean, admin = false) {
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE)) {
      if (admin)
        throw publicationError('forbidden', 'Административный доступ недоступен из класса.', 403);
      const token = request.cookies[STUDENT_SESSION_COOKIE];
      const seat = await this.seats.resolveExisting(token);
      if (!seat || !token) throw publicationError('unauthorized', 'Войдите в класс заново.', 401);
      noteAuthoritativeMutationSession(request, 'seat-existing', token);
      return { id: seat.principalId, hash: hashSessionToken(token) };
    }
    const token = request.cookies[SESSION_COOKIE];
    if (!token && !required) return { id: null, hash: null };
    const context = await this.account.resolve(token);
    if (!context || !token) throw publicationError('unauthorized', 'Войдите в аккаунт.', 401);
    noteAuthoritativeMutationSession(request, 'account', token);
    return { id: context.principalId, hash: hashSessionToken(token) };
  }
  private async query(sql: string, values: unknown[]) {
    if (!this.pool) throw publicationError('database_unavailable', 'База данных недоступна.', 503);
    try {
      return (await this.pool.query<{ result: unknown }>(sql, values)).rows[0]?.result;
    } catch (cause) {
      switch ((cause as { code?: string }).code) {
        case 'P5D01':
          throw publicationError(
            'comments_forbidden',
            'Комментарии закрыты или запрещены настройками доступа.',
            403,
          );
        case 'P5D02':
          throw publicationError(
            'comment_rate_limit',
            'Слишком много действий. Повторите позже.',
            429,
          );
        case 'P5D03':
          throw publicationError(
            'comment_conflict',
            'Данные изменились. Обновите комментарии.',
            409,
          );
        case '42501':
          throw publicationError('forbidden', 'Недостаточно прав для этого действия.', 403);
        case '22P02':
        case '22003':
          return invalid();
        default:
          throwPublicationError(cause);
      }
    }
  }
  private page(id: string, before: string | undefined, limit: string | undefined) {
    if (
      !uuid(id) ||
      (before !== undefined && !uuid(before)) ||
      (limit !== undefined && !/^(?:[1-9]|[12][0-9]|30)$/.test(limit))
    )
      invalid();
    return { before: before ?? null, limit: limit === undefined ? 20 : Number(limit) };
  }
  @Get('public-projects/:publicationId/comments/:commentId/avatar')
  async avatar(
    @Param('publicationId') id: string,
    @Param('commentId') comment: string,
    @Res() reply: FastifyReply,
  ) {
    if (!uuid(id) || !uuid(comment)) invalid();
    const source = (await this.query(
      'SELECT public.publication_comment_avatar($1,$2,true) AS result',
      [id, comment],
    )) as { dataUrl?: string; builtinKey?: string } | null;
    reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cross-Origin-Resource-Policy', 'same-origin');
    if (source?.builtinKey && /^asa-avatar-(0[1-9]|[1-5][0-9]|6[0-7])$/.test(source.builtinKey))
      return reply
        .code(302)
        .redirect(`/assets/avatars/default/avatar-${source.builtinKey.slice(-2)}.webp`);
    if (typeof source?.dataUrl !== 'string' || !isValidAvatarDataUrl(source.dataUrl))
      throw publicationError('not_found', 'Аватар недоступен.', 404);
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(source!.dataUrl!);
    if (!match) throw publicationError('not_found', 'Аватар недоступен.', 404);
    const pixels = Buffer.from(match[2]!, 'base64');
    const valid =
      match[1] === 'png'
        ? pixels.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === 'jpeg'
          ? pixels.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          : pixels.toString('ascii', 0, 4) === 'RIFF' && pixels.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) throw publicationError('not_found', 'Аватар недоступен.', 404);
    return reply.type(`image/${match[1]}`).send(pixels);
  }
  @Get('public-projects/:publicationId/comments')
  @Header('Cache-Control', 'private, no-store')
  async read(
    @Req() req: FastifyRequest,
    @Param('publicationId') id: string,
    @Query('parentId') parent: string | undefined,
    @Query('before') before: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('sort') sort: string | undefined,
  ) {
    const page = this.page(id, before, limit);
    if (
      (parent !== undefined && !uuid(parent)) ||
      (sort !== undefined && !['newest', 'oldest', 'popular'].includes(sort))
    )
      invalid();
    const a = await this.actor(req, false);
    return this.query('SELECT public.publication_comments_read($1,$2,$3,$4,$5,$6,$7) AS result', [
      a.id,
      a.hash,
      id,
      parent ?? null,
      page.before,
      page.limit,
      sort ?? 'newest',
    ]);
  }
  @Post('public-projects/:publicationId/comments/commands')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async write(
    @Req() req: FastifyRequest,
    @Param('publicationId') id: string,
    @Body() body: unknown,
  ) {
    if (!uuid(id)) invalid();
    const shape = checkBodyShape(body, [
      'action',
      'body',
      'mutationId',
      'parentId',
      'revisionId',
      'commentId',
      'expectedVersion',
      'reason',
      'enabled',
      'on',
    ]);
    if (!shape.ok) invalid();
    const { action, ...input } = shape.body;
    if (action === 'like' || action === 'pin') {
      if (
        !uuid(input['commentId']) ||
        typeof input['on'] !== 'boolean' ||
        Object.keys(input).some(
          (k) => !['commentId', 'on', ...(action === 'pin' ? ['expectedVersion'] : [])].includes(k),
        )
      )
        invalid();
      if (action === 'pin' && !expected(input['expectedVersion'])) invalid();
      const a = await this.actor(req, true);
      return action === 'like'
        ? this.query('SELECT public.publication_comment_react($1,$2,$3,$4,$5) AS result', [
            a.id,
            a.hash,
            id,
            input['commentId'],
            input['on'],
          ])
        : this.query('SELECT public.publication_comment_pin($1,$2,$3,$4,$5,$6,$7) AS result', [
            a.id,
            a.hash,
            id,
            input['commentId'],
            input['on'],
            input['expectedVersion'],
            req.id,
          ]);
    }
    if (action === 'create') {
      if (
        typeof input['body'] !== 'string' ||
        !input['body'].trim() ||
        Array.from(input['body'].trim()).length > 2000 ||
        input['body'].includes('\0') ||
        !uuid(input['mutationId']) ||
        !uuid(input['revisionId']) ||
        (input['parentId'] !== undefined && input['parentId'] !== null && !uuid(input['parentId']))
      )
        invalid();
      input['body'] = input['body'].trim();
    } else if (action === 'settings') {
      if (typeof input['enabled'] !== 'boolean' || !expected(input['expectedVersion'])) invalid();
    } else if (['delete', 'hide', 'restore', 'report'].includes(String(action))) {
      if (!uuid(input['commentId'])) invalid();
      if (action === 'report') {
        if (
          typeof input['reason'] !== 'string' ||
          !input['reason'].trim() ||
          Array.from(input['reason'].trim()).length > 500 ||
          input['reason'].includes('\0')
        )
          invalid();
      } else if (!expected(input['expectedVersion'])) invalid();
    } else invalid();
    const a = await this.actor(req, true);
    return this.query(
      'SELECT public.publication_comment_write($1,$2,$3,$4,$5::jsonb,$6) AS result',
      [a.id, a.hash, id, action, JSON.stringify(input), req.id],
    );
  }
  @Get('admin/v1/publications/:publicationId/comments')
  @Header('Cache-Control', 'private, no-store')
  async adminRead(
    @Req() req: FastifyRequest,
    @Param('publicationId') id: string,
    @Query('before') before: string | undefined,
    @Query('limit') limit: string | undefined,
  ) {
    const page = this.page(id, before, limit),
      a = await this.actor(req, true, true);
    return this.query('SELECT public.admin_publication_comments_read($1,$2,$3,$4,$5) AS result', [
      a.id,
      a.hash,
      id,
      page.before,
      page.limit,
    ]);
  }
  @Post('admin/v1/publications/:publicationId/comments/commands')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  async adminWrite(
    @Req() req: FastifyRequest,
    @Param('publicationId') id: string,
    @Body() body: unknown,
  ) {
    if (!uuid(id)) invalid();
    const shape = checkBodyShape(body, [
      'action',
      'commentId',
      'enabled',
      'expectedVersion',
      'reason',
    ]);
    if (!shape.ok) invalid();
    const { action, ...input } = shape.body;
    if (
      !['hide', 'restore', 'resolve', 'settings'].includes(String(action)) ||
      !expected(input['expectedVersion']) ||
      typeof input['reason'] !== 'string' ||
      !input['reason'].trim() ||
      Array.from(input['reason'].trim()).length > 500 ||
      input['reason'].includes('\0')
    )
      invalid();
    if (action === 'settings' ? typeof input['enabled'] !== 'boolean' : !uuid(input['commentId']))
      invalid();
    const a = await this.actor(req, true, true);
    return this.query(
      'SELECT public.admin_publication_comment_write($1,$2,$3,$4,$5::jsonb,$6) AS result',
      [a.id, a.hash, id, action, JSON.stringify(input), req.id],
    );
  }
}
