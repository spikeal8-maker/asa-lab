import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { hashSessionToken } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

/**
 * The gallery: work somebody chose to show, and what people say about it.
 *
 * Everything here is deliberately public to signed-in people across schools —
 * that is what makes it a gallery rather than another view of a class. What is
 * NOT here is any way to reach unpublished work: the only door onto a picture
 * from another tenant is gallery_snapshot, and it opens for published projects
 * alone.
 */

const STUDENT_SESSION_COOKIE = 'asa_student_session';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface GalleryRow {
  project_id: string;
  title: string;
  module_key: string;
  author_label: string;
  published_at: Date | string;
  snapshot_revision: number;
  editors_choice: boolean;
  like_count: number | string;
  wow_count: number | string;
  viewer_liked: boolean;
  viewer_wowed: boolean;
  viewer_may_remove: boolean;
}

@Controller('api/gallery')
export class GalleryController {
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

  /**
   * Anyone signed in, including a child on a class seat.
   *
   * Seeing the gallery is the point of it, and a class seat is how most of the
   * children on this platform are signed in — so this accepts either kind of
   * session and answers with the principal behind it, which is the only thing
   * the gallery deals in. What a seat cannot do is publish, and that is decided
   * where it belongs: at the publish endpoint.
   */
  private async requireViewer(
    request: FastifyRequest,
  ): Promise<{ principalId: string; accountId: string | null; isSeat: boolean }> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (context) {
      return { principalId: context.principalId, accountId: context.accountId, isSeat: false };
    }
    const token = request.cookies[STUDENT_SESSION_COOKIE];
    if (token) {
      const session = await this.requirePool().query(
        `SELECT seat_id FROM classroom_student_session_context($1)`,
        [hashSessionToken(token)],
      );
      const seatId = (session.rows[0] as { seat_id: string } | undefined)?.seat_id ?? null;
      if (seatId) {
        // Through a function, not a read of `principals`: the runtime role has
        // no business being able to page through every identity on the platform.
        const principal = await this.requirePool().query(
          `SELECT principal_for_seat($1) AS id`,
          [seatId],
        );
        const principalId = (principal.rows[0] as { id: string | null } | undefined)?.id ?? null;
        if (principalId) return { principalId, accountId: null, isSeat: true };
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
  async list(
    @Req() request: FastifyRequest,
    @Query('sort') sort: string | undefined,
    @Query('module') moduleKey: string | undefined,
    @Query('offset') offset: string | undefined,
  ) {
    const viewer = await this.requireViewer(request);
    const order = sort === 'popular' ? 'popular' : 'recent';
    const key = moduleKey && /^[a-z0-9-]{1,64}$/.test(moduleKey) ? moduleKey : null;
    const skip = Number.parseInt(offset ?? '0', 10);
    const result = await this.requirePool().query(
      `SELECT project_id, title, module_key, author_label, published_at, snapshot_revision,
              editors_choice, like_count, wow_count, viewer_liked, viewer_wowed, viewer_may_remove
         FROM gallery_list($1, $2, $3, $4, $5)`,
      [viewer.principalId, order, key, 24, Number.isFinite(skip) ? skip : 0],
    );
    return {
      items: (result.rows as GalleryRow[]).map((row) => ({
        projectId: row.project_id,
        title: row.title,
        moduleKey: row.module_key,
        authorLabel: row.author_label,
        publishedAt: iso(row.published_at),
        snapshotRevision: Number(row.snapshot_revision),
        editorsChoice: row.editors_choice === true,
        likeCount: Number(row.like_count),
        wowCount: Number(row.wow_count),
        viewerLiked: row.viewer_liked === true,
        viewerWowed: row.viewer_wowed === true,
        viewerMayRemove: row.viewer_may_remove === true,
      })),
    };
  }

  /**
   * Which of my own projects are on the wall.
   *
   * One request rather than one per card: the projects page needs to label a
   * menu item on every row, and a page of twenty cards should not make twenty
   * round trips to find out.
   */
  @Get('mine')
  async mine(@Req() request: FastifyRequest) {
    const viewer = await this.requireViewer(request);
    const result = await this.requirePool().query(
      `SELECT project_id FROM project_publications
        WHERE owner_principal_id = $1 OR published_by_principal_id = $1`,
      [viewer.principalId],
    );
    return { projectIds: (result.rows as Array<{ project_id: string }>).map((r) => r.project_id) };
  }

  /** The picture. Published work only — this is the one cross-tenant read. */
  @Get(':projectId/image')
  async image(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    const result = await this.requirePool().query(
      `SELECT image, content_type FROM gallery_snapshot($1)`,
      [projectId],
    );
    const row = result.rows[0] as { image: Buffer; content_type: string } | undefined;
    if (!row) throw new HttpException(error('not_published', 'Работа не опубликована.'), 404);
    return (
      reply
        .header('content-type', row.content_type)
        // These bytes were drawn by one learner and are shown to every school
        // on the platform, so they are declared inert as firmly as possible.
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('cross-origin-resource-policy', 'same-origin')
        .header('cache-control', 'private, max-age=300')
        .send(row.image)
    );
  }

  /**
   * One published work in full: what its own page shows.
   *
   * Including the model document — what the work is built from. A gallery you
   * can only look at teaches nothing; a child learns by opening somebody's
   * castle and seeing which shapes it is made of.
   */
  @Get(':projectId/work')
  async work(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const viewer = await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    const result = await this.requirePool().query(
      `SELECT project_id, title, module_key, author_label, published_at, snapshot_revision,
              editors_choice, like_count, wow_count, viewer_liked, viewer_wowed,
              viewer_may_remove, viewer_is_author, document_json,
              copied_from_author, copied_from_title
         FROM gallery_work($1, $2)`,
      [viewer.principalId, projectId],
    );
    const row = result.rows[0] as
      | (GalleryRow & {
          viewer_is_author: boolean;
          document_json: unknown;
          copied_from_author: string | null;
          copied_from_title: string | null;
        })
      | undefined;
    if (!row) throw new HttpException(error('not_published', 'Работа не опубликована.'), 404);
    return {
      work: {
        projectId: row.project_id,
        title: row.title,
        moduleKey: row.module_key,
        authorLabel: row.author_label,
        publishedAt: iso(row.published_at),
        snapshotRevision: Number(row.snapshot_revision),
        editorsChoice: row.editors_choice === true,
        likeCount: Number(row.like_count),
        wowCount: Number(row.wow_count),
        viewerLiked: row.viewer_liked === true,
        viewerWowed: row.viewer_wowed === true,
        viewerMayRemove: row.viewer_may_remove === true,
        viewerIsAuthor: row.viewer_is_author === true,
        document: row.document_json ?? null,
        copiedFromAuthor: row.copied_from_author,
        copiedFromTitle: row.copied_from_title,
      },
    };
  }

  /**
   * Taking a copy into your own projects.
   *
   * The one place a project document crosses a school boundary. The copy is
   * always personal — somebody else's work cannot be dropped straight into a
   * class, because class work is what a learner made, not what they fetched —
   * and it carries where it came from for the rest of its life.
   */
  @Post(':projectId/copy')
  async copy(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const viewer = await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    const shape = checkBodyShape(rawBody ?? {}, ['title']);
    const title = shape.ok ? (shape.body['title'] ?? null) : null;
    if (title !== null && (typeof title !== 'string' || title.length > 255)) {
      throw new HttpException(error('validation_error', 'Слишком длинное название.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT gallery_copy_to_projects($1, $2, $3) AS project_id`,
      [viewer.principalId, projectId, title],
    );
    const created = (result.rows[0] as { project_id: string | null } | undefined)?.project_id;
    if (!created) {
      throw new HttpException(
        error('copy_failed', 'Не удалось взять работу. Свою работу копировать не нужно.'),
        400,
      );
    }
    return { projectId: created };
  }

  /** Whether this project is on the wall, for the button on its own card. */
  @Get(':projectId/state')
  async state(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const viewer = await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    const result = await this.requirePool().query(
      `SELECT published, published_at, like_count, wow_count FROM gallery_state($1, $2)`,
      [viewer.principalId, projectId],
    );
    const row = result.rows[0] as
      | { published: boolean; published_at: Date | string; like_count: number; wow_count: number }
      | undefined;
    if (!row) return { published: false as const };
    return {
      published: true as const,
      publishedAt: iso(row.published_at),
      likeCount: Number(row.like_count),
      wowCount: Number(row.wow_count),
    };
  }

  /**
   * Putting work on the wall.
   *
   * A seat learner is refused here by the function, not by this controller: the
   * rule is "the author, or the teacher of the author's class", and a child on
   * a seat is neither for anyone but themselves. Their teacher shares it.
   */
  @Post(':projectId')
  async publish(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const viewer = await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    if (viewer.isSeat) {
      throw new HttpException(
        error('teacher_shares', 'Работу в галерею отправляет преподаватель.'),
        403,
      );
    }
    const result = await this.requirePool().query(`SELECT gallery_publish($1, $2) AS ok`, [
      viewer.principalId,
      projectId,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(
        error(
          'publish_failed',
          'Не удалось опубликовать. Откройте работу и дайте ей сохранить картинку.',
        ),
        400,
      );
    }
    return { published: true as const };
  }

  @Delete(':projectId')
  async unpublish(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const viewer = await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    const result = await this.requirePool().query(`SELECT gallery_unpublish($1, $2) AS ok`, [
      viewer.principalId,
      projectId,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('not_published', 'Работа не найдена в галерее.'), 404);
    }
    return { published: false as const };
  }

  /** «Нравится» and «ого». One of each per person, and never on your own work. */
  @Put(':projectId/reaction')
  async react(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const viewer = await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    const shape = checkBodyShape(rawBody, ['kind', 'on']);
    const kind = shape.ok ? shape.body['kind'] : null;
    const on = shape.ok ? shape.body['on'] : null;
    if ((kind !== 'like' && kind !== 'wow') || typeof on !== 'boolean') {
      throw new HttpException(error('validation_error', 'Неизвестная реакция.'), 400);
    }
    const result = await this.requirePool().query(`SELECT gallery_react($1, $2, $3, $4) AS ok`, [
      viewer.principalId,
      projectId,
      kind,
      on,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('reaction_failed', 'Не удалось поставить реакцию.'), 400);
    }
    return { ok: true as const };
  }

  /** «Выбор редакции» — awarded by a teacher, not felt by a crowd. */
  @Put(':projectId/editors-choice')
  async editorsChoice(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const viewer = await this.requireViewer(request);
    this.requireUuid(projectId, 'project');
    const capabilities = viewer.accountId
      ? await this.accounts.capabilities(viewer.accountId)
      : [];
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(
        error('educator_required', '«Выбор редакции» ставит преподаватель.'),
        403,
      );
    }
    const shape = checkBodyShape(rawBody, ['on']);
    const on = shape.ok ? shape.body['on'] : null;
    if (typeof on !== 'boolean') {
      throw new HttpException(error('validation_error', 'on must be boolean'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT gallery_editors_choice($1, $2, $3) AS ok`,
      [viewer.principalId, projectId, on],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('not_published', 'Работа не найдена в галерее.'), 404);
    }
    return { ok: true as const };
  }
}
