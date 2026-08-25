import { Body, Controller, Get, HttpException, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';
import {
  LearningCanonicalProjectionService,
  canonicalProjectionKey,
} from './learning-canonical-projection.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISIONS = ['accepted', 'changes_requested', 'incomplete', 'excused'] as const;
const QUESTION_TYPES = [
  'single_choice',
  'multiple_choice',
  'boolean',
  'numeric',
  'short_text',
] as const;

function error(code: string, message: string) {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Controller('api/classrooms')
export class LearningAssessmentsController {
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

  private canonical(): LearningCanonicalProjectionService {
    return new LearningCanonicalProjectionService(this.requirePool());
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Проверка доступна педагогам.'), 403);
    }
    return context;
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  /** The answer key is accepted here but never returned by any learner route. */
  @Post('/learning/questions')
  async createQuestion(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireEducator(request);
    const shape = checkBodyShape(rawBody, [
      'type',
      'prompt',
      'options',
      'correctAnswer',
      'tolerance',
      'maxPoints',
      'scope',
      'subject',
      'ageBand',
      'tags',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const type = shape.body['type'];
    const prompt = shape.body['prompt'];
    const options = shape.body['options'] ?? [];
    const correctAnswer = shape.body['correctAnswer'];
    const tolerance = shape.body['tolerance'] ?? 0;
    const maxPoints = shape.body['maxPoints'] ?? 1;
    const scope = shape.body['scope'] ?? 'school';
    const subject = shape.body['subject'] ?? null;
    const ageBand = shape.body['ageBand'] ?? null;
    const tags = shape.body['tags'] ?? [];
    if (
      typeof type !== 'string' ||
      !QUESTION_TYPES.includes(type as (typeof QUESTION_TYPES)[number]) ||
      typeof prompt !== 'string' ||
      prompt.trim().length === 0 ||
      prompt.length > 4000 ||
      typeof maxPoints !== 'number' ||
      !Number.isInteger(maxPoints) ||
      maxPoints < 1 ||
      maxPoints > 10000 ||
      (scope !== 'personal' && scope !== 'school') ||
      (subject !== null && (typeof subject !== 'string' || subject.length > 80)) ||
      (ageBand !== null && (typeof ageBand !== 'string' || ageBand.length > 32)) ||
      !Array.isArray(tags) ||
      tags.some((tag) => typeof tag !== 'string' || tag.length > 40)
    ) {
      throw new HttpException(error('validation_error', 'Проверьте параметры вопроса.'), 400);
    }

    let responseSchema: Record<string, unknown> = {};
    let answerKey: Record<string, unknown>;
    if (type === 'single_choice' || type === 'multiple_choice') {
      if (
        !Array.isArray(options) ||
        options.length < 2 ||
        options.length > 12 ||
        options.some(
          (option) =>
            !option ||
            typeof option !== 'object' ||
            typeof (option as Record<string, unknown>)['id'] !== 'string' ||
            typeof (option as Record<string, unknown>)['label'] !== 'string' ||
            !String((option as Record<string, unknown>)['label']).trim() ||
            String((option as Record<string, unknown>)['label']).length > 500,
        )
      ) {
        throw new HttpException(error('validation_error', 'Добавьте от 2 до 12 вариантов.'), 400);
      }
      responseSchema = { options };
      const optionIds = options.map((option) => String((option as Record<string, unknown>)['id']));
      if (new Set(optionIds).size !== optionIds.length) {
        throw new HttpException(
          error('validation_error', 'Идентификаторы вариантов повторяются.'),
          400,
        );
      }
      if (type === 'single_choice') {
        if (typeof correctAnswer !== 'string' || !optionIds.includes(correctAnswer)) {
          throw new HttpException(error('validation_error', 'Выберите правильный вариант.'), 400);
        }
        answerKey = { value: correctAnswer };
      } else {
        if (
          !Array.isArray(correctAnswer) ||
          correctAnswer.length === 0 ||
          correctAnswer.some((value) => typeof value !== 'string' || !optionIds.includes(value)) ||
          new Set(correctAnswer).size !== correctAnswer.length
        ) {
          throw new HttpException(error('validation_error', 'Выберите правильные варианты.'), 400);
        }
        answerKey = { values: [...correctAnswer].sort() };
      }
    } else if (type === 'boolean') {
      if (typeof correctAnswer !== 'boolean') {
        throw new HttpException(error('validation_error', 'Укажите ответ да или нет.'), 400);
      }
      answerKey = { value: correctAnswer };
    } else if (type === 'numeric') {
      if (
        typeof correctAnswer !== 'number' ||
        !Number.isFinite(correctAnswer) ||
        typeof tolerance !== 'number' ||
        !Number.isFinite(tolerance) ||
        tolerance < 0
      ) {
        throw new HttpException(
          error('validation_error', 'Укажите число и допустимую погрешность.'),
          400,
        );
      }
      responseSchema = { input: 'number' };
      answerKey = { value: correctAnswer, tolerance };
    } else {
      const accepted = Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer];
      if (
        accepted.length === 0 ||
        accepted.some((value) => typeof value !== 'string' || !value.trim())
      ) {
        throw new HttpException(
          error('validation_error', 'Добавьте допустимый короткий ответ.'),
          400,
        );
      }
      responseSchema = { input: 'text', maxLength: 500 };
      answerKey = { accepted };
    }

    const result = await this.requirePool().query(
      `SELECT result_code, question_id, question_version_id
         FROM question_version_create(
           $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb,
           $8, $9, $10, $11::text[]
         )`,
      [
        context.principalId,
        context.tenantId,
        scope,
        type,
        JSON.stringify([{ type: 'paragraph', text: prompt.trim() }]),
        JSON.stringify(responseSchema),
        JSON.stringify(answerKey),
        maxPoints,
        subject,
        ageBand,
        tags,
      ],
    );
    const row = result.rows[0] as
      | { result_code: string; question_id: string | null; question_version_id: string | null }
      | undefined;
    if (!row || row.result_code !== 'ok' || !row.question_id || !row.question_version_id) {
      throw new HttpException(
        error(row?.result_code ?? 'question_failed', 'Не удалось сохранить версию вопроса.'),
        row?.result_code === 'tenant_forbidden' ? 403 : 409,
      );
    }
    return { id: row.question_id, versionId: row.question_version_id };
  }

  @Get('/learning/questions')
  async questions(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT question_id, question_version_id, question_type, prompt_blocks,
              response_schema, max_points, scope_kind, subject, age_band,
              tags, published_at
         FROM question_bank_list($1, $2)`,
      [context.principalId, context.tenantId],
    );
    return {
      items: result.rows.map((row) => ({
        id: String(row['question_id']),
        versionId: String(row['question_version_id']),
        type: String(row['question_type']),
        promptBlocks: row['prompt_blocks'],
        responseSchema: row['response_schema'],
        maxPoints: Number(row['max_points']),
        scope: String(row['scope_kind']),
        subject: row['subject'] ? String(row['subject']) : null,
        ageBand: row['age_band'] ? String(row['age_band']) : null,
        tags: row['tags'] as string[],
        publishedAt: iso(row['published_at'] as Date | string),
      })),
    };
  }

  @Post('/learning/quizzes')
  async createQuiz(@Req() request: FastifyRequest, @Body() rawBody: unknown) {
    const context = await this.requireEducator(request);
    const shape = checkBodyShape(rawBody, [
      'title',
      'instructions',
      'questionVersionIds',
      'attemptLimit',
      'timeLimitMinutes',
      'passThreshold',
      'feedbackReleasePolicy',
    ]);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'];
    const instructions = shape.body['instructions'] ?? null;
    const questionVersionIds = shape.body['questionVersionIds'];
    const attemptLimit = shape.body['attemptLimit'] ?? 1;
    const timeLimitMinutes = shape.body['timeLimitMinutes'] ?? null;
    const passThreshold = shape.body['passThreshold'] ?? 60;
    const feedbackPolicy = shape.body['feedbackReleasePolicy'] ?? 'immediate';
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 255 ||
      (instructions !== null &&
        (typeof instructions !== 'string' || instructions.length > 12000)) ||
      !Array.isArray(questionVersionIds) ||
      questionVersionIds.length === 0 ||
      questionVersionIds.length > 100 ||
      questionVersionIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id)) ||
      typeof attemptLimit !== 'number' ||
      !Number.isInteger(attemptLimit) ||
      attemptLimit < 1 ||
      attemptLimit > 20 ||
      (timeLimitMinutes !== null &&
        (typeof timeLimitMinutes !== 'number' ||
          !Number.isInteger(timeLimitMinutes) ||
          timeLimitMinutes < 1 ||
          timeLimitMinutes > 480)) ||
      typeof passThreshold !== 'number' ||
      passThreshold < 0 ||
      passThreshold > 100 ||
      !['immediate', 'score_only', 'after_close'].includes(String(feedbackPolicy))
    ) {
      throw new HttpException(error('validation_error', 'Проверьте параметры теста.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, quiz_version_id, learning_activity_version_id, total_points
         FROM quiz_version_create(
           $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9
         )`,
      [
        context.principalId,
        context.tenantId,
        title.trim(),
        instructions,
        JSON.stringify(questionVersionIds),
        attemptLimit,
        timeLimitMinutes,
        Math.round(passThreshold * 100),
        feedbackPolicy,
      ],
    );
    const row = result.rows[0] as
      | {
          result_code: string;
          quiz_version_id: string | null;
          learning_activity_version_id: string | null;
          total_points: number | string | null;
        }
      | undefined;
    if (!row || row.result_code !== 'ok' || !row.quiz_version_id) {
      throw new HttpException(
        error(row?.result_code ?? 'quiz_failed', 'Не удалось опубликовать тест.'),
        row?.result_code === 'tenant_forbidden' ? 403 : 409,
      );
    }
    return {
      id: row.quiz_version_id,
      activityVersionId: row.learning_activity_version_id,
      totalPoints: Number(row.total_points),
    };
  }

  @Get('/learning/quizzes')
  async quizzes(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT quiz_version_id, title, instructions, question_count,
              total_points, attempt_limit, time_limit_minutes,
              pass_threshold_basis_points, feedback_release_policy, published_at
         FROM quiz_version_list($1, $2)`,
      [context.principalId, context.tenantId],
    );
    return {
      items: result.rows.map((row) => ({
        id: String(row['quiz_version_id']),
        title: String(row['title']),
        instructions: row['instructions'] ? String(row['instructions']) : null,
        questionCount: Number(row['question_count']),
        totalPoints: Number(row['total_points']),
        attemptLimit: Number(row['attempt_limit']),
        timeLimitMinutes:
          row['time_limit_minutes'] === null ? null : Number(row['time_limit_minutes']),
        passThreshold: Number(row['pass_threshold_basis_points']) / 100,
        feedbackReleasePolicy: String(row['feedback_release_policy']),
        publishedAt: iso(row['published_at'] as Date | string),
      })),
    };
  }

  @Post(':classroomId/quizzes')
  async assignQuiz(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['quizVersionId', 'dueAt']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const quizVersionId = shape.body['quizVersionId'];
    const dueAt = shape.body['dueAt'] ?? null;
    if (
      typeof quizVersionId !== 'string' ||
      !UUID_PATTERN.test(quizVersionId) ||
      (dueAt !== null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt))))
    ) {
      throw new HttpException(error('validation_error', 'Проверьте тест и срок.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, classroom_assignment_id, reused
         FROM classroom_quiz_assign($1, $2, $3, $4, $5)`,
      [context.accountId, context.principalId, classroomId, quizVersionId, dueAt],
    );
    const row = result.rows[0] as
      { result_code: string; classroom_assignment_id: string | null; reused: boolean } | undefined;
    if (!row || row.result_code !== 'ok' || !row.classroom_assignment_id) {
      throw new HttpException(
        error(row?.result_code ?? 'quiz_assign_failed', 'Не удалось назначить тест.'),
        404,
      );
    }
    return { assignmentId: row.classroom_assignment_id, reused: row.reused };
  }

  /** One canonical matrix for work state, result and published grade. */
  @Get(':classroomId/gradebook')
  async gradebook(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const [result, scheme, projections] = await Promise.all([
      this.requirePool().query(
        `SELECT seat_id, display_label, assignment_id, assignment_title,
              attempt_id, attempt_number, attempt_state, submitted_at,
              raw_points, max_points, percentage_basis_points, outcome,
              feedback, published_at
         FROM classroom_gradebook_list($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.requirePool().query(
        `SELECT title, version_number, bands, published_at
           FROM grading_scheme_for_classroom($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.canonical().forTeacher(context.accountId, classroomId),
    ]);
    const schemeRow = scheme.rows[0] as
      | {
          title: string;
          version_number: number | string;
          bands: Array<{ minBasisPoints: number; label: string }>;
        }
      | undefined;
    const bands = schemeRow?.bands ?? [];
    return {
      scheme: schemeRow
        ? { title: schemeRow.title, version: Number(schemeRow.version_number), bands }
        : null,
      items: result.rows.map((row) => {
        const canonical = projections.get(
          canonicalProjectionKey(String(row['seat_id']), String(row['assignment_id'])),
        )?.surface;
        const selected = canonical?.selectedResult ?? null;
        return {
          seatId: String(row['seat_id']),
          displayLabel: String(row['display_label']),
          assignmentId: String(row['assignment_id']),
          assignmentTitle: String(row['assignment_title']),
          attemptId: row['attempt_id'] ? String(row['attempt_id']) : null,
          attemptNumber: row['attempt_number'] === null ? null : Number(row['attempt_number']),
          state:
            canonical?.workflowState ??
            (row['attempt_state'] ? String(row['attempt_state']) : 'not_started'),
          submittedAt: row['submitted_at'] ? iso(row['submitted_at'] as Date | string) : null,
          points: canonical
            ? (selected?.rawPoints ?? null)
            : row['raw_points'] === null
              ? null
              : Number(row['raw_points']),
          maxPoints: canonical
            ? (selected?.maxPoints ?? null)
            : row['max_points'] === null
              ? null
              : Number(row['max_points']),
          percentage: canonical
            ? selected?.percentageBasisPoints === null ||
              selected?.percentageBasisPoints === undefined
              ? null
              : selected.percentageBasisPoints / 100
            : row['percentage_basis_points'] === null
              ? null
              : Number(row['percentage_basis_points']) / 100,
          displayGrade: canonical
            ? (selected?.displayGrade ?? null)
            : row['percentage_basis_points'] === null
              ? null
              : ([...bands]
                  .sort((a, b) => b.minBasisPoints - a.minBasisPoints)
                  .find((band) => band.minBasisPoints <= Number(row['percentage_basis_points']))
                  ?.label ?? null),
          outcome: canonical
            ? (selected?.outcome ?? null)
            : row['outcome']
              ? String(row['outcome'])
              : null,
          feedback: row['feedback'] ? String(row['feedback']) : null,
          publishedAt: canonical
            ? (selected?.publishedAt ?? null)
            : row['published_at']
              ? iso(row['published_at'] as Date | string)
              : null,
          canonicalState: canonical ?? null,
          compatibilityDiagnostic: canonical?.compatibilityDiagnostic ?? null,
        };
      }),
    };
  }

  @Get(':classroomId/grading-scheme')
  async gradingScheme(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const result = await this.requirePool().query(
      `SELECT title, version_number, bands, published_at
         FROM grading_scheme_for_classroom($1, $2)`,
      [context.accountId, classroomId],
    );
    const row = result.rows[0];
    return row
      ? {
          title: row['title'],
          version: Number(row['version_number']),
          bands: row['bands'],
          publishedAt: iso(row['published_at'] as Date | string),
        }
      : { title: null, version: null, bands: [] };
  }

  @Post(':classroomId/grading-scheme')
  async publishGradingScheme(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['title', 'bands']);
    const title = shape.ok ? shape.body['title'] : null;
    const bands = shape.ok ? shape.body['bands'] : null;
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.length > 120 ||
      !Array.isArray(bands) ||
      bands.length < 2 ||
      bands.length > 10 ||
      bands.some(
        (band) =>
          !band ||
          typeof band !== 'object' ||
          !Number.isInteger((band as Record<string, unknown>)['minBasisPoints']) ||
          typeof (band as Record<string, unknown>)['label'] !== 'string',
      )
    )
      throw new HttpException(error('validation_error', 'Проверьте шкалу оценок.'), 400);
    const result = await this.requirePool().query(
      `SELECT result_code, grading_scheme_version_id, version_number
         FROM grading_scheme_publish($1, $2, $3, $4, $5::jsonb)`,
      [context.accountId, context.principalId, classroomId, title.trim(), JSON.stringify(bands)],
    );
    const row = result.rows[0] as
      | {
          result_code: string;
          grading_scheme_version_id: string | null;
          version_number: number | string | null;
        }
      | undefined;
    if (!row || row.result_code !== 'ok') {
      throw new HttpException(
        error(row?.result_code ?? 'scheme_failed', 'Не удалось сохранить шкалу.'),
        row?.result_code === 'classroom_not_found' ? 404 : 409,
      );
    }
    return { id: row.grading_scheme_version_id, version: Number(row.version_number) };
  }

  @Get(':classroomId/gradebook/:assignmentId/:seatId/history')
  async gradeHistory(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('assignmentId') assignmentId: string,
    @Param('seatId') seatId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(assignmentId, 'assignment');
    this.requireUuid(seatId, 'seat');
    const result = await this.requirePool().query(
      `SELECT event_id, event_kind, reason, snapshot, actor_display_name, created_at
         FROM gradebook_history_list($1, $2, $3, $4)`,
      [context.accountId, classroomId, assignmentId, seatId],
    );
    return {
      items: result.rows.map((row) => ({
        id: row['event_id'],
        kind: row['event_kind'],
        reason: row['reason'],
        snapshot: row['snapshot'],
        actor: row['actor_display_name'],
        createdAt: iso(row['created_at'] as Date | string),
      })),
    };
  }

  /** Review exactly one immutable attempt and publish its canonical result. */
  @Post(':classroomId/attempts/:attemptId/review')
  async review(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('attemptId') attemptId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(attemptId, 'attempt');
    const shape = checkBodyShape(rawBody, ['decision', 'points', 'feedback', 'reason']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const decision = shape.body['decision'];
    const points = shape.body['points'] ?? null;
    const feedback = shape.body['feedback'] ?? null;
    const reason = shape.body['reason'] ?? null;
    if (
      typeof decision !== 'string' ||
      !DECISIONS.includes(decision as (typeof DECISIONS)[number])
    ) {
      throw new HttpException(error('validation_error', 'Неизвестное решение проверки.'), 400);
    }
    if (
      points !== null &&
      (typeof points !== 'number' || !Number.isInteger(points) || points < 0 || points > 1_000_000)
    ) {
      throw new HttpException(error('validation_error', 'Баллы должны быть целым числом.'), 400);
    }
    if (feedback !== null && (typeof feedback !== 'string' || feedback.length > 8000)) {
      throw new HttpException(error('validation_error', 'Отзыв слишком длинный.'), 400);
    }
    if (reason !== null && (typeof reason !== 'string' || reason.length > 1000)) {
      throw new HttpException(error('validation_error', 'Причина слишком длинная.'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT result_code, assessment_result_id, gradebook_entry_id,
              attempt_state, percentage_basis_points
         FROM learning_attempt_review($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        context.accountId,
        context.principalId,
        classroomId,
        attemptId,
        decision,
        points,
        feedback,
        reason,
      ],
    );
    const row = result.rows[0] as
      | {
          result_code: string;
          assessment_result_id: string | null;
          gradebook_entry_id: string | null;
          attempt_state: string | null;
          percentage_basis_points: number | string | null;
        }
      | undefined;
    if (!row || row.result_code === 'attempt_not_found') {
      throw new HttpException(error('attempt_not_found', 'Попытка не найдена.'), 404);
    }
    if (row.result_code === 'classroom_not_found') {
      throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    }
    if (row.result_code !== 'ok') {
      const messages: Record<string, string> = {
        invalid_decision: 'Неизвестное решение проверки.',
        invalid_transition: 'Эту попытку уже проверили или вернули.',
        invalid_points: 'Баллы выходят за пределы задания.',
        invalid_feedback: 'Отзыв слишком длинный.',
        reason_required: 'Для этого решения нужна причина.',
      };
      throw new HttpException(
        error(row.result_code, messages[row.result_code] ?? 'Не удалось сохранить результат.'),
        409,
      );
    }
    return {
      attemptId,
      state: row.attempt_state,
      assessmentResultId: row.assessment_result_id,
      gradebookEntryId: row.gradebook_entry_id,
      percentage:
        row.percentage_basis_points === null ? null : Number(row.percentage_basis_points) / 100,
    };
  }
}
