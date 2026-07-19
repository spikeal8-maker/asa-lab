import type { TeachingContextPort } from './ports.js';
import type { TeachingContext } from '../domain/types.js';

export type TeachingContextResult =
  | { readonly ok: true; readonly context: TeachingContext }
  | { readonly ok: false; readonly code: 'no_school_assigned' | 'no_active_period' };

export class GetTeachingContextUseCase {
  constructor(private readonly port: TeachingContextPort) {}

  async execute(tenantId: string, schoolId: string | null): Promise<TeachingContextResult> {
    if (schoolId === null) {
      return { ok: false, code: 'no_school_assigned' };
    }
    const context = await this.port.getActiveTeachingContext(tenantId, schoolId);
    if (context === null) {
      return { ok: false, code: 'no_active_period' };
    }
    return { ok: true, context };
  }
}
