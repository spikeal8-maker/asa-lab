import { describe, expect, it } from 'vitest';
import {
  createGamesCommandFingerprint,
  validateGameMatchStructure,
  validateGamesCommandEnvelope,
  type GameMatchParticipantV1,
  type GameMatchV1,
} from '../index.js';

function match(overrides: Partial<GameMatchV1> = {}): GameMatchV1 {
  return {
    id: 'match-1',
    gameKey: 'checkers-russian-64',
    gameVersion: '1.0.0',
    rulesVersion: 'russian-64-v1',
    stateSchemaVersion: 1,
    protocolVersion: 'games-command-v1',
    ratingPolicyVersion: null,
    admissionKind: 'invite',
    competitionKind: 'casual',
    scopeKind: 'private',
    runtimeKind: 'command',
    topology: 'duel',
    status: 'waiting',
    lifecycleVersion: 1,
    gameConfigRef: null,
    admissionRef: 'invite-1',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

function player(id: string, seatKey: string, playerId: string): GameMatchParticipantV1 {
  return {
    id,
    matchId: 'match-1',
    participantKind: 'player',
    gamePlayerId: playerId,
    botKey: null,
    seatKey,
    teamId: null,
  };
}

describe('Games Core foundation', () => {
  it('accepts a canonical private Checkers duel with zero team rows', () => {
    const issues = validateGameMatchStructure({
      match: match(),
      participants: [player('p1', 'light', 'gp-a'), player('p2', 'dark', 'gp-b')],
      teams: [],
    });
    expect(issues).toEqual([]);
  });

  it('rejects synthetic teams in duel topology', () => {
    const light = { ...player('p1', 'light', 'gp-a'), teamId: 'team-light' };
    const issues = validateGameMatchStructure({
      match: match(),
      participants: [light, player('p2', 'dark', 'gp-b')],
      teams: [{ id: 'team-light', matchId: 'match-1', teamKey: 'light' }],
    });
    expect(issues.map((issue) => issue.code)).toContain('UNEXPECTED_TEAMS');
  });

  it('requires rated policy only for rated matches', () => {
    const ratedIssues = validateGameMatchStructure({
      match: match({ competitionKind: 'rated', ratingPolicyVersion: null }),
      participants: [player('p1', 'light', 'gp-a'), player('p2', 'dark', 'gp-b')],
      teams: [],
    });
    expect(ratedIssues.map((issue) => issue.code)).toContain('INVALID_RATING_POLICY');

    const casualIssues = validateGameMatchStructure({
      match: match({ ratingPolicyVersion: 'rating-v1' }),
      participants: [player('p1', 'light', 'gp-a'), player('p2', 'dark', 'gp-b')],
      teams: [],
    });
    expect(casualIssues.map((issue) => issue.code)).toContain('INVALID_RATING_POLICY');
  });

  it('keeps command fingerprints stable across object key order and changes them with expectedVersion', () => {
    const first = createGamesCommandFingerprint({
      commandKind: 'checkers.move',
      targetRef: 'match-1',
      expectedVersion: 4,
      payload: { to: 18, from: 9 },
    });
    const reordered = createGamesCommandFingerprint({
      commandKind: 'checkers.move',
      targetRef: 'match-1',
      expectedVersion: 4,
      payload: { from: 9, to: 18 },
    });
    const newerVersion = createGamesCommandFingerprint({
      commandKind: 'checkers.move',
      targetRef: 'match-1',
      expectedVersion: 5,
      payload: { from: 9, to: 18 },
    });

    expect(reordered).toBe(first);
    expect(newerVersion).not.toBe(first);
  });

  it('enforces the R0 command id and expectedVersion envelope', () => {
    expect(
      validateGamesCommandEnvelope({
        commandId: 'move:01.safe_retry',
        commandKind: 'checkers.move',
        targetRef: 'match-1',
        expectedVersion: 1,
        payload: {},
      }),
    ).toEqual([]);

    expect(
      validateGamesCommandEnvelope({
        commandId: 'bad key with spaces',
        commandKind: 'checkers.move',
        targetRef: 'match-1',
        expectedVersion: 0,
        payload: {},
      }),
    ).toEqual(['INVALID_COMMAND_ID', 'INVALID_EXPECTED_VERSION']);
  });
});
