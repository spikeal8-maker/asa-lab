import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import { isValidProjectTitle } from '@asa-lab/projects';
import { copyPublicProject, readPublicCopyAdmission } from './public-project-copy.js';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';
import { checkBodyShape, checkIdempotencyKey } from './validation.js';
import { publicationError, throwPublicationError } from './public-projects.errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LICENSES = new Set(['reserved', 'public-domain', 'cc-by', 'cc-by-sa', 'cc-by-nc']);

function requireUuid(value: string): void {
  if (!UUID.test(value)) {
    throw publicationError('validation_error', 'Некорректный идентификатор.', 400);
  }
}

function requirePool(pool: pg.Pool | null): pg.Pool {
  if (!pool) throw publicationError('database_unavailable', 'База данных недоступна.', 503);
  return pool;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!/^\d{1,7}$/.test(value)) {
    throw publicationError('validation_error', 'Некорректная страница каталога.', 400);
  }
  const number = Number(value);
  if (number < min || number > max) {
    throw publicationError('validation_error', 'Некорректная страница каталога.', 400);
  }
  return number;
}

interface PublicProjectRow {
  publication_id: string;
  revision_id: string;
  revision_no: number;
  version_no: number;
  title: string;
  summary: string | null;
  description: string | null;
  tags: string[];
  license: string;
  module_key: string;
  author_label: string;
  published_at: Date | string;
  preview_content_type: string | null;
  preview_width: number | null;
  preview_height: number | null;
  featured: boolean;
  pinned: boolean;
}

/** An explicit allowlist: never spread a database row into a public response. */
function publicProject(row: PublicProjectRow, canCopy: boolean) {
  return {
    publicationId: row.publication_id,
    revisionId: row.revision_id,
    revisionNo: Number(row.revision_no),
    versionNo: Number(row.version_no),
    title: row.title,
    summary: row.summary,
    description: row.description,
    tags: row.tags,
    license: row.license,
    moduleKey: row.module_key,
    authorLabel: row.author_label,
    featured: row.featured === true,
    pinned: row.pinned === true,
    publishedAt:
      row.published_at instanceof Date ? row.published_at.toISOString() : row.published_at,
    preview:
      row.preview_content_type && row.preview_width && row.preview_height
        ? {
            url:
              '/api/public-projects/' + row.publication_id + '/image?revision=' + row.revision_id,
            contentType: row.preview_content_type,
            width: row.preview_width,
            height: row.preview_height,
          }
        : null,
    capabilities: {
      viewer: 'static' as const,
      canCopy,
      downloadFormats: [] as string[],
    },
  };
}

export interface OwnerPublicationStatus {
  moderationReason?: string;
  publication: {
    publicationId: string;
    revisionId: string;
    revisionNo: number;
    versionNo: number;
    state: 'public' | 'revoked' | 'unlisted' | 'draft';
    publishedAt: string;
    publicPath: string | null;
  } | null;
  canPublish: boolean;
  reasonCode: string | null;
}

@Controller('api/public-projects')
export class PublicProjectsController {
  constructor(
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.moduleRegistry) private readonly registry: ModuleRegistry,
  ) {}

  @Post(':publicationId/copy')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async copy(
    @Req() request: FastifyRequest,
    @Param('publicationId') publicationId: string,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Body() rawBody: unknown,
  ) {
    // Presence selects Seat even for empty/invalid credentials. Never fall back.
    if (Object.prototype.hasOwnProperty.call(request.cookies, STUDENT_SESSION_COOKIE)) {
      throw publicationError(
        'copy_forbidden',
        'Создать личную копию можно только из аккаунта.',
        403,
      );
    }
    const account = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!account) throw publicationError('unauthorized', 'Войдите в аккаунт.', 401);
    requireUuid(publicationId);
    const key = checkIdempotencyKey(idempotencyKey);
    if (!key.ok || key.key.startsWith('learning:')) {
      throw publicationError('invalid_idempotency_key', 'Укажите допустимый Idempotency-Key.', 400);
    }
    const shape = checkBodyShape(rawBody, ['revisionId', 'title']);
    if (!shape.ok) throw publicationError('validation_error', shape.message, 400);
    const revisionId = shape.body['revisionId'];
    if (typeof revisionId !== 'string') {
      throw publicationError('validation_error', 'Укажите опубликованную версию.', 400);
    }
    requireUuid(revisionId);
    const title = shape.body['title'];
    if ('title' in shape.body && !isValidProjectTitle(title)) {
      throw publicationError('validation_error', 'Название должно содержать 1–255 знаков.', 400);
    }
    try {
      return await copyPublicProject({
        pool: requirePool(this.pool),
        registry: this.registry,
        principalId: account.principalId,
        publicationId,
        revisionId,
        ...(typeof title === 'string' ? { title: title.trim() } : {}),
        idempotencyKey: key.key,
      });
    } catch (cause) {
      throwPublicationError(cause);
    }
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Query('q') query?: string,
    @Query('module') moduleKey?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    if (query !== undefined && (typeof query !== 'string' || query.length > 120)) {
      throw publicationError('validation_error', 'Поисковый запрос слишком длинный.', 400);
    }
    if (moduleKey !== undefined && !['three-d', 'electronics', 'blocks'].includes(moduleKey)) {
      throw publicationError('validation_error', 'Некорректный тип проекта.', 400);
    }
    const skip = boundedInteger(offset, 0, 0, 1000000);
    const take = boundedInteger(limit, 24, 1, 48);
    const result = await requirePool(this.pool).query<PublicProjectRow>(
      'SELECT entry.*, public.project_publication_featured(entry.publication_id, entry.revision_id) AS featured, public.project_publication_pinned(entry.publication_id, entry.revision_id) AS pinned FROM public.public_projects_read($1, $2, $3, $4, $5) entry',
      [null, query?.trim() || null, moduleKey ?? null, take + 1, skip],
    );
    const page = result.rows.slice(0, take);
    const admitted = await readPublicCopyAdmission(requirePool(this.pool), this.registry, page);
    return {
      items: page.map((row) => publicProject(row, admitted.has(row.publication_id))),
      nextOffset: result.rows.length > take ? skip + take : null,
    };
  }

  @Get(':publicationId')
  @Header('Cache-Control', 'no-store')
  async detail(@Param('publicationId') publicationId: string) {
    requireUuid(publicationId);
    const result = await requirePool(this.pool).query<PublicProjectRow>(
      'SELECT entry.*, public.project_publication_featured(entry.publication_id, entry.revision_id) AS featured, public.project_publication_pinned(entry.publication_id, entry.revision_id) AS pinned FROM public.public_projects_read($1, $2, $3, $4, $5) entry',
      [publicationId, null, null, 1, 0],
    );
    const row = result.rows[0];
    if (!row) throw publicationError('not_available', 'Публикация недоступна.', 404);
    const admitted = await readPublicCopyAdmission(requirePool(this.pool), this.registry, [row]);
    return { publication: publicProject(row, admitted.has(row.publication_id)) };
  }

  @Get(':publicationId/image')
  async image(
    @Param('publicationId') publicationId: string,
    @Query('revision') revisionId: string | undefined,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    requireUuid(publicationId);
    if (revisionId !== undefined) requireUuid(revisionId);
    // Read the current permission and the frozen bytes in one SQL statement,
    // even when the request carries If-None-Match/If-Modified-Since.
    const result = await requirePool(this.pool).query<{
      image: Buffer;
      content_type: string;
    }>('SELECT image, content_type FROM public_project_image($1, $2)', [
      publicationId,
      revisionId ?? null,
    ]);
    const row = result.rows[0];
    if (!row) throw publicationError('not_available', 'Публикация недоступна.', 404);
    return reply
      .header('content-type', row.content_type)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cross-origin-resource-policy', 'same-origin')
      .send(row.image);
  }
}

