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
      `SELECT id, title, brief, module_key, sample_image, demo_key, created_at,
              handout_count, started_count, submitted_count
         FROM teacher_assignment_list($1)`,
      [context.principalId],
    );
    return {
      items: (result.rows as LibraryRow[]).map((row) => ({
        id: row.id,
        title: row.title,
        brief: row.brief,
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
    const shape = checkBodyShape(rawBody, ['title', 'brief', 'moduleKey']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'];
    const brief = shape.body['brief'] ?? null;
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
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_save($1, $2, $3, $4, $5) AS id`,
      [context.principalId, assignmentId, title.trim(), brief, moduleKey],
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
