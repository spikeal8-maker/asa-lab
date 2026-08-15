import { describe, it, expect } from 'vitest';
import { isValidClassroomTitle } from '../domain/classroom';
import {
  classroomCodeFor,
  classroomCodeHash,
  formatClassroomCode,
  normalizeClassroomCode,
} from '../domain/classroom-code';
import {
  CreateClassroomUseCase,
  classroomRequestFingerprint,
} from '../application/create-classroom.usecase';
import type { ClassroomRepositoryPort, CreateClassroomInput } from '../application/ports';

describe('classroom domain', () => {
  it('validates titles', () => {
    expect(isValidClassroomTitle('8А Робототехника')).toBe(true);
    expect(isValidClassroomTitle('  ')).toBe(false);
    expect(isValidClassroomTitle('x'.repeat(256))).toBe(false);
    expect(isValidClassroomTitle(7)).toBe(false);
  });

  it('fingerprints the normalized payload deterministically', () => {
    expect(classroomRequestFingerprint('A')).toBe(classroomRequestFingerprint('A'));
    expect(classroomRequestFingerprint('A')).not.toBe(classroomRequestFingerprint('B'));
  });

  it('normalizes classroom codes without depending on spaces or case', () => {
    expect(normalizeClassroomCode('abc-def 234')).toBe('ABCDEF234');
    expect(formatClassroomCode('abcdef234')).toBe('ABC DEF 234');
    expect(classroomCodeHash('ABC DEF 234')).toBe(classroomCodeHash('abcdef234'));
  });

  it('derives stable versioned classroom codes from server-only material', () => {
    const first = classroomCodeFor('classroom-1', 1, 'secret');
    expect(first).toMatch(/^[A-Z2-9]{3} [A-Z2-9]{3} [A-Z2-9]{3}$/);
    expect(classroomCodeFor('classroom-1', 1, 'secret')).toBe(first);
    expect(classroomCodeFor('classroom-1', 2, 'secret')).not.toBe(first);
  });
});

function fakeRepo(): { port: ClassroomRepositoryPort; calls: CreateClassroomInput[] } {
  const calls: CreateClassroomInput[] = [];
  const port: ClassroomRepositoryPort = {
    createWithOwner: async (input) => {
      const previous = calls.find((c) => c.idempotencyKey === input.idempotencyKey);
      calls.push(input);
      if (previous && previous.requestFingerprint !== input.requestFingerprint) {
        return { kind: 'conflict' };
      }
      return {
        kind: previous ? 'existing' : 'created',
        classroom: {
          id: 'c-1',
          title: input.title,
          status: 'active',
          ageBand: input.ageBand,
          topicKeys: input.topicKeys,
          safeModeDefault: input.safeModeDefault,
          studentCount: 0,
          joinCodeVersion: 1,
          joinCodeStatus: 'active',
          teacherRole: 'owner',
          workspaceKind: 'personal',
          workspaceTitle: 'Личные классы',
          createdAt: 'now',
        },
      };
    },
    listForAccount: async () => [],
  };
  return { port, calls };
}

describe('create classroom use case', () => {
  const base = {
    accountId: 'a1',
    tenantId: 't1',
    classroomId: 'c-1',
    schoolId: 's1',
    academicPeriodId: 'p1',
    teacherId: 'u1',
    idempotencyKey: 'k',
    ageBand: 'mixed',
    topicKeys: [] as string[],
    safeModeDefault: true,
    joinCodeHash: 'hash',
  };

  it('trims the title and passes the server-derived context plus fingerprint', async () => {
    const { port, calls } = fakeRepo();
    const result = await new CreateClassroomUseCase(port).execute({ ...base, title: '  8А  ' });
    expect(result.ok).toBe(true);
    expect(calls[0]?.title).toBe('8А');
    expect(calls[0]?.requestFingerprint).toBe(classroomRequestFingerprint('8А'));
  });

  it('same key + same payload => existing classroom, created=false', async () => {
    const { port } = fakeRepo();
    const usecase = new CreateClassroomUseCase(port);
    const first = await usecase.execute({ ...base, title: 'A' });
    const second = await usecase.execute({ ...base, title: 'A' });
    expect(first.ok && first.created).toBe(true);
    expect(second.ok && !second.created).toBe(true);
  });

  it('same key + different payload => idempotency_conflict', async () => {
    const { port } = fakeRepo();
    const usecase = new CreateClassroomUseCase(port);
    await usecase.execute({ ...base, title: 'A' });
    const second = await usecase.execute({ ...base, title: 'B' });
    expect(second).toMatchObject({ ok: false, code: 'idempotency_conflict' });
  });

  it('rejects an invalid title', async () => {
    const { port } = fakeRepo();
    const result = await new CreateClassroomUseCase(port).execute({ ...base, title: '' });
    expect(result).toMatchObject({ ok: false, code: 'validation_error' });
  });
});
