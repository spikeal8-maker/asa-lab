import { withTenantContext } from '@asa-lab/database';
import type pg from 'pg';
import type {
  ChessRatingLedgerEntry,
  ChessRatingPool,
  ChessRatingState,
} from '../domain/rating.js';
import type { MatchmakingTicket } from '../domain/matchmaking.js';
import type {
  LiveChessChallenge,
  LiveChessEvent,
  LiveChessGame,
} from '../domain/model.js';
import type {
  ChessLiveRepositoryPort,
  LiveCommandReceipt,
  RepositoryWriteResult,
} from '../application/ports.js';

function duplicate(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function asNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function cloneJson<T>(value: unknown, label: string): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`stored ${label} JSON is invalid`);
  }
  return structuredClone(value) as T;
}

function mapReceipt(row: Record<string, unknown>): LiveCommandReceipt {
  return {
    tenantId: String(row['tenant_id']),
    actorId: String(row['actor_id']),
    commandId: String(row['command_id']),
    kind: String(row['command_kind']),
    fingerprint: String(row['fingerprint']),
    resourceType: row['resource_type'] as LiveCommandReceipt['resourceType'],
    resourceId: String(row['resource_id']),
    createdAtMs: asNumber(row['created_at_ms']),
  };
}

function mapEvent(row: Record<string, unknown>): LiveChessEvent {
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    gameId: row['game_id'] === null ? null : String(row['game_id']),
    challengeId:
      row['challenge_id'] === null ? null : String(row['challenge_id']),
    sequence: asNumber(row['sequence']),
    type: row['event_type'] as LiveChessEvent['type'],
    actorId: row['actor_id'] === null ? null : String(row['actor_id']),
    createdAtMs: asNumber(row['created_at_ms']),
    payload: cloneJson(row['payload_json'], 'event payload'),
  };
}

async function insertReceipt(
  client: pg.PoolClient,
  receipt: LiveCommandReceipt,
): Promise<void> {
  await client.query(
    `INSERT INTO chess_live_command_receipts
       (tenant_id, actor_id, command_id, command_kind, fingerprint,
        resource_type, resource_id, created_at_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      receipt.tenantId,
      receipt.actorId,
      receipt.commandId,
      receipt.kind,
      receipt.fingerprint,
      receipt.resourceType,
      receipt.resourceId,
      receipt.createdAtMs,
    ],
  );
}

async function insertEvents(
  client: pg.PoolClient,
  events: readonly LiveChessEvent[],
): Promise<void> {
  for (const event of events) {
    await client.query(
      `INSERT INTO chess_live_events
         (id, tenant_id, game_id, challenge_id, sequence, event_type,
          actor_id, created_at_ms, payload_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        event.id,
        event.tenantId,
        event.gameId,
        event.challengeId,
        event.sequence,
        event.type,
        event.actorId,
        event.createdAtMs,
        event.payload,
      ],
    );
  }
}

async function insertChallenge(
  client: pg.PoolClient,
  challenge: LiveChessChallenge,
): Promise<void> {
  await client.query(
    `INSERT INTO chess_live_challenges
       (id, tenant_id, public_code, creator_id, color_preference,
        initial_ms, increment_ms, rated, status, created_at_ms, expires_at_ms,
        accepted_by_id, accepted_at_ms, game_id, version, create_command_id,
        challenge_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      challenge.id,
      challenge.tenantId,
      challenge.publicCode,
      challenge.creatorId,
      challenge.colorPreference,
      challenge.timeControl.initialMs,
      challenge.timeControl.incrementMs,
      challenge.rated,
      challenge.status,
      challenge.createdAtMs,
      challenge.expiresAtMs,
      challenge.acceptedById,
      challenge.acceptedAtMs,
      challenge.gameId,
      challenge.version,
      challenge.createCommandId,
      challenge,
    ],
  );
}

async function insertGame(
  client: pg.PoolClient,
  game: LiveChessGame,
): Promise<void> {
  await client.query(
    `INSERT INTO chess_live_games
       (id, tenant_id, challenge_id, white_player_id, black_player_id,
        initial_ms, increment_ms, rated, status, result, termination,
        winner_id, version, event_sequence, created_at_ms, updated_at_ms,
        finished_at_ms, game_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      game.id,
      game.tenantId,
      game.challengeId,
      game.whitePlayerId,
      game.blackPlayerId,
      game.timeControl.initialMs,
      game.timeControl.incrementMs,
      game.rated,
      game.status,
      game.result,
      game.termination,
      game.winnerId,
      game.version,
      game.sequence,
      game.createdAtMs,
      game.updatedAtMs,
      game.finishedAtMs,
      game,
    ],
  );
}

