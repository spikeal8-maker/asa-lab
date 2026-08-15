import type { CheckersDocumentResult } from './document.js';
import { validateCheckersPuzzle, type CheckersPuzzle } from './puzzle.js';

const AUTHORED_POSITION_PREFIX = 'position-v1:';

interface AuthoredPositionEnvelope {
  readonly schemaVersion: 1;
  readonly puzzle: CheckersPuzzle;
}

/** Stores a teacher-authored position inside the assignment reference. This
 * keeps Project Core module-neutral while making the assignment portable. */
export function createAuthoredCheckersPositionReference(
  puzzle: CheckersPuzzle,
): CheckersDocumentResult<string> {
  const validated = validateCheckersPuzzle(puzzle);
  if (!validated.ok) return validated;
  const envelope: AuthoredPositionEnvelope = { schemaVersion: 1, puzzle: validated.value };
  return {
    ok: true,
    value: `${AUTHORED_POSITION_PREFIX}${encodeURIComponent(JSON.stringify(envelope))}`,
  };
}

export function readAuthoredCheckersPositionReference(
  reference: string,
): CheckersDocumentResult<CheckersPuzzle> {
  if (!reference.startsWith(AUTHORED_POSITION_PREFIX)) {
    return { ok: false, message: 'assignment does not contain an authored Checkers position' };
  }
  try {
    const parsed = JSON.parse(
      decodeURIComponent(reference.slice(AUTHORED_POSITION_PREFIX.length)),
    ) as Partial<AuthoredPositionEnvelope>;
    if (parsed.schemaVersion !== 1 || !parsed.puzzle) {
      return { ok: false, message: 'authored Checkers position envelope is invalid' };
    }
    return validateCheckersPuzzle(parsed.puzzle);
  } catch {
    return { ok: false, message: 'authored Checkers position cannot be decoded' };
  }
}

export function isAuthoredCheckersPositionReference(reference: string): boolean {
  return reference.startsWith(AUTHORED_POSITION_PREFIX);
}
