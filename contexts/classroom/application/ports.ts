import type { Classroom } from '../domain/classroom.js';

export interface CreateClassroomInput {
  readonly tenantId: string;
  readonly schoolId: string;
  readonly academicPeriodId: string;
  readonly teacherId: string;
  readonly title: string;
  readonly idempotencyKey: string | null;
}

export interface ClassroomRepositoryPort {
  /** Creates classroom + owner membership + audit event atomically. An
   * idempotent repeat returns the existing classroom with created=false. */
  createWithOwner(input: CreateClassroomInput): Promise<{ classroom: Classroom; created: boolean }>;
  listForTeacher(tenantId: string, teacherId: string): Promise<Classroom[]>;
}
