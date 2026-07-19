import { describe, it, expect } from 'vitest';
import { GetTeachingContextUseCase } from '../application/teaching-context.usecase';
import type { TeachingContextPort } from '../application/ports';

describe('teaching context use case', () => {
  it('resolves the active period strictly for the teacher school', async () => {
    const calls: unknown[] = [];
    const port: TeachingContextPort = {
      getActiveTeachingContext: async (tenantId, schoolId) => {
        calls.push([tenantId, schoolId]);
        return { schoolId: 's1', academicPeriodId: 'p1' };
      },
    };
    const result = await new GetTeachingContextUseCase(port).execute('t1', 's1');
    expect(result).toEqual({ ok: true, context: { schoolId: 's1', academicPeriodId: 'p1' } });
    expect(calls).toEqual([['t1', 's1']]);
  });

  it('a teacher without a school gets an explicit domain error without any lookup', async () => {
    let called = 0;
    const port: TeachingContextPort = {
      getActiveTeachingContext: async () => {
        called += 1;
        return null;
      },
    };
    const result = await new GetTeachingContextUseCase(port).execute('t1', null);
    expect(result).toEqual({ ok: false, code: 'no_school_assigned' });
    expect(called).toBe(0);
  });

  it('missing active period is an explicit error, not a fallback', async () => {
    const port: TeachingContextPort = { getActiveTeachingContext: async () => null };
    const result = await new GetTeachingContextUseCase(port).execute('t1', 's1');
    expect(result).toEqual({ ok: false, code: 'no_active_period' });
  });
});
