import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { hashSessionToken } from '@asa-lab/identity';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import type { GetTeachingContextUseCase } from '@asa-lab/organization';
import {
  areValidTopicKeys,
  classroomCodeFor,
  classroomCodeHash,
  isClassroomAgeBand,
  isClassroomStatus,
  isSeatAvatarKey,
  isValidClassroomTitle,
  type Classroom,
  type CreateClassroomUseCase,
  type ListClassroomsUseCase,
} from '@asa-lab/classroom';
import { classroomCodeSecret } from './classroom-code-secret.js';
import { teacherHomeAttention } from './teacher-home-attention.js';
import {
  decryptStudentCode,
  loadStudentCodeProtectionConfig,
  protectStudentCode,
  StudentCodeProtectionConfigError,
  StudentCodeProtectionUnavailableError,
  type StudentCodeProtectionConfig,
} from './student-code-protection.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape, checkIdempotencyKey, isPlainObject } from './validation.js';
import {
  LearningCanonicalProjectionService,
  canonicalProjectionKey,
} from './learning-canonical-projection.service.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STUDENT_CODE_ALPHABET = '2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy';
const AUTO_STUDENT_CODE_LENGTH = 6;
const STUDENT_CODE_PATTERN = /^[A-Za-z0-9]{4,10}$/;
const SEAT_STATUSES = ['issued', 'active', 'suspended'] as const;
/** The badge vocabulary, matching the database's own check constraint. */
const SEAT_AWARDS: readonly string[] = [
  'first-model',
  'bright-idea',
  'careful-work',
  'precision',
  'perseverance',
  'helper',
  'explorer',
  'editors-choice',
];

interface ClassroomSummaryRow {
  id: string;
  title: string;
  status: string;
  age_band: Classroom['ageBand'];
  topic_keys: string[];
  safe_mode_default: boolean;
  created_at: Date | string;
  join_code_version: number | string | null;
  join_code_status: 'active' | 'revoked' | null;
  student_count: number | string;
  awaiting_review?: number | string;
  teacher_role: 'owner' | 'co_teacher';
  workspace_kind: 'personal' | 'organization';
  workspace_title: string;
  archived_at: Date | string | null;
}

interface ClassroomCreationContext {
  tenantId: string;
  schoolId: string;
  academicPeriodId: string;
  userId: string;
}

interface StudentSeatRow {
  id: string;
  display_label: string;
  login_handle: string;
  assigned_count?: number | string;
  submitted_count?: number | string;
  awaiting_review?: number | string;
  safe_mode: boolean;
  status: 'issued' | 'active' | 'suspended';
  avatar_key: string | null;
  last_active_at: Date | string | null;
  created_at: Date | string;
}

interface ProtectedStudentCodeRow {
  seat_id: string;
  tenant_id: string;
  classroom_id: string;
  credential_version: number | string;
  credential_state: 'protected' | 'legacy_predictable';
  encryption_key_id: string;
  encryption_nonce: Buffer;
  encryption_ciphertext: Buffer;
  encryption_tag: Buffer;
  lookup_key_id: string;
}

interface ClassroomActivityRow {
  id: string;
  action: string;
  seat_id: string | null;
  seat_label: string | null;
  actor_is_teacher: boolean;
  project_id: string | null;
  project_title: string | null;
  occurrence_count: number | string;
  first_occurred_at: Date | string;
  occurred_at: Date | string;
}

interface SeatProjectRow {
  id: string;
  module_key: string;
  title: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  snapshot_revision: number | string | null;
  preview_json: unknown;
  preview_digest: string | null;
  last_editor_was_teacher: boolean;
  submitted_at?: Date | string | null;
  awaiting_review?: boolean;
  assignment_title?: string | null;
  assignment_goal?: string | null;
  assignment_brief?: string | null;
  assignment_sample_image?: string | null;
}

interface AssignmentRow {
  id: string;
  assignment_id?: string;
  title: string;
  brief: string | null;
  goal: string | null;
  module_key: string;
  due_at: Date | string | null;
  status: 'open' | 'closed';
  created_at: Date | string;
  /** Set on the ten tasks every class is given; null on a teacher's own. */
  demo_key?: string | null;
  sample_image?: string | null;
  seat_count?: number | string;
  started_count?: number | string;
  submitted_count?: number | string;
  audience_type?: 'whole_class' | 'named_learners' | null;
  canonical_assigned_count?: number | string;
}

interface AssignmentProgressRow {
  seat_id: string;
  display_label: string;
  avatar_key: string | null;
  project_id: string | null;
  snapshot_revision: number | string | null;
  started_at: Date | string | null;
  submitted_at: Date | string | null;
  badge: string | null;
}

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function classroomView(classroom: Classroom) {
  return {
    ...classroom,
    joinCode:
      classroom.joinCodeVersion && classroom.joinCodeStatus === 'active'
        ? classroomCodeFor(classroom.id, classroom.joinCodeVersion, classroomCodeSecret())
        : null,
  };
}

function summaryView(row: ClassroomSummaryRow) {
  const joinCodeVersion = row.join_code_version === null ? null : Number(row.join_code_version);
  return classroomView({
    id: row.id,
    title: row.title,
    status: row.status,
    ageBand: row.age_band,
    topicKeys: row.topic_keys ?? [],
    safeModeDefault: row.safe_mode_default,
    studentCount: Number(row.student_count),
    joinCodeVersion,
    joinCodeStatus: row.join_code_status,
    teacherRole: row.teacher_role,
    workspaceKind: row.workspace_kind,
    workspaceTitle: row.workspace_title,
    createdAt: iso(row.created_at),
    archivedAt: row.archived_at ? iso(row.archived_at) : null,
    // Сдано и ещё не отвечено. Учитель видит это в списке классов, не заходя
    // в каждое задание, чтобы выяснить, есть ли что проверять.
    awaitingReview: row.awaiting_review === undefined ? 0 : Number(row.awaiting_review),
  });
}

function seatView(row: StudentSeatRow) {
  return {
    id: row.id,
    displayLabel: row.display_label,
    studentCode: row.login_handle,
    // Legacy alias kept temporarily for older clients; new UI calls this Student Code.
    loginHandle: row.login_handle,
    // Сколько заданий выдано классу, сколько этот человек сдал и сколько из
    // сданного ещё ждёт ответа. Преподаватель видит это в списке, а не после
    // того, как откроет каждого по очереди.
    assignedCount: row.assigned_count === undefined ? 0 : Number(row.assigned_count),
    submittedCount: row.submitted_count === undefined ? 0 : Number(row.submitted_count),
    awaitingReview: row.awaiting_review === undefined ? 0 : Number(row.awaiting_review),
    safeMode: row.safe_mode,
    status: row.status,
    // Null means "nobody has chosen"; the client draws one from the built-in
    // set keyed by the seat, so a class looks like a class from the first
    // minute without a picture having to be picked thirty times.
    avatarKey: row.avatar_key,
    lastActiveAt: row.last_active_at ? iso(row.last_active_at) : null,
    createdAt: iso(row.created_at),
  };
}

