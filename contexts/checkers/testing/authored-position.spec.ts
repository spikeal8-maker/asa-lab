import { describe, expect, it } from 'vitest';
import {
  createAuthoredCheckersPositionReference,
  isAuthoredCheckersPositionReference,
  readAuthoredCheckersPositionReference,
} from '../domain/authored-position';
import { CHECKERS_STARTER_PUZZLES } from '../domain/starter-content';

describe('teacher-authored Checkers positions', () => {
  it('round-trips a validated position without a shared Project Core condition', () => {
    const source = { ...CHECKERS_STARTER_PUZZLES[1]!, id: 'teacher-position-1' };
    const reference = createAuthoredCheckersPositionReference(source);
    expect(reference.ok).toBe(true);
    if (!reference.ok) return;
    expect(isAuthoredCheckersPositionReference(reference.value)).toBe(true);
    const decoded = readAuthoredCheckersPositionReference(reference.value);
    expect(decoded).toEqual({ ok: true, value: source });
  });

  it('fails closed for malformed authored content', () => {
    expect(readAuthoredCheckersPositionReference('position-v1:%7Bbad')).toEqual({
      ok: false,
      message: 'authored Checkers position cannot be decoded',
    });
  });
});
