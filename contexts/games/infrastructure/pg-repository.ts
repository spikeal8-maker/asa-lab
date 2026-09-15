import type { Pool, PoolClient } from 'pg';
import {
  validateGameMatchStructure,
  type GameMatchId,
  type GameMatchParticipantV1,
  type GameMatchTeamV1,
  type GameMatchV1,
} from '../domain/model.js';
import type { GamesCommandReceiptV1 } from '../application/command.js';
import type {
  CreateGameMatchFoundationInput,
  GamesRepositoryPort,
  GamesRepositoryTransactionPort,
  GamesRequestContextV1,
  GamesWriteResult,
  SaveGameMatchLifecycleInput,
} from '../application/ports.js';

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapMatch(row: Record<string, unknown>): GameMatchV1 {
  return {
    id: String(row.id),
    gameKey: String(row.game_key),
    gameVersion: String(row.game_version),
    rulesVersion: String(row.rules_version),
    stateSchemaVersion: Number(row.state_schema_version),
    protocolVersion: String(row.protocol_version),
    ratingPolicyVersion:
      row.rating_policy_version === null ? null : String(row.rating_policy_version),
    admissionKind: row.admission_kind as GameMatchV1['admissionKind'],
    competitionKind: row.competition_kind as GameMatchV1['competitionKind'],
    scopeKind: row.scope_kind as GameMatchV1['scopeKind'],
    runtimeKind: row.runtime_kind as GameMatchV1['runtimeKind'],
    topology: row.topology as GameMatchV1['topology'],
    status: row.status as GameMatchV1['status'],
    lifecycleVersion: Number(row.lifecycle_version),
    gameConfigRef: row.game_config_ref === null ? null : String(row.game_config_ref),
    admissionRef: row.admission_ref === null ? null : String(row.admission_ref),
    createdAt: asIso(row.created_at as Date | string),
    updatedAt: asIso(row.updated_at as Date | string),
  };
}

function mapParticipant(row: Record<string, unknown>): GameMatchParticipantV1 {
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    participantKind: row.participant_kind as GameMatchParticipantV1['participantKind'],
    gamePlayerId: row.game_player_id === null ? null : String(row.game_player_id),
    botKey: row.bot_key === null ? null : String(row.bot_key),
    seatKey: String(row.seat_key),
    teamId: row.team_id === null ? null : String(row.team_id),
  };
}

function mapTeam(row: Record<string, unknown>): GameMatchTeamV1 {
  return {
    id: String(row.id),
    matchId: String(row.match_id),
    teamKey: String(row.team_key),
  };
}

function mapReceipt(row: Record<string, unknown>): GamesCommandReceiptV1 {
  return {
    actorKey: String(row.actor_game_player_id),
    commandId: String(row.command_id),
    commandKind: String(row.command_kind),
    fingerprint: String(row.fingerprint),
    resourceType: String(row.resource_type),
    resourceId: row.resource_id === null ? null : String(row.resource_id),
    outcomeKind: row.outcome_kind as GamesCommandReceiptV1['outcomeKind'],
    resultRef: row.result_ref === null ? null : String(row.result_ref),
    createdAt: asIso(row.created_at as Date | string),
  };
}

class PgGamesRepositoryTransaction implements GamesRepositoryTransactionPort {
  constructor(
    private readonly client: PoolClient,
    private readonly context: GamesRequestContextV1,
  ) {}

  async findCommandReceipt(commandId: string): Promise<GamesCommandReceiptV1 | null> {
    const result = await this.client.query(
      `SELECT actor_game_player_id, command_id, command_kind, fingerprint,
              resource_type, resource_id, outcome_kind, result_ref, created_at
         FROM games.command_receipts
        WHERE actor_game_player_id = $1
          AND command_id = $2`,
      [this.context.gamePlayerId, commandId],
    );
    return result.rows[0] ? mapReceipt(result.rows[0]) : null;
  }

  async getMatch(matchId: GameMatchId): Promise<GameMatchV1 | null> {
    const result = await this.client.query(`SELECT * FROM games.matches WHERE id = $1`, [matchId]);
    return result.rows[0] ? mapMatch(result.rows[0]) : null;
  }

  async listParticipants(matchId: GameMatchId): Promise<readonly GameMatchParticipantV1[]> {
    const result = await this.client.query(
      `SELECT id, match_id, participant_kind, game_player_id, bot_key, seat_key, team_id
         FROM games.match_participants
        WHERE match_id = $1
        ORDER BY seat_key, id`,
      [matchId],
    );
    return result.rows.map(mapParticipant);
  }

  async listTeams(matchId: GameMatchId): Promise<readonly GameMatchTeamV1[]> {
    const result = await this.client.query(
      `SELECT id, match_id, team_key
         FROM games.match_teams
        WHERE match_id = $1
        ORDER BY team_key, id`,
      [matchId],
    );
    return result.rows.map(mapTeam);
  }

