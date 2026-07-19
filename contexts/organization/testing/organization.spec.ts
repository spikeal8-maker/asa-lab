import { describe, it, expect } from 'vitest';
import { GetTeachingContextUseCase } from '../application/teaching-context.usecase';
import type { TeachingContextPort } from '../application/ports';

describe('teaching context use case', () => {
  it('passes tenant and school through to the port', async () => {
    const calls: unknown[] = [];
    const port: TeachingContextPort = {
      getActiveTeachingContext: async (tenantId, schoolId) => {
        calls.push([tenantId, schoolId]);
        return { schoolId: 's1', academicPeriodId: 'p1' };
      },
    };
    const result = await new GetTeachingContextUseCase(port).execute('t1', 's1');
    expect(result).toEqual({ schoolId: 's1', academicPeriodId: 'p1' });
    expect(calls).toEqual([['t1', 's1']]);
  });

  it('returns null when there is no active period', async () => {
    const port: TeachingContextPort = { getActiveTeachingContext: async () => null };
    expect(await new GetTeachingContextUseCase(port).execute('t1', null)).toBeNull();
  });
});