function assignmentView(row: AssignmentRow) {
  return {
    id: row.id,
    assignmentId: row.assignment_id ?? row.id,
    title: row.title,
    brief: row.brief,
    goal: row.goal ?? null,
    moduleKey: row.module_key,
    dueAt: row.due_at ? iso(row.due_at) : null,
    status: row.status,
    createdAt: iso(row.created_at),
    isDemo: Boolean(row.demo_key),
    sampleImage: row.sample_image ?? null,
    // Present on the list, absent on the row returned straight after creating
    // one — a brand-new assignment has nobody in it yet.
    seatCount: row.seat_count === undefined ? 0 : Number(row.seat_count),
    startedCount: row.started_count === undefined ? 0 : Number(row.started_count),
    submittedCount: row.submitted_count === undefined ? 0 : Number(row.submitted_count),
    audienceType: row.audience_type ?? null,
    assignedCount:
      row.canonical_assigned_count === undefined ? null : Number(row.canonical_assigned_count),
  };
}

/**
 * Код для входа, который ребёнок вводит с доски.
 *
 * Шесть знаков из букв и цифр — короткий, как пароль, и не читается как номер.
 * Из набора убраны знаки, которые путают на слух и на доске: ноль и «O»,
 * единица с «I» и «l».
 */
function generateStudentCode(): string {
  let code = '';
  for (let index = 0; index < AUTO_STUDENT_CODE_LENGTH; index += 1) {
    code += STUDENT_CODE_ALPHABET[randomInt(STUDENT_CODE_ALPHABET.length)];
  }
  return code;
}

const BATCH_STUDENT_INPUT_KEYS = new Set(['displayLabel', 'safeMode']);

function batchStudentInputHasUnsupportedKeys(students: unknown[]): boolean {
  return students.some(
    (student) =>
      isPlainObject(student) &&
      Object.keys(student).some((key) => !BATCH_STUDENT_INPUT_KEYS.has(key)),
  );
}

@Controller('api/classrooms')
export class ClassroomsController {
  constructor(
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountDirectory) private readonly accounts: AccountDirectoryPort,
    @Inject(TOKENS.teachingContextUseCase)
    private readonly teachingContext: GetTeachingContextUseCase,
    @Inject(TOKENS.createClassroomUseCase) private readonly createUseCase: CreateClassroomUseCase,
    @Inject(TOKENS.listClassroomsUseCase) private readonly listUseCase: ListClassroomsUseCase,
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

  private studentCodeProtection(): StudentCodeProtectionConfig | null {
    try {
      return loadStudentCodeProtectionConfig();
    } catch (failure) {
      if (failure instanceof StudentCodeProtectionConfigError) {
        throw new HttpException(
          error('credential_storage_unavailable', 'Хранилище кодов учеников временно недоступно.'),
          503,
        );
      }
      throw failure;
    }
  }

  private async protectedTenantId(
    client: pg.Pool | pg.PoolClient,
    accountId: string,
    classroomId: string,
  ): Promise<string> {
    const result = await client.query(
      'SELECT tenant_id FROM classroom_student_code_protection_context($1,$2)',
      [accountId, classroomId],
    );
    const tenantId = result.rows[0]?.tenant_id as string | undefined;
    if (!tenantId) {
      throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    }
    return tenantId;
  }

  private async storeProtectedStudentCode(
    client: pg.Pool | pg.PoolClient,
    accountId: string,
    classroomId: string,
    seatId: string,
    studentCode: string,
    credentialVersion: number,
    tenantId?: string,
    onlyIfMissing = false,
    credentialState: 'protected' | 'legacy_predictable' = 'protected',
  ): Promise<void> {
    const config = this.studentCodeProtection();
    if (!config) return;
    if (onlyIfMissing) {
      const existing = await client.query(
        `SELECT credential_version
           FROM classroom_student_code_protected_read($1,$2)
          WHERE seat_id=$3`,
        [accountId, classroomId, seatId],
      );
      if (Number(existing.rows[0]?.credential_version) === credentialVersion) return;
    }
    const authoritativeTenantId =
      tenantId ?? (await this.protectedTenantId(client, accountId, classroomId));
    const envelope = protectStudentCode(config, {
      tenantId: authoritativeTenantId,
      classroomId,
      seatId,
      credentialVersion,
      studentCode,
    });
    const result = await client.query(
      `SELECT classroom_student_code_protected_write(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb
      ) AS result_code`,
      [
        accountId,
        classroomId,
        seatId,
        credentialVersion,
        credentialState,
        envelope.encryptionKeyId,
        envelope.encryptionNonce,
        envelope.encryptionCiphertext,
        envelope.encryptionTag,
        envelope.lookupKeyId,
        envelope.lookupDigest,
        JSON.stringify(envelope.lookupCandidates),
      ],
    );
    const resultCode = result.rows[0]?.result_code as string | undefined;
    if (resultCode === 'ok') return;
    if (resultCode === 'code_in_use') {
      throw new HttpException(
        error('student_code_taken', 'Этот код уже использовался в классе.'),
        409,
      );
    }
    if (resultCode === 'version_conflict') {
      throw new HttpException(
        error('credential_version_conflict', 'Код ученика уже изменился. Обновите данные.'),
        409,
      );
    }
    if (resultCode === 'not_found') {
      throw new HttpException(error('seat_not_found', 'Ученик не найден.'), 404);
    }
    throw new HttpException(
      error('credential_storage_unavailable', 'Хранилище кодов учеников временно недоступно.'),
      503,
    );
  }

  private async protectLegacyCurrentStudentCode(
    client: pg.PoolClient,
    accountId: string,
    classroomId: string,
    seatId: string,
  ): Promise<void> {
    const existing = await client.query(
      `SELECT credential_version
         FROM classroom_student_code_protected_read($1,$2)
        WHERE seat_id=$3`,
      [accountId, classroomId, seatId],
    );
    if (existing.rows[0]) return;

    const legacy = await client.query(
      `SELECT tenant_id,student_code,credential_version
         FROM classroom_student_code_legacy_current($1,$2,$3)`,
      [accountId, classroomId, seatId],
    );
    const row = legacy.rows[0] as
      | { tenant_id?: string; student_code?: string; credential_version?: number | string }
      | undefined;
    if (
      !row?.tenant_id ||
      typeof row.student_code !== 'string' ||
      row.credential_version === undefined
    ) {
      throw new HttpException(error('seat_not_found', 'Ученик не найден.'), 404);
    }
    await this.storeProtectedStudentCode(
      client,
      accountId,
      classroomId,
      seatId,
      row.student_code,
      Number(row.credential_version),
      row.tenant_id,
      false,
      'legacy_predictable',
    );
  }

