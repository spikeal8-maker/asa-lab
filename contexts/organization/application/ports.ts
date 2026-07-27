import type { TeachingContext } from '../domain/types.js';

/** Resolves the active academic period for the teacher's own school. A school
 * id is mandatory: there is no fallback to an arbitrary tenant school. */
export interface TeachingContextPort {
  getActiveTeachingContext(tenantId: string, schoolId: string): Promise<TeachingContext | null>;
}