async function insertTicket(
  client: pg.PoolClient,
  ticket: MatchmakingTicket,
): Promise<void> {
  await client.query(
    `INSERT INTO chess_matchmaking_tickets
       (id, tenant_id, player_id, rating_pool, initial_ms, increment_ms,
        rated, color_preference, queued_rating, status, created_at_ms,
        expires_at_ms, paired_game_id, version, command_id, ticket_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      ticket.id,
      ticket.tenantId,
      ticket.playerId,
      ticket.pool,
      ticket.timeControl.initialMs,
      ticket.timeControl.incrementMs,
      ticket.rated,
      ticket.colorPreference,
      ticket.rating,
      ticket.status,
      ticket.createdAtMs,
      ticket.expiresAtMs,
      ticket.pairedGameId,
      ticket.version,
      ticket.commandId,
      ticket,
    ],
  );
}

export class PgChessLiveRepository implements ChessLiveRepositoryPort {
  constructor(private readonly pool: pg.Pool) {}

  async findCommandReceipt(
    tenantId: string,
    commandId: string,
  ): Promise<LiveCommandReceipt | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT tenant_id, actor_id, command_id, command_kind, fingerprint,
                resource_type, resource_id, created_at_ms
           FROM chess_live_command_receipts
          WHERE command_id = $1`,
        [commandId],
      );
      return result.rowCount ? mapReceipt(result.rows[0]) : null;
    });
  }

  async saveCommandReceipt(
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(
        this.pool,
        receipt.tenantId,
        async (client) => {
          await insertReceipt(client, receipt);
          return { ok: true } as const;
        },
      );
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async createChallenge(
    challenge: LiveChessChallenge,
    event: LiveChessEvent,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(
        this.pool,
        challenge.tenantId,
        async (client) => {
          await insertChallenge(client, challenge);
          await insertEvents(client, [event]);
          await insertReceipt(client, receipt);
          return { ok: true } as const;
        },
      );
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async getChallengeById(
    tenantId: string,
    challengeId: string,
  ): Promise<LiveChessChallenge | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT challenge_json
           FROM chess_live_challenges
          WHERE id = $1`,
        [challengeId],
      );
      return result.rowCount
        ? cloneJson<LiveChessChallenge>(result.rows[0].challenge_json, 'challenge')
        : null;
    });
  }

  async getChallengeByCode(
    tenantId: string,
    publicCode: string,
  ): Promise<LiveChessChallenge | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT challenge_json
           FROM chess_live_challenges
          WHERE public_code = $1`,
        [publicCode],
      );
      return result.rowCount
        ? cloneJson<LiveChessChallenge>(result.rows[0].challenge_json, 'challenge')
        : null;
    });
  }

  async saveChallenge(
    challenge: LiveChessChallenge,
    expectedVersion: number,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(
        this.pool,
        challenge.tenantId,
        async (client) => {
          const updated = await client.query(
            `UPDATE chess_live_challenges
                SET status = $2,
                    accepted_by_id = $3,
                    accepted_at_ms = $4,
                    game_id = $5,
                    version = $6,
                    challenge_json = $7
              WHERE id = $1 AND version = $8`,
            [
              challenge.id,
              challenge.status,
              challenge.acceptedById,
              challenge.acceptedAtMs,
              challenge.gameId,
              challenge.version,
              challenge,
              expectedVersion,
            ],
          );
          if (updated.rowCount !== 1) return { ok: false, reason: 'conflict' } as const;
          await insertEvents(client, events);
          await insertReceipt(client, receipt);
          return { ok: true } as const;
        },
      );
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async acceptChallengeAndCreateGame(
    challenge: LiveChessChallenge,
    expectedChallengeVersion: number,
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(
        this.pool,
        challenge.tenantId,
        async (client) => {
          await insertGame(client, game);
          const updated = await client.query(
            `UPDATE chess_live_challenges
                SET status = $2,
                    accepted_by_id = $3,
                    accepted_at_ms = $4,
                    game_id = $5,
                    version = $6,
                    challenge_json = $7
              WHERE id = $1 AND version = $8 AND status = 'open'`,
            [
              challenge.id,
              challenge.status,
              challenge.acceptedById,
              challenge.acceptedAtMs,
              challenge.gameId,
              challenge.version,
              challenge,
              expectedChallengeVersion,
            ],
          );
          if (updated.rowCount !== 1) return { ok: false, reason: 'conflict' } as const;
          await insertEvents(client, events);
          await insertReceipt(client, receipt);
          return { ok: true } as const;
        },
      );
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async createGame(
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(this.pool, game.tenantId, async (client) => {
        await insertGame(client, game);
        await insertEvents(client, events);
        return { ok: true } as const;
      });
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async getGame(
    tenantId: string,
    gameId: string,
  ): Promise<LiveChessGame | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT game_json
           FROM chess_live_games
          WHERE id = $1`,
        [gameId],
      );
      return result.rowCount
        ? cloneJson<LiveChessGame>(result.rows[0].game_json, 'game')
        : null;
    });
  }

  async saveGame(
    game: LiveChessGame,
    expectedVersion: number,
    events: readonly LiveChessEvent[],
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(this.pool, game.tenantId, async (client) => {
        const updated = await client.query(
          `UPDATE chess_live_games
              SET status = $2,
                  result = $3,
                  termination = $4,
                  winner_id = $5,
                  version = $6,
                  event_sequence = $7,
                  updated_at_ms = $8,
                  finished_at_ms = $9,
                  game_json = $10
            WHERE id = $1 AND version = $11`,
          [
            game.id,
            game.status,
            game.result,
            game.termination,
            game.winnerId,
            game.version,
            game.sequence,
            game.updatedAtMs,
            game.finishedAtMs,
            game,
            expectedVersion,
          ],
        );
        if (updated.rowCount !== 1) return { ok: false, reason: 'conflict' } as const;
        await insertEvents(client, events);
        await insertReceipt(client, receipt);
        return { ok: true } as const;
      });
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async listGameEvents(
    tenantId: string,
    gameId: string,
    afterSequence: number,
    visibleBeforeOrAtMs?: number,
  ): Promise<readonly LiveChessEvent[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, tenant_id, game_id, challenge_id, sequence, event_type,
                actor_id, created_at_ms, payload_json
           FROM chess_live_events
          WHERE game_id = $1
            AND sequence > $2
            AND ($3::bigint IS NULL OR created_at_ms <= $3)
          ORDER BY sequence ASC`,
        [gameId, afterSequence, visibleBeforeOrAtMs ?? null],
      );
      return result.rows.map(mapEvent);
    });
  }

  async createTicket(
    ticket: MatchmakingTicket,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(this.pool, ticket.tenantId, async (client) => {
        await insertTicket(client, ticket);
        await insertReceipt(client, receipt);
        return { ok: true } as const;
      });
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async getTicket(
    tenantId: string,
    ticketId: string,
  ): Promise<MatchmakingTicket | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT ticket_json
           FROM chess_matchmaking_tickets
          WHERE id = $1`,
        [ticketId],
      );
      return result.rowCount
        ? cloneJson<MatchmakingTicket>(result.rows[0].ticket_json, 'matchmaking ticket')
        : null;
    });
  }

  async listQueuedTickets(
    tenantId: string,
  ): Promise<readonly MatchmakingTicket[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT ticket_json
           FROM chess_matchmaking_tickets
          WHERE status = 'queued'
          ORDER BY created_at_ms ASC, id ASC`,
      );
      return result.rows.map((row) =>
        cloneJson<MatchmakingTicket>(row.ticket_json, 'matchmaking ticket'),
      );
    });
  }

  async saveTicket(
    ticket: MatchmakingTicket,
    expectedVersion: number,
    receipt: LiveCommandReceipt,
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(this.pool, ticket.tenantId, async (client) => {
        const updated = await client.query(
          `UPDATE chess_matchmaking_tickets
              SET status = $2,
                  paired_game_id = $3,
                  version = $4,
                  ticket_json = $5
            WHERE id = $1 AND version = $6`,
          [
            ticket.id,
            ticket.status,
            ticket.pairedGameId,
            ticket.version,
            ticket,
            expectedVersion,
          ],
        );
        if (updated.rowCount !== 1) return { ok: false, reason: 'conflict' } as const;
        await insertReceipt(client, receipt);
        return { ok: true } as const;
      });
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async pairTicketsAndCreateGame(
    whiteTicket: MatchmakingTicket,
    expectedWhiteVersion: number,
    blackTicket: MatchmakingTicket,
    expectedBlackVersion: number,
    game: LiveChessGame,
    events: readonly LiveChessEvent[],
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(this.pool, game.tenantId, async (client) => {
        await insertGame(client, game);
        const white = await client.query(
          `UPDATE chess_matchmaking_tickets
              SET status = $2, paired_game_id = $3, version = $4, ticket_json = $5
            WHERE id = $1 AND version = $6 AND status = 'queued'`,
          [
            whiteTicket.id,
            whiteTicket.status,
            whiteTicket.pairedGameId,
            whiteTicket.version,
            whiteTicket,
            expectedWhiteVersion,
          ],
        );
        const black = await client.query(
          `UPDATE chess_matchmaking_tickets
              SET status = $2, paired_game_id = $3, version = $4, ticket_json = $5
            WHERE id = $1 AND version = $6 AND status = 'queued'`,
          [
            blackTicket.id,
            blackTicket.status,
            blackTicket.pairedGameId,
            blackTicket.version,
            blackTicket,
            expectedBlackVersion,
          ],
        );
        if (white.rowCount !== 1 || black.rowCount !== 1) {
          return { ok: false, reason: 'conflict' } as const;
        }
        await insertEvents(client, events);
        return { ok: true } as const;
      });
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async getRating(
    tenantId: string,
    playerId: string,
    pool: ChessRatingPool,
  ): Promise<ChessRatingState | null> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT rating_json
           FROM chess_ratings
          WHERE player_id = $1 AND rating_pool = $2`,
        [playerId, pool],
      );
      return result.rowCount
        ? cloneJson<ChessRatingState>(result.rows[0].rating_json, 'rating')
        : null;
    });
  }

  async saveRatingUpdate(
    gameId: string,
    white: ChessRatingState,
    black: ChessRatingState,
    ledger: readonly [ChessRatingLedgerEntry, ChessRatingLedgerEntry],
  ): Promise<RepositoryWriteResult> {
    try {
      return await withTenantContext(this.pool, white.tenantId, async (client) => {
        for (const state of [white, black]) {
          await client.query(
            `INSERT INTO chess_ratings
               (tenant_id, player_id, rating_pool, rating, games,
                provisional, updated_at_ms, algorithm, rating_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (tenant_id, player_id, rating_pool)
             DO UPDATE SET rating = EXCLUDED.rating,
                           games = EXCLUDED.games,
                           provisional = EXCLUDED.provisional,
                           updated_at_ms = EXCLUDED.updated_at_ms,
                           algorithm = EXCLUDED.algorithm,
                           rating_json = EXCLUDED.rating_json`,
            [
              state.tenantId,
              state.playerId,
              state.pool,
              state.rating,
              state.games,
              state.provisional,
              state.updatedAtMs,
              state.algorithm,
              state,
            ],
          );
        }
        for (const entry of ledger) {
          if (entry.gameId !== gameId) {
            throw new Error('rating ledger gameId does not match update gameId');
          }
          await client.query(
            `INSERT INTO chess_rating_ledger
               (id, tenant_id, game_id, rating_pool, player_id, opponent_id,
                result, score, rating_before, rating_after,
                opponent_rating_before, expected_score, k_factor, delta,
                games_after, provisional_after, created_at_ms, algorithm,
                ledger_json)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
            [
              entry.id,
              entry.tenantId,
              entry.gameId,
              entry.pool,
              entry.playerId,
              entry.opponentId,
              entry.result,
              entry.score,
              entry.ratingBefore,
              entry.ratingAfter,
              entry.opponentRatingBefore,
              entry.expectedScore,
              entry.kFactor,
              entry.delta,
              entry.gamesAfter,
              entry.provisionalAfter,
              entry.createdAtMs,
              entry.algorithm,
              entry,
            ],
          );
        }
        return { ok: true } as const;
      });
    } catch (error) {
      if (duplicate(error)) return { ok: false, reason: 'duplicate' };
      throw error;
    }
  }

  async listRatingLedger(
    tenantId: string,
    playerId: string,
    pool: ChessRatingPool,
  ): Promise<readonly ChessRatingLedgerEntry[]> {
    return withTenantContext(this.pool, tenantId, async (client) => {
      const result = await client.query(
        `SELECT ledger_json
           FROM chess_rating_ledger
          WHERE player_id = $1 AND rating_pool = $2
          ORDER BY created_at_ms DESC, id DESC`,
        [playerId, pool],
      );
      return result.rows.map((row) =>
        cloneJson<ChessRatingLedgerEntry>(row.ledger_json, 'rating ledger'),
      );
    });
  }
}