  private async protectedReadback(
    accountId: string,
    classroomId: string,
    rows: StudentSeatRow[],
  ): Promise<StudentSeatRow[]> {
    const config = this.studentCodeProtection();
    if (!config || rows.length === 0) return rows;
    const protectedRows = (
      await this.requirePool().query(
        `SELECT seat_id,tenant_id,classroom_id,credential_version,credential_state,
                encryption_key_id,encryption_nonce,encryption_ciphertext,encryption_tag,lookup_key_id
           FROM classroom_student_code_protected_read($1,$2)`,
        [accountId, classroomId],
      )
    ).rows as ProtectedStudentCodeRow[];
    const bySeat = new Map(protectedRows.map((row) => [row.seat_id, row]));
    return rows.map((row) => {
      const protectedRow = bySeat.get(row.id);
      if (!protectedRow) {
        if (config.mode === 'enforced') {
          throw new HttpException(
            error('credential_storage_unavailable', 'Защищённый код ученика недоступен.'),
            503,
          );
        }
        return row;
      }
      try {
        const studentCode = decryptStudentCode(config, {
          tenantId: protectedRow.tenant_id,
          classroomId: protectedRow.classroom_id,
          seatId: protectedRow.seat_id,
          credentialVersion: Number(protectedRow.credential_version),
          encryptionKeyId: protectedRow.encryption_key_id,
          encryptionNonce: protectedRow.encryption_nonce,
          encryptionCiphertext: protectedRow.encryption_ciphertext,
          encryptionTag: protectedRow.encryption_tag,
        });
        return { ...row, login_handle: studentCode };
      } catch (failure) {
        if (failure instanceof StudentCodeProtectionUnavailableError) {
          throw new HttpException(
            error('credential_storage_unavailable', 'Защищённый код ученика недоступен.'),
            503,
          );
        }
        throw failure;
      }
    });
  }

  private async requireContext(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    return context;
  }

  private async requireEducator(request: FastifyRequest): Promise<ActiveContext> {
    const context = await this.requireContext(request);
    const capabilities = await this.accounts.capabilities(context.accountId);
    const educator = capabilities.find((entry) => entry.capability === 'educator');
    if (!educator || (educator.state !== 'verified' && educator.state !== 'provisional')) {
      throw new HttpException(error('educator_required', 'Классы доступны педагогам.'), 403);
    }
    return context;
  }

  private async creationContext(context: ActiveContext): Promise<ClassroomCreationContext> {
    if (context.workspaceKind === 'organization') {
      const teaching = await this.teachingContext.execute(context.tenantId, context.schoolId);
      if (!teaching.ok) {
        throw new HttpException(
          error(
            teaching.code,
            teaching.code === 'no_active_period'
              ? 'В школе нет активного учебного периода.'
              : 'В этом пространстве не выбрана школа.',
          ),
          409,
        );
      }
      if (!context.userId) {
        throw new HttpException(
          error('no_school_assigned', 'В этом пространстве не выбрана школа.'),
          409,
        );
      }
      return {
        tenantId: context.tenantId,
        schoolId: teaching.context.schoolId,
        academicPeriodId: teaching.context.academicPeriodId,
        userId: context.userId,
      };
    }
    const result = await this.requirePool().query(
      `SELECT tenant_id, school_id, academic_period_id, user_id
         FROM classroom_ensure_personal_teacher($1)`,
      [context.accountId],
    );
    const row = result.rows[0] as
      | { tenant_id: string; school_id: string; academic_period_id: string; user_id: string }
      | undefined;
    if (!row) {
      throw new HttpException(
        error('teaching_context_unavailable', 'Не удалось подготовить личные классы.'),
        409,
      );
    }
    return {
      tenantId: row.tenant_id,
      schoolId: row.school_id,
      academicPeriodId: row.academic_period_id,
      userId: row.user_id,
    };
  }

  private requireUuid(value: string, label: string): void {
    if (!UUID_PATTERN.test(value)) {
      throw new HttpException(error('validation_error', `${label} is invalid`), 400);
    }
  }

  private async summary(context: ActiveContext, classroomId: string) {
    this.requireUuid(classroomId, 'classroom');
    const result = await this.requirePool().query(
      `SELECT id, title, status, age_band, topic_keys, safe_mode_default,
              created_at, archived_at, join_code_version, join_code_status, student_count,
              teacher_role, workspace_kind, workspace_title
         FROM classroom_management_summary($1, $2)`,
      [context.accountId, classroomId],
    );
    const row = result.rows[0] as ClassroomSummaryRow | undefined;
    if (!row) throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    return summaryView(row);
  }

  @Get()
  async list(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    const items = await this.listUseCase.execute(context.accountId);
    return { items: items.map(classroomView), meta: { total: items.length } };
  }

  @Get(':classroomId')
  async get(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const actor = await this.requireEducator(request);
    const classroom = await this.summary(actor, classroomId);
    const result = await this.requirePool().query(
      'SELECT id,kind,school_id FROM classroom_learning_context($1,$2)',
      [actor.accountId, classroomId],
    );
    const context = result.rows[0];
    if (!context)
      throw new HttpException(
        error('learning_context_unavailable', 'Учебное пространство временно недоступно.'),
        503,
      );
    return {
      classroom: {
        ...classroom,
        learningContext: { id: context.id, kind: context.kind, schoolId: context.school_id },
      },
    };
  }

  @Get('teacher-home-attention')
  async homeAttention(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    if (!this.canonical().enabled()) {
      throw new HttpException(
        error('canonical_projection_unavailable', 'Список ожидающих действий временно недоступен.'),
        503,
      );
    }
    return teacherHomeAttention(
      this.requirePool(),
      context.accountId,
      await this.listUseCase.execute(context.accountId),
    );
  }

