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
import { STUDENT_SESSION_COOKIE, type SeatContext, SeatContextUseCase } from './seat-context.js';
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

/**
 * Картинка, пришедшая строкой data-url.
 *
 * Тем же путём загружаются аватары: браузер читает файл, отправляет строкой,
 * а тип и размер проверяются здесь — до того, как байты дойдут до базы.
 */
function decodeImage(raw: string): { bytes: Buffer; contentType: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!match) {
    throw new HttpException(error('validation_error', 'Подойдёт PNG, JPEG или WebP.'), 400);
  }
  const bytes = Buffer.from(match[2] as string, 'base64');
  if (bytes.byteLength < 64 || bytes.byteLength > 400_000) {
    throw new HttpException(error('validation_error', 'Картинка должна быть до 400 КБ.'), 400);
  }
  return { bytes, contentType: match[1] as string };
}

interface LibraryRow {
  id: string;
  title: string;
  brief: string | null;
  goal: string | null;
  module_key: string;
  age_band: string | null;
  sample_image: string | null;
  demo_key: string | null;
  folder_id: string | null;
  folder_title: string | null;
  archived_at: Date | string | null;
  copied_from_assignment_id: string | null;
  copied_from_title: string | null;
  visibility?: string | null;
  shared_with?: number | string | null;
  course_titles?: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
  handout_count: number | string;
  started_count: number | string;
  submitted_count: number | string;
  classroom_titles: string[] | null;
  academic_years: string[] | null;
  last_handed_out_at: Date | string | null;
}

interface FolderRow {
  id: string;
  parent_id: string | null;
  title: string;
  depth: number | string;
  direct_count: number | string;
  total_count: number | string;
}

interface AssignmentViewer {
  readonly principalId: string;
  readonly accountId: string | null;
  readonly tenantId: string;
  readonly seatId: string | null;
}

/** Возраст задания — тот же словарь, что у классов, слово в слово. */
const AGE_BANDS = new Set(['mixed', '6-8', '9-10', '11-12', '13-15', '16-18']);

