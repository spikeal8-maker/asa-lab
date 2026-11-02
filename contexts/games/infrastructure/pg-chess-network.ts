import type pg from 'pg';
import { ChessNetworkError } from '../domain/chess-network.js';

export interface ChessNetworkSource {
  kind: 'account' | 'student_seat';
  sessionHash: string;
}
export interface ChessNetworkTransaction {
  actorId: string;
  query<T>(sql: string, values?: unknown[]): Promise<T>;
}
const statuses: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  POLICY_DENIED: 403,
  NOT_FOUND: 404,
  INVALID_COMMAND: 400,
  RATE_LIMITED: 429,
};
const messages: Record<string, string> = {
  UNAUTHORIZED: 'Войдите в ASA заново.',
  FORBIDDEN: 'Нет доступа к этому действию.',
  POLICY_DENIED: 'Учитель ограничил сетевую игру или круг соперников.',
  NOT_FOUND: 'Партия или приглашение не найдены.',
  INVALID_COMMAND: 'Некорректный запрос.',
  RATE_LIMITED: 'Слишком много запросов. Подождите минуту.',
  VERSION_CONFLICT: 'Позиция уже изменилась. Обновляем партию.',
  IDEMPOTENCY_CONFLICT: 'Команда уже использована для другого действия.',
  INVITE_EXPIRED: 'Срок действия приглашения истёк.',
  INVALID_STATE: 'Действие сейчас недоступно.',
};
export function checkedNetworkResult<T>(value: T): T {
  if (value && typeof value === 'object' && 'error' in value) {
    const code = String(value.error);
    throw new ChessNetworkError(
      code,
      messages[code] ?? 'Действие сейчас недоступно.',
      statuses[code] ?? 409,
    );
  }
  return value;
}
/** No tenant/superuser context: normal runtime executes only narrow Games functions. */
export class PgChessNetworkRepository {
  constructor(private readonly pool: pg.Pool) {}
  async transaction<T>(
    source: ChessNetworkSource,
    operation: (tx: ChessNetworkTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const authenticated = await client.query<{ data: { playerId: string } | null }>(
        'SELECT games.authenticate($1,$2) data',
        [source.kind, source.sessionHash],
      );
      const actor = authenticated.rows[0]?.data;
      if (!actor) throw new ChessNetworkError('UNAUTHORIZED', 'Войдите в ASA заново.', 401);
      const result = await operation({
        actorId: actor.playerId,
        query: async <TResult>(sql: string, values: unknown[] = []) => {
          const response = await client.query<{ data: TResult }>(sql, values);
          return checkedNetworkResult(response.rows[0]?.data as TResult);
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
