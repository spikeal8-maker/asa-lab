import { createHash } from 'node:crypto';
import { isValidClassroomTitle, type Classroom } from '../domain/classroom.js';
import type { ClassroomRepositoryPort } from './ports.js';

export type CreateClassroomResult =
  | { readonly ok: true; readonly classroom: Classroom; readonly created: boolean }
  | { readonly ok: false; readonly code: 'validation_error'; readonly message: string }
  | { readonly ok: false; readonly code: 'idempotency_conflict'; readonly message: string };

/** Fingerprint of the normalized payload: a retry with the same key must carry
 * the same intent, otherwise the request is rejected as a conflict. */
export function classroomRequestFingerprint(title: string): string {
  return createHash('sha256').update(JSON.stringify({ title })).digest('hex');
}

export class CreateClassroomUseCase {
  constructor(private readonly repository: ClassroomRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    schoolId: string;
    academicPeriodId: string;
    teacherId: string;
    title: unknown;
    idempotencyKey: string;
  }): Promise<CreateClassroomResult> {
    if (!isValidClassroomTitle(input.title)) {
      return { ok: false, code: 'validation_error', message: 'title must be 1..255 characters' };
    }
    const title = input.title.trim();
    const result = await this.repository.createWithOwner({
      tenantId: input.tenantId,
      schoolId: input.schoolId,
      academicPeriodId: input.academicPeriodId,
      teacherId: input.teacherId,
      title,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: classroomRequestFingerprint(title),
    });
    if (result.kind === 'conflict') {
      return {
        ok: false,
        code: 'idempotency_conflict',
        message: 'the same Idempotency-Key was already used with a different payload',
      };
    }
    return { ok: true, classroom: result.classroom, created: result.kind === 'created' };
  }
}