  async createMatchFoundation(input: CreateGameMatchFoundationInput): Promise<GamesWriteResult> {
    const issues = validateGameMatchStructure({
      match: input.match,
      participants: input.participants,
      teams: input.teams,
    });
    if (issues.length > 0) {
      throw new Error(
        `Invalid GameMatch foundation: ${issues.map((issue) => issue.code).join(', ')}`,
      );
    }
    if (
      !input.participants.some(
        (participant) =>
          participant.participantKind === 'player' &&
          participant.gamePlayerId === this.context.gamePlayerId,
      )
    ) {
      return { ok: false, reason: 'forbidden' };
    }

    const replay = await this.lockAndResolveReceipt(input.receipt);
    if (replay) return replay;

    const matchInsert = await this.client.query(
      `INSERT INTO games.matches (
          id, game_key, game_version, rules_version, state_schema_version,
          protocol_version, rating_policy_version, admission_kind,
          competition_kind, scope_kind, runtime_kind, topology, status,
          lifecycle_version, game_config_ref, admission_ref,
          created_by_game_player_id, created_at, updated_at
       ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18, $19
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        input.match.id,
        input.match.gameKey,
        input.match.gameVersion,
        input.match.rulesVersion,
        input.match.stateSchemaVersion,
        input.match.protocolVersion,
        input.match.ratingPolicyVersion,
        input.match.admissionKind,
        input.match.competitionKind,
        input.match.scopeKind,
        input.match.runtimeKind,
        input.match.topology,
        input.match.status,
        input.match.lifecycleVersion,
        input.match.gameConfigRef,
        input.match.admissionRef,
        this.context.gamePlayerId,
        input.match.createdAt,
        input.match.updatedAt,
      ],
    );
    if (matchInsert.rowCount !== 1) return { ok: false, reason: 'conflict' };

    for (const team of input.teams) {
      await this.client.query(
        `INSERT INTO games.match_teams (id, match_id, team_key)
         VALUES ($1, $2, $3)`,
        [team.id, team.matchId, team.teamKey],
      );
    }

    for (const participant of input.participants) {
      await this.client.query(
        `INSERT INTO games.match_participants (
            id, match_id, participant_kind, game_player_id, bot_key, seat_key, team_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          participant.id,
          participant.matchId,
          participant.participantKind,
          participant.gamePlayerId,
          participant.botKey,
          participant.seatKey,
          participant.teamId,
        ],
      );
    }

    await this.insertReceipt(input.receipt);
    return { ok: true, replayed: false };
  }

  async saveMatchLifecycle(input: SaveGameMatchLifecycleInput): Promise<GamesWriteResult> {
    if (
      !Number.isInteger(input.expectedLifecycleVersion) ||
      input.expectedLifecycleVersion < 1 ||
      input.match.lifecycleVersion !== input.expectedLifecycleVersion + 1
    ) {
      return { ok: false, reason: 'conflict' };
    }

    const replay = await this.lockAndResolveReceipt(input.receipt);
    if (replay) return replay;

    const result = await this.client.query(
      `UPDATE games.matches
          SET status = $3,
              lifecycle_version = $4,
              updated_at = $5
        WHERE id = $1
          AND lifecycle_version = $2
        RETURNING id`,
      [
        input.match.id,
        input.expectedLifecycleVersion,
        input.match.status,
        input.match.lifecycleVersion,
        input.match.updatedAt,
      ],
    );
    if (result.rowCount !== 1) return { ok: false, reason: 'conflict' };

    await this.insertReceipt(input.receipt);
    return { ok: true, replayed: false };
  }

  private async lockAndResolveReceipt(
    receipt: GamesCommandReceiptV1,
  ): Promise<GamesWriteResult | null> {
    if (receipt.actorKey !== this.context.gamePlayerId) {
      return { ok: false, reason: 'forbidden' };
    }
    await this.client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `${receipt.actorKey}:${receipt.commandId}`,
    ]);
    const existing = await this.findCommandReceipt(receipt.commandId);
    if (!existing) return null;
    if (
      existing.commandKind === receipt.commandKind &&
      existing.fingerprint === receipt.fingerprint
    ) {
      return { ok: true, replayed: true };
    }
    return { ok: false, reason: 'duplicate' };
  }

  private async insertReceipt(receipt: GamesCommandReceiptV1): Promise<void> {
    await this.client.query(
      `INSERT INTO games.command_receipts (
          actor_game_player_id, command_id, command_kind, fingerprint,
          resource_type, resource_id, outcome_kind, result_ref, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        receipt.actorKey,
        receipt.commandId,
        receipt.commandKind,
        receipt.fingerprint,
        receipt.resourceType,
        receipt.resourceId,
        receipt.outcomeKind,
        receipt.resultRef,
        receipt.createdAt,
      ],
    );
  }
}

export class PgGamesRepository implements GamesRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async withRequestContext<T>(
    context: GamesRequestContextV1,
    operation: (transaction: GamesRepositoryTransactionPort) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.game_player_id', $1, true)`, [
        context.gamePlayerId,
      ]);
      await client.query(`SELECT set_config('app.games_audit_id', $1, true)`, [context.auditId]);
      const result = await operation(new PgGamesRepositoryTransaction(client, context));
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
