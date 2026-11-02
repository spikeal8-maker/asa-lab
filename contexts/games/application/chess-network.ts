import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type {
  ChessNetworkAccess,
  ChessNetworkAction,
  ChessNetworkInvite,
  ChessNetworkPolicy,
  ChessNetworkScope,
} from '@asa-lab/contracts';
import { createGamesCommandFingerprint } from './command.js';
import {
  applyNetworkChess,
  ChessNetworkError,
  createNetworkChess,
  expireNetworkChess,
  networkMatchView,
  type NetworkMatchRecord,
} from '../domain/chess-network.js';
import {
  PgChessNetworkRepository,
  type ChessNetworkSource,
  type ChessNetworkTransaction,
} from '../infrastructure/pg-chess-network.js';

interface PrivateAccess {
  allowed: boolean;
  reason: string;
  rules: { scope: ChessNetworkScope }[];
  affiliations: unknown[];
}
export interface NetworkInviteInput {
  scope: ChessNetworkScope;
  initialMs: number;
  incrementMs: number;
  colorPreference: 'white' | 'black' | 'random';
}
interface RefResult {
  matchId?: string;
  inviteId?: string;
  replayed?: boolean;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function networkId(value: string): string {
  if (!UUID.test(value))
    throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный идентификатор.', 400);
  return value;
}
function fingerprint(
  kind: string,
  target: string | null,
  version: number | null,
  payload: unknown,
): string {
  return createGamesCommandFingerprint({
    commandKind: kind,
    targetRef: target,
    expectedVersion: version,
    payload,
  });
}
/** Casual invitation vertical. Rated/legacy Chess Live stays a separate boundary. */
export class ChessNetworkService {
  private readonly repository: PgChessNetworkRepository;
  private readonly readBudget = new Map<string, { at: number; count: number }>();
  constructor(
    pool: pg.Pool,
    private readonly now = () => Date.now(),
  ) {
    this.repository = new PgChessNetworkRepository(pool);
  }
  private consumeRead(actor: string): void {
    const now = this.now();
    if (this.readBudget.size > 10_000) {
      for (const [key, item] of this.readBudget)
        if (now - item.at >= 60_000) this.readBudget.delete(key);
    }
    const old = this.readBudget.get(actor);
    if (!old && this.readBudget.size >= 10000)
      throw new ChessNetworkError('RATE_LIMITED', 'Слишком много активных запросов.', 429);
    if (!old || now - old.at >= 60_000) this.readBudget.set(actor, { at: now, count: 1 });
    else if (++old.count > 300)
      throw new ChessNetworkError('RATE_LIMITED', 'Слишком много запросов.', 429);
  }
  async access(source: ChessNetworkSource): Promise<ChessNetworkAccess> {
    return this.repository.transaction(source, async (tx) => {
      this.consumeRead(tx.actorId);
      const value = await tx.query<{ player: ChessNetworkAccess['player']; access: PrivateAccess }>(
        "SELECT games.chess_read('access') data",
      );
      const scopes: ChessNetworkScope[] = ['classroom', 'school', 'platform'];
      return {
        player: value.player,
        allowed: value.access.allowed,
        reason: value.access.reason,
        scopes: value.access.allowed
          ? scopes.filter(
              (scope) =>
                (scope === 'platform' || value.access.affiliations.length > 0) &&
                value.access.rules.every(
                  (rule) => scopes.indexOf(scope) <= scopes.indexOf(rule.scope),
                ),
            )
          : [],
      };
    });
  }
  async legacyAllowed(source: ChessNetworkSource): Promise<boolean> {
    return this.repository.transaction(source, async (tx) => {
      const current = await tx.query<{ access: PrivateAccess }>(
        "SELECT games.chess_read('access') data",
      );
      return current.access.rules.length === 0 && current.access.allowed;
    });
  }
  private async match(tx: ChessNetworkTransaction, id: string) {
    const loaded = await tx.query<{ match: NetworkMatchRecord }>(
      "SELECT games.chess_read('match',$1) data",
      [id],
    );
    let record = loaded.match;
    if (record.status === 'active') {
      const expired = expireNetworkChess(record.state, this.now());
      if (expired !== record.state) {
        await tx.query("SELECT games.chess_save(NULL,NULL,$1,$2,'timeout',$3::jsonb) data", [
          id,
          record.version,
          JSON.stringify(expired),
        ]);
        record = (
          await tx.query<{ match: NetworkMatchRecord }>(
            "SELECT games.chess_read('match',$1) data",
            [id],
          )
        ).match;
      }
    }
    return networkMatchView(record, tx.actorId, this.now());
  }
  async getMatch(source: ChessNetworkSource, id: string) {
    networkId(id);
    return this.repository.transaction(source, async (tx) => {
      this.consumeRead(tx.actorId);
      return { match: await this.match(tx, id) };
    });
  }
  async getInvite(source: ChessNetworkSource, code: string) {
    if (!/^[A-F0-9]{24}$/.test(code))
      throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный код приглашения.', 400);
    return this.repository.transaction(source, async (tx) => {
      this.consumeRead(tx.actorId);
      return tx.query<{ invite: ChessNetworkInvite }>("SELECT games.chess_read('invite',$1) data", [
        code,
      ]);
    });
  }
  async history(source: ChessNetworkSource, cursor?: string, limit = 25) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный размер страницы.', 400);
    type HistoryCursor = { updatedAt: number; id: string };
    let decoded: HistoryCursor | null = null;
    if (cursor) {
      try {
        if (cursor.length > 200) throw new Error('cursor');
        decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as HistoryCursor;
        if (!decoded || !Number.isSafeInteger(decoded.updatedAt) || !UUID.test(decoded.id))
          throw new Error('cursor');
      } catch {
        throw new ChessNetworkError('INVALID_COMMAND', 'Некорректная страница истории.', 400);
      }
    }
    return this.repository.transaction(source, async (tx) => {
      this.consumeRead(tx.actorId);
      const result = await tx.query<{
        matches: NetworkMatchRecord[];
        invites: ChessNetworkInvite[];
      }>("SELECT games.chess_read('history',NULL,$1::jsonb,$2) data", [
        decoded && JSON.stringify(decoded),
        limit,
      ]);
      const last = result.matches.at(-1);
      return {
        invites: result.invites,
        matches: result.matches.map((record) => networkMatchView(record, tx.actorId, this.now())),
        nextCursor:
          last && result.matches.length === limit
            ? Buffer.from(JSON.stringify({ id: last.id, updatedAt: last.updatedAt })).toString(
                'base64url',
              )
            : null,
      };
    });
  }
  private async result(tx: ChessNetworkTransaction, result: RefResult) {
    if (result.matchId)
      return { match: await this.match(tx, result.matchId), replayed: result.replayed === true };
    if (!result.inviteId)
      throw new ChessNetworkError('INVALID_STATE', 'Не удалось выполнить команду.');
    const value = await tx.query<{ invite: ChessNetworkInvite }>(
      "SELECT games.chess_read('own-invite',$1) data",
      [result.inviteId],
    );
    return { ...value, replayed: result.replayed === true };
  }
  async create(source: ChessNetworkSource, command: string, input: NetworkInviteInput) {
    createNetworkChess(input.initialMs, input.incrementMs, this.now());
    return this.repository.transaction(source, async (tx) =>
      this.result(
        tx,
        await tx.query<RefResult>('SELECT games.chess_create($1,$2,$3,$4,$5,$6,$7,$8) data', [
          command,
          fingerprint('create', null, null, input),
          randomUUID(),
          randomBytes(12).toString('hex').toUpperCase(),
          input.scope,
          input.initialMs,
          input.incrementMs,
          input.colorPreference,
        ]),
      ),
    );
  }
  async cancel(source: ChessNetworkSource, command: string, id: string, version: number) {
    networkId(id);
    return this.repository.transaction(source, async (tx) =>
      this.result(
        tx,
        await tx.query<RefResult>('SELECT games.chess_cancel($1,$2,$3,$4) data', [
          command,
          fingerprint('cancel', id, version, {}),
          id,
          version,
        ]),
      ),
    );
  }
  async accept(source: ChessNetworkSource, command: string, code: string) {
    if (!/^[A-F0-9]{24}$/.test(code))
      throw new ChessNetworkError('INVALID_COMMAND', 'Некорректный код приглашения.', 400);
    return this.repository.transaction(source, async (tx) => {
      const hash = fingerprint('accept', code, null, {});
      const replay = await tx.query<RefResult | null>('SELECT games.command_replay($1,$2) data', [
        command,
        hash,
      ]);
      if (replay) return this.result(tx, replay);
      const context = await tx.query<{ invite: ChessNetworkInvite; matchId?: string }>(
        'SELECT games.chess_redeem_context($1) data',
        [code],
      );
      if (context.matchId) throw new ChessNetworkError('INVALID_STATE', 'Приглашение уже принято.');
      const invite = context.invite;
      const state = createNetworkChess(invite.initialMs, invite.incrementMs, this.now());
      return this.result(
        tx,
        await tx.query<RefResult>('SELECT games.chess_accept($1,$2,$3,$4,$5,$6::jsonb) data', [
          command,
          hash,
          code,
          randomUUID(),
          invite.colorPreference === 'white' ||
            (invite.colorPreference === 'random' && randomInt(2) === 0),
          JSON.stringify(state),
        ]),
      );
    });
  }
  async action(
    source: ChessNetworkSource,
    command: string,
    id: string,
    version: number,
    action: ChessNetworkAction,
    uci?: string,
  ) {
    networkId(id);
    return this.repository.transaction(source, async (tx) => {
      const hash = fingerprint(action, id, version, { uci: uci ?? null });
      const replay = await tx.query<RefResult | null>('SELECT games.command_replay($1,$2) data', [
        command,
        hash,
      ]);
      if (replay) return this.result(tx, replay);
      const loaded = await tx.query<{ match: NetworkMatchRecord }>(
        "SELECT games.chess_read('match',$1) data",
        [id],
      );
      if (loaded.match.status === 'aborted')
        return { match: networkMatchView(loaded.match, tx.actorId, this.now()), replayed: false };
      if (loaded.match.version !== version)
        throw new ChessNetworkError('VERSION_CONFLICT', 'Позиция уже изменилась.');
      if (loaded.match.status === 'finished')
        throw new ChessNetworkError('MATCH_FINISHED', 'Партия завершена.');
      const state = applyNetworkChess(loaded.match, tx.actorId, action, uci, this.now());
      return this.result(
        tx,
        await tx.query<RefResult>('SELECT games.chess_save($1,$2,$3,$4,$5,$6::jsonb) data', [
          command,
          hash,
          id,
          version,
          action,
          JSON.stringify(state),
        ]),
      );
    });
  }
  async policy(
    source: ChessNetworkSource,
    id: string,
    input?: Omit<ChessNetworkPolicy, 'version'> & { expectedVersion: number },
    command?: string,
  ) {
    networkId(id);
    if (input && (!command || !/^[A-Za-z0-9._:-]{1,128}$/.test(command)))
      throw new ChessNetworkError('INVALID_COMMAND', 'Отсутствует идентификатор команды.', 400);
    return this.repository.transaction(source, async (tx) => {
      const value = await tx.query<ChessNetworkPolicy | null>(
        'SELECT games.network_policy($1,$2,$3,$4::jsonb,$5,$6) data',
        [
          source.kind,
          source.sessionHash,
          id,
          input ? JSON.stringify(input) : null,
          input ? command : null,
          input
            ? fingerprint('network-policy', id, input.expectedVersion, {
                enabled: input.enabled,
                scope: input.scope,
              })
            : null,
        ],
      );
      if (!value)
        throw new ChessNetworkError(
          'FORBIDDEN',
          'Управление доступно только учителю этого класса.',
          403,
        );
      return value;
    });
  }
}
