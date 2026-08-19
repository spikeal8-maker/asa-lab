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
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { hashSessionToken } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

/**
 * Коллекции — подборки работ из галереи, отложенных себе.
 *
 * В подборке лежит ссылка, а не копия: снятая со стены работа уходит и отсюда.
 * Видит подборку только тот, кто её собрал.
 */

const STUDENT_SESSION_COOKIE = 'asa_student_session';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

@Controller('api/collections')
export class CollectionsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool) {
      throw new HttpException(error('database_unavailable', 'database is not configured'), 503);
    }
    return this.pool;
  }

  /** Собирать подборки может и ребёнок с местом: это его закладки. */
  private async requirePrincipal(request: FastifyRequest): Promise<string> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (context) return context.principalId;

    const token = request.cookies[STUDENT_SESSION_COOKIE];
    if (token) {
      const session = await this.requirePool().query(
        `SELECT seat_id FROM classroom_student_session_context($1)`,
        [hashSessionToken(token)],
      );
      const seatId = (session.rows[0] as { seat_id: string } | undefined)?.seat_id ?? null;
      if (seatId) {
        const principal = await this.requirePool().query(`SELECT principal_for_seat($1) AS id`, [
          seatId,
        ]);
        const id = (principal.rows[0] as { id: string | null } | undefined)?.id ?? null;
        if (id) return id;
      }
    }
    throw new HttpException(error('unauthorized', 'no active session'), 401);
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const principalId = await this.requirePrincipal(request);
    const result = await this.requirePool().query(
      `SELECT id, title, item_count, created_at FROM collection_list($1)`,
      [principalId],
    );
    return {
      items: (
        result.rows as Array<{
          id: string;
          title: string;
          item_count: number | string;
          created_at: Date | string;
        }>
      ).map((row) => ({
        id: row.id,
        title: row.title,
        itemCount: Number(row.item_count),
        createdAt: iso(row.created_at),
      })),
    };
  }

  @Get(':collectionId')
  async items(@Req() request: FastifyRequest, @Param('collectionId') collectionId: string) {
    const principalId = await this.requirePrincipal(request);
    this.requireUuid(collectionId, 'collection');
    const result = await this.requirePool().query(
      `SELECT project_id, title, module_key, author_label, snapshot_revision,
              editors_choice, added_at
         FROM collection_items_list($1, $2)`,
      [principalId, collectionId],
    );
    return {
      items: (
        result.rows as Array<{
          project_id: string;
          title: string;
          module_key: string;
          author_label: string;
          snapshot_revision: number | string;
          editors_choice: boolean;
          added_at: Date | string;
        }>
      ).map((row) => ({
        projectId: row.project_id,
        title: row.title,
        moduleKey: row.module_key,
        authorLabel: row.author_label,
        snapshotRevision: Number(row.snapshot_revision),
        editorsChoice: row.editors_choice === true,
        addedAt: iso(row.added_at),
      })),
    };
  }

  @Post()
  async create(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const principalId = await this.requirePrincipal(request);
    const shape = checkBodyShape(rawBody, ['title']);
    const title = shape.ok ? shape.body['title'] : null;
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 120) {
      throw new HttpException(error('validation_error', 'Введите название подборки.'), 400);
    }
    const result = await this.requirePool().query(`SELECT collection_create($1, $2) AS id`, [
      principalId,
      title,
    ]);
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('create_failed', 'Не удалось создать подборку.'), 400);
    return { id };
  }

  @Patch(':collectionId')
  async rename(
    @Req() request: FastifyRequest,
    @Param('collectionId') collectionId: string,
    @Body() rawBody: unknown,
  ) {
    const principalId = await this.requirePrincipal(request);
    this.requireUuid(collectionId, 'collection');
    const shape = checkBodyShape(rawBody, ['title']);
    const title = shape.ok ? shape.body['title'] : null;
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > 120) {
      throw new HttpException(error('validation_error', 'Введите название подборки.'), 400);
    }
    const result = await this.requirePool().query(`SELECT collection_rename($1, $2, $3) AS ok`, [
      principalId,
      collectionId,
      title,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('not_found', 'Подборка не найдена.'), 404);
    }
    return { ok: true as const };
  }

  @Delete(':collectionId')
  async remove(@Req() request: FastifyRequest, @Param('collectionId') collectionId: string) {
    const principalId = await this.requirePrincipal(request);
    this.requireUuid(collectionId, 'collection');
    const result = await this.requirePool().query(`SELECT collection_delete($1, $2) AS ok`, [
      principalId,
      collectionId,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('not_found', 'Подборка не найдена.'), 404);
    }
    return { removed: true as const };
  }

  /** Положить работу в подборку или вынуть её оттуда. */
  @Put(':collectionId/items/:projectId')
  async setItem(
    @Req() request: FastifyRequest,
    @Param('collectionId') collectionId: string,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const principalId = await this.requirePrincipal(request);
    this.requireUuid(collectionId, 'collection');
    this.requireUuid(projectId, 'project');
    const shape = checkBodyShape(rawBody, ['inside']);
    const inside = shape.ok ? shape.body['inside'] : null;
    if (typeof inside !== 'boolean') {
      throw new HttpException(error('validation_error', 'inside must be boolean'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT collection_set_item($1, $2, $3, $4) AS ok`,
      [principalId, collectionId, projectId, inside],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(
        error('not_found', 'Подборка не найдена или работа снята со стены.'),
        404,
      );
    }
    return { ok: true as const };
  }

  /** В каких подборках уже лежит эта работа. */
  @Get('holding/:projectId')
  async holding(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const principalId = await this.requirePrincipal(request);
    this.requireUuid(projectId, 'project');
    const result = await this.requirePool().query(
      `SELECT collection_id FROM collections_holding($1, $2)`,
      [principalId, projectId],
    );
    return {
      collectionIds: (result.rows as Array<{ collection_id: string }>).map(
        (row) => row.collection_id,
      ),
    };
  }
}
