import { createHash } from 'node:crypto';

const COMMAND_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface GamesCommandEnvelope<TPayload> {
  readonly commandId: string;
  readonly commandKind: string;
  readonly targetRef: string | null;
  readonly expectedVersion: number | null;
  readonly payload: TPayload;
}

export interface GamesCommandReceiptV1 {
  readonly actorKey: string;
  readonly commandId: string;
  readonly commandKind: string;
  readonly fingerprint: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcomeKind: 'applied' | 'rejected';
  readonly resultRef: string | null;
  readonly createdAt: string;
}

export function isValidGamesCommandId(commandId: string): boolean {
  return COMMAND_ID_PATTERN.test(commandId);
}

export function isValidExpectedVersion(expectedVersion: number | null): boolean {
  return expectedVersion === null || (Number.isInteger(expectedVersion) && expectedVersion > 0);
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  return value;
}

export function createGamesCommandFingerprint<TPayload>(command: Omit<GamesCommandEnvelope<TPayload>, 'commandId'>): string {
  const canonical = JSON.stringify(
    normalize({
      commandKind: command.commandKind,
      targetRef: command.targetRef,
      expectedVersion: command.expectedVersion,
      payload: command.payload,
    }),
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function validateGamesCommandEnvelope<TPayload>(command: GamesCommandEnvelope<TPayload>): readonly string[] {
  const issues: string[] = [];
  if (!isValidGamesCommandId(command.commandId)) issues.push('INVALID_COMMAND_ID');
  if (!command.commandKind.trim()) issues.push('INVALID_COMMAND_KIND');
  if (!isValidExpectedVersion(command.expectedVersion)) issues.push('INVALID_EXPECTED_VERSION');
  return issues;
}