@Controller('api/assignments')
export class AssignmentsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.seatContextUseCase) private readonly seatContext: SeatContextUseCase,
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

  /**
   * Images are private application data, not bearer URLs. Resolve either kind
   * of signed-in user here, then let the database verify that this exact
   * principal/seat may see the assignment. Keeping the second check in SQL is
   * important because the byte-reading functions run as SECURITY DEFINER.
   */
  private async requireViewer(request: FastifyRequest): Promise<AssignmentViewer> {
    const account = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (account) {
      return {
        principalId: account.principalId,
        accountId: account.accountId,
        tenantId: account.tenantId,
        seatId: null,
      };
    }

    const seat: SeatContext | null = await this.seatContext.resolve(
      request.cookies[STUDENT_SESSION_COOKIE],
    );
    if (seat) {
      return {
        principalId: seat.principalId,
        accountId: null,
        tenantId: seat.tenantId,
        seatId: seat.seatId,
      };
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
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT id, title, brief, goal, module_key, age_band, sample_image, demo_key,
              folder_id, folder_title, archived_at, copied_from_assignment_id,
              copied_from_title, visibility, shared_with, course_titles,
              created_at, updated_at,
              handout_count, started_count, submitted_count,
              classroom_titles, academic_years, last_handed_out_at
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
        ageBand: row.age_band,
        sampleImage: row.sample_image,
        isDemo: Boolean(row.demo_key),
        folderId: row.folder_id,
        folderTitle: row.folder_title,
        archivedAt: row.archived_at ? iso(row.archived_at) : null,
        // Кому открыто: без этого список не рассказывает, что видно коллегам.
        visibility: row.visibility ?? 'private',
        sharedWith: Number(row.shared_with ?? 0),
        courseTitles: row.course_titles ?? [],
        copiedFrom: row.copied_from_assignment_id
          ? { id: row.copied_from_assignment_id, title: row.copied_from_title ?? '' }
          : null,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        handoutCount: Number(row.handout_count),
        startedCount: Number(row.started_count),
        submittedCount: Number(row.submitted_count),
        // Кому и когда выдавалось: по этим строкам задание и ищут через год.
        classroomTitles: row.classroom_titles ?? [],
        academicYears: row.academic_years ?? [],
        lastHandedOutAt: row.last_handed_out_at ? iso(row.last_handed_out_at) : null,
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
    const shape = checkBodyShape(rawBody, [
      'title',
      'brief',
      'goal',
      'moduleKey',
      'folderId',
      'ageBand',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'];
    const brief = shape.body['brief'] ?? null;
    const goal = shape.body['goal'] ?? null;
    const moduleKey = shape.body['moduleKey'];
    const folderId = shape.body['folderId'] ?? null;
    const ageBand = shape.body['ageBand'] ?? null;
    if (folderId !== null) this.requireUuid(String(folderId), 'folder');
    if (ageBand !== null && !AGE_BANDS.has(String(ageBand))) {
      throw new HttpException(error('validation_error', 'Неизвестный возраст.'), 400);
    }
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
      `SELECT teacher_assignment_save($1, $2, $3, $4, $5, $6, $7, $8) AS id`,
      [context.principalId, assignmentId, title.trim(), brief, moduleKey, goal, folderId, ageBand],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    return id;
  }

  @Delete(':assignmentId')
  async remove(@Req() request: FastifyRequest, @Param('assignmentId') assignmentId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    let result: pg.QueryResult;
    try {
      result = await this.requirePool().query(
        `SELECT teacher_assignment_delete($1, $2) AS removed`,
        [context.principalId, assignmentId],
      );
    } catch (caught) {
      if (
        typeof caught === 'object' &&
        caught !== null &&
        'code' in caught &&
        caught.code === '23503'
      ) {
        throw new HttpException(
          error(
            'assignment_in_course',
            'Задание используется в курсе. Сначала удалите его из уроков или уберите в архив.',
          ),
          409,
        );
      }
      throw caught;
    }
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
    const picture = raw === null ? null : decodeImage(raw);
    const bytes = picture?.bytes ?? null;
    const contentType = picture?.contentType ?? null;
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_sample_set($1, $2, $3, $4) AS ok`,
      [context.principalId, assignmentId, bytes, contentType],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    }
    return { ok: true as const };
  }

  /** The picture itself, only for a viewer who may see this assignment. */
  @Get(':assignmentId/sample')
  async sample(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    this.requireUuid(assignmentId, 'assignment');
    const viewer = await this.requireViewer(request);
    const result = await this.requirePool().query(
      `SELECT sample_bytes, sample_content_type
         FROM assignment_sample_for_viewer($1, $2, $3, $4, $5)`,
      [assignmentId, viewer.principalId, viewer.accountId, viewer.tenantId, viewer.seatId],
    );
    const row = result.rows[0] as { sample_bytes: Buffer; sample_content_type: string } | undefined;
    if (!row) throw new HttpException(error('sample_not_found', 'Картинки нет.'), 404);
    return reply
      .header('content-type', row.sample_content_type)
      .header('cache-control', 'private, max-age=60')
      .send(row.sample_bytes);
  }

  // Папки.
  //
  // Дерево отвечает на вопрос «куда я это положил». На вопрос «что мне подходит
  // сейчас» отвечают признаки задания — среда, возраст, классы, годы, — и они
  // приходят вместе со списком, расставлять их руками не нужно.

  @Get('folders')
  async folders(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT id, parent_id, title, depth, direct_count, total_count
         FROM assignment_folder_tree($1)`,
      [context.principalId],
    );
    return {
      items: (result.rows as FolderRow[]).map((row) => ({
        id: row.id,
        parentId: row.parent_id,
        title: row.title,
        depth: Number(row.depth),
        directCount: Number(row.direct_count),
        totalCount: Number(row.total_count),
      })),
    };
  }

  @Post('folders')
  async createFolder(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireEducator(request);
    const shape = checkBodyShape(rawBody, ['title', 'parentId']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = String(shape.body['title'] ?? '').trim();
    const parentId = shape.body['parentId'] ?? null;
    if (title.length === 0 || title.length > 120) {
      throw new HttpException(error('validation_error', 'Введите название папки.'), 400);
    }
    if (parentId !== null) this.requireUuid(String(parentId), 'folder');
    const result = await this.requirePool().query(
      `SELECT assignment_folder_create($1, $2, $3) AS id`,
      [context.principalId, parentId, title],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) {
      throw new HttpException(
        error(
          'folder_rejected',
          'Папку создать не удалось: имя уже занято рядом или вложенность слишком глубокая.',
        ),
        400,
      );
    }
    return { id };
  }

  @Patch('folders/:folderId')
  async updateFolder(
    @Req() request: FastifyRequest,
    @Param('folderId') folderId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(folderId, 'folder');
    const shape = checkBodyShape(rawBody, ['title', 'parentId']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const pool = this.requirePool();

    if (shape.body['title'] !== undefined) {
      const title = String(shape.body['title'] ?? '').trim();
      if (title.length === 0 || title.length > 120) {
        throw new HttpException(error('validation_error', 'Введите название папки.'), 400);
      }
      const renamed = await pool.query(`SELECT assignment_folder_rename($1, $2, $3) AS ok`, [
        context.principalId,
        folderId,
        title,
      ]);
      if ((renamed.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
        throw new HttpException(error('folder_not_found', 'Папка не найдена.'), 404);
      }
    }

    if (shape.body['parentId'] !== undefined) {
      const parentId = shape.body['parentId'] ?? null;
      if (parentId !== null) this.requireUuid(String(parentId), 'folder');
      const moved = await pool.query(`SELECT assignment_folder_move($1, $2, $3) AS ok`, [
        context.principalId,
        folderId,
        parentId,
      ]);
      if ((moved.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
        throw new HttpException(error('folder_rejected', 'Папку туда перенести нельзя.'), 400);
      }
    }

    return { ok: true as const };
  }

  /** Удаляется папка, а не задания: всё внутри поднимается на уровень выше. */
  @Delete('folders/:folderId')
  async deleteFolder(@Req() request: FastifyRequest, @Param('folderId') folderId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(folderId, 'folder');
    const result = await this.requirePool().query(`SELECT assignment_folder_delete($1, $2) AS ok`, [
      context.principalId,
      folderId,
    ]);
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('folder_not_found', 'Папка не найдена.'), 404);
    }
    return { removed: true as const };
  }

  /** Задание переезжает в папку. null — в корень полки. */
  @Put(':assignmentId/folder')
  async moveAssignment(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['folderId']);
    const folderId = shape.ok ? (shape.body['folderId'] ?? null) : null;
    if (folderId !== null) this.requireUuid(String(folderId), 'folder');
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_move($1, $2, $3) AS ok`,
      [context.principalId, assignmentId, folderId],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    }
    return { ok: true as const };
  }

  /**
   * В архив и обратно.
   *
   * Задание прошлого года уходит из списка, но остаётся в базе: удалив его, мы
   * удалили бы выдачи и работы учеников за тот год.
   */
  @Put(':assignmentId/archived')
  async archiveAssignment(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['archived']);
    const archived = shape.ok ? shape.body['archived'] === true : false;
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_archive($1, $2, $3) AS ok`,
      [context.principalId, assignmentId, archived],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    }
    return { ok: true as const };
  }

  /**
   * Своя версия задания.
   *
   * Правка на месте меняет задание всем классам, которым оно выдано. Когда
   * переделка нужна одному классу, берут копию: она ложится в ту же папку,
   * помнит источник, а готовый курс остаётся готовым курсом.
   */
  @Post(':assignmentId/copy')
  async copyAssignment(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['title']);
    const title = shape.ok ? (shape.body['title'] ?? null) : null;
    if (title !== null && (typeof title !== 'string' || title.length > 255)) {
      throw new HttpException(error('validation_error', 'Название слишком длинное.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_copy($1, $2, $3) AS id`,
      [context.principalId, assignmentId, title],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    return { id };
  }

  /**
   * Картинка внутри текста задания.
   *
   * Образец отвечает «что должно получиться», а эти — «как дойти до шага 3».
   * Возвращается адрес: текст задания хранит ссылку, а не байты, и остаётся
   * текстом, который можно поправить через год.
   */
  @Post(':assignmentId/images')
  async addImage(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['imageDataUrl']);
    const raw = shape.ok ? shape.body['imageDataUrl'] : null;
    if (typeof raw !== 'string') {
      throw new HttpException(error('validation_error', 'Неверное изображение.'), 400);
    }
    const picture = decodeImage(raw);
    const result = await this.requirePool().query(
      `SELECT teacher_assignment_image_add($1, $2, $3, $4) AS id`,
      [context.principalId, assignmentId, picture.bytes, picture.contentType],
    );
    const id = (result.rows[0] as { id: string | null } | undefined)?.id ?? null;
    if (!id) throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    return { id, url: `/api/assignments/${assignmentId}/images/${id}` };
  }

  /** Отдать её. Как и образец — любому, кому видно само задание. */
  @Get(':assignmentId/images/:imageId')
  async image(
    @Req() request: FastifyRequest,
    @Param('assignmentId') assignmentId: string,
    @Param('imageId') imageId: string,
    @Res({ passthrough: false }) reply: FastifyReply,
  ) {
    this.requireUuid(assignmentId, 'assignment');
    this.requireUuid(imageId, 'image');
    const viewer = await this.requireViewer(request);
    const result = await this.requirePool().query(
      `SELECT bytes, content_type
         FROM assignment_image_for_viewer($1, $2, $3, $4, $5, $6)`,
      [assignmentId, imageId, viewer.principalId, viewer.accountId, viewer.tenantId, viewer.seatId],
    );
    const row = result.rows[0] as { bytes: Buffer; content_type: string } | undefined;
    if (!row) throw new HttpException(error('image_not_found', 'Картинки нет.'), 404);
    return reply
      .header('content-type', row.content_type)
      .header('cache-control', 'private, max-age=300')
      .send(row.bytes);
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
