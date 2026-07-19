import type { TeachingContext } from '../domain/types.js';

/** Resolves the school and active academic period for a teacher. */
export interface TeachingContextPort {
  getActiveTeachingContext(
    tenantId: string,
    schoolId: string | null,
  ): Promise<TeachingContext | null>;
}
