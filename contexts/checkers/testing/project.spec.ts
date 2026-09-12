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
        activeBotMode: 'free',
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

  it('upgrades CK-101 education state to campaign mode without losing progression', () => {
    const project = createInitialCheckersProjectDocument('student-1');
    const legacyEducation = Object.fromEntries(
      Object.entries(project.education).filter(([key]) => key !== 'activeBotMode'),
    );
    const parsed = validateCheckersProjectDocument({ ...project, education: legacyEducation });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.education.activeBotMode).toBe('campaign');
    expect(parsed.value.education.unlockedBotRung).toBe(project.education.unlockedBotRung);
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
