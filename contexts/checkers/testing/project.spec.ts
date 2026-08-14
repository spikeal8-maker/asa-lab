import { describe, expect, it } from 'vitest';
import { createInitialCheckersDocument } from '../domain/document';
import {
  createInitialCheckersProjectDocument,
  validateCheckersProjectDocument,
} from '../domain/project';

describe('persisted Checkers project document', () => {
  it('creates a complete learning aggregate around the Russian-64 game', () => {
    const project = createInitialCheckersProjectDocument('student-1');
    expect(project).toMatchObject({
      kind: 'asa-checkers-project',
      game: { ruleset: 'russian-64', pieces: expect.any(Array) },
      education: {
        selectedBotId: 'iskra',
        unlockedBotRung: 1,
        completedPuzzleIds: [],
        assignments: [],
      },
    });
    expect(project.education.progress).toHaveLength(18);
    expect(validateCheckersProjectDocument(project)).toEqual({ ok: true, value: project });
  });

  it('upgrades board-only foundation drafts without losing the game', () => {
    const legacy = createInitialCheckersDocument('lesson');
    const parsed = validateCheckersProjectDocument(legacy);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.game).toEqual(legacy);
    expect(parsed.value.education.progress).toHaveLength(18);
  });

  it('rejects tampered bot progression and duplicate puzzle evidence', () => {
    const project = createInitialCheckersProjectDocument();
    expect(
      validateCheckersProjectDocument({
        ...project,
        education: { ...project.education, unlockedBotRung: 99 },
      }),
    ).toEqual({ ok: false, message: 'checkers bot progression is invalid' });
    expect(
      validateCheckersProjectDocument({
        ...project,
        education: {
          ...project.education,
          completedPuzzleIds: ['capture-choice', 'capture-choice'],
        },
      }),
    ).toEqual({ ok: false, message: 'education.completedPuzzleIds is invalid' });
  });
});
