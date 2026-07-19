import { describe, it, expect } from 'vitest';
import { isValidClassroomTitle } from '../domain/classroom';
import { CreateClassroomUseCase } from '../application/create-classroom.usecase';
import type { ClassroomRepositoryPort } from '../application/ports';

describe('classroom domain', () => {
  it('validates titles', () => {
    expect(isValidClassroomTitle('8А Робототехника')).toBe(true);
    expect(isValidClassroomTitle('  ')).toBe(false);
    expect(isValidClassroomTitle('x'.repeat(256))).toBe(false);
    expect(isValidClassroomTitle(7)).toBe(false);
  });
});

describe('create classroom use case', () => {
  function repo(): { port: ClassroomRepositoryPort; calls: unknown[] } {
    const calls: unknown[] = [];
    const port: ClassroomRepositoryPort = {
      createWithOwner: async (input) => {
        calls.push(input);
        const first = calls.length === 1;
        return {
          classroom: { id: 'c-1', title: input.title, status: 'active', createdAt: 'now' },
          created: first,
        };
      },
      listForTeacher: async () => [],
    };
    return { port, calls };
  }

  it('trims the title and passes the server-derived context', async () => {
    const { port, calls } = repo();
    const usecase = new CreateClassroomUseCase(port);
    const result = await usecase.execute({
      tenantId: 't1',
      schoolId: 's1',
      academicPeriodId: 'p1',
      teacherId: 'u1',
      title: '  8А  ',
      idempotencyKey: 'key-1',
    });
    expect(result.ok).toBe(true);
    expect((calls[0] as { title: string }).title).toBe('8А');
  });

  it('an idempotent repeat reports created=false with the same classroom', async () => {
    const { port } = repo();
    const usecase = new CreateClassroomUseCase(port);
    const base = {
      tenantId: 't1',
      schoolId: 's1',
      academicPeriodId: 'p1',
      teacherId: 'u1',
      title: 'A',
      idempotencyKey: 'k',
    };
    const first = await usecase.execute(base);
    const second = await usecase.execute(base);
    expect(first.ok && first.created).toBe(true);
    expect(second.ok && !second.created).toBe(true);
    if (first.ok && second.ok) {
      expect(second.classroom.id).toBe(first.classroom.id);
    }
  });

  it('rejects an invalid title', async () => {
    const { port } = repo();
    const result = await new CreateClassroomUseCase(port).execute({
      tenantId: 't1',
      schoolId: 's1',
      academicPeriodId: 'p1',
      teacherId: 'u1',
      title: '',
      idempotencyKey: null,
    });
    expect(result.ok).toBe(false);
  });
});
