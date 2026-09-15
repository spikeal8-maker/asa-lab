export type GamePlayerId = string;
export type GameMatchId = string;
export type GameMatchParticipantId = string;
export type GameMatchTeamId = string;

export type GameAdmissionKind =
  'direct' | 'invite' | 'matchmaking' | 'tournament' | 'event' | 'bot' | 'local';
export type GameCompetitionKind = 'casual' | 'rated';
export type GameScopeKind =
  'private' | 'classroom' | 'workspace' | 'global' | 'event' | 'tournament';
export type GameRuntimeKind = 'command' | 'realtime_room';
export type GameTopologyKind = 'duel' | 'free_for_all' | 'teams' | 'coop';
export type GameMatchStatus =
  'waiting' | 'ready' | 'active' | 'finishing' | 'finished' | 'cancelled' | 'aborted';
export type GameParticipantKind = 'player' | 'bot' | 'local_guest';

export interface GameMatchV1 {
  readonly id: GameMatchId;
  readonly gameKey: string;
  readonly gameVersion: string;
  readonly rulesVersion: string;
  readonly stateSchemaVersion: number;
  readonly protocolVersion: string;
  readonly ratingPolicyVersion: string | null;
  readonly admissionKind: GameAdmissionKind;
  readonly competitionKind: GameCompetitionKind;
  readonly scopeKind: GameScopeKind;
  readonly runtimeKind: GameRuntimeKind;
  readonly topology: GameTopologyKind;
  readonly status: GameMatchStatus;
  readonly lifecycleVersion: number;
  readonly gameConfigRef: string | null;
  readonly admissionRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GameMatchParticipantV1 {
  readonly id: GameMatchParticipantId;
  readonly matchId: GameMatchId;
  readonly participantKind: GameParticipantKind;
  readonly gamePlayerId: GamePlayerId | null;
  readonly botKey: string | null;
  readonly seatKey: string;
  readonly teamId: GameMatchTeamId | null;
}

export interface GameMatchTeamV1 {
  readonly id: GameMatchTeamId;
  readonly matchId: GameMatchId;
  readonly teamKey: string;
}

export interface GameMatchStructureV1 {
  readonly match: GameMatchV1;
  readonly participants: readonly GameMatchParticipantV1[];
  readonly teams: readonly GameMatchTeamV1[];
}

export interface GameMatchStructureIssue {
  readonly code:
    | 'INVALID_VERSION'
    | 'INVALID_RATING_POLICY'
    | 'PARTICIPANT_MATCH_MISMATCH'
    | 'TEAM_MATCH_MISMATCH'
    | 'DUPLICATE_SEAT_KEY'
    | 'DUPLICATE_TEAM_KEY'
    | 'INVALID_PARTICIPANT_IDENTITY'
    | 'INVALID_DUEL_ROSTER'
    | 'INVALID_FFA_ROSTER'
    | 'UNEXPECTED_TEAMS'
    | 'INVALID_TEAM_COUNT'
    | 'INVALID_TEAM_MEMBERSHIP';
  readonly message: string;
}

function participantIdentityIsValid(participant: GameMatchParticipantV1): boolean {
  switch (participant.participantKind) {
    case 'player':
      return Boolean(participant.gamePlayerId) && participant.botKey === null;
    case 'bot':
      return participant.gamePlayerId === null && Boolean(participant.botKey);
    case 'local_guest':
      return participant.gamePlayerId === null && participant.botKey === null;
  }
}

export function validateGameMatchStructure(
  input: GameMatchStructureV1,
): readonly GameMatchStructureIssue[] {
  const { match, participants, teams } = input;
  const issues: GameMatchStructureIssue[] = [];

  if (
    !Number.isInteger(match.stateSchemaVersion) ||
    match.stateSchemaVersion < 1 ||
    !Number.isInteger(match.lifecycleVersion) ||
    match.lifecycleVersion < 1
  ) {
    issues.push({
      code: 'INVALID_VERSION',
      message: 'stateSchemaVersion and lifecycleVersion must be positive integers.',
    });
  }

  if (
    (match.competitionKind === 'rated' && !match.ratingPolicyVersion) ||
    (match.competitionKind === 'casual' && match.ratingPolicyVersion !== null)
  ) {
    issues.push({
      code: 'INVALID_RATING_POLICY',
      message: 'Rated matches require ratingPolicyVersion; casual matches require null.',
    });
  }

  const seats = new Set<string>();
  for (const participant of participants) {
    if (participant.matchId !== match.id) {
      issues.push({
        code: 'PARTICIPANT_MATCH_MISMATCH',
        message: `Participant ${participant.id} belongs to another match.`,
      });
    }
    if (seats.has(participant.seatKey)) {
      issues.push({
        code: 'DUPLICATE_SEAT_KEY',
        message: `Duplicate seatKey ${participant.seatKey}.`,
      });
    }
    seats.add(participant.seatKey);
    if (!participantIdentityIsValid(participant)) {
      issues.push({
        code: 'INVALID_PARTICIPANT_IDENTITY',
        message: `Participant ${participant.id} has an invalid identity shape.`,
      });
    }
  }

  const teamIds = new Set<GameMatchTeamId>();
  const teamKeys = new Set<string>();
  for (const team of teams) {
    if (team.matchId !== match.id) {
      issues.push({
        code: 'TEAM_MATCH_MISMATCH',
        message: `Team ${team.id} belongs to another match.`,
      });
    }
    if (teamKeys.has(team.teamKey)) {
      issues.push({ code: 'DUPLICATE_TEAM_KEY', message: `Duplicate teamKey ${team.teamKey}.` });
    }
    teamIds.add(team.id);
    teamKeys.add(team.teamKey);
  }

  if (match.topology === 'duel') {
    if (participants.length !== 2) {
      issues.push({
        code: 'INVALID_DUEL_ROSTER',
        message: 'Duel matches require exactly two participants in V1.',
      });
    }
    if (teams.length !== 0 || participants.some((participant) => participant.teamId !== null)) {
      issues.push({
        code: 'UNEXPECTED_TEAMS',
        message: 'Duel matches must contain zero teams and null participant teamId values.',
      });
    }
  }

  if (match.topology === 'free_for_all') {
    if (participants.length < 2) {
      issues.push({
        code: 'INVALID_FFA_ROSTER',
        message: 'Free-for-all matches require at least two participants.',
      });
    }
    if (teams.length !== 0 || participants.some((participant) => participant.teamId !== null)) {
      issues.push({
        code: 'UNEXPECTED_TEAMS',
        message: 'Free-for-all matches must contain zero teams and null participant teamId values.',
      });
    }
  }

  if (match.topology === 'teams') {
    if (teams.length < 2) {
      issues.push({
        code: 'INVALID_TEAM_COUNT',
        message: 'Team matches require at least two match-scoped teams.',
      });
    }
    for (const participant of participants) {
      if (!participant.teamId || !teamIds.has(participant.teamId)) {
        issues.push({
          code: 'INVALID_TEAM_MEMBERSHIP',
          message: `Participant ${participant.id} must reference a team from the same match.`,
        });
      }
    }
  }

  if (match.topology === 'coop') {
    if (teams.length !== 1) {
      issues.push({
        code: 'INVALID_TEAM_COUNT',
        message: 'Co-op matches require exactly one match-scoped team.',
      });
    }
    for (const participant of participants) {
      if (!participant.teamId || !teamIds.has(participant.teamId)) {
        issues.push({
          code: 'INVALID_TEAM_MEMBERSHIP',
          message: `Participant ${participant.id} must reference the cooperative team.`,
        });
      }
    }
  }

  return issues;
}
