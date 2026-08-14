import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  CHECKERS_REACTION_IDS,
  applyCheckersGameMove,
  createCheckersReactionEvent,
  createInitialCheckersProjectDocument,
  isCheckersSquare,
  validateCheckersProjectDocument,
  type CheckersAssignment,
  type CheckersDocument,
  type CheckersProjectDocument,
  type CheckersReactionEvent,
  type CheckersReactionId,
} from '@asa-lab/checkers';
import { randomUUID } from 'node:crypto';
import { withTenantContext } from '@asa-lab/database';
import type { ActiveContext, ActiveContextUseCase } from '@asa-lab/identity';
import { SESSION_COOKIE, TOKENS } from './tokens.js';
import { checkBodyShape } from './validation.js';

function error(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

interface ProjectMembership {
  readonly classroomId: string;
  readonly role: 'owner' | 'student';
  readonly teacherDocument: CheckersProjectDocument;
}

interface RosterRow {
  readonly student_user_id: string;
  readonly student_account_id: string;
  readonly display_name: string;
  readonly email: string;
}

interface StateRow {
  readonly student_user_id: string;
  readonly document_json: unknown;
  readonly revision: number;
  readonly updated_at: string;
}

interface ClassMemberRow {
  readonly member_user_id: string;
  readonly member_account_id: string;
  readonly display_name: string;
}

interface ClassGameRow {
  readonly id: string;
  readonly classroom_id: string;
  readonly light_user_id: string;
  readonly dark_user_id: string;
  readonly mode: 'friendly' | 'team' | 'teacher-event';
  readonly status: 'pending' | 'active' | 'declined' | 'finished';
  readonly document_json: unknown;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface ReactionRow {
  readonly id: string;
  readonly game_id: string;
  readonly classroom_id: string;
  readonly sender_user_id: string;
  readonly reaction_id: CheckersReactionId;
  readonly game_state: 'active' | 'finished';
  readonly created_at: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TEACHER_FEEDBACK_IDS = [
  'great-progress',
  'retry-capture',
  'review-turning-point',
  'ready-next',
] as const;
type TeacherFeedbackId = (typeof TEACHER_FEEDBACK_IDS)[number];

function mergeAssignments(
  document: CheckersProjectDocument,
  assignments: readonly CheckersAssignment[],
  studentAccountId: string,
): CheckersProjectDocument {
  const visibleAssignments = assignments.filter(
    (assignment) =>
      assignment.status === 'assigned' &&
      (assignment.assigneeKind === 'class' || assignment.assigneeIds.includes(studentAccountId)),
  );
  return {
    ...document,
    education: { ...document.education, assignments: visibleAssignments },
  };
}

@Controller('api/checkers/projects')
export class CheckersClassroomController {
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

  private async requireContext(
    request: FastifyRequest,
  ): Promise<ActiveContext & { userId: string }> {
    const context = await this.activeContext.resolve(request.cookies[SESSION_COOKIE]);
    if (!context) throw new HttpException(error('unauthorized', 'no active session'), 401);
    if (context.userId === null || context.workspaceKind !== 'organization') {
      throw new HttpException(
        error('organization_required', 'classroom Checkers requires an organization workspace'),
        403,
      );
    }
    return { ...context, userId: context.userId };
  }

  private async membership(
    context: ActiveContext & { userId: string },
    projectId: string,
  ): Promise<ProjectMembership> {
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const result = await client.query(
        `SELECT p.classroom_id, m.member_role, d.document_json
           FROM projects p
           JOIN project_drafts d
             ON d.tenant_id = p.tenant_id AND d.project_id = p.id
           JOIN classroom_memberships m
             ON m.tenant_id = p.tenant_id AND m.classroom_id = p.classroom_id
          WHERE p.tenant_id = $1 AND p.id = $2
            AND p.project_scope = 'classroom' AND p.module_key = 'checkers'
            AND p.status = 'active' AND m.user_id = $3`,
        [context.tenantId, projectId, context.userId],
      );
      const row = result.rows[0];
      if (!row || (row.member_role !== 'owner' && row.member_role !== 'student')) {
        throw new HttpException(
          error('project_not_found', 'Checkers classroom was not found'),
          404,
        );
      }
      const validated = validateCheckersProjectDocument(row.document_json);
      if (!validated.ok) {
        throw new HttpException(error('invalid_project', validated.message), 500);
      }
      return {
        classroomId: row.classroom_id as string,
        role: row.member_role as 'owner' | 'student',
        teacherDocument: validated.value,
      };
    });
  }

  private async classroomMembers(
    context: ActiveContext & { userId: string },
    projectId: string,
  ): Promise<readonly ClassMemberRow[]> {
    const result = await this.requirePool().query(
      `SELECT member_user_id, member_account_id, display_name
         FROM checkers_classroom_members($1, $2, $3)`,
      [context.tenantId, context.userId, projectId],
    );
    return result.rows as ClassMemberRow[];
  }

  @Get(':projectId/state')
  async state(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    if (membership.role !== 'student') {
      throw new HttpException(
        error('student_required', 'student Checkers state is unavailable'),
        403,
      );
    }
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const result = await client.query(
        `SELECT document_json, revision, updated_at
           FROM checkers_student_states
          WHERE tenant_id = $1 AND project_id = $2 AND student_user_id = $3`,
        [context.tenantId, projectId, context.userId],
      );
      const feedback = await client.query(
        `SELECT id, feedback_id, created_at
           FROM checkers_teacher_feedback
          WHERE tenant_id = $1 AND project_id = $2 AND student_user_id = $3
          ORDER BY created_at DESC
          LIMIT 20`,
        [context.tenantId, projectId, context.userId],
      );
      const row = result.rows[0];
      const stored = row
        ? validateCheckersProjectDocument(row.document_json)
        : { ok: true as const, value: createInitialCheckersProjectDocument(context.accountId) };
      if (!stored.ok) throw new HttpException(error('invalid_student_state', stored.message), 500);
      return {
        role: 'student' as const,
        document: mergeAssignments(
          stored.value,
          membership.teacherDocument.education.assignments,
          context.accountId,
        ),
        revision: row ? Number(row.revision) : 0,
        updatedAt: row ? String(row.updated_at) : null,
        teacherFeedback: feedback.rows.map((item) => ({
          id: String(item.id),
          feedbackId: String(item.feedback_id),
          createdAt: String(item.created_at),
        })),
      };
    });
  }

  @Put(':projectId/state')
  async saveState(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    if (membership.role !== 'student') {
      throw new HttpException(
        error('student_required', 'student Checkers state is unavailable'),
        403,
      );
    }
    const shape = checkBodyShape(rawBody, ['document']);
    if (!shape.ok) throw new HttpException(error('validation_error', shape.message), 400);
    const validated = validateCheckersProjectDocument(shape.body['document']);
    if (!validated.ok) throw new HttpException(error('validation_error', validated.message), 400);
    const document = mergeAssignments(
      validated.value,
      membership.teacherDocument.education.assignments,
      context.accountId,
    );
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO checkers_student_states
           (tenant_id, project_id, classroom_id, student_user_id, student_account_id, document_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, project_id, student_user_id) DO UPDATE
           SET document_json = EXCLUDED.document_json,
               revision = checkers_student_states.revision + 1,
               updated_at = now()
         RETURNING document_json, revision, updated_at`,
        [
          context.tenantId,
          projectId,
          membership.classroomId,
          context.userId,
          context.accountId,
          JSON.stringify(document),
        ],
      );
      const row = result.rows[0];
      return {
        document: row.document_json as CheckersProjectDocument,
        revision: Number(row.revision),
        updatedAt: String(row.updated_at),
      };
    });
  }

  @Post(':projectId/students')
  async enrolStudent(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    if (membership.role !== 'owner') {
      throw new HttpException(
        error('educator_required', 'only the class owner can add students'),
        403,
      );
    }
    const shape = checkBodyShape(rawBody, ['email']);
    const emailValue = shape.ok ? shape.body['email'] : null;
    if (
      !shape.ok ||
      typeof emailValue !== 'string' ||
      emailValue.length > 255 ||
      !emailValue.includes('@')
    ) {
      throw new HttpException(error('validation_error', 'enter a valid student email'), 400);
    }
    try {
      const result = await this.requirePool().query(
        `SELECT student_user_id, student_account_id, display_name, email
           FROM checkers_enrol_student_by_email($1, $2, $3, $4)`,
        [context.tenantId, context.userId, projectId, emailValue.trim().toLowerCase()],
      );
      reply.code(201);
      return { student: result.rows[0] };
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'student could not be added';
      if (message.includes('account was not found')) {
        throw new HttpException(
          error('student_not_found', 'Аккаунт ученика с таким email не найден.'),
          404,
        );
      }
      if (message.includes('staff')) {
        throw new HttpException(
          error('staff_account', 'Аккаунт сотрудника нельзя добавить как ученика.'),
          409,
        );
      }
      throw new HttpException(
        error('student_enrolment_failed', 'Не удалось добавить ученика в этот класс.'),
        409,
      );
    }
  }

  @Get(':projectId/classroom')
  async classroom(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    if (membership.role !== 'owner') {
      throw new HttpException(error('educator_required', 'teacher dashboard is unavailable'), 403);
    }
    const roster = await this.requirePool().query(
      `SELECT student_user_id, student_account_id, display_name, email
         FROM checkers_classroom_roster($1, $2, $3)`,
      [context.tenantId, context.userId, projectId],
    );
    const states = await withTenantContext(this.requirePool(), context.tenantId, (client) =>
      client.query(
        `SELECT student_user_id, document_json, revision, updated_at
           FROM checkers_student_states
          WHERE tenant_id = $1 AND project_id = $2`,
        [context.tenantId, projectId],
      ),
    );
    const safety = await withTenantContext(this.requirePool(), context.tenantId, (client) =>
      client.query(
        `SELECT s.id, s.game_id, s.reaction_event_id, s.status, s.created_at,
                s.reporter_user_id, r.reaction_id, r.sender_user_id
           FROM checkers_safety_signals s
           JOIN checkers_reaction_events r
             ON r.tenant_id = s.tenant_id AND r.id = s.reaction_event_id
          WHERE s.tenant_id = $1 AND s.project_id = $2
          ORDER BY s.created_at DESC
          LIMIT 50`,
        [context.tenantId, projectId],
      ),
    );
    const stateByUser = new Map(
      (states.rows as StateRow[]).map((row) => [row.student_user_id, row] as const),
    );
    const nameByUser = new Map(
      (roster.rows as RosterRow[]).map((student) => [
        student.student_user_id,
        student.display_name,
      ]),
    );
    return {
      assignments: membership.teacherDocument.education.assignments,
      safetySignals: safety.rows.map((row) => ({
        id: String(row.id),
        gameId: String(row.game_id),
        reactionEventId: String(row.reaction_event_id),
        reactionId: String(row.reaction_id),
        reporterName: nameByUser.get(String(row.reporter_user_id)) ?? 'Ученик',
        senderName: nameByUser.get(String(row.sender_user_id)) ?? 'Ученик',
        status: String(row.status),
        createdAt: String(row.created_at),
      })),
      students: (roster.rows as RosterRow[]).map((student) => {
        const row = stateByUser.get(student.student_user_id);
        const validated = row ? validateCheckersProjectDocument(row.document_json) : null;
        const document = validated?.ok
          ? validated.value
          : createInitialCheckersProjectDocument(student.student_account_id);
        return {
          id: student.student_account_id,
          displayName: student.display_name,
          email: student.email,
          lastActivityAt: document.education.lastActivityAt,
          progress: document.education.progress,
          evidence: document.education.evidence,
          completedPuzzleIds: document.education.completedPuzzleIds,
          lastMove: document.game.moveHistory.at(-1) ?? null,
          revision: row?.revision ?? 0,
          updatedAt: row ? String(row.updated_at) : null,
        };
      }),
    };
  }

  @Post(':projectId/feedback')
  async sendTeacherFeedback(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    if (membership.role !== 'owner') {
      throw new HttpException(
        error('educator_required', 'Только педагог может оставить учебную рекомендацию.'),
        403,
      );
    }
    const shape = checkBodyShape(rawBody, ['studentId', 'feedbackId']);
    const studentId = shape.ok ? shape.body['studentId'] : null;
    const feedbackId = shape.ok ? shape.body['feedbackId'] : null;
    if (
      !shape.ok ||
      typeof studentId !== 'string' ||
      !UUID_PATTERN.test(studentId) ||
      typeof feedbackId !== 'string' ||
      !TEACHER_FEEDBACK_IDS.includes(feedbackId as TeacherFeedbackId)
    ) {
      throw new HttpException(error('validation_error', 'Выберите ученика и рекомендацию.'), 400);
    }
    const members = await this.classroomMembers(context, projectId);
    const student = members.find((member) => member.member_account_id === studentId);
    if (!student) {
      throw new HttpException(error('student_not_found', 'Ученик не состоит в этом классе.'), 404);
    }
    const inserted = await withTenantContext(
      this.requirePool(),
      context.tenantId,
      async (client) => {
        const feedback = await client.query(
          `INSERT INTO checkers_teacher_feedback
             (tenant_id, project_id, classroom_id, student_user_id, teacher_user_id, feedback_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, feedback_id, created_at`,
          [
            context.tenantId,
            projectId,
            membership.classroomId,
            student.member_user_id,
            context.userId,
            feedbackId,
          ],
        );
        await client.query(
          `INSERT INTO audit_events
             (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
           VALUES ($1, $2, 'checkers_classroom', $3, 'checkers.teacher_feedback_sent',
                   jsonb_build_object('projectId', $4::uuid, 'studentUserId', $5::uuid,
                                      'feedbackId', $6::text))`,
          [
            context.tenantId,
            context.userId,
            membership.classroomId,
            projectId,
            student.member_user_id,
            feedbackId,
          ],
        );
        return feedback.rows[0];
      },
    );
    reply.code(201);
    return {
      feedback: {
        id: String(inserted.id),
        feedbackId: String(inserted.feedback_id),
        createdAt: String(inserted.created_at),
      },
    };
  }

  @Get(':projectId/play')
  async classPlay(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    const members = await this.classroomMembers(context, projectId);
    const memberByUser = new Map(members.map((member) => [member.member_user_id, member] as const));
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const games = await client.query(
        `SELECT id, classroom_id, light_user_id, dark_user_id, mode, status,
                document_json, version, created_at, updated_at
           FROM checkers_class_games
          WHERE tenant_id = $1 AND project_id = $2
            AND ($3 = 'owner' OR light_user_id = $4 OR dark_user_id = $4)
          ORDER BY updated_at DESC
          LIMIT 50`,
        [context.tenantId, projectId, membership.role, context.userId],
      );
      const reactions = await client.query(
        `SELECT id, game_id, classroom_id, sender_user_id, reaction_id, game_state, created_at
           FROM checkers_reaction_events
          WHERE tenant_id = $1 AND project_id = $2
          ORDER BY created_at DESC
          LIMIT 100`,
        [context.tenantId, projectId],
      );
      const mute = await client.query(
        `SELECT muted FROM checkers_reaction_mutes
          WHERE tenant_id = $1 AND project_id = $2 AND user_id = $3`,
        [context.tenantId, projectId, context.userId],
      );
      const muted = Boolean(mute.rows[0]?.muted);
      return {
        role: membership.role,
        muted,
        classmates: members
          .filter((member) => member.member_user_id !== context.userId)
          .map((member) => ({
            id: member.member_account_id,
            displayName: member.display_name,
          })),
        games: (games.rows as ClassGameRow[]).map((game) => {
          const validated = validateCheckersProjectDocument({
            ...createInitialCheckersProjectDocument(context.accountId),
            game: game.document_json,
          });
          if (!validated.ok) {
            throw new HttpException(error('invalid_class_game', validated.message), 500);
          }
          const light = memberByUser.get(game.light_user_id);
          const dark = memberByUser.get(game.dark_user_id);
          return {
            id: game.id,
            mode: game.mode,
            status: game.status,
            version: Number(game.version),
            side:
              context.userId === game.light_user_id
                ? ('light' as const)
                : context.userId === game.dark_user_id
                  ? ('dark' as const)
                  : null,
            lightPlayer: {
              id: light?.member_account_id ?? '',
              displayName: light?.display_name ?? 'Ученик',
            },
            darkPlayer: {
              id: dark?.member_account_id ?? '',
              displayName: dark?.display_name ?? 'Ученик',
            },
            document: validated.value.game,
            createdAt: String(game.created_at),
            updatedAt: String(game.updated_at),
            reactions: muted
              ? []
              : (reactions.rows as ReactionRow[])
                  .filter((reaction) => reaction.game_id === game.id)
                  .reverse()
                  .map((reaction) => ({
                    id: reaction.id,
                    senderName: memberByUser.get(reaction.sender_user_id)?.display_name ?? 'Ученик',
                    reactionId: reaction.reaction_id,
                    sentAt: String(reaction.created_at),
                  })),
          };
        }),
      };
    });
  }

  @Post(':projectId/challenges')
  async createChallenge(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    if (membership.role !== 'student') {
      throw new HttpException(
        error('student_required', 'Только ученик может отправить вызов.'),
        403,
      );
    }
    const shape = checkBodyShape(rawBody, ['opponentId', 'mode']);
    const opponentId = shape.ok ? shape.body['opponentId'] : null;
    const mode = shape.ok ? shape.body['mode'] : null;
    if (
      !shape.ok ||
      typeof opponentId !== 'string' ||
      !UUID_PATTERN.test(opponentId) ||
      (mode !== 'friendly' && mode !== 'team')
    ) {
      throw new HttpException(error('validation_error', 'Выберите одноклассника и режим.'), 400);
    }
    const members = await this.classroomMembers(context, projectId);
    const opponent = members.find((member) => member.member_account_id === opponentId);
    if (!opponent || opponent.member_user_id === context.userId) {
      throw new HttpException(
        error('classmate_required', 'Вызов доступен только однокласснику.'),
        403,
      );
    }
    const game = await withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const duplicate = await client.query(
        `SELECT id FROM checkers_class_games
          WHERE tenant_id = $1 AND project_id = $2 AND status IN ('pending', 'active')
            AND ((light_user_id = $3 AND dark_user_id = $4)
              OR (light_user_id = $4 AND dark_user_id = $3))
          LIMIT 1`,
        [context.tenantId, projectId, context.userId, opponent.member_user_id],
      );
      if (duplicate.rows[0]) {
        throw new HttpException(error('challenge_exists', 'У вас уже есть открытая игра.'), 409);
      }
      const inserted = await client.query(
        `INSERT INTO checkers_class_games
           (tenant_id, project_id, classroom_id, created_by_user_id, light_user_id,
            dark_user_id, mode, document_json)
         VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
         RETURNING id, status, version, created_at`,
        [
          context.tenantId,
          projectId,
          membership.classroomId,
          context.userId,
          opponent.member_user_id,
          mode,
          JSON.stringify(createInitialCheckersProjectDocument(context.accountId).game),
        ],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'checkers_class_game', $3, 'checkers.challenge_created',
                 jsonb_build_object('projectId', $4::uuid, 'opponentUserId', $5::uuid,
                                    'mode', $6::text))`,
        [
          context.tenantId,
          context.userId,
          inserted.rows[0].id,
          projectId,
          opponent.member_user_id,
          mode,
        ],
      );
      return inserted.rows[0];
    });
    reply.code(201);
    return { game };
  }

  @Post(':projectId/events')
  async createTeacherEvent(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    if (membership.role !== 'owner') {
      throw new HttpException(
        error('educator_required', 'Только педагог может создать матч класса.'),
        403,
      );
    }
    const shape = checkBodyShape(rawBody, ['lightPlayerId', 'darkPlayerId']);
    const lightPlayerId = shape.ok ? shape.body['lightPlayerId'] : null;
    const darkPlayerId = shape.ok ? shape.body['darkPlayerId'] : null;
    if (
      !shape.ok ||
      typeof lightPlayerId !== 'string' ||
      !UUID_PATTERN.test(lightPlayerId) ||
      typeof darkPlayerId !== 'string' ||
      !UUID_PATTERN.test(darkPlayerId) ||
      lightPlayerId === darkPlayerId
    ) {
      throw new HttpException(
        error('validation_error', 'Выберите двух разных учеников класса.'),
        400,
      );
    }
    const members = await this.classroomMembers(context, projectId);
    const light = members.find((member) => member.member_account_id === lightPlayerId);
    const dark = members.find((member) => member.member_account_id === darkPlayerId);
    if (!light || !dark) {
      throw new HttpException(
        error('classmates_required', 'Оба участника должны состоять в этом классе.'),
        403,
      );
    }
    const game = await withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const duplicate = await client.query(
        `SELECT id FROM checkers_class_games
          WHERE tenant_id = $1 AND project_id = $2 AND mode = 'teacher-event'
            AND status IN ('pending', 'active')
            AND ((light_user_id = $3 AND dark_user_id = $4)
              OR (light_user_id = $4 AND dark_user_id = $3))
          LIMIT 1`,
        [context.tenantId, projectId, light.member_user_id, dark.member_user_id],
      );
      if (duplicate.rows[0]) {
        throw new HttpException(
          error('event_exists', 'Для этих учеников уже открыт матч педагога.'),
          409,
        );
      }
      const inserted = await client.query(
        `INSERT INTO checkers_class_games
           (tenant_id, project_id, classroom_id, created_by_user_id, light_user_id,
            dark_user_id, mode, status, document_json)
         VALUES ($1, $2, $3, $4, $5, $6, 'teacher-event', 'active', $7)
         RETURNING id, status, version, created_at`,
        [
          context.tenantId,
          projectId,
          membership.classroomId,
          context.userId,
          light.member_user_id,
          dark.member_user_id,
          JSON.stringify(createInitialCheckersProjectDocument(context.accountId).game),
        ],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'checkers_class_game', $3, 'checkers.teacher_event_created',
                 jsonb_build_object('projectId', $4::uuid, 'lightUserId', $5::uuid,
                                    'darkUserId', $6::uuid))`,
        [
          context.tenantId,
          context.userId,
          inserted.rows[0].id,
          projectId,
          light.member_user_id,
          dark.member_user_id,
        ],
      );
      return inserted.rows[0];
    });
    reply.code(201);
    return { game };
  }

  @Post(':projectId/games/:gameId/accept')
  async acceptChallenge(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('gameId') gameId: string,
  ) {
    const context = await this.requireContext(request);
    await this.membership(context, projectId);
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const updated = await client.query(
        `UPDATE checkers_class_games
            SET status = 'active', version = version + 1, updated_at = now()
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3
            AND dark_user_id = $4 AND status = 'pending'
          RETURNING id, status, version`,
        [context.tenantId, projectId, gameId, context.userId],
      );
      if (!updated.rows[0]) {
        throw new HttpException(error('challenge_unavailable', 'Этот вызов уже недоступен.'), 409);
      }
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'checkers_class_game', $3, 'checkers.challenge_accepted',
                 jsonb_build_object('projectId', $4::uuid))`,
        [context.tenantId, context.userId, gameId, projectId],
      );
      return { game: updated.rows[0] };
    });
  }

  @Post(':projectId/games/:gameId/moves')
  async playClassMove(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('gameId') gameId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    await this.membership(context, projectId);
    const shape = checkBodyShape(rawBody, ['expectedVersion', 'pieceId', 'path']);
    const expectedVersion = shape.ok ? shape.body['expectedVersion'] : null;
    const pieceId = shape.ok ? shape.body['pieceId'] : null;
    const path = shape.ok ? shape.body['path'] : null;
    if (
      !shape.ok ||
      typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      typeof pieceId !== 'string' ||
      !Array.isArray(path) ||
      path.some((square) => !isCheckersSquare(square))
    ) {
      throw new HttpException(error('validation_error', 'Ход имеет неверный формат.'), 400);
    }
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const found = await client.query(
        `SELECT id, light_user_id, dark_user_id, status, document_json, version
           FROM checkers_class_games
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [context.tenantId, projectId, gameId],
      );
      const row = found.rows[0];
      if (!row || row.status !== 'active') {
        throw new HttpException(error('game_unavailable', 'Игра не активна.'), 409);
      }
      const side =
        row.light_user_id === context.userId
          ? 'light'
          : row.dark_user_id === context.userId
            ? 'dark'
            : null;
      if (!side)
        throw new HttpException(error('participant_required', 'Вы не участник этой игры.'), 403);
      const parsed = row.document_json as CheckersDocument;
      if (parsed.sideToMove !== side) {
        throw new HttpException(error('not_your_turn', 'Сейчас ход другого игрока.'), 409);
      }
      const applied = applyCheckersGameMove(parsed, { pieceId, path });
      if (!applied.ok) throw new HttpException(error('illegal_move', applied.message), 409);
      const status = applied.value.result === '*' ? 'active' : 'finished';
      const updated = await client.query(
        `UPDATE checkers_class_games
            SET document_json = $1, status = $2, version = version + 1, updated_at = now()
          WHERE tenant_id = $3 AND project_id = $4 AND id = $5 AND version = $6
          RETURNING document_json, status, version, updated_at`,
        [
          JSON.stringify(applied.value),
          status,
          context.tenantId,
          projectId,
          gameId,
          expectedVersion,
        ],
      );
      if (!updated.rows[0]) {
        throw new HttpException(
          error('version_conflict', 'Партия уже обновилась. Повторите ход.'),
          409,
        );
      }
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'checkers_class_game', $3, 'checkers.class_move_played',
                 jsonb_build_object('projectId', $4::uuid, 'ply', $5::integer))`,
        [context.tenantId, context.userId, gameId, projectId, applied.value.moveHistory.length],
      );
      return { game: updated.rows[0] };
    });
  }

  @Post(':projectId/games/:gameId/reactions')
  async react(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('gameId') gameId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    const shape = checkBodyShape(rawBody, ['reactionId']);
    const reactionId = shape.ok ? shape.body['reactionId'] : null;
    if (
      !shape.ok ||
      typeof reactionId !== 'string' ||
      !CHECKERS_REACTION_IDS.includes(reactionId as CheckersReactionId)
    ) {
      throw new HttpException(error('unknown_reaction', 'Разрешены только готовые реакции.'), 400);
    }
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const games = await client.query(
        `SELECT light_user_id, dark_user_id, status
           FROM checkers_class_games
          WHERE tenant_id = $1 AND project_id = $2 AND id = $3`,
        [context.tenantId, projectId, gameId],
      );
      const game = games.rows[0];
      if (!game) throw new HttpException(error('game_not_found', 'Игра не найдена.'), 404);
      if (game.status === 'declined') {
        throw new HttpException(error('game_closed', 'Игра закрыта.'), 409);
      }
      const previous = await client.query(
        `SELECT id, game_id, classroom_id, sender_user_id, reaction_id, game_state, created_at
           FROM checkers_reaction_events
          WHERE tenant_id = $1 AND game_id = $2
          ORDER BY created_at`,
        [context.tenantId, gameId],
      );
      const requestEvent = {
        eventId: randomUUID(),
        gameId,
        gameClassroomId: membership.classroomId,
        senderId: context.userId,
        senderClassroomIds: [membership.classroomId],
        participantIds: [String(game.light_user_id), String(game.dark_user_id)],
        reactionId: reactionId as CheckersReactionId,
        sentAt: new Date().toISOString(),
        gameState: game.status === 'finished' ? ('finished' as const) : ('active' as const),
      };
      const priorEvents: CheckersReactionEvent[] = (previous.rows as ReactionRow[]).map((row) => ({
        id: row.id,
        gameId: row.game_id,
        classroomId: row.classroom_id,
        senderId: row.sender_user_id,
        reactionId: row.reaction_id,
        sentAt: String(row.created_at),
        gameState: row.game_state,
      }));
      const created = createCheckersReactionEvent(requestEvent, priorEvents);
      if (!created.ok) {
        throw new HttpException(error('reaction_rejected', created.message), 429);
      }
      const inserted = await client.query(
        `INSERT INTO checkers_reaction_events
           (id, tenant_id, project_id, classroom_id, game_id, sender_user_id,
            reaction_id, game_state, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, reaction_id, created_at`,
        [
          created.value.id,
          context.tenantId,
          projectId,
          membership.classroomId,
          gameId,
          context.userId,
          created.value.reactionId,
          created.value.gameState,
          created.value.sentAt,
        ],
      );
      await client.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
         VALUES ($1, $2, 'checkers_class_game', $3, 'checkers.reaction_sent',
                 jsonb_build_object('projectId', $4::uuid, 'reactionId', $5::text))`,
        [context.tenantId, context.userId, gameId, projectId, created.value.reactionId],
      );
      return { reaction: inserted.rows[0] };
    });
  }

  @Put(':projectId/reactions/mute')
  async muteReactions(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() rawBody: unknown,
  ) {
    const context = await this.requireContext(request);
    await this.membership(context, projectId);
    const shape = checkBodyShape(rawBody, ['muted']);
    const muted = shape.ok ? shape.body['muted'] : null;
    if (!shape.ok || typeof muted !== 'boolean') {
      throw new HttpException(error('validation_error', 'Неверная настройка реакций.'), 400);
    }
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      await client.query(
        `INSERT INTO checkers_reaction_mutes (tenant_id, project_id, user_id, muted)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, project_id, user_id) DO UPDATE
           SET muted = EXCLUDED.muted, updated_at = now()`,
        [context.tenantId, projectId, context.userId, muted],
      );
      return { muted };
    });
  }

  @Post(':projectId/games/:gameId/reactions/:eventId/report')
  async reportReaction(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('gameId') gameId: string,
    @Param('eventId') eventId: string,
  ) {
    const context = await this.requireContext(request);
    const membership = await this.membership(context, projectId);
    return withTenantContext(this.requirePool(), context.tenantId, async (client) => {
      const event = await client.query(
        `SELECT r.id
           FROM checkers_reaction_events r
           JOIN checkers_class_games g
             ON g.tenant_id = r.tenant_id AND g.id = r.game_id
          WHERE r.tenant_id = $1 AND r.project_id = $2 AND r.game_id = $3 AND r.id = $4
            AND (g.light_user_id = $5 OR g.dark_user_id = $5)`,
        [context.tenantId, projectId, gameId, eventId, context.userId],
      );
      if (!event.rows[0]) {
        throw new HttpException(error('reaction_not_found', 'Реакция не найдена.'), 404);
      }
      const inserted = await client.query(
        `INSERT INTO checkers_safety_signals
           (tenant_id, project_id, classroom_id, game_id, reaction_event_id, reporter_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, reaction_event_id, reporter_user_id) DO NOTHING
         RETURNING id`,
        [context.tenantId, projectId, membership.classroomId, gameId, eventId, context.userId],
      );
      if (inserted.rows[0]) {
        await client.query(
          `INSERT INTO audit_events
             (tenant_id, actor_user_id, entity_type, entity_id, action, payload_json)
           VALUES ($1, $2, 'checkers_class_game', $3, 'checkers.reaction_reported',
                   jsonb_build_object('projectId', $4::uuid, 'reactionEventId', $5::uuid))`,
          [context.tenantId, context.userId, gameId, projectId, eventId],
        );
      }
      return { reported: true };
    });
  }
}