  @Post()
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') idempotencyHeader: string | undefined,
  ) {
    const context = await this.requireEducator(request);
    if (isPlainObject(rawBody) && ('tenant_id' in rawBody || 'tenantId' in rawBody)) {
      throw new HttpException(error('validation_error', 'tenant is derived from the session'), 400);
    }
    const shape = checkBodyShape(rawBody, ['title', 'ageBand', 'topicKeys', 'safeModeDefault']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const keyCheck = checkIdempotencyKey(idempotencyHeader);
    if (!keyCheck.ok) {
      throw new HttpException(error('invalid_idempotency_key', keyCheck.message), 400);
    }
    const teaching = await this.creationContext(context);
    const classroomId = randomUUID();
    const ageBand = shape.body['ageBand'] ?? 'mixed';
    const topicKeys = shape.body['topicKeys'] ?? [];
    const safeModeDefault = shape.body['safeModeDefault'] ?? true;
    const joinCode = classroomCodeFor(classroomId, 1, classroomCodeSecret());
    const result = await this.createUseCase.execute({
      accountId: context.accountId,
      tenantId: teaching.tenantId,
      classroomId,
      schoolId: teaching.schoolId,
      academicPeriodId: teaching.academicPeriodId,
      teacherId: teaching.userId,
      title: shape.body['title'],
      ageBand,
      topicKeys,
      safeModeDefault,
      joinCodeHash: classroomCodeHash(joinCode),
      idempotencyKey: keyCheck.key,
    });
    if (!result.ok) {
      throw new HttpException(
        error(result.code, result.message),
        result.code === 'idempotency_conflict' ? 409 : 400,
      );
    }
    reply.code(result.created ? 201 : 200);
    return { classroom: await this.summary(context, result.classroom.id), created: result.created };
  }

  /**
   * Сколько работ ждёт этого преподавателя во всех его классах.
   *
   * Ради этого числа продукт открывают утром; ради него же не должно
   * приходиться обходить классы по одному.
   */
  @Get('awaiting-review')
  async awaitingReview(@Req() request: FastifyRequest) {
    const context = await this.requireEducator(request);
    if (this.canonical().enabled()) {
      const projections = await this.canonical().forTeacherAccount(context.accountId);
      return {
        total: [...projections.values()].filter(
          (item) => item.surface.workflowState === 'waiting_review',
        ).length,
      };
    }
    const result = await this.requirePool().query(
      `SELECT classroom_awaiting_review_total($1) AS total`,
      [context.accountId],
    );
    return { total: Number((result.rows[0] as { total: number | string }).total ?? 0) };
  }

  /** Сводка по классу: выдано, сдано, ждут ответа, кто отстаёт. */
  @Get(':classroomId/progress')
  async progress(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const [result, projections] = await Promise.all([
      this.requirePool().query(
        `SELECT seat_count, assigned_count, submitted_count, awaiting_review, behind_count
         FROM classroom_progress_summary($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.canonical().forTeacher(context.accountId, classroomId),
    ]);
    const row = result.rows[0] as
      | {
          seat_count: number | string;
          assigned_count: number | string;
          submitted_count: number | string;
          awaiting_review: number | string;
          behind_count: number | string;
        }
      | undefined;
    if (!row) throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    return {
      seatCount: Number(row.seat_count),
      assignedCount: Number(row.assigned_count),
      submittedCount: projections.size
        ? [...projections.values()].filter((item) =>
            ['submitted', 'waiting_review', 'changes_requested', 'completed'].includes(
              item.surface.workflowState,
            ),
          ).length
        : Number(row.submitted_count),
      awaitingReview: projections.size
        ? [...projections.values()].filter(
            (item) => item.surface.workflowState === 'waiting_review',
          ).length
        : Number(row.awaiting_review),
      behindCount: Number(row.behind_count),
    };
  }

  @Get(':classroomId/roster')
  async roster(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const [result, projections] = await Promise.all([
      this.requirePool().query(
        `SELECT id, display_label, login_handle, safe_mode, status, avatar_key,
              last_active_at, created_at, assigned_count, submitted_count, awaiting_review
         FROM classroom_management_roster($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.canonical().forTeacher(context.accountId, classroomId),
    ]);
    const rosterRows = await this.protectedReadback(
      context.accountId,
      classroomId,
      result.rows as StudentSeatRow[],
    );
    return {
      items: rosterRows.map((row) => {
        const item = seatView(row);
        const states = [...projections.values()].filter(
          (projection) => projection.state.provenance.seatId === row.id,
        );
        return states.length === 0
          ? item
          : {
              ...item,
              submittedCount: states.filter((projection) =>
                ['submitted', 'waiting_review', 'changes_requested', 'completed'].includes(
                  projection.surface.workflowState,
                ),
              ).length,
              awaitingReview: states.filter(
                (projection) => projection.surface.workflowState === 'waiting_review',
              ).length,
            };
      }),
    };
  }

  /**
   * What happened in this class. The database applies the teacher check and the
   * seat filter, so a caller cannot ask about a learner in someone else's
   * class by editing the request.
   */
  @Get(':classroomId/activity')
  async activity(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Query('seatId') seatId: string | undefined,
    @Query('kind') kind: string | undefined,
  ) {
    const context = await this.requireEducator(request);
    const result = await this.requirePool().query(
      `SELECT id, action, seat_id, seat_label, actor_is_teacher, project_id,
              project_title, occurrence_count, first_occurred_at, occurred_at
         FROM classroom_activity_feed($1, $2, $3, 200)`,
      [context.principalId, classroomId, seatId ?? null],
    );
    const rows = result.rows as ClassroomActivityRow[];
    const projectsOnly = kind === 'projects';
    return {
      items: rows
        .filter((row) => (projectsOnly ? row.project_id !== null : true))
        .map((row) => ({
          id: row.id,
          action: row.action,
          seatId: row.seat_id,
          seatLabel: row.seat_label,
          byTeacher: row.actor_is_teacher === true,
          projectId: row.project_id,
          projectTitle: row.project_title,
          count: Number(row.occurrence_count),
          firstAt: String(row.first_occurred_at),
          at: String(row.occurred_at),
        })),
    };
  }

  /** One learner: who they are, what they made, and what they have been doing. */
  @Get(':classroomId/students/:seatId')
  async student(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
  ) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const [roster, projects, activity, counts, projections] = await Promise.all([
      this.requirePool().query(
        `SELECT id, display_label, login_handle, safe_mode, status, avatar_key,
                last_active_at, created_at, assigned_count, submitted_count, awaiting_review
           FROM classroom_management_roster($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.requirePool().query(
        `SELECT id, module_key, title, status, created_at, updated_at,
                snapshot_revision, preview_json, preview_digest, last_editor_was_teacher,
                submitted_at, awaiting_review,
                assignment_title, assignment_goal, assignment_brief, assignment_sample_image
           FROM classroom_seat_projects($1, $2)`,
        [context.principalId, seatId],
      ),
      this.requirePool().query(
        `SELECT id, action, seat_id, seat_label, actor_is_teacher, project_id,
                project_title, occurrence_count, first_occurred_at, occurred_at
           FROM classroom_activity_feed($1, $2, $3, 100)`,
        [context.principalId, classroomId, seatId],
      ),
      // Сколько сдал и сколько из этого ждёт ответа. Первый вопрос, с которым
      // преподаватель открывает страницу ученика.
      this.requirePool().query(
        `SELECT submitted, awaiting_review FROM classroom_seat_work_counts($1)`,
        [seatId],
      ),
      this.canonical().forTeacher(context.accountId, classroomId),
    ]);
    const protectedRoster = await this.protectedReadback(
      context.accountId,
      classroomId,
      roster.rows as StudentSeatRow[],
    );
    const seat = protectedRoster.find((row) => row.id === seatId);
    if (!seat) {
      throw new HttpException(error('not_found', 'Ученик не найден в этом классе.'), 404);
    }
    const workCounts = counts.rows[0] as
      { submitted: number | string; awaiting_review: number | string } | undefined;
    const learnerStates = [...projections.values()].filter(
      (projection) => projection.state.provenance.seatId === seatId,
    );
    return {
      student: seatView(seat),
      submittedCount: learnerStates.length
        ? learnerStates.filter((projection) =>
            ['submitted', 'waiting_review', 'changes_requested', 'completed'].includes(
              projection.surface.workflowState,
            ),
          ).length
        : Number(workCounts?.submitted ?? 0),
      awaitingReview: learnerStates.length
        ? learnerStates.filter(
            (projection) => projection.surface.workflowState === 'waiting_review',
          ).length
        : Number(workCounts?.awaiting_review ?? 0),
      projects: (projects.rows as SeatProjectRow[]).map((row) => ({
        id: row.id,
        moduleKey: row.module_key,
        title: row.title,
        status: row.status,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        snapshotRevision: row.snapshot_revision === null ? null : Number(row.snapshot_revision),
        preview:
          row.preview_json && row.preview_digest
            ? { digest: row.preview_digest, descriptor: row.preview_json }
            : null,
        lastEditedByTeacher: row.last_editor_was_teacher === true,
        // Сдано и ещё не отвечено — свойство самой работы: преподаватель
        // открывает страницу, чтобы найти именно ту, до которой не дошёл.
        submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
        awaitingReview: row.awaiting_review === true,
        canonicalState:
          learnerStates.find((projection) => projection.projectId === row.id)?.surface ?? null,
        // Что было задано. Проверять работу, не видя условия, преподаватель
        // может только по памяти — а через неделю после урока её уже нет.
        assignment: row.assignment_title
          ? {
              title: row.assignment_title,
              goal: row.assignment_goal,
              brief: row.assignment_brief,
              sampleImage: row.assignment_sample_image,
            }
          : null,
      })),
      activity: (activity.rows as ClassroomActivityRow[]).map((row) => ({
        id: row.id,
        action: row.action,
        seatId: row.seat_id,
        seatLabel: row.seat_label,
        byTeacher: row.actor_is_teacher === true,
        projectId: row.project_id,
        projectTitle: row.project_title,
        count: Number(row.occurrence_count),
        firstAt: String(row.first_occurred_at),
        at: String(row.occurred_at),
      })),
    };
  }

  @Post(':classroomId/seats')
  async addSeat(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['displayLabel', 'safeMode']);
    const displayLabel = shape.ok ? shape.body['displayLabel'] : null;
    const safeMode = shape.ok ? (shape.body['safeMode'] ?? true) : null;
    if (
      !shape.ok ||
      typeof displayLabel !== 'string' ||
      displayLabel.trim().length < 1 ||
      displayLabel.trim().length > 120 ||
      typeof safeMode !== 'boolean'
    ) {
      throw new HttpException(error('validation_error', 'Проверьте имя и настройки ученика.'), 400);
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const studentCode = generateStudentCode();
      const client = await this.requirePool().connect();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          `SELECT id, display_label, login_handle, safe_mode, status, avatar_key, last_active_at, created_at
             FROM classroom_management_add_seat($1, $2, $3, $4, $5)`,
          [context.accountId, classroomId, displayLabel.trim(), studentCode, safeMode],
        );
        const student = result.rows[0] as StudentSeatRow | undefined;
        if (!student) throw new Error('student seat was not created');
        const issued = await client.query(
          'SELECT result_code, credential_version FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)',
          [context.accountId, classroomId, student.id, hashSessionToken(studentCode), randomUUID()],
        );
        if (issued.rows[0]?.result_code !== 'issued') {
          throw new Error(`student code issue failed: ${String(issued.rows[0]?.result_code)}`);
        }
        await this.storeProtectedStudentCode(
          client,
          context.accountId,
          classroomId,
          student.id,
          studentCode,
          Number(issued.rows[0].credential_version),
        );
        await client.query('COMMIT');
        reply.code(201);
        return { student: seatView(student) };
      } catch (failure) {
        await client.query('ROLLBACK');
        if (failure instanceof HttpException) throw failure;
        const message = failure instanceof Error ? failure.message : '';
        if (message.includes('unique') || message.includes('duplicate')) {
          if (attempt < 11) continue;
          throw new HttpException(
            error('student_code_unavailable', 'Не удалось подобрать код ученика.'),
            503,
          );
        }
        if (message.includes('unavailable')) {
          throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
        }
        throw failure;
      } finally {
        client.release();
      }
    }
    throw new HttpException(
      error('student_code_unavailable', 'Не удалось подобрать код ученика.'),
      503,
    );
  }

  @Post(':classroomId/seats/batch/preview')
  async previewSeatsBatch(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['students', 'requestId']);
    const students = shape.ok ? shape.body['students'] : null;
    const requestId = shape.ok ? shape.body['requestId'] : null;
    if (
      !Array.isArray(students) ||
      students.length < 1 ||
      students.length > 100 ||
      batchStudentInputHasUnsupportedKeys(students) ||
      typeof requestId !== 'string' ||
      !UUID_PATTERN.test(requestId)
    ) {
      throw new HttpException(
        error('validation_error', 'Добавьте от 1 до 100 учеников и корректный requestId.'),
        400,
      );
    }
    try {
      const rows = (
        await this.requirePool().query(
          `SELECT result_code,reused,row_index,display_label,login_handle,safe_mode,row_status,reason_code
             FROM classroom_student_seat_batch_prepare_v2($1,$2,$3,$4::jsonb)`,
          [context.accountId, classroomId, requestId, JSON.stringify(students)],
        )
      ).rows;
      const code = rows[0]?.result_code as string | undefined;
      if (code === 'request_conflict') {
        throw new HttpException(
          error('idempotency_conflict', 'Этот requestId уже использован для другого списка.'),
          409,
        );
      }
      if (code !== 'ok') {
        throw new HttpException(error('validation_error', 'Не удалось подготовить список.'), 400);
      }
      return {
        results: rows.map((row) => ({
          index: Number(row.row_index),
          displayLabel: row.display_label as string | null,
          studentCode: typeof row.login_handle === 'string' ? String(row.login_handle) : null,
          loginHandle: row.login_handle as string | null,
          safeMode: row.safe_mode as boolean | null,
          status: row.row_status as 'valid' | 'duplicate' | 'conflict' | 'invalid',
          reasonCode: String(row.reason_code),
        })),
      };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('classroom unavailable')) {
        throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
      }
      throw failure;
    }
  }

  @Post(':classroomId/seats/batch')
  async addSeatsBatch(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['students', 'requestId']);
    const students = shape.ok ? shape.body['students'] : null;
    const requestId = shape.ok ? shape.body['requestId'] : null;
    if (
      !Array.isArray(students) ||
      students.length < 1 ||
      students.length > 100 ||
      batchStudentInputHasUnsupportedKeys(students) ||
      typeof requestId !== 'string' ||
      !UUID_PATTERN.test(requestId)
    ) {
      throw new HttpException(
        error('validation_error', 'Нужен список от 1 до 100 учеников и requestId.'),
        400,
      );
    }

    const protection = this.studentCodeProtection();
    const execute = async (client: pg.Pool | pg.PoolClient) =>
      (
        await client.query(
          `SELECT result_code,reused,row_index,row_status,reason_code,display_label,
                  login_handle,safe_mode,seat_id,credential_version
             FROM classroom_student_seat_batch_commit_v2($1,$2,$3,$4::jsonb)`,
          [context.accountId, classroomId, requestId, JSON.stringify(students)],
        )
      ).rows;
    const present = (rows: Record<string, unknown>[]) => {
      const code = rows[0]?.['result_code'] as string | undefined;
      if (code === 'request_conflict') {
        throw new HttpException(
          error('idempotency_conflict', 'Этот requestId уже использован для другого списка.'),
          409,
        );
      }
      if (code !== 'ok') {
        throw new HttpException(
          error('batch_failed', 'Не удалось обработать список учеников.'),
          409,
        );
      }
      const reused = rows[0]?.['reused'] === true;
      const results = rows.map((row) => ({
        index: Number(row['row_index']),
        status: row['row_status'] as 'created' | 'duplicate' | 'conflict' | 'invalid',
        reasonCode: String(row['reason_code']),
        displayLabel: row['display_label'] as string | null,
        studentCode: typeof row['login_handle'] === 'string' ? String(row['login_handle']) : null,
        loginHandle: row['login_handle'] as string | null,
        safeMode: row['safe_mode'] as boolean | null,
        seatId: (row['seat_id'] as string | null) ?? null,
        credentialVersion:
          row['credential_version'] === null || row['credential_version'] === undefined
            ? null
            : Number(row['credential_version']),
        credential: null,
      }));
      return {
        requestId,
        reused,
        created: results.filter((item) => item.status === 'created').length,
        credentialsAvailable: false,
        results,
      };
    };

    if (!protection) {
      try {
        return present(await execute(this.requirePool()));
      } catch (failure) {
        if (failure instanceof HttpException) throw failure;
        const message = failure instanceof Error ? failure.message : '';
        if (message.includes('classroom unavailable')) {
          throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
        }
        throw failure;
      }
    }

    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      const rows = await execute(client);
      const response = present(rows);
      const tenantId = await this.protectedTenantId(client, context.accountId, classroomId);
      for (const row of rows) {
        const shouldProtect = row['row_status'] === 'created' || response.reused;
        if (
          shouldProtect &&
          typeof row['seat_id'] === 'string' &&
          typeof row['login_handle'] === 'string' &&
          row['credential_version'] !== null &&
          row['credential_version'] !== undefined
        ) {
          await this.storeProtectedStudentCode(
            client,
            context.accountId,
            classroomId,
            row['seat_id'],
            row['login_handle'],
            Number(row['credential_version']),
            tenantId,
            response.reused,
          );
        }
      }
      await client.query('COMMIT');
      return response;
    } catch (failure) {
      await client.query('ROLLBACK');
      if (failure instanceof HttpException) throw failure;
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('classroom unavailable')) {
        throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
      }
      throw failure;
    } finally {
      client.release();
    }
  }

  @Post(':classroomId/seats/:seatId/code')
  async setStudentCode(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(seatId, 'student seat');
    const shape = checkBodyShape(rawBody, ['studentCode', 'requestId']);
    const requested = shape.ok ? shape.body['studentCode'] : undefined;
    const requestId = shape.ok ? shape.body['requestId'] : null;
    if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
      throw new HttpException(
        error('validation_error', 'Требуется requestId для изменения кода.'),
        400,
      );
    }
    const explicitCode =
      typeof requested === 'string' && requested.trim() ? requested.trim() : null;
    if (explicitCode !== null && !STUDENT_CODE_PATTERN.test(explicitCode)) {
      throw new HttpException(
        error('validation_error', 'Код ученика должен состоять из 4–10 латинских букв или цифр.'),
        400,
      );
    }

    const execute = (client: pg.Pool | pg.PoolClient) =>
      explicitCode === null
        ? client.query(
            'SELECT result_code,student_code,code_version,reused FROM classroom_student_code_generate($1,$2,$3,$4)',
            [context.accountId, classroomId, seatId, requestId],
          )
        : client.query(
            'SELECT result_code,code_version,reused FROM classroom_student_code_set($1,$2,$3,$4,$5)',
            [context.accountId, classroomId, seatId, explicitCode, requestId],
          );
    const present = (row: Record<string, unknown> | undefined) => {
      if (row?.['result_code'] === 'ok') {
        return {
          studentCode: explicitCode ?? String(row['student_code']),
          version: Number(row['code_version']),
          reused: row['reused'] === true,
        };
      }
      if (row?.['result_code'] === 'code_in_use') {
        throw new HttpException(
          error('student_code_taken', 'Этот код уже используется в классе.'),
          409,
        );
      }
      if (row?.['result_code'] === 'request_conflict') {
        throw new HttpException(
          error('idempotency_conflict', 'Этот requestId уже использован для другой операции.'),
          409,
        );
      }
      if (row?.['result_code'] === 'not_found') {
        throw new HttpException(error('seat_not_found', 'Ученик не найден.'), 404);
      }
      throw new HttpException(
        error('student_code_failed', 'Не удалось изменить код ученика.'),
        409,
      );
    };
    const mapFailure = (failure: unknown): never => {
      if (failure instanceof HttpException) throw failure;
      if (failure instanceof Error && failure.message.includes('generation exhausted')) {
        throw new HttpException(
          error('student_code_unavailable', 'Не удалось подобрать новый код.'),
          503,
        );
      }
      throw failure;
    };

    const protection = this.studentCodeProtection();
    if (!protection) {
      try {
        return present((await execute(this.requirePool())).rows[0]);
      } catch (failure) {
        return mapFailure(failure);
      }
    }

    const client = await this.requirePool().connect();
    try {
      await client.query('BEGIN');
      await this.protectLegacyCurrentStudentCode(
        client,
        context.accountId,
        classroomId,
        seatId,
      );
      const result = present((await execute(client)).rows[0]);
      await this.storeProtectedStudentCode(
        client,
        context.accountId,
        classroomId,
        seatId,
        result.studentCode,
        result.version,
        undefined,
        result.reused,
      );
      await client.query('COMMIT');
      return result;
    } catch (failure) {
      await client.query('ROLLBACK');
      return mapFailure(failure);
    } finally {
      client.release();
    }
  }

  /** Legacy long-key endpoint. Kept temporarily for old clients during migration. */
  @Post(':classroomId/seats/:seatId/credential')
  async issueCredential(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(seatId, 'seat');
    const shape = checkBodyShape(rawBody, ['requestId']);
    if (
      !shape.ok ||
      typeof shape.body['requestId'] !== 'string' ||
      !UUID_PATTERN.test(shape.body['requestId'])
    ) {
      throw new HttpException(error('validation_error', 'Требуется идентификатор выдачи.'), 400);
    }
    const credential = randomBytes(18).toString('base64url');
    const result = await this.requirePool().query(
      'SELECT result_code, credential_version FROM classroom_seat_credential_issue($1,$2,$3,$4,$5)',
      [
        context.accountId,
        classroomId,
        seatId,
        hashSessionToken(credential),
        shape.body['requestId'],
      ],
    );
    const row = result.rows[0];
    if (row?.result_code === 'already_issued')
      throw new HttpException(
        error(
          'credential_already_issued',
          'Этот ключ уже выдан. Старый ключ нельзя прочитать повторно. Для замены начните новую выдачу.',
        ),
        409,
      );
    if (row?.result_code !== 'issued')
      throw new HttpException(error('seat_not_found', 'Место ученика недоступно.'), 404);
    return { credential, version: Number(row.credential_version) };
  }

  @Patch(':classroomId/seats/:seatId')
  async updateSeat(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(seatId, 'student seat');
    const shape = checkBodyShape(rawBody, [
      'displayLabel',
      'loginHandle',
      'safeMode',
      'status',
      'avatarKey',
    ]);
    const displayLabel = shape.ok ? shape.body['displayLabel'] : null;
    const loginHandle = shape.ok ? shape.body['loginHandle'] : null;
    const safeMode = shape.ok ? shape.body['safeMode'] : null;
    const status = shape.ok ? shape.body['status'] : null;
    const avatarKey = shape.ok ? (shape.body['avatarKey'] ?? null) : null;
    if (
      !shape.ok ||
      typeof displayLabel !== 'string' ||
      displayLabel.trim().length < 1 ||
      displayLabel.trim().length > 120 ||
      typeof loginHandle !== 'string' ||
      !STUDENT_CODE_PATTERN.test(loginHandle.trim()) ||
      typeof safeMode !== 'boolean' ||
      typeof status !== 'string' ||
      !SEAT_STATUSES.includes(status as (typeof SEAT_STATUSES)[number]) ||
      !isSeatAvatarKey(avatarKey)
    ) {
      throw new HttpException(error('validation_error', 'Проверьте настройки ученика.'), 400);
    }
    const current = await this.requirePool().query(
      `SELECT login_handle FROM classroom_management_roster($1,$2) WHERE id=$3`,
      [context.accountId, classroomId, seatId],
    );
    if (!current.rows[0]) {
      throw new HttpException(error('student_not_found', 'Ученик не найден.'), 404);
    }
    if (String(current.rows[0].login_handle) !== loginHandle.trim()) {
      throw new HttpException(
        error('student_code_endpoint_required', 'Код ученика изменяется отдельным действием.'),
        409,
      );
    }
    try {
      const result = await this.requirePool().query(
        `SELECT id, display_label, login_handle, safe_mode, status, avatar_key, last_active_at, created_at
           FROM classroom_management_update_seat($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          context.accountId,
          classroomId,
          seatId,
          displayLabel.trim(),
          loginHandle.trim(),
          safeMode,
          status,
          avatarKey,
        ],
      );
      return { student: seatView(result.rows[0] as StudentSeatRow) };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      if (message.includes('unique') || message.includes('duplicate')) {
        throw new HttpException(error('handle_taken', 'Это имя для входа уже занято.'), 409);
      }
      throw failure;
    }
  }

  @Delete(':classroomId/seats/:seatId')
  async removeSeat(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('seatId') seatId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    this.requireUuid(seatId, 'student seat');
    const result = await this.requirePool().query(
      `SELECT classroom_management_remove_seat($1, $2, $3) AS removed`,
      [context.accountId, classroomId, seatId],
    );
    if (result.rows[0]?.removed !== true) {
      throw new HttpException(error('student_not_found', 'Ученик не найден.'), 404);
    }
    return { removed: true as const };
  }

  /**
   * Everything about a class that a teacher can correct without entering it:
   * the name they typed in a hurry, the age band they picked by accident, the
   * subjects, and whether safe mode is on. One request, because to the teacher
   * it is one act — fixing the class.
   */
  @Patch(':classroomId')
  async updateDetails(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    const current = await this.summary(context, classroomId);
    const shape = checkBodyShape(rawBody, ['title', 'ageBand', 'topicKeys', 'safeModeDefault']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'] ?? current.title;
    const ageBand = shape.body['ageBand'] ?? current.ageBand;
    const topicKeys = shape.body['topicKeys'] ?? current.topicKeys;
    const safeModeDefault = shape.body['safeModeDefault'] ?? current.safeModeDefault;
    if (!isValidClassroomTitle(title)) {
      throw new HttpException(error('validation_error', 'Название класса обязательно.'), 400);
    }
    if (!isClassroomAgeBand(ageBand)) {
      throw new HttpException(error('validation_error', 'Неизвестный возраст учеников.'), 400);
    }
    if (!areValidTopicKeys(topicKeys)) {
      throw new HttpException(error('validation_error', 'Неизвестные направления.'), 400);
    }
    if (typeof safeModeDefault !== 'boolean') {
      throw new HttpException(error('validation_error', 'Safe Mode must be boolean.'), 400);
    }
    await this.requirePool().query(
      `SELECT classroom_management_update_details($1, $2, $3, $4, $5, $6)`,
      [
        context.accountId,
        classroomId,
        title.trim(),
        ageBand,
        [...topicKeys].sort(),
        safeModeDefault,
      ],
    );
    return { classroom: await this.summary(context, classroomId) };
  }

  /**
   * Put a class away, bring it back, or remove it.
   *
   * Removal keeps the rows: a class holds children's work and a record of who
   * did what. What the teacher asked for — it is gone from my lists, nobody can
   * get in — is exactly what the state delivers, and a mistake stays undoable
   * by someone who can read the audit trail.
   */
  @Post(':classroomId/status')
  async setStatus(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['status']);
    const status = shape.ok ? shape.body['status'] : null;
    if (!isClassroomStatus(status)) {
      throw new HttpException(error('validation_error', 'Неизвестное состояние класса.'), 400);
    }
    try {
      await this.requirePool().query(`SELECT classroom_management_set_status($1, $2, $3)`, [
        context.accountId,
        classroomId,
        status,
      ]);
    } catch (cause) {
      // The database is the authority on who may do this; it answers with one
      // of two refusals and neither should read as a server fault.
      const message = cause instanceof Error ? cause.message : '';
      if (message.includes('owner required')) {
        throw new HttpException(
          error('owner_required', 'Удалить класс может только основной преподаватель.'),
          403,
        );
      }
      if (message.includes('classroom unavailable')) {
        throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
      }
      throw cause;
    }
    if (status === 'deleted') return { removed: true as const };
    return { classroom: await this.summary(context, classroomId) };
  }

  /**
   * Work a teacher sets for the class.
   *
   * The module is named here rather than left to the learner: a child opening
   * "make a keyring" should land in the editor it is made in, not in a menu of
   * environments they have no way to choose between.
   */
  @Post(':classroomId/assignments')
  async createAssignment(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const shape = checkBodyShape(rawBody, ['title', 'brief', 'moduleKey', 'dueAt']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const title = shape.body['title'];
    const brief = shape.body['brief'] ?? null;
    const moduleKey = shape.body['moduleKey'];
    const dueAt = shape.body['dueAt'] ?? null;
    if (!isValidClassroomTitle(title)) {
      throw new HttpException(error('validation_error', 'Введите название задания.'), 400);
    }
    if (typeof moduleKey !== 'string' || !/^[a-z0-9-]{1,64}$/.test(moduleKey)) {
      throw new HttpException(error('validation_error', 'Выберите среду для задания.'), 400);
    }
    if (brief !== null && (typeof brief !== 'string' || brief.length > 4000)) {
      throw new HttpException(error('validation_error', 'Описание слишком длинное.'), 400);
    }
    if (dueAt !== null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt)))) {
      throw new HttpException(error('validation_error', 'Неверный срок сдачи.'), 400);
    }
    const created = await this.requirePool().query(
      `SELECT classroom_assignment_create($1, $2, $3, $4, $5, $6) AS id`,
      [context.principalId, classroomId, title.trim(), brief, moduleKey, dueAt],
    );
    if (!(created.rows[0] as { id: string | null } | undefined)?.id) {
      throw new HttpException(error('classroom_not_found', 'Класс не найден.'), 404);
    }
    return { created: true as const };
  }

  @Get(':classroomId/assignments')
  async listAssignments(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const [result, canonical] = await Promise.all([
      this.requirePool().query(
        `SELECT id, assignment_id, title, brief, goal, module_key, due_at, status, created_at,
                demo_key, sample_image, seat_count, started_count, submitted_count
           FROM classroom_assignment_list($1, $2)`,
        [context.accountId, classroomId],
      ),
      this.requirePool().query(
        `SELECT classroom_assignment_id,audience_type,assigned_count
           FROM learning_direct_assignment_summary($1,$2,$3)`,
        [context.principalId, context.tenantId, classroomId],
      ),
    ]);
    const summaries = new Map(
      canonical.rows.map((row) => [String(row['classroom_assignment_id']), row]),
    );
    return {
      items: (result.rows as AssignmentRow[]).map((row) => {
        const summary = summaries.get(row.id);
        return assignmentView(
          summary
            ? {
                ...row,
                audience_type:
                  summary['audience_type'] === 'whole_class' ||
                  summary['audience_type'] === 'named_learners'
                    ? summary['audience_type']
                    : null,
                canonical_assigned_count: summary['assigned_count'] as number | string,
              }
            : row,
        );
      }),
    };
  }

  @Post(':classroomId/assignments/:assignmentId/status')
  async setAssignmentStatus(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const shape = checkBodyShape(rawBody, ['status']);
    const status = shape.ok ? shape.body['status'] : null;
    if (status !== 'open' && status !== 'closed') {
      throw new HttpException(error('validation_error', 'Неизвестное состояние задания.'), 400);
    }
    await this.requirePool().query(`SELECT classroom_assignment_set_status($1, $2, $3, $4)`, [
      context.accountId,
      classroomId,
      assignmentId,
      status,
    ]);
    return { ok: true as const };
  }

  /**
   * Removing an assignment — including a demo a teacher did not want.
   *
   * Work a learner already started is not deleted with it: the link goes, the
   * project stays theirs. A child's model is not a teacher's to throw away by
   * tidying a list.
   */
  @Delete(':classroomId/assignments/:assignmentId')
  async deleteAssignment(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    const result = await this.requirePool().query(
      `SELECT classroom_assignment_delete($1, $2, $3) AS removed`,
      [context.accountId, classroomId, assignmentId],
    );
    if ((result.rows[0] as { removed: boolean } | undefined)?.removed !== true) {
      throw new HttpException(error('assignment_not_found', 'Задание не найдено.'), 404);
    }
    return { removed: true as const };
  }

  /** Every learner against one assignment — including those who never opened it. */
  @Get(':classroomId/assignments/:assignmentId/progress')
  async assignmentProgress(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(assignmentId, 'assignment');
    await this.summary(context, classroomId);
    const [result, projections] = await Promise.all([
      this.requirePool().query(
        `SELECT seat_id, display_label, avatar_key, project_id, snapshot_revision,
              started_at, submitted_at, badge
         FROM classroom_assignment_progress($1, $2, $3)`,
        [context.accountId, classroomId, assignmentId],
      ),
      this.canonical().forTeacher(context.accountId, classroomId),
    ]);
    return {
      items: (result.rows as AssignmentProgressRow[]).map((row) => ({
        seatId: row.seat_id,
        displayLabel: row.display_label,
        avatarKey: row.avatar_key,
        projectId: row.project_id,
        snapshotRevision: row.snapshot_revision === null ? null : Number(row.snapshot_revision),
        startedAt: row.started_at ? iso(row.started_at) : null,
        submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
        badge: row.badge,
        canonicalState:
          projections.get(canonicalProjectionKey(row.seat_id, assignmentId))?.surface ?? null,
      })),
    };
  }

  /**
   * A badge for a learner, and the reason behind it.
   *
   * The database decides who may give one — a teacher of that learner's class,
   * nobody else — so the route carries no authority of its own beyond being
   * signed in as an educator.
   */
  @Put(':classroomId/students/:seatId/awards/:awardKey')
  async setAward(
    @Req() request: FastifyRequest,
    @Param('seatId') seatId: string,
    @Param('awardKey') awardKey: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(seatId, 'seat');
    if (!SEAT_AWARDS.includes(awardKey)) {
      throw new HttpException(error('validation_error', 'Неизвестный значок.'), 400);
    }
    const shape = checkBodyShape(rawBody, ['granted', 'note']);
    const granted = shape.ok ? shape.body['granted'] : null;
    const note = shape.ok ? (shape.body['note'] ?? null) : null;
    if (typeof granted !== 'boolean' || (note !== null && typeof note !== 'string')) {
      throw new HttpException(error('validation_error', 'granted must be boolean'), 400);
    }
    const result = await this.requirePool().query(
      `SELECT classroom_seat_award_set($1, $2, $3, $4, $5) AS ok`,
      [context.principalId, seatId, awardKey, note, granted],
    );
    if ((result.rows[0] as { ok: boolean } | undefined)?.ok !== true) {
      throw new HttpException(error('seat_not_found', 'Ученик не найден.'), 404);
    }
    return { items: await this.awardsOf(seatId) };
  }

  @Get(':classroomId/students/:seatId/awards')
  async listAwards(@Req() request: FastifyRequest, @Param('seatId') seatId: string) {
    await this.requireEducator(request);
    this.requireUuid(seatId, 'seat');
    return { items: await this.awardsOf(seatId) };
  }

  /** Which badges each learner in the class holds, for the register. */
  @Get(':classroomId/awards')
  async classAwards(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    await this.summary(context, classroomId);
    const result = await this.requirePool().query(
      `SELECT seat_id, award_key FROM classroom_seat_award_keys($1, $2)`,
      [context.accountId, classroomId],
    );
    const bySeat: Record<string, string[]> = {};
    for (const row of result.rows as Array<{ seat_id: string; award_key: string }>) {
      (bySeat[row.seat_id] ??= []).push(row.award_key);
    }
    return { items: bySeat };
  }

  private async awardsOf(seatId: string) {
    const result = await this.requirePool().query(
      `SELECT award_key, note, created_at, awarded_by_display_name
         FROM classroom_seat_awards_list($1)`,
      [seatId],
    );
    return (
      result.rows as Array<{
        award_key: string;
        note: string | null;
        created_at: Date | string;
        awarded_by_display_name: string;
      }>
    ).map((row) => ({
      awardKey: row.award_key,
      note: row.note,
      createdAt: iso(row.created_at),
      awardedBy: row.awarded_by_display_name,
    }));
  }

  @Patch(':classroomId/policies')
  async updatePolicy(
    @Req() request: FastifyRequest,
    @Param('classroomId') classroomId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    const shape = checkBodyShape(rawBody, ['safeModeDefault']);
    const safeModeDefault = shape.ok ? shape.body['safeModeDefault'] : null;
    if (!shape.ok || typeof safeModeDefault !== 'boolean') {
      throw new HttpException(error('validation_error', 'Safe Mode must be boolean.'), 400);
    }
    await this.requirePool().query(`SELECT classroom_management_update_policy($1, $2, $3)`, [
      context.accountId,
      classroomId,
      safeModeDefault,
    ]);
    return { classroom: await this.summary(context, classroomId) };
  }

  @Post(':classroomId/join-code/rotate')
  async rotateJoinCode(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    const current = await this.summary(context, classroomId);
    const version = (current.joinCodeVersion ?? 0) + 1;
    const joinCode = classroomCodeFor(classroomId, version, classroomCodeSecret());
    await this.requirePool().query(`SELECT classroom_management_rotate_join_code($1, $2, $3, $4)`, [
      context.accountId,
      classroomId,
      classroomCodeHash(joinCode),
      version,
    ]);
    return { classroom: await this.summary(context, classroomId) };
  }

  @Delete(':classroomId/join-code')
  async revokeJoinCode(@Req() request: FastifyRequest, @Param('classroomId') classroomId: string) {
    const context = await this.requireEducator(request);
    this.requireUuid(classroomId, 'classroom');
    await this.requirePool().query(`SELECT classroom_management_revoke_join_code($1, $2)`, [
      context.accountId,
      classroomId,
    ]);
    return { classroom: await this.summary(context, classroomId) };
  }
}
