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
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

/**
 * Курсы и общий каталог.
 *
 * Задание — единица работы, курс — единица преподавания: «Электроника, первый
 * год» это не двадцать разрозненных заданий, а порядок, в котором их проходят.
 * Поэтому курс не папка: папка отвечает «куда я это положил», курс — «что за
 * чем идёт и что отдаётся целиком».
 *
 * Круг доступа один и тот же для задания и для курса: только мне → названным
 * преподавателям → моей школе → всем. Вопрос один, и два разных ответа в двух
 * местах преподаватель не удержит в голове.
 *
 * Чужое забирается копией, а не ссылкой: автор правит своё, взявший — своё.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISIBILITY = new Set(['private', 'teachers', 'school', 'public']);

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface CourseRow {
  id: string;
  title: string;
  summary: string | null;
  visibility: string;
  age_band: string | null;
  item_count: number | string;
  shared_with: number | string;
  copied_from_course_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CatalogueRow {
  kind: string;
  id: string;
  title: string;
  summary: string | null;
  module_key: string | null;
  age_band: string | null;
  visibility: string;
  sample_image: string | null;
  item_count: number | string;
  author_name: string | null;
  author_school: string | null;
  created_at: Date | string;
}

@Controller('api')
export class CoursesController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
  ) {}

  private requirePool(): pg.Pool {
    if (!this.pool)
      throw new HttpException(error('unavailable', 'database is not configured'), 503);
    return this.pool;
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Курсы доступны педагогам.'), 403);
    }
    return context;
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  // Свои курсы.

  @Get('courses')
  async list(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT id, title, summary, visibility, age_band, item_count, shared_with,
              copied_from_course_id, created_at, updated_at
         FROM course_list_for_principal($1)`,
      [context.principalId],
    );
    return {
      items: (result.rows as CourseRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        visibility: row.visibility,
        ageBand: row.age_band,
        itemCount: Number(row.item_count),
        sharedWith: Number(row.shared_with),
        copiedFromCourseId: row.copied_from_course_id,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      })),
    };
  }

  @Post('courses')
  async create(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    return { id: await this.save(request, null, rawBody) };
  }

  @Patch('courses/:courseId')
  async update(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Body() rawBody: unknown,
  ) {
    this.requireUuid(courseId, 'course');
    return { id: await this.save(request, courseId, rawBody) };
  }

  private async save(
    request: FastifyRequest,
    courseId: string | null,
    rawBody: unknown,
  ): Promise<string> {
    const context = await this.requireEducator(request);
    const shape = checkBodyShape(rawBody, ['title', 'summary', 'ageBand', 'visibility']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = String(shape.body['title'] ?? '').trim();
    const summary = shape.body['summary'] ?? null;
    const ageBand = shape.body['ageBand'] ?? null;
    const visibility = shape.body['visibility'] ?? null;
    if (title.length === 0 || title.length > 160) {
      throw new HttpException(error('validation_error', 'Введите название курса.'), 400);
    }
    if (summary !== null && (typeof summary !== 'string' || summary.length > 600)) {
      throw new HttpException(error('validation_error', 'Описание слишком длинное.'), 400);
    }
    if (visibility !== null && !VISIBILITY.has(String(visibility))) {
      throw new HttpException(error('validation_error', 'Неизвестный уровень доступа.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT course_save($1, $2, $3, $4, $5, $6) AS id`,
      [context.principalId, courseId, title, summary, ageBand, visibility],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
    return id;
  }

  /** Удаляется курс, а не задания: они остаются в банке. */
  @Delete('courses/:courseId')
  async remove(@Req() request: FastifyRequest, @Param('courseId') courseId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const result = await this.requirePool().query(`SELECT course_delete($1, $2) AS ok`, [
      context.principalId,
      courseId,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
    }
    return { removed: true as const };
  }

  /** Состав курса — то, что видно и чужому, если курс ему открыт. */
  @Get('courses/:courseId/items')
  async items(@Req() request: FastifyRequest, @Param('courseId') courseId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    const result = await this.requirePool().query(
      `SELECT id, title, goal, module_key, sample_image, step_number
         FROM course_contents($1, $2, $3, $4)`,
      [courseId, context.principalId, context.accountId, context.tenantId],
    );
    return {
      items: (
        result.rows as Array<{
          id: string;
          title: string;
          goal: string | null;
          module_key: string;
          sample_image: string | null;
          step_number: number | string;
        }>
      ).map((row) => ({
        id: row.id,
        title: row.title,
        goal: row.goal,
        moduleKey: row.module_key,
        sampleImage: row.sample_image,
        position: Number(row.step_number),
      })),
    };
  }

  @Put('courses/:courseId/items/:assignmentId')
  async setItem(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['included']);
    const included = shape.ok ? shape.body['included'] !== false : true;
    const result = await this.requirePool().query(`SELECT course_item_set($1, $2, $3, $4) AS ok`, [
      context.principalId,
      courseId,
      assignmentId,
      included,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('course_not_found', 'Курс или задание не найдены.'), 404);
    }
    return { ok: true as const };
  }

  /** Порядок внутри курса: шаг вверх или вниз. */
  @Post('courses/:courseId/items/:assignmentId/move')
  async moveItem(
    @Req() request: FastifyRequest,
    @Param('courseId') courseId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(courseId, 'course');
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['delta']);
    const delta = shape.ok && Number(shape.body['delta']) < 0 ? -1 : 1;
    const result = await this.requirePool().query(`SELECT course_item_move($1, $2, $3, $4) AS ok`, [
      context.principalId,
      courseId,
      assignmentId,
      delta,
    ]);
    return { ok: (result.rows[0] as { ok: boolean } | undefined)?.ok === true };
  }

  // Кому открыто.

  @Put('sharing/:kind/:subjectId/visibility')
  async setVisibility(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const shape = checkBodyShape(rawBody, ['visibility']);
    const visibility = String(shape.ok ? (shape.body['visibility'] ?? '') : '');
    if (!VISIBILITY.has(visibility)) {
      throw new HttpException(error('validation_error', 'Неизвестный уровень доступа.'), 400);
    }
    const pool = this.requirePool();
    if (kind === 'assignment') {
      const result = await pool.query(
        `SELECT teacher_assignment_visibility_set($1, $2, $3) AS ok`,
        [context.principalId, subjectId, visibility],
      );
      if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
        throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
      }
      return { ok: true as const };
    }
    if (kind === 'course') {
      const result = await pool.query(`SELECT course_visibility_set($1, $2, $3) AS ok`, [
        context.principalId,
        subjectId,
        visibility,
      ]);
      if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
        throw new HttpException(error('course_not_found', 'Курс не найден.'), 404);
      }
      return { ok: true as const };
    }
    throw new HttpException(error('validation_error', 'Неизвестный вид содержимого.'), 400);
  }

  @Get('sharing/:kind/:subjectId')
  async shares(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const result = await this.requirePool().query(
      `SELECT account_id, email, display_name, created_at FROM content_share_list($1, $2, $3)`,
      [context.principalId, kind, subjectId],
    );
    return {
      items: (
        result.rows as Array<{
          account_id: string;
          email: string;
          display_name: string;
          created_at: Date | string;
        }>
      ).map((row) => ({
        accountId: row.account_id,
        email: row.email,
        displayName: row.display_name,
        createdAt: iso(row.created_at),
      })),
    };
  }

  /**
   * Открыть доступ коллеге по почте.
   *
   * Почта, а не выбор из списка всех преподавателей платформы: список чужих
   * имён — это справочник людей, и показывать его ради «поделиться заданием»
   * незачем.
   */
  @Post('sharing/:kind/:subjectId')
  async addShare(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const shape = checkBodyShape(rawBody, ['email']);
    const email = String(shape.ok ? (shape.body['email'] ?? '') : '').trim();
    if (email.length === 0 || email.length > 254) {
      throw new HttpException(error('validation_error', 'Введите почту преподавателя.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT content_share_add($1, $2, $3, $4) AS ok`,
      [context.principalId, kind, subjectId, email],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(
        error('share_rejected', 'Преподаватель с такой почтой не найден.'),
        404,
      );
    }
    return { ok: true as const };
  }

  @Delete('sharing/:kind/:subjectId/:accountId')
  async removeShare(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
    @Param('accountId') accountId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    this.requireUuid(accountId, 'account');
    const result = await this.requirePool().query(
      `SELECT content_share_remove($1, $2, $3, $4) AS ok`,
      [context.principalId, kind, subjectId, accountId],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('share_not_found', 'Доступ не найден.'), 404);
    }
    return { removed: true as const };
  }

  // Общий каталог.

  /** Курсы и задания, открытые тому, кто смотрит. Своё сюда не попадает. */
  @Get('catalogue')
  async catalogue(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT kind, id, title, summary, module_key, age_band, visibility, sample_image,
              item_count, author_name, author_school, created_at
         FROM shared_catalogue($1, $2, $3)`,
      [context.principalId, context.accountId, context.tenantId],
    );
    return {
      items: (result.rows as CatalogueRow[]).map((row) => ({
        kind: row.kind as 'course' | 'assignment',
        id: row.id,
        title: row.title,
        summary: row.summary,
        moduleKey: row.module_key,
        ageBand: row.age_band,
        visibility: row.visibility,
        sampleImage: row.sample_image,
        itemCount: Number(row.item_count),
        authorName: row.author_name ?? 'Преподаватель',
        authorSchool: row.author_school,
        createdAt: iso(row.created_at),
      })),
    };
  }

  /**
   * Забрать чужое себе.
   *
   * Копией, а не ссылкой: автор правит своё, взявший — своё. Иначе исправленная
   * у автора опечатка меняет урок в чужой школе посреди четверти.
   */
  @Post('catalogue/:kind/:subjectId/take')
  async take(
    @Req() request: FastifyRequest,
    @Param('kind') kind: string,
    @Param('subjectId') subjectId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(subjectId, 'subject');
    const pool = this.requirePool();
    const sql =
      kind === 'course'
        ? `SELECT course_take($1, $2, $3, $4) AS id`
        : `SELECT assignment_take($1, $2, $3, $4) AS id`;
    if (kind !== 'course' && kind !== 'assignment') {
      throw new HttpException(error('validation_error', 'Неизвестный вид содержимого.'), 400);
    }
    const result = await pool.query(sql, [
      context.principalId,
      subjectId,
      context.accountId,
      context.tenantId,
    ]);
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('not_available', 'Это вам не доступно.'), 404);
    return { id };
  }
}