@Controller('api/projects/:projectId/publication')
export class ProjectPublicationController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private async requireOwnerSession(request: FastifyRequest): Promise<string> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (context) return context.principalId;
    if (request.cookies[STUDENT_SESSION_COOKIE]) {
      throw publicationError(
        'publication_forbidden',
        'Публикация доступна владельцу личного проекта с аккаунтом.',
        403,
      );
    }
    throw publicationError('unauthorized', 'Войдите в аккаунт.', 401);
  }

  private async ownerStatus(principalId: string, projectId: string) {
    const result = await requirePool(this.pool).query<{
      result: OwnerPublicationStatus | null;
    }>('SELECT project_publication_status($1, $2) AS result', [principalId, projectId]);
    const status = result.rows[0]?.result;
    if (!status) throw publicationError('not_available', 'Проект недоступен.', 404);
    return status;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async status(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const principalId = await this.requireOwnerSession(request);
    requireUuid(projectId);
    return this.ownerStatus(principalId, projectId);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async publish(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const principalId = await this.requireOwnerSession(request);
    requireUuid(projectId);
    const shape = checkBodyShape(rawBody ?? {}, ['title', 'description', 'tags', 'license']);
    if (!shape.ok) throw publicationError('validation_error', shape.message, 400);
    const metadata: Record<string, unknown> = {};
    if ('title' in shape.body) {
      const title = shape.body['title'];
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 255) {
        throw publicationError('validation_error', 'Название должно содержать 1–255 знаков.', 400);
      }
      metadata['title'] = title.trim();
    }
    if ('description' in shape.body) {
      const description = shape.body['description'];
      if (description !== null && (typeof description !== 'string' || description.length > 2000)) {
        throw publicationError('validation_error', 'Описание должно быть короче 2001 знака.', 400);
      }
      metadata['description'] = typeof description === 'string' ? description.trim() : null;
    }
    if ('tags' in shape.body) {
      const tags = shape.body['tags'];
      if (
        !Array.isArray(tags) ||
        tags.length > 10 ||
        tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 32)
      ) {
        throw publicationError('validation_error', 'Добавьте не более десяти коротких тегов.', 400);
      }
      metadata['tags'] = [...new Set((tags as string[]).map((tag) => tag.trim().toLowerCase()))];
    }
    if ('license' in shape.body) {
      const license = shape.body['license'];
      if (typeof license !== 'string' || !LICENSES.has(license)) {
        throw publicationError('validation_error', 'Неизвестная лицензия.', 400);
      }
      metadata['license'] = license;
    }
    try {
      const result = await requirePool(this.pool).query<{
        result: OwnerPublicationStatus;
      }>('SELECT project_publication_publish($1, $2, $3::jsonb) AS result', [
        principalId,
        projectId,
        JSON.stringify(metadata),
      ]);
      const status = result.rows[0]?.result;
      if (!status) throw publicationError('not_available', 'Проект недоступен.', 404);
      return status;
    } catch (cause) {
      throwPublicationError(cause);
    }
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  async revoke(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const principalId = await this.requireOwnerSession(request);
    requireUuid(projectId);
    const result = await requirePool(this.pool).query<{ ok: boolean }>(
      'SELECT project_publication_revoke($1, $2) AS ok',
      [principalId, projectId],
    );
    if (result.rows[0]?.ok !== true) {
      throw publicationError('not_available', 'Проект недоступен.', 404);
    }
    return this.ownerStatus(principalId, projectId);
  }
}
