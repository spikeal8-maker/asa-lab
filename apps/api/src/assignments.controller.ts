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
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { isValidClassroomTitle } from '@asa-lab/classroom';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

/**
 * A teacher's own library of tasks.
 *
 * A task belongs to the person who wrote it, not to a class. The same work
 * given to three classes is one entry here and three handouts; correcting the
 * wording corrects it in all three, and next September it is still here.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

interface LibraryRow {
  id: string;
  title: string;
  brief: string | null;
  goal: string | null;
  module_key: string;
  sample_image: string | null;
  demo_key: string | null;
  created_at: Date | string;
  handout_count: number | string;
  started_count: number | string;
  submitted_count: number | string;
}

@Controller('api/assignments')
export class AssignmentsController {
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
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Задания доступны педагогам.'), 403);
    }
    return context;
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT id, title, brief, goal, module_key, sample_image, demo_key, created_at,
              handout_count, started_count, submitted_count
         FROM teacher_assignment_list($1)`,
      [context.principalId],
    );
    return {
      items: (result.rows as LibraryRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        brief: row.brief,
        goal: row.goal,
        moduleKey: row.module_key,
        sampleImage: row.sample_image,
        isDemo: Boolean(row.demo_key),
        createdAt: iso(row.created_at),
        handoutCount: Number(row.handout_count),
        startedCount: Number(row.started_count),
        submittedCount: Number(row.submitted_count),
      })),
    };
  }

  @Post()
  async create(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    return { id: await this.save(request, null, rawBody) };
  }

  @Patch(':assignmentId')
  async update(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    this.requireUuid(assignmentId, 'assignment');
    return { id: await this.save(request, assignmentId, rawBody) };
  }

  private async save(
    request: FastifyRequest,
    assignmentId: string | null,
    rawBody: unknown,
  ): Promise<string> {
    const context = await this.requireEducator(request);
    const shape = checkBodyShape(rawBody, ['title', 'brief', 'goal', 'moduleKey']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'];
    const brief = shape.body['brief'] ?? null;
    const goal = shape.body['goal'] ?? null;
    const moduleKey = shape.body['moduleKey'];
    if (!isValidClassroomTitle(title)) {
      throw new HttpException(error('validation_error', 'Введите название задания.'), 400);
    }
    if (typeof moduleKey !== 'string' || !/^[a-z0-9-]{1,64}$/.test(moduleKey)) {
      throw new HttpException(error('validation_error', 'Выберите среду для задания.'), 400);
    }
    if (brief !== null && (typeof brief !== 'string' || brief.length > 4000)) {
      throw new HttpException(error('validation_error', 'Описание слишком длинное.'), 400);
    }
    // A goal is one sentence. The limit is what keeps it one sentence.
    if (goal !== null && (typeof goal !== 'string' || goal.length > 160)) {
      throw new HttpException(error('validation_error', 'Цель — не длиннее 160 символов.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_save($1, $2, $3, $4, $5, $6) AS id`,
      [context.principalId, assignmentId, title.trim(), brief, moduleKey, goal],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    return id;
  }

  @Delete(':assignmentId')
  async remove(@Req() request: FastifyRequest, @Param('assignmentId') assignmentId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_delete($1, $2) AS removed`,
      [context.principalId, assignmentId],
    );
    if ((result.rows[0] as { removed: boolean } | undefined)?.removed !== true) {
      throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    }
    return { removed: true as const };
  }

  /**
   * The reference picture for a task the teacher wrote.
   *
   * Stored rather than linked: a URL to somewhere else rots, and a school that
   * loses its file server should not lose its course. Sent as a data URL, the
   * same shape the avatar upload already uses, and checked here for type and
   * size before it reaches the database.
   */
  @Put(':assignmentId/sample')
  async setSample(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['imageDataUrl']);
    const raw = shape.ok ? (shape.body['imageDataUrl'] ?? null) : null;
    if (raw !== null && typeof raw !== 'string') {
      throw new HttpException(error('validation_error', 'Неверное изображение.'), 400);
    }
    let bytes: Buffer | null = null;
    let contentType: string | null = null;
    if (raw !== null) {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
      if (!match) {
        throw new HttpException(
          error('validation_error', 'Подойдёт PNG, JPEG или WebP.'),
          400,
        );
      }
      contentType = match[1] as string;
      bytes = Buffer.from(match[2] as string, 'base64');
      if (bytes.byteLength < 64 || bytes.byteLength > 400_000) {
        throw new HttpException(
          error('validation_error', 'Картинка должна быть до 400 КБ.'),
          400,
        );
      }
    }
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_sample_set($1, $2, $3, $4) AS ok`,
      [context.principalId, assignmentId, bytes, contentType],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    }
    return { ok: true as const };
  }

  /** The picture itself. Public to anyone signed in: it is a reference render,
   *  and a learner has to be able to see the task they were given. */
  @Get(':assignmentId/sample')
  async sample(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    this.requireUuid(assignmentId, 'assignment');
    void request;
    const result = await this.requirePool().query(
      `SELECT sample_bytes, sample_content_type FROM teacher_assignment_sample($1)`,
      [assignmentId],
    );
    const row = result.rows[0] as
      | { sample_bytes: Buffer; sample_content_type: string }
      | undefined;
    if (!row) throw new HttpException(error('sample_not_found', 'Картинки нет.'), 404);
    return reply
      .header('content-type', row.sample_content_type)
      .header('cache-control', 'private, max-age=60')
      .send(row.sample_bytes);
  }

  /** Every class this teacher runs, and whether this task is in it. */
  @Get(':assignmentId/classrooms')
  async classrooms(@Req() request: FastifyRequest, @Param('assignmentId') assignmentId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const result = await this.requirePool().query(
      `SELECT classroom_id, classroom_title, handed_out, due_at
         FROM teacher_assignment_classrooms($1, $2)`,
      [context.principalId, assignmentId],
    );
    return {
      items: (
        result.rows as Array<{
          classroom_id: string;
          classroom_title: string;
          handed_out: boolean;
          due_at: Date | string | null;
        }>
      ).map((row) => ({
        classroomId: row.classroom_id,
        classroomTitle: row.classroom_title,
        handedOut: row.handed_out,
        dueAt: row.due_at ? iso(row.due_at) : null,
      })),
    };
  }

  /** Give the task to a class, or take it back. */
  @Put(':assignmentId/classrooms/:classroomId')
  async handOut(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['given', 'dueAt']);
    const given = shape.ok ? shape.body['given'] : null;
    const dueAt = shape.ok ? (shape.body['dueAt'] ?? null) : null;
    if (typeof given !== 'boolean') {
      throw new HttpException(error('validation_error', 'given must be boolean'), 400);
    }
    if (dueAt !== null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt)))) {
      throw new HttpException(error('validation_error', 'Неверный срок сдачи.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_hand_out($1, $2, $3, $4, $5) AS ok`,
      [context.principalId, assignmentId, classroomId, given, dueAt],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    }
    return { ok: true as const };
  }
}
