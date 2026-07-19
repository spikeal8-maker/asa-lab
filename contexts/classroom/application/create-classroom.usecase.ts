import { isValidClassroomTitle, type Classroom } from '../domain/classroom.js';
import type { ClassroomRepositoryPort } from './ports.js';

export type CreateClassroomResult =
  | { readonly ok: true; readonly classroom: Classroom; readonly created: boolean }
  | { readonly ok: false; readonly code: 'validation_error'; readonly message: string };

export class CreateClassroomUseCase {
  constructor(private readonly repository: ClassroomRepositoryPort) {}

  async execute(input: {
    tenantId: string;
    schoolId: string;
    academicPeriodId: string;
    teacherId: string;
    title: unknown;
    idempotencyKey: string | null;
  }): Promise<CreateClassroomResult> {
    if (!isValidClassroomTitle(input.title)) {
      return { ok: false, code: 'validation_error', message: 'title must be 1..255 characters' };
    }
    const { classroom, created } = await this.repository.createWithOwner({
      tenantId: input.tenantId,
      schoolId: input.schoolId,
      academicPeriodId: input.academicPeriodId,
      teacherId: input.teacherId,
      title: input.title.trim(),
      idempotencyKey: input.idempotencyKey,
    });
    return { ok: true, classroom, created };
  }
}
