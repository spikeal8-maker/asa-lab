import type { TeachingContextPort } from './ports.js';
import type { TeachingContext } from '../domain/types.js';

export class GetTeachingContextUseCase {
  constructor(private readonly port: TeachingContextPort) {}

  async execute(tenantId: string, schoolId: string | null): Promise<TeachingContext | null> {
    return this.port.getActiveTeachingContext(tenantId, schoolId);
  }
}
