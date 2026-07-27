import type { Classroom } from '../domain/classroom.js';

export interface CreateClassroomInput {
  readonly tenantId: string;
  readonly schoolId: string;
  readonly academicPeriodId: string;
  readonly teacherId: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
}

export type CreateWithOwnerResult =
  | { readonly kind: 'created'; readonly classroom: Classroom }
  | { readonly kind: 'existing'; readonly classroom: Classroom }
  | { readonly kind: 'conflict' };

export interface ClassroomRepositoryPort {
  /** Creates classroom + owner membership + audit event atomically. A repeat
   * with the same idempotency key and the same request fingerprint returns the
   * existing classroom; the same key with a different fingerprint conflicts. */
  createWithOwner(input: CreateClassroomInput): Promise<CreateWithOwnerResult>;
  listForTeacher(tenantId: string, teacherId: string): Promise<Classroom[]>;
}
