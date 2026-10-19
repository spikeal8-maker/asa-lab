import type pg from 'pg';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import { AiServiceError } from './ai-chat.service.js';
import { STUDENT_SESSION_COOKIE, type SeatContextUseCase } from './seat-context.js';
import { SESSION_COOKIE } from './tokens.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const AI_SEAT_HEADER = 'x-asa-ai-seat';

export interface AiAdmission {
  canGenerate: boolean;
  reason: string | null;
  rating?: number | null;
  minimumRating?: number;
}

export interface AiScopes {
  personal: boolean;
  items: Array<
    AiAdmission & {
      seatId: string;
      classroomId: string;
      classroomTitle: string;
      displayName: string;
    }
  >;
}

export interface ClassroomAiAccess {
  classroomId: string;
  mode: 'deny' | 'allow' | 'rating';
  minimumRating: number;
  revision: number;
  readOnly: boolean;
  students: Array<{
    seatId: string;
    displayName: string;
    status: string;
    override: 'inherit' | 'allow' | 'deny';
    rating: number | null;
    canGenerate: boolean;
  }>;
}

/** A header is a selector only. Its authority is established again in SQL. */
export function aiSeatSelector(request: FastifyRequest): string | null {
  const selected = request.headers[AI_SEAT_HEADER];
  if (selected === undefined) return null;
  if (typeof selected !== 'string' || !UUID.test(selected)) {
    throw new AiServiceError('ai_scope_invalid', 400, 'Неверный школьный контекст чата.');
  }
  return selected.toLowerCase();
}

export function aiAccessId(value: string): string {
  if (!UUID.test(value)) {
    throw new AiServiceError('ai_scope_invalid', 400, 'Неверный идентификатор класса или ученика.');
  }
  return value.toLowerCase();
}

/** A retained Account cookie cannot replace an invalid/revoked Seat session. */
export async function aiRequestActor(
  request: FastifyRequest,
  accounts: ActiveContextUseCase,
  seats: SeatContextUseCase,
): Promise<string> {
  const studentToken = request.cookies[STUDENT_SESSION_COOKIE];
  if (studentToken !== undefined) {
    const seat = await seats.resolveExisting(studentToken);
    if (!seat) throw new AiServiceError('ai_session_required', 401, 'Войдите в класс заново.');
    return seat.principalId;
  }
  const account = await accounts.resolve(request.cookies[SESSION_COOKIE]);
  if (!account?.accountId) {
    throw new AiServiceError('ai_session_required', 401, 'Войдите в аккаунт или в свой класс.');
  }
  return account.principalId;
}

export function requireAiSameOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  let valid = false;
  try {
    valid = typeof origin === 'string' && new URL(origin).host === request.headers.host;
  } catch {
    /* Invalid origins stay denied. */
  }
  if (!valid) throw new AiServiceError('ai_origin_denied', 403, 'Источник запроса запрещён.');
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new AiServiceError('ai_json_required', 415, 'Нужен JSON-запрос.');
  }
}

export class AiAccessService {
  constructor(private readonly pool: pg.Pool) {}

  private async value<T>(sql: string, params: unknown[]): Promise<T> {
    try {
      const result = await this.pool.query<{ value: T | null }>(sql, params);
      const value = result.rows[0]?.value;
      if (value === null || value === undefined) {
        throw new AiServiceError('ai_scope_denied', 403, 'Этот контекст чата недоступен.');
      }
      return value;
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : '';
      if (/AI_(?:SCOPE|TEACHER)_DENIED/.test(message)) {
        throw new AiServiceError('ai_scope_denied', 403, 'Нет доступа к этому классу или чату.');
      }
      if (message.includes('AI_POLICY_CONFLICT')) {
        throw new AiServiceError(
          'ai_policy_conflict',
          409,
          'Настройки изменились. Обновите их и повторите выбор.',
        );
      }
      if (message.includes('AI_REQUEST_ID_REUSED')) {
        throw new AiServiceError(
          'ai_request_id_reused',
          409,
          'Этот запрос уже использован с другими данными.',
        );
      }
      if (message.includes('AI_POLICY_INVALID')) {
        throw new AiServiceError(
          'ai_policy_invalid',
          400,
          'Проверьте правило доступа и порог рейтинга от 0 до 100.',
        );
      }
      throw problem;
    }
  }

  owner(actor: string, seatId: string | null): Promise<string> {
    return this.value('SELECT ai_access_owner($1,$2) AS value', [actor, seatId]);
  }

  scopes(actor: string): Promise<AiScopes> {
    return this.value('SELECT ai_access_scopes($1) AS value', [actor]);
  }

  admission(owner: string): Promise<AiAdmission> {
    return this.value('SELECT ai_access_status($1) AS value', [owner]);
  }

  classroom(actor: string, classroomId: string): Promise<ClassroomAiAccess> {
    return this.value('SELECT ai_classroom_access_get($1,$2) AS value', [actor, classroomId]);
  }

  saveClassroom(
    actor: string,
    classroomId: string,
    input: unknown,
  ): Promise<{ saved: true; revision: number }> {
    return this.value('SELECT ai_classroom_access_set($1,$2,$3::jsonb) AS value', [
      actor,
      classroomId,
      JSON.stringify(input),
    ]);
  }
}
