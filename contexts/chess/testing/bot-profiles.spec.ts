import { describe, expect, it } from 'vitest';
import {
  ASA_BOT_PROFILES,
  chooseAsaBotCandidateIndex,
  chooseMappedAsaBotMove,
  computeAsaBotMoveTimeMs,
  decideAsaBotMistake,
  validateAsaBotProfileCatalog,
  type AsaBotProfile,
} from '../domain/bot-profiles';
import { applyLegalMove, createStartPosition } from '../domain/chess';
import { ASA_OPENING_BOOK } from '../domain/opening-book';

const seedContext = {
  gameSeed: 'class-7-game-14',
  positionKey: 'start-position',
  ply: 12,
} as const;

describe('ASA bot profile foundation', () => {
  it('contains an immutable, strictly valid 4/4/3/1 catalog', () => {
    expect(validateAsaBotProfileCatalog(ASA_BOT_PROFILES)).toEqual([]);
    expect(ASA_BOT_PROFILES).toHaveLength(12);
    expect(Object.isFrozen(ASA_BOT_PROFILES)).toBe(true);
    for (const profile of ASA_BOT_PROFILES) {
      expect(Object.isFrozen(profile)).toBe(true);
      expect(Object.isFrozen(profile.style.weights)).toBe(true);
      expect(Object.isFrozen(profile.openingRepertoireIds)).toBe(true);
      expect(profile.calibrationStatus).toBe('not-calibrated');
      expect(profile.engine.level).toBeGreaterThanOrEqual(1);
      expect(profile.engine.level).toBeLessThanOrEqual(3);
      expect(profile.engine.depth).toBeGreaterThanOrEqual(1);
      expect(profile.engine.depth).toBeLessThanOrEqual(3);
    }
    expect(Object.groupBy(ASA_BOT_PROFILES, (profile) => profile.tier)).toMatchObject({
      beginner: expect.arrayContaining([
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      ]),
      intermediate: expect.arrayContaining([
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      ]),
      advanced: expect.arrayContaining([
        expect.any(Object),
        expect.any(Object),
        expect.any(Object),
      ]),
      adaptive: expect.arrayContaining([expect.any(Object)]),
    });
  });

  it('uses unique measurable style vectors and distinct signal pairs', () => {
    const vectors = new Set<string>();
    const signals = new Set<string>();
    for (const profile of ASA_BOT_PROFILES) {
      const vector = Object.values(profile.style.weights);
      expect(vector.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 10);
      expect(Math.max(...vector) - Math.min(...vector)).toBeGreaterThanOrEqual(0.1);
      vectors.add(vector.join('|'));
      const signalKey = [...profile.style.signals].sort().join('|');
      signals.add(signalKey);
      for (const signal of profile.style.signals) {
        expect(profile.style.weights[signal]).toBeGreaterThanOrEqual(0.2);
      }
    }
    expect(vectors.size).toBe(12);
    expect(signals.size).toBe(12);
  });

  it('references only the existing curated opening book', () => {
    const openingIds = new Set(ASA_OPENING_BOOK.map((opening) => opening.id));
    for (const profile of ASA_BOT_PROFILES) {
      expect(profile.openingRepertoireIds.length).toBeGreaterThanOrEqual(2);
      for (const openingId of profile.openingRepertoireIds)
        expect(openingIds.has(openingId)).toBe(true);
    }
  });

  it('keeps original fictional identities and no Chess.com or real-person names', () => {
    const forbidden =
      /chess\.com|chesscom|magnus|carlsen|hikaru|nakamura|kasparov|kramnik|fischer|gotham|stockfish/i;
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const profile of ASA_BOT_PROFILES) {
      expect(profile.id).toMatch(/^asa-bot-/);
      expect(profile.displayName).not.toMatch(forbidden);
      ids.add(profile.id);
      names.add(profile.displayName.toLocaleLowerCase('ru-RU'));
    }
    expect(ids.size).toBe(12);
    expect(names.size).toBe(12);
  });

  it('rejects schema drift, duplicate identities and invented opening ids', () => {
    const invalid = ASA_BOT_PROFILES.map((profile) => ({
      ...profile,
      targetEloBand: { ...profile.targetEloBand },
      engine: { ...profile.engine },
      style: { weights: { ...profile.style.weights }, signals: [...profile.style.signals] },
      openingRepertoireIds: [...profile.openingRepertoireIds],
      mistakeModel: { ...profile.mistakeModel },
      moveTimeModel: { ...profile.moveTimeModel },
      policy: {
        assistance: { ...profile.policy.assistance },
        challenge: { ...profile.policy.challenge },
      },
    })) as unknown as AsaBotProfile[];
    invalid[1] = {
      ...invalid[1]!,
      id: invalid[0]!.id,
      displayName: 'Magnus Chess.com',
      openingRepertoireIds: ['invented-opening'],
    };
    (invalid[2] as unknown as Record<string, unknown>).unexpected = true;
    const errors = validateAsaBotProfileCatalog(invalid);
    expect(errors.some((error) => error.includes('id must be unique'))).toBe(true);
    expect(errors.some((error) => error.includes('real-person or third-party'))).toBe(true);
    expect(errors.some((error) => error.includes('opening-book ids'))).toBe(true);
    expect(errors.some((error) => error.includes('must contain exactly'))).toBe(true);
  });

  it('makes deterministic seeded candidate, mistake and timing decisions with bounded outputs', () => {
    for (const profile of ASA_BOT_PROFILES) {
      const choice = chooseAsaBotCandidateIndex(profile, 7, seedContext);
      expect(chooseAsaBotCandidateIndex(profile, 7, seedContext)).toBe(choice);
      expect(choice).toBeGreaterThanOrEqual(0);
      expect(choice).toBeLessThan(7);

      const mistake = decideAsaBotMistake(profile, seedContext, 0.75);
      expect(decideAsaBotMistake(profile, seedContext, 0.75)).toEqual(mistake);
      expect(mistake.probability).toBeGreaterThanOrEqual(0);
      expect(mistake.probability).toBeLessThanOrEqual(profile.mistakeModel.maxChance);
      expect(mistake.roll).toBeGreaterThanOrEqual(0);
      expect(mistake.roll).toBeLessThan(1);

      const timingInput = {
        ...seedContext,
        legalMoveCount: 34,
        inCheck: true,
        remainingMs: 60_000,
      } as const;
      const time = computeAsaBotMoveTimeMs(profile, timingInput);
      expect(computeAsaBotMoveTimeMs(profile, timingInput)).toBe(time);
      expect(time).toBeGreaterThanOrEqual(50);
      expect(time).toBeLessThanOrEqual(profile.moveTimeModel.maximumMs);
      expect(time).toBeLessThanOrEqual(timingInput.remainingMs);
    }
  });

  it('maps representative profile levels to a legal current bot move', () => {
    const start = createStartPosition();
    for (const level of [1, 2, 3] as const) {
      const profile = ASA_BOT_PROFILES.find((candidate) => candidate.engine.level === level)!;
      const choice = chooseMappedAsaBotMove(start, profile);
      expect(choice).not.toBeNull();
      expect(choice?.profileId).toBe(profile.id);
      expect(choice?.depth).toBe(level);
      expect(applyLegalMove(start, choice!.uci).ok).toBe(true);
    }
  });
});
